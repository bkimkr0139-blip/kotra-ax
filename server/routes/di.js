'use strict';
// Intelligent Data Integration Studio API — /api/v1/data-integration  (docs/16_DATA_INTEGRATION.md)
const { api } = require('../router');
const { q } = require('../db');
const U = require('../util');
const A = require('../auth');
const G = require('../gov');
const C = require('../di/core');
const S = require('../di/schema');
const M = require('../di/mapping');
const MDM = require('../di/mdm');
const DQ = require('../di/quality');
const PL = require('../di/pipeline');
const EV = require('../di/evolution');
const EVD = require('../di/evidence');
const UNI = require('../di/unified');

const B = '/api/v1/data-integration';
const R = (name) => ({ roles: C.rolesOf(name) });
const guard = (fn) => (ctx) => { C.guard(); return fn(ctx); };
const route = (method, path, role, fn) => api[method](B + path, guard(fn), role ? R(role) : { auth: true });
const rate = (ctx, key, n, ms = 60000) => { if (!A.rateLimit(`di:${key}:${ctx.user.id}`, n, ms)) throw new U.HttpError(429, 'RATE_LIMITED', '요청이 너무 많습니다 / Too many requests'); };
const caps = (u) => Object.fromEntries(Object.entries(C.ROLES).map(([k, v]) => [k, v.includes(u.role)]));

// ── 개요 ──────────────────────────────────────────────
route('get', '/config', 'DataViewer', (ctx) => ({ enabled: C.enabled(), strict_sod: C.strictSod(), capabilities: caps(ctx.user), note: '합성(SYNTHETIC) 데이터 기반 시연 모듈 — 운영계 쓰기·자동 DDL 금지' }));
route('get', '/overview', 'DataViewer', () => overview());
function overview() {
  const now = U.iso(); const snaps = ['CRM_DEMO', 'BUYKOREA_DEMO'].map((s) => S.latestSnapshot(s)).filter(Boolean);
  const tables = snaps.reduce((a, s) => a + s.schema.tables.length, 0); const cols = snaps.reduce((a, s) => a + s.schema.tables.reduce((x, t) => x + t.columns.length, 0), 0);
  const eligible = q.get("SELECT COUNT(*) n FROM di_raw WHERE status<>'SUPERSEDED' AND eligible=1").n; const total = q.get("SELECT COUNT(*) n FROM di_raw WHERE status<>'SUPERSEDED'").n;
  const dup = q.get("SELECT COUNT(*) n FROM di_candidate WHERE band IN ('AUTO_LINK_CANDIDATE','REVIEW_REQUIRED') AND status IN ('PENDING','NEEDS_INFO')").n; const golden = q.get("SELECT COUNT(*) n FROM di_party WHERE party_type='ORGANIZATION' AND lifecycle_status='ACTIVE'").n;
  const dq = DQ.latest(); const lag = {}; for (const s of ['CRM_DEMO', 'BUYKOREA_DEMO']) { const r = q.get("SELECT finished_at f FROM di_run WHERE (source_id=? OR source_id LIKE ? OR source_id LIKE ?) AND status IN ('SUCCEEDED','PARTIAL') ORDER BY finished_at DESC LIMIT 1", s, `${s},%`, `%,${s}`); lag[s] = r ? U.round((new Date(now) - new Date(r.f)) / 3600000, 2) : null; }
  const maxLag = Object.values(lag).filter((x) => x != null); const failed = q.get("SELECT COUNT(*) n FROM di_run WHERE status='FAILED' AND id NOT IN (SELECT parent_run_id FROM di_run WHERE parent_run_id IS NOT NULL)").n;
  const prop = q.all("SELECT state FROM di_proposal").map((x) => x.state); const pendingApprovals = q.get("SELECT COUNT(*) n FROM di_proposal WHERE state='REVIEW_REQUESTED'").n + q.get("SELECT COUNT(*) n FROM di_dq_issue WHERE status='REVIEWED'").n + q.get("SELECT COUNT(*) n FROM di_candidate WHERE status='PENDING' AND band='AUTO_LINK_CANDIDATE'").n;
  const src = (id) => { const s = q.get('SELECT * FROM di_source WHERE id=?', id); const h = S.health(s); const run = q.get("SELECT status, finished_at FROM di_run WHERE source_id LIKE ? ORDER BY finished_at DESC LIMIT 1", `%${id}%`); return { id, mode: s.integration_mode, status: h.ok ? 'HEALTHY' : 'DOWN', last_success: (q.get("SELECT finished_at f FROM di_run WHERE source_id LIKE ? AND status IN ('SUCCEEDED','PARTIAL') ORDER BY finished_at DESC LIMIT 1", `%${id}%`) || {}).f || null, last_run_status: run ? run.status : null, rows: h.rows }; };
  const kpi = (key, label, value, formula, denom, basis) => ({ key, label, value, formula, denominator: denom, as_of: now, source: basis, demo: true });
  return {
    as_of: now, data_class: 'SYNTHETIC',
    connections: [{ ...src('CRM_DEMO'), name: 'CRM' }, { ...src('BUYKOREA_DEMO'), name: 'BuyKOREA' }, { name: 'MDM', id: 'MDM', mode: 'DEMO', status: golden ? 'HEALTHY' : 'EMPTY', rows: q.count('di_party') }, { name: 'Serving(ODS)', id: 'ODS', mode: 'DEMO', status: 'HEALTHY', rows: q.count('di_ods') }, { name: 'RAG/추천 계약', id: 'RAG', mode: 'DEMO', status: 'CONTRACT', rows: q.count('di_lineage', "WHERE kind='SERVES'") }],
    kpis: [kpi('tables', '발견한 테이블/컬럼', `${tables} / ${cols}`, '최신 스냅샷의 테이블·컬럼 합계', `${snaps.length}개 원천`, 'di_snapshot'), kpi('eligible', '대상 동의 고객', eligible, '동의 유효(목적·기간·5개년) 원천 레코드 수', `전체 ${total}건`, 'di_raw.eligible'),
      kpi('dups', '중복 후보(검토 대기)', dup, 'AUTO_LINK/REVIEW 등급이며 PENDING·NEEDS_INFO 인 후보 수', `후보 ${q.count('di_candidate')}건`, 'di_candidate'), kpi('golden', '정본(ORG) 수', golden, '활성(ACTIVE) 기업 정본', `전체 정본 ${q.count('di_party')}건`, 'di_party'),
      kpi('dq', '데이터 품질 점수', dq ? (dq.overall ?? 'N/A') : 'N/A', '차원별 점수의 가중 평균(분모 0 차원 제외)', dq ? `rule ${dq.rule_version}` : '-', 'di_dq_run'), kpi('lag', '증분 지연(시간)', maxLag.length ? Math.max(...maxLag) : 'N/A', '현재 시각 − 마지막 성공 반영 시각(원천별 최댓값)', `SLA 24h`, 'di_run')],
    flow: { crm: src('CRM_DEMO').rows, bk: src('BUYKOREA_DEMO').rows, mdm: q.count('di_party'), ods: q.count('di_ods'), serving: q.count('di_lineage', "WHERE kind='SERVES'") },
    attention: { ai_proposals: prop.filter((s) => ['DRAFT', 'SIMULATED'].includes(s)).length, pending_approvals: pendingApprovals, failed_runs: failed, drift_open: q.get("SELECT COUNT(*) n FROM di_drift WHERE status IN ('DETECTED','PROPOSED')").n, impact_warnings: q.get("SELECT COUNT(*) n FROM di_drift WHERE severity IN ('HIGH','BLOCK') AND status<>'CLOSED'").n },
    dq: dq && { overall: dq.overall, scores: Object.fromEntries(Object.entries(dq.scores).map(([k, v]) => [k, v.score])), trend: DQ.trend(10), issues: DQ.issueSummary() },
    dedup: q.all('SELECT band, status, COUNT(*) n FROM di_candidate GROUP BY band, status'), schema_changes: EV.listDrifts().slice(0, 5), recent_runs: PL.listRuns(6).map((r) => ({ id: r.id, mode: r.mode, status: r.status, started_at: r.started_at, read: r.counts.read, quarantined: r.counts.quarantined })),
  };
}

