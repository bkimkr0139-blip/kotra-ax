'use strict';
// Connection Lab · Schema Discovery · Profiling · ERD/Model Registry · Diff · DDL.
// 원칙: 읽기 전용(허용 목록 식별자만 사용), 샘플은 기본 마스킹, 모든 ERD/DDL/Mermaid는 같은 모델 JSON 에서 생성한다.
const { q } = require('../db');
const U = require('../util');
const { J, P, nid } = require('./core');

// ───────── 커넥터 (CRM_DEMO / BUYKOREA_DEMO / FILE_UPLOAD) ─────────
const DEMO_CONN = {
  CRM_DEMO: { system: 'CRM', tables: ['demo_crm_customer', 'demo_crm_participation', 'demo_crm_voc'], updated: { demo_crm_customer: 'updated_at' }, root: 'demo_crm_customer' },
  BUYKOREA_DEMO: { system: 'BUYKOREA', tables: ['demo_bk_member', 'demo_bk_product', 'demo_bk_inquiry'], updated: { demo_bk_member: 'modified_at' }, root: 'demo_bk_member' },
};
const ident = (s) => { if (!/^[a-z_][a-z0-9_]*$/i.test(s)) throw new U.HttpError(400, 'BAD_IDENTIFIER', 'invalid identifier'); return s; };
const PII_COL = /(email|name$|contact|manager_name|phone|address|reg_no|website)/i;
const mask = (col, v) => {
  if (v == null || v === '') return v;
  const s = String(v); if (!PII_COL.test(col)) return v;
  if (/email/i.test(col)) { const [a, d] = s.split('@'); return d ? `${a.slice(0, 2)}***@${d}` : '***'; }
  if (/reg_no/i.test(col)) return s.replace(/\d(?=\d{2})/g, '*');
  if (/address/i.test(col)) return s.split(/[ ,]+/).slice(0, 2).join(' ') + ' ***';
  return s.length <= 2 ? '**' : s.slice(0, 1) + '*'.repeat(Math.min(6, s.length - 2)) + s.slice(-1);
};

function uploadRows(sourceId, table) { const r = q.get('SELECT rows_json FROM di_upload WHERE source_id=? AND table_name=?', sourceId, table); return r ? P(r.rows_json, []) : []; }
function conn(src) {
  if (src.connector_type === 'FILE_UPLOAD') {
    const tables = q.all('SELECT table_name FROM di_upload WHERE source_id=?', src.id).map((r) => r.table_name);
    return { system: src.id, tables, updated: {}, root: tables[0], upload: true };
  }
  const c = DEMO_CONN[src.id]; if (!c) throw new U.HttpError(400, 'NO_CONNECTOR', `커넥터가 없습니다: ${src.id}`);
  return c;
}
function inferType(vals) {
  const v = vals.filter((x) => x != null && x !== '');
  if (!v.length) return 'TEXT';
  if (v.every((x) => /^-?\d+$/.test(String(x)))) return 'INTEGER';
  if (v.every((x) => /^-?\d+(\.\d+)?$/.test(String(x)))) return 'REAL';
  if (v.every((x) => /^\d{4}-\d{2}-\d{2}/.test(String(x)))) return 'TIMESTAMP';
  return 'TEXT';
}
function tableMeta(c, src, t) {
  if (c.upload) {
    const rows = uploadRows(src.id, t); const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
    return { name: t, rows_approx: rows.length, columns: keys.map((k, i) => ({ name: k, type: inferType(rows.map((r) => r[k])), nullable: true, pk: i === 0, fk: null })), indexes: [] };
  }
  ident(t);
  const cols = q.all(`PRAGMA table_info(${t})`); const fks = q.all(`PRAGMA foreign_key_list(${t})`);
  const rows = q.get(`SELECT COUNT(*) n FROM ${t}`).n;
  const idx = q.all(`PRAGMA index_list(${t})`).map((i) => ({ name: i.name, unique: !!i.unique }));
  return { name: t, rows_approx: rows, columns: cols.map((x) => { const fk = fks.find((f) => f.from === x.name); return { name: x.name, type: String(x.type || 'TEXT').toUpperCase(), nullable: !x.notnull && !x.pk, pk: !!x.pk, fk: fk ? `${fk.table}.${fk.to}` : null }; }), indexes: idx };
}
function readRows(c, src, t, { since, limit } = {}) {
  if (c.upload) return uploadRows(src.id, t).slice(0, limit || 10000);
  ident(t); const uc = c.updated[t];
  if (since && uc) return q.all(`SELECT * FROM ${t} WHERE ${ident(uc)} > ? ORDER BY ${uc}`, since);
  return q.all(`SELECT * FROM ${t}${limit ? ` LIMIT ${Number(limit) | 0}` : ''}`);
}
const pkOf = (meta) => (meta.columns.find((x) => x.pk) || meta.columns[0]).name;

function capabilities(src) {
  return src.connector_type === 'FILE_UPLOAD' ? { schema_discovery: true, snapshot: true, incremental: false, cdc: false, writeback: false }
    : { schema_discovery: true, snapshot: true, incremental: true, cdc: false, writeback: false };
}
function health(src) {
  try { const c = conn(src); const n = c.tables.reduce((a, t) => a + (c.upload ? uploadRows(src.id, t).length : q.get(`SELECT COUNT(*) n FROM ${ident(t)}`).n), 0); return { ok: true, tables: c.tables.length, rows: n }; }
  catch (e) { return { ok: false, error: e.message }; }
}

