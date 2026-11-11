'use strict';
// Data Quality Center: 6대 품질 차원(스펙 §11) 실측, 허용 DSL 규칙만 실행, 정비 워크플로우(승인된 값만 Apply).
const { q } = require('../db');
const U = require('../util');
const G = require('../gov');
const S = require('./schema');
const { J, P, nid, ev, audit, err } = require('./core');

const RULE_VERSION = 'dq-rules-v1';
const SYS_OF = { demo_crm_customer: 'CRM', demo_crm_participation: 'CRM', demo_crm_voc: 'CRM', demo_bk_member: 'BUYKOREA', demo_bk_product: 'BUYKOREA', demo_bk_inquiry: 'BUYKOREA' };
const SRC_OF = { CRM: 'CRM_DEMO', BUYKOREA: 'BUYKOREA_DEMO' };
const WEIGHTS = { completeness: 0.25, uniqueness: 0.2, validity: 0.25, consistency: 0.1, accuracy: 0.1, timeliness: 0.1 };
const DIM_LABEL = { completeness: ['완전성', 'Completeness'], uniqueness: ['유일성', 'Uniqueness'], validity: ['유효성', 'Validity'], consistency: ['일관성', 'Consistency'], accuracy: ['정확성', 'Accuracy'], timeliness: ['적시성', 'Timeliness'] };
const FORMULAS = {
  completeness: '필수값 유효 건수 / 평가대상 필수값 건수', uniqueness: '중복 아닌 레코드 수 / 평가대상 레코드 수', validity: '검증 통과 값 수 / 평가 대상 값 수',
  consistency: 'CRM↔BK 연결 후보 중 핵심 필드(국가·정규화 법인명)가 일치한 쌍 / 평가 대상 쌍', accuracy: '검증 가능한 참조 규칙(한국 사업자번호 체크섬) 통과 / 검증 대상 값', timeliness: '마지막 성공 반영이 SLA(24h) 이내인 원천 수 / 활성 원천 수',
};

// 허용된 규칙만 (check_type 화이트리스트). params 의 식별자는 모두 검증한다.
const DEFAULT_RULES = [
  ['DQ-C01', 'demo_crm_customer.contact_email', 'completeness', 'NOT_NULL', { table: 'demo_crm_customer', field: 'contact_email' }, 'MEDIUM'],
  ['DQ-C02', 'demo_crm_customer.country_code', 'completeness', 'NOT_NULL', { table: 'demo_crm_customer', field: 'country_code' }, 'HIGH'],
  ['DQ-C03', 'demo_crm_customer.organization_name', 'completeness', 'NOT_NULL', { table: 'demo_crm_customer', field: 'organization_name', where_kind: 'CRM_ORG' }, 'HIGH'],
  ['DQ-C04', 'demo_bk_member.manager_email', 'completeness', 'NOT_NULL', { table: 'demo_bk_member', field: 'manager_email' }, 'HIGH'],
  ['DQ-C05', 'demo_bk_member.residence_country', 'completeness', 'NOT_NULL', { table: 'demo_bk_member', field: 'residence_country' }, 'MEDIUM'],
  ['DQ-C06', 'demo_bk_member.business_name_en', 'completeness', 'NOT_NULL', { table: 'demo_bk_member', field: 'business_name_en' }, 'HIGH'],
  ['DQ-V01', 'demo_crm_customer.contact_email', 'validity', 'FORMAT', { table: 'demo_crm_customer', field: 'contact_email', sem: 'EMAIL' }, 'MEDIUM'],
  ['DQ-V02', 'demo_bk_member.manager_email', 'validity', 'FORMAT', { table: 'demo_bk_member', field: 'manager_email', sem: 'EMAIL' }, 'HIGH'],
  ['DQ-V03', 'demo_crm_customer.country_code', 'validity', 'ISO_COUNTRY', { table: 'demo_crm_customer', field: 'country_code' }, 'MEDIUM'],
  ['DQ-V04', 'demo_bk_member.residence_country', 'validity', 'ISO_COUNTRY', { table: 'demo_bk_member', field: 'residence_country' }, 'MEDIUM'],
  ['DQ-V05', 'demo_crm_customer.business_reg_no', 'validity', 'FORMAT', { table: 'demo_crm_customer', field: 'business_reg_no', sem: 'REG_NO' }, 'MEDIUM'],
  ['DQ-V06', 'demo_bk_member.company_reg_no', 'validity', 'FORMAT', { table: 'demo_bk_member', field: 'company_reg_no', sem: 'REG_NO' }, 'MEDIUM'],
  ['DQ-V07', 'demo_crm_customer.consent_at..consent_until', 'validity', 'DATE_ORDER', { table: 'demo_crm_customer', from: 'consent_at', to: 'consent_until' }, 'HIGH'],
  ['DQ-V08', 'demo_bk_product.hs_code', 'validity', 'FORMAT', { table: 'demo_bk_product', field: 'hs_code', sem: 'HS' }, 'LOW'],
  ['DQ-U01', 'demo_crm_customer (정규화 법인명+국가)', 'uniqueness', 'UNIQUE_NATURAL', { table: 'demo_crm_customer', name: 'organization_name', country: 'country_code', where_kind: 'CRM_ORG' }, 'MEDIUM'],
  ['DQ-U02', 'demo_bk_member (정규화 법인명+국가)', 'uniqueness', 'UNIQUE_NATURAL', { table: 'demo_bk_member', name: 'business_name_en', country: 'residence_country' }, 'MEDIUM'],
  ['DQ-A01', 'demo_crm_customer.business_reg_no (체크섬)', 'accuracy', 'REG_CHECKSUM', { table: 'demo_crm_customer', field: 'business_reg_no' }, 'MEDIUM'],
  ['DQ-A02', 'demo_bk_member.company_reg_no (체크섬)', 'accuracy', 'REG_CHECKSUM', { table: 'demo_bk_member', field: 'company_reg_no' }, 'MEDIUM'],
];
const WHERE = { CRM_ORG: " WHERE customer_type='ORGANIZATION'" };
const IDENT = /^[a-z_][a-z0-9_]*$/i;
function seedRules() { for (const [id, subject, dim, check, params, sev] of DEFAULT_RULES) q.upsert('di_dq_rule', { id, subject, dimension: dim, check_type: check, params: J(params), severity: sev, threshold: 0.95, status: 'ACTIVE', version: RULE_VERSION }); }