// ── 원천(Connection Lab) ───────────────────────────────
route('get', '/sources', 'DataViewer', () => ({ items: q.all('SELECT * FROM di_source ORDER BY enabled DESC, id').map((s) => ({ ...s, capabilities: U.parse(s.capabilities, {}), health: s.enabled ? S.health(s) : { ok: false, error: '승인 전 비활성' }, latest_snapshot: (S.latestSnapshot(s.id) || {}).id || null, watermark: (q.get('SELECT value FROM di_watermark WHERE source_id=?', s.id) || {}).value || null })), notes: ['LIVE 연결은 보안 심의·읽기 전용 계정·Secret Vault·Gateway 승인 이전 비활성', 'CDC·writeback 은 지원하지 않습니다(표시 그대로)'] }));
route('post', '/sources', 'ConnectorAdmin', (ctx) => {
  const b = ctx.body; const id = String(b.id || '').toUpperCase().replace(/[^A-Z0-9_]/g, '').slice(0, 30); if (id.length < 3) throw C.err('VALIDATION', 'id(3자 이상 영문·숫자·밑줄)가 필요합니다');
  if (b.connector_type !== 'FILE_UPLOAD') throw C.err('CONNECTOR_NOT_ALLOWED', 'MVP에서는 FILE_UPLOAD 원천만 등록할 수 있습니다. LIVE 연결은 보안 승인 이후 별도 활성화합니다', 403);
  if (q.get('SELECT 1 x FROM di_source WHERE id=?', id)) throw C.err('DUPLICATE', '이미 등록된 원천입니다', 409);
  q.insert('di_source', { id, name: String(b.name || id).slice(0, 80), source_kind: 'FILE', connector_type: 'FILE_UPLOAD', integration_mode: 'SYNTHETIC', owner: String(b.owner || ctx.user.name).slice(0, 60), security_class: 'INTERNAL', status: 'READY', capabilities: C.J(S.capabilities({ connector_type: 'FILE_UPLOAD' })), enabled: 1, last_test_at: null, last_run_at: null, version: 1 });
  C.audit(ctx, 'source.registered', 'di_source', id, { connector: 'FILE_UPLOAD' }); C.ev(ctx, 'source.registered', id); return { id };
});
route('post', '/sources/:id/test', 'ConnectorAdmin', (ctx) => {
  const s = q.get('SELECT * FROM di_source WHERE id=?', ctx.params.id); if (!s) throw U.notFound('Source not found'); if (!s.enabled) throw C.err('SOURCE_DISABLED', `${s.id} 는 승인 전 비활성입니다(${s.integration_mode})`, 403);
  const h = S.health(s); q.run('UPDATE di_source SET last_test_at=?, status=? WHERE id=?', U.iso(), h.ok ? 'HEALTHY' : 'DOWN', s.id); C.audit(ctx, 'source.tested', 'di_source', s.id, { ok: h.ok }); return { source_id: s.id, read_only: true, ...h, capabilities: U.parse(s.capabilities, {}) };
});
route('post', '/sources/:id/upload', 'ConnectorAdmin', (ctx) => {
  const s = q.get("SELECT * FROM di_source WHERE id=? AND connector_type='FILE_UPLOAD'", ctx.params.id); if (!s) throw U.notFound('FILE_UPLOAD source not found');
  const table = String(ctx.body.table || 'upload_table').toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 40); const content = String(ctx.body.content || ''); if (content.length > 200000) throw C.err('PAYLOAD_TOO_LARGE', '파일은 200KB 이하여야 합니다', 413);
  let rows; try { rows = ctx.body.format === 'json' ? JSON.parse(content) : parseCsv(content); } catch { throw C.err('PARSE_ERROR', '파일을 해석할 수 없습니다'); }
  if (!Array.isArray(rows) || !rows.length || rows.length > 2000) throw C.err('VALIDATION', '1~2000행의 배열/CSV 가 필요합니다');
  rows = rows.filter((r) => r && typeof r === 'object').map((r) => Object.fromEntries(Object.entries(r).slice(0, 60).map(([k, v]) => [String(k).slice(0, 60), v == null ? null : String(v).slice(0, 300)])));
  q.run('INSERT OR REPLACE INTO di_upload(source_id,table_name,rows_json,uploaded_at) VALUES(?,?,?,?)', s.id, table, C.J(rows), U.iso()); C.audit(ctx, 'source.upload', 'di_source', s.id, { table, rows: rows.length }); return { source_id: s.id, table, rows: rows.length, next: 'POST /sources/{id}/discover' };
});
function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim()); const split = (l) => { const o = []; let cur = ''; let qt = false; for (const ch of l) { if (ch === '"') qt = !qt; else if (ch === ',' && !qt) { o.push(cur); cur = ''; } else cur += ch; } o.push(cur); return o.map((x) => x.trim()); };
  const head = split(lines[0]); return lines.slice(1).map((l) => Object.fromEntries(split(l).map((v, i) => [head[i] || `col_${i}`, v === '' ? null : v])));
}
route('post', '/sources/:id/discover', 'DataArchitect', (ctx) => {
  const s = q.get('SELECT * FROM di_source WHERE id=?', ctx.params.id); if (!s) throw U.notFound('Source not found'); if (!s.enabled) throw C.err('SOURCE_DISABLED', `${s.id} 는 승인 전 비활성입니다`, 403); rate(ctx, 'discover', 20);
  const snap = S.captureSnapshot(ctx, s, 'MANUAL'); C.audit(ctx, 'discover', 'di_snapshot', snap.id, { source: s.id, hash: snap.schema_hash }); C.ev(ctx, 'discover', snap.id, { source: s.id });
  return { snapshot_id: snap.id, version: snap.version, schema_hash: snap.schema_hash, tables: snap.schema.tables.length, columns: snap.schema.tables.reduce((a, t) => a + t.columns.length, 0), relations: snap.schema.relations.length, inferred: snap.schema.relations.filter((r) => !r.declared).length };
});
route('get', '/sources/:id/preview', 'DataViewer', (ctx) => {
  const s = q.get('SELECT * FROM di_source WHERE id=?', ctx.params.id); if (!s || !s.enabled) throw U.notFound('Source not found or disabled'); const c = S.conn(s); const t = String(ctx.query.table || c.tables[0]); if (!c.tables.includes(t)) throw C.err('TABLE_NOT_ALLOWED', '허용 목록에 없는 테이블입니다', 403);
  const rows = S.readRows(c, s, t, { limit: Math.min(Number(ctx.query.limit) || 10, 25) }).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, S.mask(k, v)]))); C.audit(ctx, 'source.preview', 'di_source', s.id, { table: t, rows: rows.length });
  return { source_id: s.id, table: t, tables: c.tables, rows, masked: true, sample_kind: 'ACTUAL_MASKED' };
});
route('get', '/schema-snapshots', 'DataViewer', (ctx) => ({ items: S.listSnapshots(ctx.query.source_id || 'CRM_DEMO') }));
route('get', '/schema-snapshots/:id', 'DataViewer', (ctx) => { const s = S.getSnapshot(ctx.params.id); if (!s) throw U.notFound('Snapshot not found'); return { ...s, schema_json: undefined, profile_json: undefined }; });
route('get', '/discovery', 'DataViewer', (ctx) => {
  const out = {}; for (const id of ['CRM_DEMO', 'BUYKOREA_DEMO']) { const s = S.latestSnapshot(id); if (s) out[id] = { snapshot_id: s.id, version: s.version, captured_at: s.captured_at, schema_hash: s.schema_hash, schema: s.schema, profile: s.profile }; }
  const crm = out.CRM_DEMO; const bk = out.BUYKOREA_DEMO; const candidates = [];
  if (crm && bk) for (const ct of crm.schema.tables) for (const cc of ct.columns) for (const bt of bk.schema.tables) for (const bc of bt.columns) { if (cc.concept && cc.concept === bc.concept) candidates.push({ concept: cc.concept, crm: `${ct.name}.${cc.name}`, bk: `${bt.name}.${bc.name}`, crm_type: cc.type, bk_type: bc.type, type_diff: cc.type !== bc.type }); }
  return { sources: out, standard_candidates: candidates, domain_suggestions: [['demo_crm_customer', '고객/기업(Party·LegalEntity)'], ['demo_bk_member', '회원·바이어 기업'], ['demo_bk_product', '상품(Product)'], ['demo_crm_participation', '참가이력(Activity)'], ['demo_crm_voc', 'VOC(Activity)'], ['demo_bk_inquiry', '문의(Activity)']] };
});