// ───────── 프로파일링 ─────────
const ISO2 = new Set('KR US JP VN AE DE SG TH ID CN GB FR IN AU CA BR MX SA TR PL'.split(' '));
const SEM = [
  [/email/i, 'EMAIL'], [/country|residence/i, 'COUNTRY'], [/reg_no/i, 'REG_NO'], [/hs_code/i, 'HS'], [/website|url/i, 'URL'],
  [/(_at|_until|_date)$/i, 'DATE'], [/status/i, 'ENUM'], [/consent_purpose|program_code|customer_type/i, 'ENUM'],
];
const semOf = (col) => (SEM.find(([re]) => re.test(col)) || [null, 'FREE'])[1];
function validValue(sem, v) {
  const s = String(v);
  switch (sem) {
    case 'EMAIL': return /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(s);
    case 'COUNTRY': return ISO2.has(s);
    case 'REG_NO': return /^\d{3}-\d{2}-\d{5}$/.test(s) ? krRegValid(s) : /^[A-Z]{2}-\d{6,12}$/.test(s);
    case 'HS': return /^\d{4}(\.\d{2}){0,2}$/.test(s) || /^\d{4,10}$/.test(s);
    case 'URL': return /^(https?:\/\/)?[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(s);
    case 'DATE': return !Number.isNaN(Date.parse(s));
    default: return true;
  }
}
function krRegValid(s) {
  const d = s.replace(/-/g, '').split('').map(Number); if (d.length !== 10) return false;
  const w = [1, 3, 7, 1, 3, 7, 1, 3, 5]; let sum = 0; for (let i = 0; i < 9; i++) sum += d[i] * w[i]; sum += Math.floor((d[8] * 5) / 10);
  return (10 - (sum % 10)) % 10 === d[9];
}
function profileTable(c, src, meta) {
  const rows = readRows(c, src, meta.name); const out = {};
  for (const col of meta.columns) {
    const vals = rows.map((r) => r[col.name]); const sem = semOf(col.name);
    const present = vals.filter((x) => x != null && x !== '');
    const dist = new Map(); present.forEach((x) => dist.set(String(x), (dist.get(String(x)) || 0) + 1));
    const invalid = sem === 'FREE' || sem === 'ENUM' ? 0 : present.filter((x) => !validValue(sem, x)).length;
    out[col.name] = { total: vals.length, null_count: vals.length - present.length, distinct_count: dist.size, invalid_count: invalid, semantic: sem, unique: dist.size === present.length && present.length > 0,
      top: dist.size <= 12 ? [...dist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, n]) => [PII_COL.test(col.name) ? mask(col.name, k) : k, n]) : undefined,
      min: ['DATE'].includes(sem) && present.length ? String(present.reduce((a, b) => (String(a) < String(b) ? a : b))).slice(0, 10) : undefined,
      max: ['DATE'].includes(sem) && present.length ? String(present.reduce((a, b) => (String(a) > String(b) ? a : b))).slice(0, 10) : undefined,
      sample: present.slice(0, 3).map((x) => mask(col.name, x)), sample_kind: 'ACTUAL_MASKED' };
  }
  return out;
}

// ───────── 개념(표준) 사전: 컬럼 → 표준 개념 후보 ─────────
const CONCEPTS = [
  ['organization_name', ['organization_name', 'business_name_en', 'company_name']], ['contact_person_name', ['contact_name', 'manager_name']], ['contact_email', ['contact_email', 'manager_email']],
  ['country_code', ['country_code', 'residence_country']], ['organization_identifier', ['business_reg_no', 'company_reg_no']], ['address', ['address_line', 'registered_address']],
  ['website', ['website', 'website_url']], ['consent_granted_at', ['consent_at', 'permission_granted_at']], ['consent_valid_until', ['consent_until', 'permission_expires_at']],
  ['consent_revoked_at', ['consent_revoked_at']], ['source_updated_at', ['updated_at', 'modified_at']], ['hs_code', ['main_hs_code', 'hs_code']], ['product_name', ['product_name_en']],
  ['participation_program', ['program_code']], ['customer_kind', ['customer_type']], ['account_status', ['account_status']], ['interest_industry', ['export_interest_category', 'interest_industry']],
];
const conceptOf = (col) => { const c = CONCEPTS.find(([, al]) => al.includes(col)); return c ? c[0] : null; };

