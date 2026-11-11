'use strict';
// Mapping Workbench: 안전한 Rule DSL(임의 SQL/eval 금지), 코드표 LOOKUP_MAP, 매핑 검증, 표준화 적용.
const crypto = require('node:crypto');
const { q } = require('../db');
const U = require('../util');
const { J, P, nid, err } = require('./core');

// 지원 규칙 (스펙 §9.2). 이 목록 밖의 type 은 거부한다.
const RULE_TYPES = ['TRIM', 'NFKC', 'UPPER', 'LOWER', 'LOOKUP_MAP', 'DATE_PARSE', 'SAFE_CAST', 'NULL_COALESCE', 'SPLIT', 'CONCAT', 'REGEX_REPLACE_ALLOWLIST', 'HASH_IDENTIFIER', 'VALIDATE_ENUM'];
const REGEX_ALLOW = { STRIP_NON_DIGIT: [/\D+/g, ''], COLLAPSE_SPACE: [/\s+/g, ' '], STRIP_PUNCT: [/[^\p{L}\p{N}\s]/gu, ' '], STRIP_HYPHEN: [/-/g, ''], LEGAL_SUFFIX: [/\b(ltd|limited|co|company|inc|corp|corporation|llc|gmbh|pte|주식회사)\b\.?/giu, ''] };
const SALT = process.env.DI_HASH_SALT || 'kotra-di-demo-salt';
const hashId = (v) => crypto.createHash('sha256').update(SALT + '|' + String(v).trim().toLowerCase()).digest('hex').slice(0, 24);

const SCHEMA = { // 최소 JSON Schema 검증 (외부 의존성 없음)
  LOOKUP_MAP: { required: ['lookup_set'], optional: ['lookup_version', 'on_unknown'] }, SAFE_CAST: { required: ['to'] }, DATE_PARSE: { required: [], optional: ['format'] },
  NULL_COALESCE: { required: ['default'] }, SPLIT: { required: ['sep', 'index'] }, CONCAT: { required: ['with'], optional: ['sep'] }, REGEX_REPLACE_ALLOWLIST: { required: ['pattern'] }, VALIDATE_ENUM: { required: ['values'] },
  TRIM: { required: [] }, NFKC: { required: [] }, UPPER: { required: [] }, LOWER: { required: [] }, HASH_IDENTIFIER: { required: [] },
};
function validateRule(rule) {
  const problems = [];
  if (!rule || typeof rule !== 'object') return ['규칙은 객체여야 합니다'];
  if (!RULE_TYPES.includes(rule.type)) problems.push(`허용되지 않은 규칙 유형: ${String(rule.type).slice(0, 30)} (허용: ${RULE_TYPES.join(', ')})`);
  const sch = SCHEMA[rule.type]; if (sch) for (const k of sch.required) if (rule[k] === undefined) problems.push(`필수 속성 누락: ${k}`);
  if (rule.type === 'REGEX_REPLACE_ALLOWLIST' && !REGEX_ALLOW[rule.pattern]) problems.push(`허용 목록에 없는 패턴: ${String(rule.pattern).slice(0, 30)} (허용: ${Object.keys(REGEX_ALLOW).join(', ')})`);
  if (rule.type === 'LOOKUP_MAP' && rule.on_unknown && !['FLAG_FOR_REVIEW', 'QUARANTINE', 'PASS_THROUGH'].includes(rule.on_unknown)) problems.push('on_unknown 값이 올바르지 않습니다');
  for (const k of Object.keys(rule)) if (/(sql|eval|exec|script|function|url|http)/i.test(k)) problems.push(`금지된 속성: ${k}`);
  return problems;
}
const lookup = (set, version, v) => { const r = q.get('SELECT standard_value s FROM di_codeset WHERE code_set=? AND version=? AND source_value=?', set, version, String(v).trim().toUpperCase()); return r ? r.s : undefined; };