// ── 모델 / ERD Studio ─────────────────────────────────
route('get', '/models', 'DataViewer', () => ({ items: q.all('SELECT id,scope,version,status,parent_id,note,created_at,created_by FROM di_model ORDER BY scope, created_at').map((m) => { const mm = S.getModel(m.id).model; return { ...m, entities: mm.entities.length, columns: mm.entities.reduce((a, e) => a + e.columns.length, 0), relations: mm.relations.length }; }) }));
route('get', '/models/:id/erd', 'DataViewer', (ctx) => {
  const m = S.getModel(ctx.params.id); if (!m) throw U.notFound('Model not found'); const f = String(ctx.query.format || 'json'); const model = m.model;
  const diffAgainst = ctx.query.diff ? S.getModel(ctx.query.diff) : null; const diff = diffAgainst ? S.diffModels(diffAgainst.model, model) : null;
  if (f === 'svg') return { __raw: true, type: 'image/svg+xml; charset=utf-8', headers: { 'content-disposition': `inline; filename="${m.scope}-${m.version}.svg"` }, body: S.toSvg(model, { diff, selected: ctx.query.selected, compact: ctx.query.compact === '1' }) };
  if (f === 'mmd') return { __raw: true, type: 'text/plain; charset=utf-8', body: S.toMermaid(model) };
  if (f === 'ddl') return { __raw: true, type: 'text/plain; charset=utf-8', body: S.toDdl(model, ctx.query.dialect === 'sqlite' ? 'sqlite' : 'ansi') };
  return { id: m.id, scope: m.scope, version: m.version, status: m.status, model, diff, standards: S.checkStandards(model), svg: S.toSvg(model, { diff, selected: ctx.query.selected, compact: ctx.query.compact === '1' }) };
});
route('post', '/models/:id/compare', 'DataViewer', (ctx) => { const a = S.getModel(ctx.params.id); const b = S.getModel(ctx.body.other_id); if (!a || !b) throw U.notFound('Model not found'); return { from: { id: a.id, version: a.version }, to: { id: b.id, version: b.version }, diff: S.diffModels(a.model, b.model) }; });
route('post', '/models/:id/propose', 'DataArchitect', (ctx) => {
  const base = S.getModel(ctx.params.id); if (!base) throw U.notFound('Model not found'); const next = JSON.parse(C.J(base.model)); const ch = Array.isArray(ctx.body.changes) ? ctx.body.changes.slice(0, 20) : [];
  for (const c of ch) { if (c.op !== 'add_column') throw C.err('OP_NOT_ALLOWED', 'MVP에서는 add_column 변경만 제안할 수 있습니다', 422); const e = next.entities.find((x) => x.name === c.entity); if (!e || !/^[a-z][a-z0-9_]*$/.test(String(c.name))) throw C.err('VALIDATION', '대상 엔터티/컬럼명이 올바르지 않습니다'); if (!e.columns.some((x) => x.name === c.name)) e.columns.push({ name: c.name, type: String(c.type || 'string(100)').slice(0, 30), pk: false, fk: null, nullable: true, note: String(c.note || '').slice(0, 100) }); }
  const diff = S.diffModels(base.model, next); const id = C.nid('MDL'); const ver = `${base.version}-draft.${q.count('di_model', 'WHERE parent_id=?', base.id) + 1}`;
  q.insert('di_model', { id, scope: base.scope, version: ver, status: 'DRAFT', parent_id: base.id, schema_json: C.J(next), note: String(ctx.body.note || '모델 개선 초안').slice(0, 200), created_by: ctx.user.id, created_at: U.iso(), released_at: null }); C.audit(ctx, 'model.proposed', 'di_model', id, { base: base.id, semver: diff.semver });
  return { id, version: ver, status: 'DRAFT', diff, note: 'DRAFT 모델은 활성화되지 않습니다(승인·배포는 진화 엔진 경유)' };
});