function discover(src) {
  const c = conn(src); const metas = c.tables.map((t) => tableMeta(c, src, t)); const profile = {};
  metas.forEach((m) => { profile[m.name] = profileTable(c, src, m); m.columns.forEach((col) => { col.concept = conceptOf(col.name); }); });
  const relations = inferRelations(c, src, metas);
  return { system: c.system, tables: metas, relations, profile };
}
function inferRelations(c, src, metas) {
  const pks = {}; metas.forEach((m) => m.columns.filter((x) => x.pk).forEach((x) => { (pks[x.name] = pks[x.name] || []).push(m.name); }));
  const out = []; const seen = new Set();
  for (const m of metas) for (const col of m.columns) {
    if (col.fk) { const [pt, pc] = col.fk.split('.'); out.push({ from: m.name, fromCol: col.name, to: pt, toCol: pc, cardinality: 'N:1', declared: true, confidence: 1, verified: inclusion(c, src, m.name, col.name, pt, pc) }); seen.add(`${m.name}.${col.name}`); continue; }
    if (col.pk) continue;
    // 동일 이름 PK
    let target = (pks[col.name] || []).find((t) => t !== m.name); let conf = 0.9;
    if (!target) { // *_member_id → bk_member_id 등 접미 일치
      const tail = col.name.replace(/^(buyer|seller|parent|owner)_/, '');
      for (const [pk, ts] of Object.entries(pks)) if (pk.endsWith(tail) && tail !== col.name && ts[0] !== m.name) { target = ts[0]; conf = 0.7; }
      if (target) { const pk = metas.find((x) => x.name === target).columns.find((x) => x.pk).name; if (!seen.has(`${m.name}.${col.name}`)) out.push({ from: m.name, fromCol: col.name, to: target, toCol: pk, cardinality: 'N:1', declared: false, confidence: conf, verified: inclusion(c, src, m.name, col.name, target, pk) }); seen.add(`${m.name}.${col.name}`); }
      continue;
    }
    if (!seen.has(`${m.name}.${col.name}`)) { out.push({ from: m.name, fromCol: col.name, to: target, toCol: col.name, cardinality: 'N:1', declared: false, confidence: conf, verified: inclusion(c, src, m.name, col.name, target, col.name) }); seen.add(`${m.name}.${col.name}`); }
  }
  return out;
}
function inclusion(c, src, ft, fc, tt, tc) {
  try {
    const a = new Set(readRows(c, src, ft).map((r) => r[fc]).filter((x) => x != null)); const b = new Set(readRows(c, src, tt).map((r) => r[tc]));
    let miss = 0; a.forEach((x) => { if (!b.has(x)) miss++; }); return { checked: a.size, missing: miss, ok: miss === 0 };
  } catch { return { checked: 0, missing: 0, ok: null }; }
}
const canonSchema = (tables) => tables.map((t) => ({ n: t.name, c: t.columns.map((x) => [x.name, x.type, x.nullable, x.pk, x.fk || '']) })).sort((a, b) => a.n.localeCompare(b.n));
const schemaHash = (tables) => U.sha(J(canonSchema(tables)));

function captureSnapshot(ctx, src, mode = 'MANUAL') {
  const d = discover(src); const last = q.get('SELECT version FROM di_snapshot WHERE source_id=? ORDER BY version DESC LIMIT 1', src.id);
  const version = (last ? last.version : 0) + 1; const id = nid('SNP');
  q.insert('di_snapshot', { id, source_id: src.id, version, captured_at: U.iso(), schema_hash: schemaHash(d.tables), schema_json: J({ system: d.system, tables: d.tables, relations: d.relations }), profile_json: J(d.profile), capture_mode: mode, by_user: ctx && ctx.user ? ctx.user.id : 'system' });
  registerAsIsModel(ctx, src, id, version);
  return getSnapshot(id);
}
const hydSnap = (s) => s && ({ ...s, schema: P(s.schema_json, {}), profile: P(s.profile_json, {}) });
const getSnapshot = (id) => hydSnap(q.get('SELECT * FROM di_snapshot WHERE id=?', id));
const latestSnapshot = (sourceId) => hydSnap(q.get('SELECT * FROM di_snapshot WHERE source_id=? ORDER BY version DESC LIMIT 1', sourceId));
const listSnapshots = (sourceId) => q.all('SELECT id,source_id,version,captured_at,schema_hash,capture_mode FROM di_snapshot WHERE source_id=? ORDER BY version DESC', sourceId);

// ───────── 스키마 드리프트 Diff ─────────
function diffSchemas(oldS, newS) {
  const out = []; const om = Object.fromEntries((oldS.tables || []).map((t) => [t.name, t])); const nm = Object.fromEntries((newS.tables || []).map((t) => [t.name, t]));
  for (const t of Object.keys(nm)) if (!om[t]) out.push({ kind: 'NEW_TABLE', table: t });
  for (const t of Object.keys(om)) if (!nm[t]) out.push({ kind: 'DROPPED_TABLE', table: t });
  for (const t of Object.keys(nm)) {
    if (!om[t]) continue; const oc = Object.fromEntries(om[t].columns.map((c) => [c.name, c])); const nc = Object.fromEntries(nm[t].columns.map((c) => [c.name, c]));
    const added = Object.keys(nc).filter((c) => !oc[c]); const dropped = Object.keys(oc).filter((c) => !nc[c]);
    for (const c of added) out.push({ kind: 'NEW_COLUMN', table: t, column: c, new: { type: nc[c].type, nullable: nc[c].nullable } });
    for (const c of dropped) out.push({ kind: 'DROPPED_COLUMN', table: t, column: c, old: { type: oc[c].type } });
    for (const d of dropped) for (const a of added) if (oc[d].type === nc[a].type && U.sha(d.replace(/[^a-z]/g, '')).slice(0, 0) === '' && similarity(d, a) >= 0.6) out.push({ kind: 'RENAME_SUSPECTED', table: t, from: d, to: a, confidence: U.round(similarity(d, a), 2) });
    for (const c of Object.keys(nc)) if (oc[c]) {
      if (oc[c].type !== nc[c].type) out.push({ kind: 'TYPE_CHANGE', table: t, column: c, old: oc[c].type, new: nc[c].type });
      if (oc[c].nullable !== nc[c].nullable) out.push({ kind: 'NULLABLE_CHANGE', table: t, column: c, old: oc[c].nullable, new: nc[c].nullable });
      if (oc[c].pk !== nc[c].pk) out.push({ kind: 'PK_CHANGE', table: t, column: c, old: oc[c].pk, new: nc[c].pk });
    }
  }
  return out;
}
function similarity(a, b) {
  const g = (s) => { const t = `  ${s.toLowerCase()} `; const o = new Set(); for (let i = 0; i < t.length - 2; i++) o.add(t.slice(i, i + 3)); return o; };
  const x = g(a), y = g(b); let n = 0; x.forEach((v) => { if (y.has(v)) n++; }); return n / (x.size + y.size - n || 1);
}