function pkOf(table) { const c = q.all(`PRAGMA table_info(${table})`).find((x) => x.pk); return c ? c.name : 'rowid'; }
function rowsOf(params) {
  [params.table, params.field, params.from, params.to, params.name, params.country].filter(Boolean).forEach((x) => { if (!IDENT.test(x)) throw err('BAD_RULE', '허용되지 않은 식별자'); });
  if (!SYS_OF[params.table]) throw err('BAD_RULE', '허용되지 않은 테이블');
  const pk = pkOf(params.table); const where = WHERE[params.where_kind] || '';
  return { pk, rows: q.all(`SELECT * FROM ${params.table}${where}`), system: SYS_OF[params.table] };
}
const ref = (system, table, pk) => `${system}:${table}:${pk}`;
const present = (v) => v != null && String(v).trim() !== '';

function evalRule(rule) {
  const p = U.parse(rule.params, {}); const { pk, rows, system } = rowsOf(p); const viol = []; let evaluated = 0; let passed = 0;
  const fix = (v) => (S.ISO2.has(String(v).toUpperCase()) ? String(v).toUpperCase() : (q.get("SELECT standard_value s FROM di_codeset WHERE code_set='COUNTRY_ISO2' AND version='v1' AND source_value=?", String(v).toUpperCase()) || {}).s);
  switch (rule.check_type) {
    case 'NOT_NULL': for (const r of rows) { evaluated++; if (present(r[p.field])) passed++; else viol.push({ pk: r[pk], field: p.field, value: null, suggestion: { type: 'REQUEST_SOURCE_FIX', note: '원천 시스템에서 값 보완 필요(자동 보정 불가)' } }); } break;
    case 'FORMAT': for (const r of rows) { if (!present(r[p.field])) continue; evaluated++; if (S.validValue(p.sem, r[p.field])) passed++; else viol.push({ pk: r[pk], field: p.field, value: r[p.field], suggestion: { type: 'REQUEST_SOURCE_FIX', note: `${p.sem} 형식 오류` } }); } break;
    case 'ISO_COUNTRY': for (const r of rows) { if (!present(r[p.field])) continue; evaluated++; if (S.ISO2.has(String(r[p.field]))) passed++; else { const f = fix(r[p.field]); viol.push({ pk: r[pk], field: p.field, value: r[p.field], suggestion: f ? { type: 'SET_VALUE', value: f, note: `국가코드 정규화 ${r[p.field]} → ${f}` } : { type: 'REQUEST_SOURCE_FIX', note: '미등록 국가코드' } }); } } break;
    case 'DATE_ORDER': for (const r of rows) { if (!present(r[p.from]) || !present(r[p.to])) continue; evaluated++; if (String(r[p.from]) <= String(r[p.to])) passed++; else viol.push({ pk: r[pk], field: p.from, value: `${r[p.from]} > ${r[p.to]}`, suggestion: { type: 'REQUEST_SOURCE_FIX', note: '동의 시작이 만료보다 늦음' } }); } break;
    case 'UNIQUE_NATURAL': { const seen = new Map(); for (const r of rows) { evaluated++; const k = `${require('./mapping').normalizeOrgName(r[p.name])}|${String(r[p.country] || '').toUpperCase()}`; if (!k.startsWith('|')) { if (seen.has(k)) viol.push({ pk: r[pk], field: p.name, value: r[p.name], suggestion: { type: 'DEDUP_REVIEW', note: `동일 시스템 내 중복 후보(기준 ${seen.get(k)})` } }); else { seen.set(k, r[pk]); passed++; } } else passed++; } break; }
    case 'REG_CHECKSUM': for (const r of rows) { const v = r[p.field]; if (!present(v) || !/^\d{3}-\d{2}-\d{5}$/.test(String(v))) continue; evaluated++; if (S.krRegValid(String(v))) passed++; else viol.push({ pk: r[pk], field: p.field, value: v, suggestion: { type: 'REQUEST_SOURCE_FIX', note: '사업자번호 체크섬 불일치' } }); } break;
    default: throw err('BAD_RULE', `허용되지 않은 검사 유형: ${rule.check_type}`);
  }
  return { rule, system, table: p.table, pk, evaluated, passed, violations: viol };
}
const pct = (n, d) => (d > 0 ? U.round((n / d) * 100, 1) : null); // 분모 0 → N/A(null)