// ── KOTRA-AX 통합 ERD (실측 메타데이터 · ERwin / DA# 표기 공용 모델) ──
route('get', '/erd/unified', 'DataViewer', (ctx) => { const m = UNI.build({ force: ctx.query.refresh === '1' }); C.audit(ctx, 'erd.unified.view', 'erd', 'unified', { entities: m.stats.entities }); return m; });
route('get', '/erd/unified/export', 'DataViewer', (ctx) => {
  const f = String(ctx.query.format || 'json'); const area = ctx.query.area ? String(ctx.query.area) : undefined; const m = UNI.build(); C.audit(ctx, 'erd.unified.export', 'erd', 'unified', { format: f, area });
  if (f === 'ddl') return { __raw: true, type: 'text/plain; charset=utf-8', headers: { 'content-disposition': 'attachment; filename="kotra-ax-unified.sql"' }, body: UNI.ddl(m, { area, dialect: ctx.query.dialect === 'sqlite' ? 'sqlite' : 'ansi' }) };
  if (f === 'mmd') return { __raw: true, type: 'text/plain; charset=utf-8', headers: { 'content-disposition': 'attachment; filename="kotra-ax-unified.mmd"' }, body: UNI.mermaid(m, { area }) };
  if (f === 'dictionary') return { __raw: true, type: 'text/csv; charset=utf-8', headers: { 'content-disposition': 'attachment; filename="kotra-ax-table-column-dictionary.csv"' }, body: UNI.dictionaryCsv(m) };
  if (f === 'entities') return { __raw: true, type: 'text/csv; charset=utf-8', headers: { 'content-disposition': 'attachment; filename="kotra-ax-entity-list.csv"' }, body: UNI.entityListCsv(m) };
  return { __raw: true, type: 'application/json; charset=utf-8', headers: { 'content-disposition': 'attachment; filename="kotra-ax-unified-erd.json"' }, body: JSON.stringify(m, null, 1) };
});
route('put', '/glossary', 'DataArchitect', (ctx) => { const r = UNI.setGlossary(ctx, ctx.body); C.audit(ctx, 'glossary.set', 'di_glossary', `${r.kind}:${r.target}`, { logical: r.logical }); return r; });