// ───────── 모델 레지스트리 (AS-IS / CONCEPT / TOBE) ─────────
const hydModel = (m) => m && ({ ...m, model: P(m.schema_json, {}) });
function modelsOf(scope) { return q.all('SELECT * FROM di_model WHERE scope=? ORDER BY created_at, version', scope).map(hydModel); }
const getModel = (id) => hydModel(q.get('SELECT * FROM di_model WHERE id=?', id));
const activeModel = (scope) => hydModel(q.get("SELECT * FROM di_model WHERE scope=? AND status='ACTIVE' ORDER BY created_at DESC LIMIT 1", scope));
function erdFromSchema(schema) {
  return { entities: schema.tables.map((t) => ({ name: t.name, rows: t.rows_approx, columns: t.columns.map((c) => ({ name: c.name, type: c.type, pk: c.pk, fk: c.fk, nullable: c.nullable, concept: c.concept })) })),
    relations: (schema.relations || []).map((r) => ({ from: r.from, fromCol: r.fromCol, to: r.to, toCol: r.toCol, cardinality: r.cardinality, declared: r.declared, confidence: r.confidence, verified: r.verified })) };
}
function registerAsIsModel(ctx, src, snapId, version) {
  const scope = src.id === 'CRM_DEMO' ? 'CRM_ASIS' : src.id === 'BUYKOREA_DEMO' ? 'BK_ASIS' : `ASIS_${src.id}`;
  q.run("UPDATE di_model SET status='RETIRED' WHERE scope=? AND status='ACTIVE'", scope);
  const snap = getSnapshot(snapId); const parent = q.get('SELECT id FROM di_model WHERE scope=? ORDER BY created_at DESC LIMIT 1', scope);
  q.insert('di_model', { id: nid('MDL'), scope, version: `${version}.0.0`, status: 'ACTIVE', parent_id: parent ? parent.id : null, schema_json: J({ ...erdFromSchema(snap.schema), source_snapshot: snapId, notes: ['원천 메타데이터에서 자동 생성(실측)'] }), note: `snapshot ${snapId}`, created_by: ctx && ctx.user ? ctx.user.id : 'system', created_at: U.iso(), released_at: U.iso() });
}