// 단일 규칙 실행. 반환 {value, flag?:'UNKNOWN_CODE'|'CAST_FAIL'|'ENUM_FAIL'}
function applyRule(rule, value, rowCtx = {}) {
  const bad = validateRule(rule); if (bad.length) throw err('RULE_INVALID', bad.join('; '));
  const v = value;
  switch (rule.type) {
    case 'TRIM': return { value: v == null ? v : String(v).trim() };
    case 'NFKC': return { value: v == null ? v : String(v).normalize('NFKC') };
    case 'UPPER': return { value: v == null ? v : String(v).toUpperCase() };
    case 'LOWER': return { value: v == null ? v : String(v).toLowerCase() };
    case 'LOOKUP_MAP': {
      if (v == null || v === '') return { value: v };
      const r = lookup(rule.lookup_set, rule.lookup_version || 'v1', v); if (r !== undefined) return { value: r };
      return rule.on_unknown === 'PASS_THROUGH' ? { value: v } : { value: null, flag: 'UNKNOWN_CODE', raw: v };
    }
    case 'DATE_PARSE': { if (v == null || v === '') return { value: v }; const t = Date.parse(v); return Number.isNaN(t) ? { value: null, flag: 'CAST_FAIL', raw: v } : { value: new Date(t).toISOString() }; }
    case 'SAFE_CAST': {
      if (v == null || v === '') return { value: v };
      if (rule.to === 'INTEGER') { const n = Number(v); return Number.isInteger(n) ? { value: n } : { value: null, flag: 'CAST_FAIL', raw: v }; }
      if (rule.to === 'REAL') { const n = Number(v); return Number.isFinite(n) ? { value: n } : { value: null, flag: 'CAST_FAIL', raw: v }; }
      return { value: String(v) };
    }
    case 'NULL_COALESCE': return { value: v == null || v === '' ? rule.default : v };
    case 'SPLIT': { if (v == null) return { value: v }; const parts = String(v).split(String(rule.sep)); return { value: parts[Number(rule.index)] ?? null }; }
    case 'CONCAT': return { value: [v, rowCtx[rule.with]].filter((x) => x != null && x !== '').join(rule.sep ?? ' ') };
    case 'REGEX_REPLACE_ALLOWLIST': { if (v == null) return { value: v }; const [re, rep] = REGEX_ALLOW[rule.pattern]; return { value: String(v).slice(0, 500).replace(re, rep) }; }
    case 'HASH_IDENTIFIER': return { value: v == null || v === '' ? v : hashId(v) };
    case 'VALIDATE_ENUM': return v == null || rule.values.includes(v) ? { value: v } : { value: v, flag: 'ENUM_FAIL' };
    default: return { value: v };
  }
}
// 규칙 체인(배열) 실행
function applyChain(rules, value, rowCtx) {
  let cur = value; const flags = [];
  for (const r of Array.isArray(rules) ? rules : [rules]) { const o = applyRule(r, cur, rowCtx); cur = o.value; if (o.flag) { flags.push({ flag: o.flag, raw: o.raw, rule: r.type }); if (o.flag === 'UNKNOWN_CODE' || o.flag === 'CAST_FAIL') break; } }
  return { value: cur, flags };
}

// ───────── 매핑 레지스트리 ─────────
const activeVersion = () => (q.get("SELECT mapping_version v FROM di_mapping WHERE status='ACTIVE' ORDER BY mapping_version DESC LIMIT 1") || {}).v || 'v1';
const hydMap = (m) => m && ({ ...m, rules: P(m.rule_json, []) });
const listMappings = (version) => q.all('SELECT * FROM di_mapping WHERE mapping_version=? ORDER BY target_entity, target_field, precedence', version || activeVersion()).map(hydMap);
const mappingVersions = () => q.all('SELECT mapping_version v, status, COUNT(*) n FROM di_mapping GROUP BY mapping_version, status ORDER BY mapping_version').map((r) => ({ version: r.v, status: r.status, mappings: r.n }));

// 표준 필드(타깃) 목록과 필수 여부 — 매핑 커버리지 계산 기준
const REQUIRED_TARGETS = [['LEGAL_ENTITY', 'normalized_name'], ['LEGAL_ENTITY', 'country_code'], ['SOURCE_CROSSWALK', 'source_pk'], ['PARTY_IDENTIFIER', 'email_hash'], ['CONSENT_GRANT', 'granted_at'], ['CONSENT_GRANT', 'expires_at']];
function coverage(version) {
  const ms = listMappings(version).filter((m) => m.status === 'ACTIVE' || m.status === 'APPROVED');
  const need = REQUIRED_TARGETS.map(([e, f]) => ({ entity: e, field: f, systems: ['CRM', 'BUYKOREA'] }));
  let total = 0; let ok = 0; const missing = [];
  for (const n of need) for (const sys of n.systems) { total++; if (ms.some((m) => m.target_entity === n.entity && m.target_field === n.field && m.source_system === sys)) ok++; else missing.push(`${sys} → ${n.entity}.${n.field}`); }
  return { required_total: total, approved: ok, pct: total ? U.round((ok / total) * 100, 1) : null, missing, formula: '승인된 필수 매핑 수 / 전체 필수 매핑 수 (분모 0이면 N/A)' };
}