// ── 매핑 / 표준 ───────────────────────────────────────
route('get', '/mappings', 'DataViewer', (ctx) => ({ version: ctx.query.version || M.activeVersion(), versions: M.mappingVersions(), coverage: M.coverage(ctx.query.version), items: M.listMappings(ctx.query.version), rule_types: M.RULE_TYPES, forbidden: ['임의 SQL 실행', '서버 eval/exec', '무검증 정규식', '외부 호출', '운영 테이블 삭제'] }));
route('get', '/standards', 'DataViewer', () => ({ items: q.all('SELECT * FROM di_standard ORDER BY concept'), codesets: q.all('SELECT code_set, version, COUNT(*) n FROM di_codeset GROUP BY code_set, version') }));
route('post', '/mappings/validate', 'DataArchitect', (ctx) => { rate(ctx, 'mapvalid', 60); return M.validateMapping(ctx.body); });
route('post', '/mappings', 'DataArchitect', (ctx) => { const m = M.upsertMapping(ctx, { ...ctx.body, status: 'DRAFT', mapping_version: 'draft' }); C.audit(ctx, 'mapping.draft', 'di_mapping', m.id, {}); return { mapping: m, note: 'DRAFT 매핑은 활성화되지 않습니다(승인·배포는 진화 엔진 경유)' }; });

// ── 품질 ──────────────────────────────────────────────
route('get', '/quality', 'DataViewer', () => ({ latest: DQ.latest(), trend: DQ.trend(12), rules: q.all('SELECT * FROM di_dq_rule ORDER BY id').map((r) => ({ ...r, params: U.parse(r.params, {}) })), issues: DQ.issueSummary(), weights: DQ.WEIGHTS, labels: DQ.DIM_LABEL }));
route('post', '/quality/run', 'DataSteward', (ctx) => { rate(ctx, 'dq', 20); return DQ.run(ctx); });
route('get', '/quality/issues', 'DataViewer', (ctx) => ({ items: DQ.listIssues(ctx.query), summary: DQ.issueSummary() }));
route('post', '/quality/issues/:id/:action', 'DataSteward', (ctx) => DQ.issueAction(ctx, ctx.params.id, ctx.params.action, ctx.body));