const col = (name, type, o = {}) => ({ name, type, pk: !!o.pk, fk: o.fk || null, nullable: o.nullable !== undefined ? o.nullable : !o.pk, note: o.note });
const E = (name, columns, comment) => ({ name, comment, columns });
function conceptModel() {
  return { entities: [
    E('LEGAL_ENTITY', [col('legal_entity_id', 'uuid', { pk: 1 }), col('country_code', 'string(2)'), col('normalized_name', 'string(200)'), col('organization_identifier', 'string(40)', { note: '발급국가·검증상태와 함께 관리' })], '법인/사업체'),
    E('PARTY', [col('party_id', 'uuid', { pk: 1 }), col('party_type', 'string(16)'), col('lifecycle_status', 'string(16)'), col('created_at', 'datetime')], '고객 주체(기업/개인)'),
    E('PERSON', [col('person_id', 'uuid', { pk: 1 }), col('party_id', 'uuid', { fk: 'PARTY.party_id' }), col('display_name', 'string(100)')], '담당자/개인 — 법인과 별개'),
    E('ACCOUNT', [col('account_id', 'uuid', { pk: 1 }), col('party_id', 'uuid', { fk: 'PARTY.party_id' }), col('source_system', 'string(16)'), col('account_key', 'string(60)')], '로그인 계정 — 원천별, 병합 금지'),
    E('AFFILIATION', [col('affiliation_id', 'uuid', { pk: 1 }), col('party_id', 'uuid', { fk: 'PARTY.party_id' }), col('legal_entity_id', 'uuid', { fk: 'LEGAL_ENTITY.legal_entity_id' }), col('valid_from', 'datetime')], '사람↔기업 관계'),
    E('PRODUCT', [col('product_id', 'uuid', { pk: 1 }), col('legal_entity_id', 'uuid', { fk: 'LEGAL_ENTITY.legal_entity_id' }), col('hs_code', 'string(12)'), col('product_name', 'string(200)')], '기업 귀속 상품'),
    E('CONSENT_GRANT', [col('consent_id', 'uuid', { pk: 1 }), col('party_id', 'uuid', { fk: 'PARTY.party_id' }), col('purpose_code', 'string(60)'), col('granted_at', 'datetime'), col('expires_at', 'datetime'), col('status', 'string(16)')], '목적별 동의'),
    E('SOURCE_RECORD', [col('source_record_id', 'uuid', { pk: 1 }), col('source_system', 'string(16)'), col('source_table', 'string(60)'), col('source_pk', 'string(60)'), col('fingerprint', 'string(64)')], '원천 레코드 식별'),
    E('CUSTOMER_ACTIVITY', [col('activity_id', 'uuid', { pk: 1 }), col('party_id', 'uuid', { fk: 'PARTY.party_id' }), col('source_record_id', 'uuid', { fk: 'SOURCE_RECORD.source_record_id' }), col('event_type', 'string(30)'), col('occurred_at', 'datetime')], '참여/VOC/문의 — 출처·시점 있는 활동'),
  ], relations: [
    { from: 'PERSON', fromCol: 'party_id', to: 'PARTY', toCol: 'party_id', cardinality: 'N:1', declared: true, confidence: 1 }, { from: 'ACCOUNT', fromCol: 'party_id', to: 'PARTY', toCol: 'party_id', cardinality: 'N:1', declared: true, confidence: 1 },
    { from: 'AFFILIATION', fromCol: 'party_id', to: 'PARTY', toCol: 'party_id', cardinality: 'N:1', declared: true, confidence: 1 }, { from: 'AFFILIATION', fromCol: 'legal_entity_id', to: 'LEGAL_ENTITY', toCol: 'legal_entity_id', cardinality: 'N:1', declared: true, confidence: 1 },
    { from: 'PRODUCT', fromCol: 'legal_entity_id', to: 'LEGAL_ENTITY', toCol: 'legal_entity_id', cardinality: 'N:1', declared: true, confidence: 1 }, { from: 'CONSENT_GRANT', fromCol: 'party_id', to: 'PARTY', toCol: 'party_id', cardinality: 'N:1', declared: true, confidence: 1 },
    { from: 'CUSTOMER_ACTIVITY', fromCol: 'party_id', to: 'PARTY', toCol: 'party_id', cardinality: 'N:1', declared: true, confidence: 1 }, { from: 'CUSTOMER_ACTIVITY', fromCol: 'source_record_id', to: 'SOURCE_RECORD', toCol: 'source_record_id', cardinality: 'N:1', declared: true, confidence: 1 },
  ], notes: ['법인 ≠ 담당자 개인 ≠ 로그인 계정', '거래·상담·상품·문의는 고객 마스터 속성이 아니라 출처·시점이 있는 활동 데이터로 연결', '개념 모델은 기술 검증용 제안안이며 실제 CRM 기준 물리 ERD는 CNR-006·007 현황 분석 후 확정'] };
}
function tobeModel() {
  const m = { entities: [
    E('PARTY', [col('party_id', 'uuid', { pk: 1 }), col('party_type', 'string(16)'), col('lifecycle_status', 'string(16)'), col('display_name', 'string(200)'), col('country_code', 'string(2)'), col('consent_status', 'string(16)'), col('active_golden_version_id', 'uuid', { fk: 'GOLDEN_RECORD_VERSION.golden_version_id' }), col('merged_into', 'uuid'), col('created_at', 'datetime')], 'CRM 기준 정본 연결(PartyMaster)'),
    E('PARTY_IDENTIFIER', [col('identifier_id', 'uuid', { pk: 1 }), col('party_id', 'uuid', { fk: 'PARTY.party_id' }), col('identifier_type', 'string(30)'), col('normalized_value_hash', 'string(64)', { note: '평문 비저장, 정책 기반 해시' })], '이메일/등록번호 해시 — 단독 병합 근거 금지'),
    E('SOURCE_RECORD', [col('source_record_id', 'uuid', { pk: 1 }), col('source_system', 'string(16)'), col('source_table', 'string(60)'), col('source_pk', 'string(60)'), col('fingerprint', 'string(64)')], '원천 레코드(삭제·덮어쓰기 금지)'),
    E('SOURCE_CROSSWALK', [col('crosswalk_id', 'uuid', { pk: 1 }), col('party_id', 'uuid', { fk: 'PARTY.party_id' }), col('source_record_id', 'uuid', { fk: 'SOURCE_RECORD.source_record_id' }), col('match_status', 'string(16)'), col('valid_from', 'datetime'), col('valid_to', 'datetime', { nullable: true })], '활성 레코드 기준 (source_system,source_table,source_pk) 유일'),
    E('GOLDEN_RECORD_VERSION', [col('golden_version_id', 'uuid', { pk: 1 }), col('party_id', 'uuid', { fk: 'PARTY.party_id' }), col('version_no', 'int'), col('survivorship_rule_version', 'string(20)'), col('valid_from', 'datetime')], 'SCD Type 2 버전 이력'),
    E('CONSENT_GRANT', [col('consent_id', 'uuid', { pk: 1 }), col('party_id', 'uuid', { fk: 'PARTY.party_id' }), col('purpose_code', 'string(60)'), col('granted_at', 'datetime'), col('expires_at', 'datetime'), col('status', 'string(16)')], '목적별 동의'),
    E('AFFILIATION', [col('affiliation_id', 'uuid', { pk: 1 }), col('party_id', 'uuid', { fk: 'PARTY.party_id' }), col('legal_entity_id', 'uuid', { fk: 'PARTY.party_id' }), col('role_type', 'string(30)'), col('valid_from', 'datetime')], '담당자↔기업'),
    E('ACCOUNT_LINK', [col('account_link_id', 'uuid', { pk: 1 }), col('party_id', 'uuid', { fk: 'PARTY.party_id' }), col('source_system', 'string(16)'), col('account_key', 'string(60)')], '원천별 계정 — 계정 자체는 병합하지 않는다'),
    E('PRODUCT', [col('product_id', 'uuid', { pk: 1 }), col('legal_entity_id', 'uuid', { fk: 'PARTY.party_id' }), col('hs_code', 'string(12)'), col('product_name', 'string(200)')], '기업 귀속 상품'),
    E('CUSTOMER_ACTIVITY', [col('activity_id', 'uuid', { pk: 1 }), col('party_id', 'uuid', { fk: 'PARTY.party_id' }), col('source_record_id', 'uuid', { fk: 'SOURCE_RECORD.source_record_id' }), col('event_type', 'string(30)'), col('occurred_at', 'datetime')], '참여·VOC·문의'),
    E('PARTY_PROFILE', [col('party_id', 'uuid', { pk: 1, fk: 'PARTY.party_id' }), col('primary_country', 'string(2)'), col('hs_code_list', 'string(200)'), col('product_keys', 'string(200)')], 'ODS 서빙용 가공 프로필'),
  ], relations: [], notes: ['제안 모델 v1 — 승인 전 서비스에 영향 없음'] };
  m.relations = m.entities.flatMap((e) => e.columns.filter((c) => c.fk).map((c) => { const [t, tc] = c.fk.split('.'); return { from: e.name, fromCol: c.name, to: t, toCol: tc, cardinality: 'N:1', declared: true, confidence: 1 }; }));
  return m;
}