function consistencyScore() {
  const cands = q.all("SELECT * FROM di_candidate WHERE band IN ('AUTO_LINK_CANDIDATE','REVIEW_REQUIRED')"); let ok = 0; let n = 0; const detail = [];
  for (const c of cands) {
    const d = require('./mdm').candidateDetail(c.id); if (!d || !d.left || !d.right) continue; n++;
    const countryOk = String(d.left.country || '').toUpperCase() === String(d.right.country || '').toUpperCase();
    const nameOk = require('./mapping').normalizeOrgName(d.left.name) === require('./mapping').normalizeOrgName(d.right.name);
    if (countryOk && nameOk) ok++; else detail.push({ candidate: c.id, country_match: countryOk, name_match: nameOk });
  }
  return { evaluated: n, passed: ok, detail };
}
function timelinessScore() {
  const srcs = q.all("SELECT * FROM di_source WHERE enabled=1 AND integration_mode IN ('SYNTHETIC','MOCK')"); let ok = 0; const detail = [];
  for (const s of srcs) { const r = q.get("SELECT finished_at f FROM di_run WHERE (source_id=? OR source_id LIKE ? OR source_id LIKE ?) AND status IN ('SUCCEEDED','PARTIAL') ORDER BY finished_at DESC LIMIT 1", s.id, `${s.id},%`, `%,${s.id}`); const lag = r ? (new Date(U.iso()) - new Date(r.f)) / 3600000 : null; const within = lag != null && lag <= 24; if (within) ok++; detail.push({ source: s.id, lag_hours: lag == null ? null : U.round(lag, 2), within_sla: within }); }
  return { evaluated: srcs.length, passed: ok, detail };
}