// ── 식별 / MDM ────────────────────────────────────────
route('post', '/identity/resolve', 'MdmSteward', (ctx) => { rate(ctx, 'resolve', 20); const r = MDM.resolveCandidates(ctx); PL.linkCandidateParties(); C.audit(ctx, 'identity.resolve', 'di_candidate', 'all', { created: r.created }); return r; });
route('get', '/identity/candidates', 'DataViewer', (ctx) => {
  let sql = 'SELECT * FROM di_candidate WHERE 1=1'; const p = []; if (ctx.query.status) { sql += ' AND status=?'; p.push(ctx.query.status); } if (ctx.query.band) { sql += ' AND band=?'; p.push(ctx.query.band); }
  const rows = q.all(sql + " ORDER BY CASE band WHEN 'AUTO_LINK_CANDIDATE' THEN 0 WHEN 'REVIEW_REQUIRED' THEN 1 ELSE 2 END, score DESC LIMIT 300", ...p).map(MDM.hydCand).map((c) => ({ ...c, left_name: (MDM.latestRaw(...c.left_ref.split(':')) || {}).name_raw, right_name: (MDM.latestRaw(...c.right_ref.split(':')) || {}).name_raw }));
  return { items: rows, summary: q.all('SELECT band, status, COUNT(*) n FROM di_candidate GROUP BY band, status'), policy: { version: MDM.POLICY_VERSION, note: '점수는 설명용 모델입니다. 반대 증거가 있으면 95점이라도 DO_NOT_LINK, 초기에는 자동 병합 금지(승인형)', thresholds: { AUTO_LINK_CANDIDATE: '≥70', REVIEW_REQUIRED: '30~69' } } };
});
route('get', '/identity/candidates/:id', 'DataViewer', (ctx) => { const d = MDM.candidateDetail(ctx.params.id); if (!d) throw U.notFound('Candidate not found'); return { ...d, events: q.all('SELECT * FROM di_event WHERE ref=? ORDER BY id', d.id).map((e) => ({ ...e, detail: U.parse(e.detail, {}) })), decisions: q.all('SELECT * FROM di_decision WHERE candidate_id=? ORDER BY created_at', d.id) }; });
route('post', '/identity/candidates/:id/preview', 'MdmSteward', (ctx) => MDM.previewMerge(ctx.params.id));
route('post', '/identity/candidates/:id/recommend', 'MdmSteward', (ctx) => MDM.recommend(ctx, ctx.params.id, ctx.body));
route('post', '/identity/candidates/:id/decision', 'MdmSteward', (ctx) => C.idempotent(ctx, 'identity.decision:' + ctx.params.id, () => MDM.decide(ctx, ctx.params.id, ctx.body)));
route('post', '/identity/signup-simulate', 'DataViewer', (ctx) => { rate(ctx, 'signup', 30); return MDM.simulateSignup(ctx, ctx.body); });
route('get', '/masters', 'DataViewer', (ctx) => {
  let sql = 'SELECT * FROM di_party WHERE 1=1'; const p = []; if (ctx.query.type) { sql += ' AND party_type=?'; p.push(ctx.query.type); } if (ctx.query.status) { sql += ' AND lifecycle_status=?'; p.push(ctx.query.status); } if (ctx.query.q) { sql += ' AND display_name LIKE ?'; p.push(`%${String(ctx.query.q).slice(0, 40)}%`); }
  const rows = q.all(sql + ' ORDER BY party_id LIMIT 300', ...p).map((x) => { const g = x.golden_version_id ? q.get('SELECT version_no FROM di_golden WHERE id=?', x.golden_version_id) : null; return { ...x, display_name: x.party_type === 'PERSON' ? S.mask('name', x.display_name) : x.display_name, golden_version: g ? g.version_no : null, sources: q.all("SELECT source_system s FROM di_crosswalk WHERE party_id=? AND status='ACTIVE'", x.party_id).map((r) => r.s) }; });
  return { items: rows, counts: Object.fromEntries(q.all('SELECT party_type t, lifecycle_status s, COUNT(*) n FROM di_party GROUP BY party_type, lifecycle_status').map((r) => [`${r.t}.${r.s}`, r.n])) };
});
route('get', '/masters/:party_id', 'DataViewer', (ctx) => {
  const p = q.get('SELECT * FROM di_party WHERE party_id=?', ctx.params.party_id); if (!p) throw U.notFound('Party not found');
  return { party: { ...p, display_name: p.party_type === 'PERSON' ? S.mask('name', p.display_name) : p.display_name }, crosswalks: q.all('SELECT * FROM di_crosswalk WHERE party_id=? ORDER BY valid_from', p.party_id), consents: q.all('SELECT id,source_ref,purpose,legal_basis,valid_from,valid_to,revoked_at,status FROM di_consent WHERE party_id=?', p.party_id), activities: q.all('SELECT * FROM di_activity WHERE party_id=? ORDER BY occurred_at DESC LIMIT 50', p.party_id), affiliations: q.all('SELECT * FROM di_affiliation WHERE org_party_id=? OR person_party_id=?', p.party_id, p.party_id), links: q.all('SELECT * FROM di_link WHERE party_a=? OR party_b=?', p.party_id, p.party_id), merged_children: q.all('SELECT party_id FROM di_party WHERE merged_into=?', p.party_id).map((x) => x.party_id), impact: MDM.impactOf([p.party_id]), ods: q.get('SELECT party_id, attributes, product_keys, golden_version_id, mapping_version FROM di_ods WHERE party_id=?', p.party_id) };
});
route('get', '/masters/:party_id/history', 'DataViewer', (ctx) => ({ party_id: ctx.params.party_id, versions: MDM.goldenHistory(ctx.params.party_id), decisions: q.all('SELECT * FROM di_decision WHERE survivor_party=? OR absorbed_party=? ORDER BY created_at DESC', ctx.params.party_id, ctx.params.party_id) }));
route('post', '/masters/:party_id/unmerge', 'MdmApprover', (ctx) => C.idempotent(ctx, 'unmerge:' + ctx.params.party_id, () => MDM.unmerge(ctx, ctx.params.party_id, ctx.body)));