// ───────── 모델 Diff / 호환성 / 표준 점검 ─────────
function diffModels(a, b) {
  const ae = Object.fromEntries(a.entities.map((e) => [e.name, e])); const be = Object.fromEntries(b.entities.map((e) => [e.name, e])); const out = { entities_added: [], entities_removed: [], columns_added: [], columns_removed: [], columns_changed: [], relations_added: [], relations_removed: [] };
  for (const n of Object.keys(be)) if (!ae[n]) out.entities_added.push(n);
  for (const n of Object.keys(ae)) if (!be[n]) out.entities_removed.push(n);
  for (const n of Object.keys(be)) if (ae[n]) {
    const ac = Object.fromEntries(ae[n].columns.map((c) => [c.name, c])); const bc = Object.fromEntries(be[n].columns.map((c) => [c.name, c]));
    Object.keys(bc).filter((c) => !ac[c]).forEach((c) => out.columns_added.push({ entity: n, column: c, type: bc[c].type, nullable: bc[c].nullable }));
    Object.keys(ac).filter((c) => !bc[c]).forEach((c) => out.columns_removed.push({ entity: n, column: c }));
    Object.keys(bc).filter((c) => ac[c] && (ac[c].type !== bc[c].type || ac[c].nullable !== bc[c].nullable)).forEach((c) => out.columns_changed.push({ entity: n, column: c, from: { type: ac[c].type, nullable: ac[c].nullable }, to: { type: bc[c].type, nullable: bc[c].nullable } }));
  }
  const rk = (r) => `${r.from}.${r.fromCol}>${r.to}.${r.toCol}`; const ar = new Set((a.relations || []).map(rk)); const br = new Set((b.relations || []).map(rk));
  [...br].filter((x) => !ar.has(x)).forEach((x) => out.relations_added.push(x)); [...ar].filter((x) => !br.has(x)).forEach((x) => out.relations_removed.push(x));
  const breaking = out.entities_removed.length || out.columns_removed.length || out.columns_changed.some((c) => c.to.nullable === false && c.from.nullable !== false || c.from.type !== c.to.type);
  const additive = out.entities_added.length || out.columns_added.length || out.relations_added.length;
  out.semver = breaking ? 'major' : additive ? 'minor' : 'patch';
  out.compatibility = breaking ? 'BREAKING' : 'BACKWARD_COMPATIBLE';
  out.counts = { entities_added: out.entities_added.length, entities_removed: out.entities_removed.length, columns_added: out.columns_added.length, columns_removed: out.columns_removed.length, columns_changed: out.columns_changed.length };
  return out;
}
const AMBIG = ['nm', 'cd', 'no', 'dt', 'yn', 'flg', 'tp'];
function checkStandards(model) {
  const issues = []; const typeBy = {};
  for (const e of model.entities) {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(e.name)) issues.push({ severity: 'MEDIUM', entity: e.name, rule: 'NAMING', message: '엔터티 이름은 영문·숫자·밑줄만 사용' });
    if (!e.columns.some((c) => c.pk)) issues.push({ severity: 'HIGH', entity: e.name, rule: 'PK_MISSING', message: '식별키(PK) 누락' });
    const names = new Set();
    for (const c of e.columns) {
      if (names.has(c.name)) issues.push({ severity: 'HIGH', entity: e.name, column: c.name, rule: 'DUP_COLUMN', message: '중복 컬럼명' }); names.add(c.name);
      if (!/^[a-z][a-z0-9_]*$/.test(c.name)) issues.push({ severity: 'LOW', entity: e.name, column: c.name, rule: 'SNAKE_CASE', message: 'snake_case 권장' });
      if (c.name.split('_').some((t) => AMBIG.includes(t))) issues.push({ severity: 'LOW', entity: e.name, column: c.name, rule: 'AMBIGUOUS_ABBR', message: '불분명한 약어 사용' });
      const base = String(c.type).replace(/\(.*/, '').toLowerCase(); const k = c.name; (typeBy[k] = typeBy[k] || new Map()).set(`${e.name}`, String(c.type).toLowerCase()); void base;
      if (c.fk) { const [t, tc] = c.fk.split('.'); const te = model.entities.find((x) => x.name === t); if (!te || !te.columns.some((x) => x.name === tc)) issues.push({ severity: 'HIGH', entity: e.name, column: c.name, rule: 'FK_TARGET', message: `FK 대상 없음: ${c.fk}` }); }
    }
  }
  for (const [name, m] of Object.entries(typeBy)) { const types = new Set([...m.values()]); if (types.size > 1 && !name.endsWith('_id')) issues.push({ severity: 'MEDIUM', column: name, rule: 'DOMAIN_MISMATCH', message: `동일 컬럼명에 서로 다른 타입: ${[...types].join(', ')}` }); }
  return issues;
}