function run(ctx, { createIssues = true } = {}) {
  const rules = q.all("SELECT * FROM di_dq_rule WHERE status='ACTIVE' ORDER BY id"); const dims = {}; const bySystem = {}; const results = []; let created = 0;
  for (const r of rules) {
    const o = evalRule(r); results.push(o);
    const d = (dims[r.dimension] = dims[r.dimension] || { evaluated: 0, passed: 0 }); d.evaluated += o.evaluated; d.passed += o.passed;
    const s = (bySystem[o.system] = bySystem[o.system] || {}); const sd = (s[r.dimension] = s[r.dimension] || { evaluated: 0, passed: 0 }); sd.evaluated += o.evaluated; sd.passed += o.passed;
    if (createIssues) for (const v of o.violations) {
      const sref = ref(o.system, o.table, v.pk); const ex = q.get("SELECT id FROM di_dq_issue WHERE rule_id=? AND source_ref=? AND field=? AND status NOT IN ('CLOSED','REJECTED')", r.id, sref, v.field);
      if (!ex) { q.insert('di_dq_issue', { id: nid('DQI'), rule_id: r.id, dimension: r.dimension, severity: r.severity, source_ref: sref, field: v.field, evidence: J({ value_masked: v.value == null ? null : S.mask(v.field, v.value), rule: r.subject }), suggestion: J(v.suggestion), status: 'DETECTED', assigned_to: null, run_id: null, before_json: null, after_json: null, created_at: U.iso(), updated_at: U.iso(), version: 1 }); created++; }
    }
  }
  const cons = consistencyScore(); dims.consistency = { evaluated: cons.evaluated, passed: cons.passed };
  const tl = timelinessScore(); dims.timeliness = { evaluated: tl.evaluated, passed: tl.passed };
  const scores = {}; for (const k of Object.keys(WEIGHTS)) { const d = dims[k] || { evaluated: 0, passed: 0 }; scores[k] = { score: pct(d.passed, d.evaluated), evaluated: d.evaluated, passed: d.passed, weight: WEIGHTS[k], formula: FORMULAS[k] }; }
  const wsum = Object.entries(scores).filter(([, v]) => v.score != null).reduce((a, [k]) => a + WEIGHTS[k], 0);
  const overall = wsum > 0 ? U.round(Object.entries(scores).filter(([, v]) => v.score != null).reduce((a, [k, v]) => a + v.score * WEIGHTS[k], 0) / wsum, 1) : null;
  const sys = {}; for (const [s, ds] of Object.entries(bySystem)) { sys[s] = {}; for (const [k, d] of Object.entries(ds)) sys[s][k] = pct(d.passed, d.evaluated); }
  const id = nid('DQR'); const detail = { overall, scores, by_system: sys, issues_created: created, consistency: cons.detail, timeliness: tl.detail, mapping_coverage: require('./mapping').coverage(), rule_count: rules.length };
  q.insert('di_dq_run', { id, at: U.iso(), rule_version: RULE_VERSION, scores: J({ overall, ...Object.fromEntries(Object.entries(scores).map(([k, v]) => [k, v.score])) }), detail: J(detail), by_user: ctx && ctx.user ? ctx.user.id : 'system' });
  if (ctx) { ev(ctx, 'dq.run', id, { overall, created }); audit(ctx, 'quality.run', 'di_dq_run', id, { overall, created }); }
  return { run_id: id, rule_version: RULE_VERSION, at: U.iso(), overall, scores, by_system: sys, issues_created: created, mapping_coverage: detail.mapping_coverage, weights_note: '가중치와 rule_version 을 함께 표시합니다. 분모가 0이면 N/A 입니다.' };
}
function latest() { const r = q.get('SELECT * FROM di_dq_run ORDER BY at DESC, rowid DESC LIMIT 1'); return r ? { run_id: r.id, at: r.at, rule_version: r.rule_version, ...U.parse(r.detail, {}) } : null; }
function trend(limit = 12) { return q.all('SELECT id,at,scores FROM di_dq_run ORDER BY at DESC, rowid DESC LIMIT ?', limit).reverse().map((r) => ({ id: r.id, at: r.at, ...U.parse(r.scores, {}) })); }