// ── 파이프라인 ────────────────────────────────────────
route('get', '/pipelines', 'DataViewer', () => ({ definition: { id: 'default', version: 'pipeline-v1', stages: PL.STAGES, sources: ['CRM_DEMO', 'BUYKOREA_DEMO'], modes: ['FULL', 'INCREMENTAL'], notes: ['MVP: full_snapshot 및 incremental_by_updated_at', 'CDC 는 원천이 제공할 때만 교체형으로 지원(현재 미지원)', '워터마크는 최종 검증 성공 후에만 전진'] }, watermarks: q.all('SELECT * FROM di_watermark'), runs: PL.listRuns(25), sources: q.all('SELECT id,name,integration_mode,enabled FROM di_source') }));
route('post', '/pipelines/:id/run', 'PipelineOperator', (ctx) => {
  rate(ctx, 'run', 12); const b = ctx.body; const inj = b.inject_error ? String(b.inject_error).toUpperCase() : undefined; if (inj && !PL.STAGES.includes(inj)) throw C.err('BAD_INJECTION', `inject_error 는 ${PL.STAGES.join('/')} 중 하나입니다`);
  return C.idempotent(ctx, 'pipeline.run', () => PL.run(ctx, { source_id: b.source_id || 'ALL', mode: b.mode, inject_error: inj, since: b.since, restandardize: b.restandardize === true, idempotency_key: ctx.req.headers['idempotency-key'] ? String(ctx.req.headers['idempotency-key']).slice(0, 60) : undefined }));
});
route('get', '/pipelines/runs/:id', 'DataViewer', (ctx) => { const r = PL.getRun(ctx.params.id); if (!r) throw U.notFound('Run not found'); return { ...r, children: q.all('SELECT id,status,retry_no FROM di_run WHERE parent_run_id=?', r.id) }; });
route('post', '/pipelines/runs/:id/retry', 'PipelineOperator', (ctx) => PL.retry(ctx, ctx.params.id));
route('post', '/pipelines/inject', 'PipelineOperator', (ctx) => PL.injectSource(ctx, String(ctx.body.kind || '').toUpperCase()));

// ── 계보 ──────────────────────────────────────────────
route('get', '/lineage/:object_id', 'DataViewer', (ctx) => { const node = ctx.params.object_id; const l = PL.lineageOf(node); return { ...l, impact_services: l.downstream.filter((e) => e.to_node.startsWith('svc:')).map((e) => e.to_node), note: '허용된 역할만 원천 레코드 상세를 볼 수 있습니다' }; });
route('get', '/lineage-index', 'DataViewer', () => ({ parties: q.all("SELECT party_id, display_name, company_id FROM di_party WHERE party_type='ORGANIZATION' AND lifecycle_status='ACTIVE' ORDER BY (company_id IS NULL), party_id LIMIT 60"), fields: q.all("SELECT DISTINCT to_node FROM di_lineage WHERE kind='MAPPING' ORDER BY to_node") }));
// 고객용(대외) — 상세 원천 비노출, 추천 근거의 데이터 출처 요약만 제공
api.get(B + '/provenance/recommendation', guard((ctx) => {
  const u = ctx.user; if (!u.company_id) throw C.err('NO_COMPANY', '기업 사용자만 조회할 수 있습니다', 403);
  const s = MDM.servingKeysFor(u.company_id); const p = q.get("SELECT party_id FROM di_party WHERE company_id=? AND lifecycle_status='ACTIVE' AND party_type='ORGANIZATION' LIMIT 1", u.company_id);
  return { company_id: u.company_id, data_sources: ['기업 프로필(MyKOTRA)', ...(p ? ['통합 고객 정본(MDM, 합성 시연 데이터)'] : [])], integration: p ? { golden_version: s ? s.golden_version_id : null, mapping_version: s ? s.mapping_version : null, enriched: !!s } : null, rule: 'MatchRule v2(설명 가능한 Match Score)', note: '원천 레코드 상세와 타 기업 정보는 표시하지 않습니다' };
}), { roles: ['customer', 'admin'] });