// 매핑 검증 (TC-MAP-01/02): 필수 누락·잘림·미등록 코드·분류 다운그레이드
function validateMapping(input, { sample = true } = {}) {
  const issues = []; const m = input;
  const rules = Array.isArray(m.rules) ? m.rules : m.rule ? [m.rule] : [];
  if (!m.source_system || !m.source_table || !m.source_field || !m.target_entity || !m.target_field) issues.push({ severity: 'HIGH', code: 'FIELD_MISSING', message: '원천/타깃 필드 지정이 누락되었습니다' });
  rules.forEach((r, i) => validateRule(r).forEach((p) => issues.push({ severity: 'HIGH', code: 'RULE_INVALID', message: `규칙 ${i + 1}: ${p}` })));
  const std = q.get('SELECT * FROM di_standard WHERE concept=?', m.target_field);
  if (rules.some((r) => r.type === 'LOOKUP_MAP')) for (const r of rules.filter((x) => x.type === 'LOOKUP_MAP')) { const n = q.get('SELECT COUNT(*) n FROM di_codeset WHERE code_set=? AND version=?', r.lookup_set, r.lookup_version || 'v1').n; if (!n) issues.push({ severity: 'HIGH', code: 'CODESET_MISSING', message: `미등록 코드표: ${r.lookup_set}/${r.lookup_version || 'v1'} → QUARANTINE 대상` }); }
  if (std && m.source_sensitivity && sensRank(m.source_sensitivity) > sensRank(std.sensitivity)) issues.push({ severity: 'HIGH', code: 'CLASS_DOWNGRADE', message: `데이터 분류 다운그레이드 차단: ${m.source_sensitivity} → ${std.sensitivity}` });
  let preview = null;
  if (sample && m.source_table && m.source_field && /^[a-z_][a-z0-9_]*$/i.test(m.source_table + m.source_field) && !issues.some((i) => ['FIELD_MISSING', 'RULE_INVALID', 'CODESET_MISSING'].includes(i.code))) {
    try {
      const rows = q.all(`SELECT ${m.source_field} AS v FROM ${m.source_table} LIMIT 200`); let fail = 0; let trunc = 0; let unknown = 0; const ex = [];
      for (const r of rows) { const o = applyChain(rules, r.v, {}); if (o.flags.some((f) => f.flag === 'CAST_FAIL')) fail++; if (o.flags.some((f) => f.flag === 'UNKNOWN_CODE')) { unknown++; if (ex.length < 5) ex.push({ raw: r.v, flag: 'UNKNOWN_CODE' }); } if (std && std.length && o.value != null && String(o.value).length > std.length) trunc++; if (ex.length < 5 && r.v != null) ex.push({ raw: require('./schema').mask(m.source_field, r.v), out: require('./schema').mask(m.source_field, o.value) }); }
      preview = { rows: rows.length, cast_failures: fail, truncations: trunc, unknown_codes: unknown, examples: ex.slice(0, 5), sample_kind: 'ACTUAL_MASKED' };
      if (fail) issues.push({ severity: 'HIGH', code: 'CAST_FAIL', message: `형변환 실패 ${fail}건` }); if (trunc) issues.push({ severity: 'HIGH', code: 'TRUNCATION', message: `텍스트 잘림 ${trunc}건(표준 길이 ${std.length})` });
      if (unknown) issues.push({ severity: 'MEDIUM', code: 'UNKNOWN_CODE', message: `표준코드 미등록 값 ${unknown}건 → QUARANTINE` });
    } catch (e) { issues.push({ severity: 'HIGH', code: 'PREVIEW_FAIL', message: e.message }); }
  }
  const verdict = issues.some((i) => i.severity === 'HIGH') ? 'FAIL' : issues.length ? 'WARN' : 'PASS';
  return { verdict, issues, preview };
}
const sensRank = (s) => ({ PUBLIC: 0, INTERNAL: 1, SENSITIVE: 2, CONFIDENTIAL: 3 }[String(s).toUpperCase()] ?? 1);

function upsertMapping(ctx, b) {
  const v = validateMapping(b, { sample: false }); if (v.verdict === 'FAIL') throw err('MAPPING_INVALID', v.issues.map((i) => i.message).join('; '), 422);
  const id = b.id || nid('MAP'); const row = { id, source_system: b.source_system, source_table: b.source_table, source_field: b.source_field, target_entity: b.target_entity, target_field: b.target_field, rule_json: J(b.rules || (b.rule ? [b.rule] : [])), mapping_version: b.mapping_version || 'draft', status: b.status || 'DRAFT', precedence: b.precedence || 1, required: b.required ? 1 : 0, note: b.note || '', updated_at: U.iso() };
  q.upsert('di_mapping', row); return hydMap(q.get('SELECT * FROM di_mapping WHERE id=?', id));
}

// 레코드 표준화: 활성 매핑 버전 + 코드표 적용 → 표준 속성 맵
function standardizeRecord(system, table, rec, version) {
  const ms = listMappings(version).filter((m) => (m.status === 'ACTIVE') && m.source_system === system && m.source_table === table);
  const out = {}; const flags = []; const prov = {};
  for (const m of ms) {
    const o = applyChain(m.rules, rec[m.source_field], rec);
    const key = `${m.target_entity}.${m.target_field}`;
    if (o.flags.length) o.flags.forEach((f) => flags.push({ ...f, field: m.source_field, target: key }));
    if (out[key] === undefined || (o.value != null && o.value !== '')) { out[key] = o.value; prov[key] = { source: `${system}.${table}.${m.source_field}`, mapping: m.id, version: m.mapping_version }; }
  }
  return { std: out, flags, provenance: prov };
}
function normalizeOrgName(name) {
  if (!name) return '';
  return String(name).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\b(ltd|limited|co|company|inc|corp|corporation|llc|gmbh|pte)\b/gu, ' ').replace(/주식회사|\(주\)/gu, ' ').replace(/\s+/g, ' ').trim();
}

module.exports = { RULE_TYPES, REGEX_ALLOW, validateRule, applyRule, applyChain, hashId, listMappings, mappingVersions, activeVersion, coverage, validateMapping, upsertMapping, standardizeRecord, normalizeOrgName, hydMap, REQUIRED_TARGETS };