// ───────── 정비 워크플로우 ─────────
const hydIssue = (i) => i && ({ ...i, evidence: U.parse(i.evidence, {}), suggestion: U.parse(i.suggestion, {}), before: U.parse(i.before_json, null), after: U.parse(i.after_json, null) });
function listIssues({ status, dimension, severity, system, limit = 200 } = {}) {
  let sql = 'SELECT * FROM di_dq_issue WHERE 1=1'; const p = [];
  if (status) { const st = String(status).split(','); sql += ` AND status IN (${st.map(() => '?').join(',')})`; p.push(...st); }
  if (dimension) { sql += ' AND dimension=?'; p.push(dimension); } if (severity) { sql += ' AND severity=?'; p.push(severity); } if (system) { sql += ' AND source_ref LIKE ?'; p.push(`${system}:%`); }
  sql += " ORDER BY CASE severity WHEN 'HIGH' THEN 0 WHEN 'MEDIUM' THEN 1 ELSE 2 END, created_at DESC LIMIT ?"; p.push(Math.min(Number(limit) || 200, 500));
  return q.all(sql, ...p).map(hydIssue);
}
function issueSummary() { const by = q.all('SELECT status s, COUNT(*) c FROM di_dq_issue GROUP BY status'); return Object.fromEntries(by.map((r) => [r.s, r.c])); }
function issueAction(ctx, id, action, b = {}) {
  const i = q.get('SELECT * FROM di_dq_issue WHERE id=?', id); if (!i) throw U.notFound('Issue not found');
  const sug = U.parse(i.suggestion, {}); const now = U.iso();
  const set = (to, extra = {}, note = '') => { G.transition(ctx, 'di_dq', id, to, note, { version: i.version + 1, ...extra }); ev(ctx, `dq.${to.toLowerCase()}`, id, { note }); return hydIssue(q.get('SELECT * FROM di_dq_issue WHERE id=?', id)); };
  switch (action) {
    case 'triage': return set('TRIAGED');
    case 'assign': { const who = String(b.assignee || ctx.user.id).slice(0, 40); return set('ASSIGNED', { assigned_to: who }, `assigned to ${who}`); }
    case 'propose': { if (!sug || !sug.type) throw err('NO_SUGGESTION', '정비 제안이 없습니다', 409); return set('PROPOSED', { before_json: J({ value_masked: U.parse(i.evidence, {}).value_masked }) }, sug.note || ''); }
    case 'review': return set('REVIEWED', {}, String(b.note || '').slice(0, 200));
    case 'approve': { if (ctx.user.role !== 'admin') throw err('FORBIDDEN', '정비 승인은 관리자(데이터 스튜어드 승인자)만 가능합니다', 403); if (b.confirm !== true) throw err('CONFIRM_REQUIRED', 'confirm:true 가 필요합니다', 400); if (i.assigned_to && i.assigned_to === ctx.user.id && process.env.DI_STRICT_SOD === 'true') throw err('SOD_VIOLATION', '담당자와 승인자는 분리되어야 합니다', 403); return set('APPROVED', {}, 'approved'); }
    case 'reject': return set('REJECTED', {}, String(b.note || '').slice(0, 200));
    case 'apply': {
      if (sug.type !== 'SET_VALUE') throw err('NOT_AUTO_APPLICABLE', '이 이슈는 자동 보정 대상이 아닙니다(원천 시스템 보완 필요)', 422);
      const [system, table, pk] = i.source_ref.split(':'); const fid = nid('DQF');
      q.insert('di_fix', { id: fid, issue_id: id, source_ref: i.source_ref, field: i.field, old_value: String(U.parse(i.evidence, {}).value_masked ?? ''), new_value: sug.value, applied_by: ctx.user.id, applied_at: now, reverted_at: null });
      const out = set('APPLIED', { after_json: J({ value: sug.value, fix: fid, layer: 'STANDARD(표준화 계층 오버레이 — 원천 원본 불변)' }) }, `applied ${fid}`);
      require('./pipeline').restandardizeOne(ctx, system, table, pk); audit(ctx, 'quality.apply', 'di_dq_issue', id, { fix: fid, field: i.field }); return out;
    }
    case 'verify': {
      const rule = q.get('SELECT * FROM di_dq_rule WHERE id=?', i.rule_id); const o = evalRuleOn(rule, i.source_ref, i.field); const fixed = q.get('SELECT 1 x FROM di_fix WHERE issue_id=? AND reverted_at IS NULL', id);
      if (!fixed && o.violation) throw err('VERIFY_FAILED', '아직 위반 상태입니다', 409);
      return set('VERIFIED', { after_json: J({ ...(U.parse(i.after_json, {}) || {}), verified_at: now, remaining_violation: !fixed && o.violation }) }, 'verified');
    }
    case 'close': return set('CLOSED');
    case 'reopen': return set('REOPENED');
    default: throw err('BAD_ACTION', 'unknown action', 400);
  }
}
function evalRuleOn(rule, sourceRef, field) { const o = evalRule(rule); const [, , pk] = sourceRef.split(':'); return { violation: o.violations.some((v) => String(v.pk) === pk && v.field === field) }; }
// 표준화 단계가 사용하는 오버레이(원천 불변)
function fixesFor(system, table, pk) { return q.all('SELECT field,new_value FROM di_fix WHERE source_ref=? AND reverted_at IS NULL', `${system}:${table}:${pk}`); }

module.exports = { RULE_VERSION, WEIGHTS, DIM_LABEL, FORMULAS, DEFAULT_RULES, seedRules, evalRule, run, latest, trend, listIssues, issueSummary, issueAction, fixesFor, SYS_OF, SRC_OF, hydIssue };