// ── 진화(Self-Evolving) ───────────────────────────────
route('get', '/evolution', 'DataViewer', () => ({ drifts: EV.listDrifts(), proposals: EV.listProposals(), releases: q.all('SELECT * FROM di_release ORDER BY deployed_at DESC').map((r) => ({ ...r, snapshot: undefined, impact: U.parse(r.impact, {}) })), gates: EV.GATES, active_model: (S.activeModel('TOBE_MDM') || {}).version, active_mapping: M.activeVersion(), boundary: [['읽기 전용 스키마 발견', '자동'], ['변경 요약/ERD Diff', '자동'], ['신규 표준·매핑 제안', '제안 자동 · 활성화는 승인'], ['샌드박스 재실행', '자동(격리)'], ['정본 병합/Unmerge', '불가 · 승인 필요'], ['동의 범위 변경', '불가 · 법적·업무 승인'], ['운영 DB DDL·원천 쓰기', '불가 · Change Management'], ['RAG 접근등급 하향', '불가 · 보안 승인']] }));
route('post', '/evolution/detect', 'DataArchitect', (ctx) => { rate(ctx, 'detect', 20); return EV.detect(ctx, String(ctx.body.source_id || 'BUYKOREA_DEMO')); });
route('get', '/evolution/:id', 'DataViewer', (ctx) => { const d = EV.proposalDetail(ctx.params.id); if (!d) throw U.notFound('Proposal not found'); return d; });
route('post', '/evolution/:id/simulate', 'DataArchitect', (ctx) => { rate(ctx, 'sim', 20); return EV.simulate(ctx, ctx.params.id); });
route('post', '/evolution/:id/request-review', 'DataArchitect', (ctx) => EV.requestReview(ctx, ctx.params.id));
route('post', '/evolution/:id/approve', 'ChangeApprover', (ctx) => C.idempotent(ctx, 'evo.approve:' + ctx.params.id, () => EV.approve(ctx, ctx.params.id, ctx.body)));
route('post', '/evolution/:id/reject', 'ChangeApprover', (ctx) => EV.reject(ctx, ctx.params.id, ctx.body.reason));
route('post', '/evolution/:id/deploy-demo', 'ReleaseOperator', (ctx) => C.idempotent(ctx, 'evo.deploy:' + ctx.params.id, () => EV.deployDemo(ctx, ctx.params.id, ctx.body)));
route('post', '/evolution/:id/rollback-demo', 'ReleaseOperator', (ctx) => C.idempotent(ctx, 'evo.rollback:' + ctx.params.id, () => EV.rollbackDemo(ctx, ctx.params.id, ctx.body)));

// ── 승인함 · 감사 · 증적 ──────────────────────────────
route('get', '/approvals', 'DataViewer', () => ({
  candidates: q.all("SELECT id,left_ref,right_ref,score,band,reviewer,created_at FROM di_candidate WHERE band='AUTO_LINK_CANDIDATE' AND status IN ('PENDING','NEEDS_INFO') ORDER BY score DESC").map((c) => ({ ...c, kind: 'MDM_MERGE' })),
  proposals: q.all("SELECT id,risk,requested_by,created_at,proposal FROM di_proposal WHERE state IN ('REVIEW_REQUESTED','APPROVED') ORDER BY created_at").map((p) => ({ id: p.id, risk: p.risk, requested_by: p.requested_by, created_at: p.created_at, summary: U.parse(p.proposal, {}).change_summary, kind: 'EVOLUTION' })),
  dq: q.all("SELECT id,rule_id,source_ref,field,severity,status FROM di_dq_issue WHERE status IN ('PROPOSED','REVIEWED','APPROVED') ORDER BY created_at").map((i) => ({ ...i, kind: 'DQ_FIX' })),
  note: '병합·정비·진화 변경은 승인 전에 반영되지 않습니다. 승인 화면에서 Diff와 영향 범위를 확인하세요.' }));
route('get', '/audit', 'Auditor', (ctx) => ({ events: q.all("SELECT id, ts, actor_id, actor_role, action, target_type, target_id, detail FROM audit_events WHERE action LIKE 'di.%' ORDER BY id DESC LIMIT ?", Math.min(Number(ctx.query.limit) || 100, 300)).map((e) => ({ ...e, detail: U.parse(e.detail, {}) })), chain: G.verifyAuditChain(), studio_events: q.all('SELECT * FROM di_event ORDER BY id DESC LIMIT 100').map((e) => ({ ...e, detail: U.parse(e.detail, {}) })), access: { note: '원천 샘플 조회·모델 변경·병합·배포는 모두 감사 대상', sample_previews: q.count('audit_events', "WHERE action='di.source.preview'") } }));
route('get', '/evidence', 'DataViewer', () => ({ documents: EVD.index(), aux: ['schemas/*.json', 'erd/*.mmd', 'mappings/*.json', 'api/openapi.yaml', 'seed/di_golden_dataset.json', 'tests/*.json'], selfcheck: q.get('SELECT * FROM di_selfcheck ORDER BY at DESC, rowid DESC LIMIT 1') ? { ...q.get('SELECT * FROM di_selfcheck ORDER BY at DESC, rowid DESC LIMIT 1'), results: U.parse(q.get('SELECT results FROM di_selfcheck ORDER BY at DESC, rowid DESC LIMIT 1').results, []) } : null, note: '모든 문서는 요청 시점의 실제 시스템 상태에서 생성됩니다(고정 성공 문구 없음)' }));
route('get', '/evidence/export', 'Auditor', (ctx) => {
  C.audit(ctx, 'evidence.export', 'evidence', String(ctx.query.doc || 'bundle'), {}); const doc = String(ctx.query.doc || 'bundle');
  if (doc === 'bundle') return { __raw: true, type: 'text/markdown; charset=utf-8', headers: { 'content-disposition': 'attachment; filename="axos-data-integration-evidence.md"' }, body: EVD.bundle() };
  const g = EVD.generate(doc); if (!g) throw U.notFound('Unknown evidence document'); return { __raw: true, type: g.mime, headers: { 'content-disposition': `attachment; filename="${g.name}"` }, body: g.body };
});
route('post', '/selfcheck', 'DataSteward', (ctx) => { rate(ctx, 'selfcheck', 20); return EV.selfCheck(ctx); });
api.get(B + '/golden-dataset', guard(() => require('../di/seed').goldenDataset()), R('DataViewer'));