// ───────── 렌더링: Mermaid / DDL / SVG ─────────
function toMermaid(model) {
  const lines = ['erDiagram'];
  for (const r of model.relations) lines.push(`    ${r.to} ||--o{ ${r.from} : "${r.fromCol}${r.declared === false ? ' (inferred)' : ''}"`);
  for (const e of model.entities) { lines.push(`    ${e.name} {`); e.columns.forEach((c) => lines.push(`        ${String(c.type).replace(/[^A-Za-z0-9_]/g, '_')} ${c.name}${c.pk ? ' PK' : c.fk ? ' FK' : ''}`)); lines.push('    }'); }
  return lines.join('\n');
}
function sqlType(t, dialect) {
  const s = String(t).toLowerCase(); const len = (s.match(/\((\d+)\)/) || [])[1];
  if (s.startsWith('string') || s.startsWith('varchar')) return dialect === 'sqlite' ? 'TEXT' : `VARCHAR(${len || 255})`;
  if (s === 'uuid') return dialect === 'sqlite' ? 'TEXT' : 'UUID';
  if (s === 'datetime' || s === 'timestamp') return 'TIMESTAMP';
  if (s === 'int' || s === 'integer') return 'INTEGER';
  return String(t).toUpperCase();
}
function toDdl(model, dialect = 'ansi') {
  const out = ['-- REVIEW ONLY — 검토용 미리보기입니다. 운영 DB에 자동 실행되지 않습니다.', `-- dialect: ${dialect} · generated ${U.iso()}`, ''];
  const order = [...model.entities]; const fks = [];
  for (const e of order) {
    const pk = e.columns.filter((c) => c.pk).map((c) => c.name);
    out.push(`CREATE TABLE ${e.name} (`);
    const lines = e.columns.map((c) => `  ${c.name} ${sqlType(c.type, dialect)}${c.nullable === false || c.pk ? ' NOT NULL' : ''}`);
    if (pk.length) lines.push(`  PRIMARY KEY (${pk.join(', ')})`);
    out.push(lines.join(',\n')); out.push(');');
    e.columns.filter((c) => c.fk).forEach((c) => { const [t, tc] = c.fk.split('.'); fks.push(`ALTER TABLE ${e.name} ADD CONSTRAINT fk_${e.name}_${c.name} FOREIGN KEY (${c.name}) REFERENCES ${t}(${tc});`); });
    if (e.name === 'SOURCE_CROSSWALK') out.push('CREATE UNIQUE INDEX ux_crosswalk_active ON SOURCE_CROSSWALK (source_record_id) WHERE valid_to IS NULL;');
    out.push('');
  }
  if (fks.length) { out.push('-- 참조 무결성(물리 FK 미지원 환경에서는 서버 트랜잭션 검증으로 대체)'); out.push(...fks); }
  return out.join('\n');
}
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function layout(model, compact = false) {
  const ents = model.entities; const cols = Math.max(1, Math.ceil(Math.sqrt(ents.length * 1.4))); const pos = {}; const colW = []; const rowH = [];
  const size = (e) => ({ w: compact ? Math.max(150, e.name.length * 8.5 + 40) : Math.max(190, Math.min(300, Math.max(e.name.length * 8.5 + 24, ...e.columns.map((c) => (c.name.length + String(c.type).length + 6) * 6.8 + 36)))), h: compact ? 34 : 30 + e.columns.length * 19 + 8 });
  ents.forEach((e, i) => { const s = size(e); const c = i % cols; const r = Math.floor(i / cols); colW[c] = Math.max(colW[c] || 0, s.w); rowH[r] = Math.max(rowH[r] || 0, s.h); pos[e.name] = { c, r, ...s }; });
  const gx = 70, gy = 56; const xs = [0]; colW.forEach((w, i) => { xs[i + 1] = xs[i] + w + gx; }); const ys = [0]; rowH.forEach((h, i) => { ys[i + 1] = ys[i] + h + gy; });
  ents.forEach((e) => { const p = pos[e.name]; p.x = 24 + xs[p.c]; p.y = 24 + ys[p.r]; });
  return { pos, width: 48 + xs[xs.length - 1] - gx, height: 48 + ys[ys.length - 1] - gy };
}
function toSvg(model, { diff, selected, compact } = {}) {
  const { pos, width, height } = layout(model, compact); const added = new Set(diff ? diff.entities_added : []); const removed = new Set(diff ? diff.entities_removed : []);
  const chg = new Set(diff ? [...diff.columns_added.map((c) => c.entity), ...diff.columns_changed.map((c) => c.entity), ...diff.columns_removed.map((c) => c.entity)] : []);
  const addCols = new Set(diff ? diff.columns_added.map((c) => `${c.entity}.${c.column}`) : []); const chCols = new Set(diff ? diff.columns_changed.map((c) => `${c.entity}.${c.column}`) : []);
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${Math.ceil(width)} ${Math.ceil(height)}" width="${Math.ceil(width)}" height="${Math.ceil(height)}" role="img" aria-label="ERD" font-family="Pretendard, 'Noto Sans KR', sans-serif" font-size="12">`,
    '<defs><marker id="crow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0 0L10 5L0 10" fill="none" stroke="#5b6879" stroke-width="1.4"/></marker></defs>'];
  const rel = [];
  for (const r of model.relations) {
    const a = pos[r.from], b = pos[r.to]; if (!a || !b) continue;
    const ac = [a.x + a.w / 2, a.y + a.h / 2], bc = [b.x + b.w / 2, b.y + b.h / 2];
    const pt = (p, o) => { const dx = o[0] - (p.x + p.w / 2), dy = o[1] - (p.y + p.h / 2); const sx = Math.abs(dx) / (p.w / 2 || 1), sy = Math.abs(dy) / (p.h / 2 || 1); const k = Math.max(sx, sy) || 1; return [p.x + p.w / 2 + dx / k, p.y + p.h / 2 + dy / k]; };
    if (r.from === r.to) { rel.push(`<path d="M${a.x + a.w} ${a.y + 40} h26 v30 h-26" fill="none" stroke="#5b6879" stroke-width="1.4" marker-end="url(#crow)"/>`); continue; }
    const p1 = pt(a, bc), p2 = pt(b, ac); const bad = r.verified && r.verified.ok === false;
    const stroke = bad ? '#d4182b' : r.declared === false ? '#8693a4' : '#3a4657';
    rel.push(`<g class="rel" data-from="${esc(r.from)}" data-to="${esc(r.to)}"><line x1="${p1[0].toFixed(1)}" y1="${p1[1].toFixed(1)}" x2="${p2[0].toFixed(1)}" y2="${p2[1].toFixed(1)}" stroke="${stroke}" stroke-width="1.5"${r.declared === false ? ' stroke-dasharray="6 4"' : ''} marker-end="url(#crow)"/><text x="${((p1[0] + p2[0]) / 2).toFixed(1)}" y="${((p1[1] + p2[1]) / 2 - 4).toFixed(1)}" fill="${bad ? '#d4182b' : '#5b6879'}" font-size="10" text-anchor="middle">${esc(r.cardinality)}${r.declared === false ? ' ?' : ''}</text></g>`);
  }
  parts.push(...rel);
  for (const e of model.entities) {
    const p = pos[e.name]; const head = added.has(e.name) ? '#17794a' : removed.has(e.name) ? '#c0172a' : chg.has(e.name) ? '#9a5b00' : '#0b4ea2';
    parts.push(`<g class="ent${selected === e.name ? ' sel' : ''}" data-ent="${esc(e.name)}" tabindex="0" role="button" aria-label="${esc(e.name)}"><rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="8" fill="#fff" stroke="${selected === e.name ? '#f59e0b' : '#c3cedc'}" stroke-width="${selected === e.name ? 2.5 : 1.2}"/><path d="M${p.x} ${p.y + 28} V${p.y + 8} a8 8 0 0 1 8 -8 H${p.x + p.w - 8} a8 8 0 0 1 8 8 V${p.y + 28} Z" fill="${head}"/><text x="${p.x + 10}" y="${p.y + 19}" fill="#fff" font-weight="700">${esc(e.name)}</text>${e.rows != null ? `<text x="${p.x + p.w - 8}" y="${p.y + 19}" fill="#dbe7ff" font-size="10" text-anchor="end">${e.rows} rows</text>` : ''}`);
    (compact ? [] : e.columns).forEach((c, i) => { const y = p.y + 30 + i * 19 + 13; const key = `${e.name}.${c.name}`; const hl = addCols.has(key) ? '#e5f5ec' : chCols.has(key) ? '#fff3dc' : null;
      if (hl) parts.push(`<rect x="${p.x + 1}" y="${y - 12}" width="${p.w - 2}" height="18" fill="${hl}"/>`);
      parts.push(`<text x="${p.x + 10}" y="${y}" fill="#14202e" font-weight="${c.pk ? 700 : 400}" data-col="${esc(c.name)}">${c.pk ? '🔑 ' : c.fk ? '↗ ' : ''}${esc(c.name)}</text><text x="${p.x + p.w - 8}" y="${y}" fill="#8693a4" font-size="10.5" text-anchor="end">${esc(String(c.type).toLowerCase())}${c.nullable === false && !c.pk ? ' ·NN' : ''}</text>`); });
    parts.push('</g>');
  }
  parts.push('</svg>'); return parts.join('');
}

module.exports = { DEMO_CONN, conn, health, capabilities, tableMeta, readRows, pkOf, mask, discover, captureSnapshot, getSnapshot, latestSnapshot, listSnapshots, schemaHash, diffSchemas, similarity, conceptOf, CONCEPTS, validValue, krRegValid, semOf,
  modelsOf, getModel, activeModel, erdFromSchema, conceptModel, tobeModel, diffModels, checkStandards, toMermaid, toDdl, toSvg, PII_COL, ISO2, uploadRows };
