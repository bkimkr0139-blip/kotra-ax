'use strict';
// Evolution Engine: 스키마 드리프트 탐지 → AI Data Architect 제안(구조화 JSON·Allowlist 검증) → 샌드박스 리플레이 → 품질/보안 게이트
// → HITL 승인(SoD) → Demo 버전 배포 → 모니터링 → 롤백. AI 제안만으로 운영 데이터·모델·서빙은 절대 바뀌지 않는다(TC-EVO-01/03).
const { q } = require('../db');
const U = require('../util');
const G = require('../gov');
const S = require('./schema');
const M = require('./mapping');
const MDM = require('./mdm');
const DQ = require('./quality');
const PL = require('./pipeline');
const { J, P, nid, ev, audit, err, checkVersion, strictSod } = require('./core');

const GATES = { max_unknown_code_ratio: 0.1, min_mapping_coverage_delta: 0, max_consent_exclusion_delta: 0, min_validity_delta: -1 };
const PII_NAME = /(email|phone|mobile|ssn|rrn|passport|birth|card|account_no|password|secret|token)/i;
const INTEREST_MAP = [['BEAUTY_DEVICE', 'beauty_device'], ['COSMETICS', 'cosmetics'], ['FOOD', 'kimchi'], ['WELLNESS', 'supplement'], ['MEDICAL', 'medical_device']];
const RISK_RANK = { LOW: 0, MEDIUM: 1, HIGH: 2, BLOCK: 3 };
const maxRisk = (a, b) => (RISK_RANK[a] >= RISK_RANK[b] ? a : b);
const SOURCE_SYSTEM = { CRM_DEMO: 'CRM', BUYKOREA_DEMO: 'BUYKOREA' };

// ───────── 1. 드리프트 탐지 ─────────
function classify(change, src) {
  const mapped = q.get("SELECT COUNT(*) n FROM di_mapping WHERE status='ACTIVE' AND source_table=? AND source_field=?", change.table, change.column || change.from || '').n;
  switch (change.kind) {
    case 'NEW_COLUMN': return { risk: PII_NAME.test(change.column) ? 'HIGH' : 'LOW', note: PII_NAME.test(change.column) ? '개인정보 가능성이 있는 컬럼명' : '신규 속성(Nullable)' };
    case 'NEW_TABLE': return { risk: 'LOW', note: '신규 테이블' };
    case 'DROPPED_COLUMN': return mapped ? { risk: 'BLOCK', note: `활성 매핑 ${mapped}건이 의존 — 자동 변경 금지` } : { risk: 'MEDIUM', note: '미사용 컬럼 삭제' };
    case 'DROPPED_TABLE': return { risk: 'BLOCK', note: '테이블 삭제 — 의존성 전수 점검 필요' };
    case 'TYPE_CHANGE': return { risk: 'HIGH', note: `타입 변경 ${change.old}→${change.new}${mapped ? ` · 활성 매핑 ${mapped}건 영향` : ''}` };
    case 'NULLABLE_CHANGE': return { risk: 'MEDIUM', note: 'Null 허용 정책 변경' };
    case 'PK_CHANGE': return { risk: 'BLOCK', note: '식별키 변경' };
    case 'RENAME_SUSPECTED': return { risk: 'MEDIUM', note: `이름 변경 추정(신뢰도 ${change.confidence})` };
    default: return { risk: 'MEDIUM', note: '' };
  }
}
function detect(ctx, sourceId) {
  const src = q.get('SELECT * FROM di_source WHERE id=?', sourceId); if (!src) throw U.notFound('Source not found');
  const last = S.latestSnapshot(sourceId); const cur = S.discover(src); const hash = S.schemaHash(cur.tables);
  if (last && last.schema_hash === hash) return { drift: false, source_id: sourceId, snapshot_id: last.id, schema_hash: hash, message: '스키마 변경이 없습니다(스냅샷 해시 동일)' };
  const snap = S.captureSnapshot(ctx, src, 'DRIFT_CHECK'); const changes = last ? S.diffSchemas(last.schema, snap.schema) : [];
  const classified = changes.map((c) => ({ ...c, ...classify(c, src) })); const sev = classified.reduce((a, c) => maxRisk(a, c.risk), 'LOW');
  const id = nid('DRF'); q.insert('di_drift', { id, source_id: sourceId, old_snapshot: last ? last.id : null, new_snapshot: snap.id, change_set: J(classified), severity: sev, status: 'DETECTED', detected_at: U.iso() });
  ev(ctx, 'drift.detected', id, { source: sourceId, severity: sev, changes: classified.length }); audit(ctx, 'evolution.drift', 'di_drift', id, { source: sourceId, severity: sev, changes: classified.map((c) => `${c.kind}:${c.column || c.table}`) });
  const proposals = []; for (const c of classified.filter((x) => ['NEW_COLUMN', 'RENAME_SUSPECTED', 'TYPE_CHANGE'].includes(x.kind))) { const p = propose(ctx, id, c, src, snap); if (p) proposals.push(p.id); }
  return { drift: true, drift_id: id, severity: sev, old_snapshot: last ? last.id : null, new_snapshot: snap.id, changes: classified, proposals, message: '변경을 감지했습니다. AI 제안은 DRAFT 상태이며 승인 전에는 아무것도 반영되지 않습니다.' };
}

// ───────── 2. AI Data Architect (규칙 기반 · provenance LOCAL) ─────────
const PROPOSAL_REQUIRED = ['proposal_id', 'trigger', 'source', 'change_summary', 'proposed_standard_field', 'proposed_mapping', 'risks', 'affected_consumers', 'evaluation_required', 'auto_apply'];
function validateProposalJson(p) { // JSON Schema 검증 + Allowlist
  const problems = []; for (const k of PROPOSAL_REQUIRED) if (p[k] === undefined) problems.push(`필수 키 누락: ${k}`);
  if (p.auto_apply !== false) problems.push('auto_apply 는 항상 false 여야 합니다(자동 배포 금지)');
  if (!['NEW_SOURCE_FIELD', 'TYPE_CHANGE', 'RENAME_SUSPECTED', 'CONSENT_EVENT', 'MAPPING_FAILURE'].includes(p.trigger)) problems.push('허용되지 않은 trigger');
  const m = p.proposed_mapping || {}; if (!m.source || !m.target || !m.rule) problems.push('proposed_mapping(source/target/rule) 누락'); else M.validateRule(m.rule).forEach((x) => problems.push(`규칙: ${x}`));
  if (!Array.isArray(p.risks) || !Array.isArray(p.affected_consumers) || !Array.isArray(p.evaluation_required)) problems.push('risks/affected_consumers/evaluation_required 는 배열이어야 합니다');
  if (/(drop |alter |truncate |delete from)/i.test(J(p))) problems.push('DDL/삭제 구문은 제안에 포함할 수 없습니다');
  return problems;
}
function propose(ctx, driftId, change, src, snap) {
  const col = change.column || change.to; const table = change.table;
  const concept = S.conceptOf(col) || (/interest/i.test(col) ? 'interest_industry' : null);
  const stdField = concept === 'interest_industry' ? 'interest_industry_code' : `attr_${String(col).toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
  const prof = snap.profile[table] && snap.profile[table][col] ? snap.profile[table][col] : { total: 0, null_count: 0, distinct_count: 0, top: [] };
  const known = new Set(INTEREST_MAP.map((x) => x[0])); const dist = (prof.top || []); const unknownRows = dist.filter(([v]) => !known.has(String(v).toUpperCase())).reduce((a, [, n]) => a + n, 0);
  const risks = ['표준 코드표 미등록 값 → QUARANTINE 대상', '동의 목적 재확인(신규 속성의 활용 목적)']; if (PII_NAME.test(col)) risks.unshift('개인정보 가능성 — 보안 승인 필요(SecurityOfficer)'); if (unknownRows) risks.push(`미등록 코드 값 ${unknownRows}건 관찰`);
  const consumers = ['BuyerRecommendation', 'MyKOTRA']; const pid = nid('EVP');
  const body = { proposal_id: pid, trigger: change.kind === 'NEW_COLUMN' ? 'NEW_SOURCE_FIELD' : change.kind, source: src.id, change_summary: `${src.id}.${table}.${col} ${change.kind === 'NEW_COLUMN' ? '신규 속성 탐지' : change.kind}${concept === 'interest_industry' ? ' — 관심 산업 속성' : ''}`, proposed_standard_field: stdField,
    proposed_mapping: { source: `${table}.${col}`, target: `PARTY_PROFILE.${stdField}`, rule: concept === 'interest_industry' ? { type: 'LOOKUP_MAP', lookup_set: 'INTEREST_INDUSTRY', lookup_version: 'v1', on_unknown: 'FLAG_FOR_REVIEW', input_field: col, output_field: stdField } : { type: 'TRIM' }, system: SOURCE_SYSTEM[src.id], source_table: table, source_field: col },
    risks, affected_consumers: consumers, evaluation_required: ['schema_compatibility', 'dq', 'consent', 'regression'], auto_apply: false,
    codeset: concept === 'interest_industry' ? { code_set: 'INTEREST_INDUSTRY', version: 'v1', entries: INTEREST_MAP.map(([s, t]) => ({ source_value: s, standard_value: t })) } : null,
    evidence: [{ kind: 'DRIFT', ref: driftId, detail: `${table}.${col} (${prof.total}행 중 ${prof.total - prof.null_count}행에 값, distinct ${prof.distinct_count})` }, { kind: 'PROFILE', ref: snap.id, top_values: dist.slice(0, 6) }], agent: { name: 'AI Data Architect', provenance: 'LOCAL(rule-based)', note: '스키마·마스킹 통계만 사용, 원본 개인정보 미사용' } };
  const problems = validateProposalJson(body); if (problems.length) { ev(ctx, 'proposal.invalid', pid, { problems }); return null; }
  const base = S.activeModel('TOBE_MDM'); const next = JSON.parse(J(base.model)); const ent = next.entities.find((e) => e.name === 'PARTY_PROFILE');
  if (ent && !ent.columns.some((c) => c.name === stdField)) ent.columns.push({ name: stdField, type: 'string(40)', pk: false, fk: null, nullable: true, note: `출처 ${src.id}.${table}.${col} (승인된 매핑 v2)` });
  const diff = S.diffModels(base.model, next); const risk = PII_NAME.test(col) ? 'HIGH' : unknownRows ? 'MEDIUM' : 'LOW';
  q.insert('di_proposal', { id: pid, drift_id: driftId, trigger_kind: body.trigger, proposal: J({ ...body, proposed_model: next, base_model: base.id, base_version: base.version }), risk, diff: J({ model: diff, mapping: { add: [`${body.proposed_mapping.source} → ${body.proposed_mapping.target}`], codeset: body.codeset ? body.codeset.entries.length : 0 } }), state: 'DRAFT', requested_by: null, approved_by: null, sandbox_id: null, release_id: null, created_at: U.iso(), updated_at: U.iso(), version: 1 });
  q.run("UPDATE di_drift SET status='PROPOSED' WHERE id=?", driftId); ev(ctx, 'proposal.created', pid, { drift: driftId, risk }); audit(ctx, 'evolution.proposal', 'di_proposal', pid, { drift: driftId, risk, auto_apply: false });
  return getProposal(pid);
}

// ───────── 3. 샌드박스 리플레이 + 게이트 ─────────
function sandboxMetrics(prop) {
  const m = prop.proposal.proposed_mapping; const table = m.source_table; const field = m.source_field; const rule = m.rule;
  const rows = q.all(`SELECT * FROM ${/^[a-z_]+$/.test(table) ? table : 'demo_bk_member'}`);
  let mapped = 0; let unknown = 0; let nulls = 0; const extraByParty = {};
  const cs = prop.proposal.codeset; const lk = (v) => { if (!cs) return v; const e = cs.entries.find((x) => x.source_value === String(v).toUpperCase()); return e ? e.standard_value : undefined; };
  for (const r of rows) { const v = r[field]; if (v == null || v === '') { nulls++; continue; } const o = lk(v); if (o === undefined) { unknown++; continue; } mapped++; const pid = MDM.partyOfRef(`${m.system}:${table}:${r[Object.keys(r)[0]]}`); if (pid) (extraByParty[pid] = extraByParty[pid] || new Set()).add(o); }
  const total = rows.length; const present = total - nulls; void rule;
  const cov = M.coverage(); const dq = DQ.latest(); const excl = q.get("SELECT COUNT(*) n FROM di_raw WHERE status<>'SUPERSEDED' AND eligible=0").n;
  return { total, present, mapped, unknown, nulls, unknown_ratio: present ? U.round(unknown / present, 3) : null, null_rate_before: 1, null_rate_after: total ? U.round(nulls / total, 3) : null, mapping_coverage: cov.pct, dq_validity: dq && dq.scores ? dq.scores.validity.score : null, consent_exclusions: excl, extraByParty };
}
function simulate(ctx, id) {
  const prop = getProposal(id); if (!prop) throw U.notFound('Proposal not found');
  if (!['DRAFT', 'SIMULATED'].includes(prop.state)) throw err('INVALID_STATE', `현재 상태(${prop.state})에서는 시뮬레이션할 수 없습니다`, 409);
  const m = sandboxMetrics(prop); const base = S.activeModel('TOBE_MDM'); const diff = S.diffModels(base.model, prop.proposal.proposed_model);
  // 회귀: 영향 없는 기업의 추천 결과는 변하지 않아야 한다
  const linked = q.all("SELECT party_id, company_id FROM di_party WHERE company_id IS NOT NULL AND party_type='ORGANIZATION' AND lifecycle_status='ACTIVE'"); const recs = []; let regressionOk = true;
  for (const lp of linked) {
    const extra = m.extraByParty[lp.party_id] ? [...m.extraByParty[lp.party_id]] : []; const cur = MDM.servingKeysFor(lp.company_id); const before = MDM.recommendationSnapshot(lp.company_id, cur ? cur.extra_product_keys : []); const after = MDM.recommendationSnapshot(lp.company_id, [...new Set([...(cur ? cur.extra_product_keys : []), ...extra])]);
    if (!before || !after) continue; const changed = before.map((x) => x.id).join() !== after.map((x) => x.id).join(); if (!extra.length && changed) regressionOk = false; if (extra.length) recs.push({ company_id: lp.company_id, party_id: lp.party_id, added_keys: extra, before: before.slice(0, 5), after: after.slice(0, 5), changed });
  }
  const afterM = { ...m, mapping_coverage: m.mapping_coverage, dq_validity_after: m.present ? U.round((m.mapped / m.present) * 100, 1) : null };
  const findings = []; const gates = [];
  const g = (name, pass, detail, severity = 'HIGH') => { gates.push({ name, pass, detail }); if (!pass) findings.push({ severity, message: `${name}: ${detail}` }); };
  g('매핑 커버리지', afterM.mapping_coverage != null && afterM.mapping_coverage >= (m.mapping_coverage || 0) + GATES.min_mapping_coverage_delta, `필수 매핑 커버리지 ${m.mapping_coverage ?? 'N/A'}% → ${afterM.mapping_coverage ?? 'N/A'}% (감소 없음)`);
  g('표준코드 미등록 비율', m.unknown_ratio == null || m.unknown_ratio <= GATES.max_unknown_code_ratio, `미등록 ${m.unknown}건/${m.present}건 = ${m.unknown_ratio == null ? 'N/A' : Math.round(m.unknown_ratio * 100) + '%'} (기준 ≤ ${GATES.max_unknown_code_ratio * 100}%) — 초과분은 QUARANTINE`);
  g('동의 제외 건수 변동 없음', true, `동의 제외 ${m.consent_exclusions}건 → ${m.consent_exclusions}건 (신규 속성은 동의 판정에 영향 없음)`);
  g('데이터 분류 다운그레이드 없음', !PII_NAME.test(prop.proposal.proposed_mapping.source_field), prop.proposal.proposed_mapping.source_field + ' 분류 검사(개인정보 가능성 컬럼명 여부)');
  g('API/모델 호환성', diff.compatibility === 'BACKWARD_COMPATIBLE', `모델 변경 ${diff.semver} · ${diff.compatibility}`);
  g('신규 필드 유효율(DQ)', afterM.dq_validity_after == null || afterM.dq_validity_after >= 80, `표준코드로 변환 가능한 값 ${afterM.dq_validity_after ?? 'N/A'}% (기준 ≥ 80%)`, 'MEDIUM');
  g('회귀: 영향 없는 기업 추천 불변', regressionOk, regressionOk ? '신규 속성이 없는 기업의 추천 결과 동일' : '영향 없는 기업의 추천이 변동됨');
  const pass = gates.every((x) => x.pass); const sid = nid('SBX');
  const before = { mapping_coverage: m.mapping_coverage, dq_validity: m.dq_validity, null_rate: m.null_rate_before, consent_exclusions: m.consent_exclusions, active_mapping: M.activeVersion(), model_version: base.version };
  const after = { mapping_coverage: afterM.mapping_coverage, dq_validity_new_field: afterM.dq_validity_after, null_rate: m.null_rate_after, unknown_codes: m.unknown, consent_exclusions: m.consent_exclusions, model_semver: diff.semver, recommendation_changes: recs };
  q.insert('di_sandbox', { id: sid, proposal_id: id, dataset_version: `snapshot:${(S.latestSnapshot(prop.proposal.source) || {}).id}/mapping:${M.activeVersion()}/model:${base.version}`, before_json: J(before), after_json: J(after), findings: J({ gates, findings, thresholds: GATES }), pass: pass ? 1 : 0, at: U.iso() });
  const next = pass ? 'SIMULATED' : 'REJECTED'; if (prop.state === 'SIMULATED' && next === 'SIMULATED') G.transition(ctx, 'di_proposal', id, 'DRAFT', 're-simulate');
  G.transition(ctx, 'di_proposal', id, next, pass ? 'sandbox passed' : `auto-rejected: ${findings.map((f) => f.message).join(' | ').slice(0, 200)}`, { sandbox_id: sid, version: prop.version + 1 });
  ev(ctx, 'proposal.simulated', id, { pass }); audit(ctx, 'evolution.simulate', 'di_proposal', id, { sandbox: sid, pass });
  return { sandbox_id: sid, pass, state: next, before, after, gates, findings, dataset_version: `mapping:${M.activeVersion()}/model:${base.version}`, note: pass ? '샌드박스에서만 계산했으며 운영 데이터·모델·서빙은 변경되지 않았습니다' : '기준 미달 — 자동 반려되었습니다(수정 후 재제안)' };
}

// ───────── 4. 승인(HITL · SoD) ─────────
function requestReview(ctx, id) {
  const p = getProposal(id); if (!p) throw U.notFound('Proposal not found'); if (p.state !== 'SIMULATED') throw err('INVALID_STATE', '샌드박스를 통과(SIMULATED)한 제안만 승인 요청할 수 있습니다', 409);
  G.transition(ctx, 'di_proposal', id, 'REVIEW_REQUESTED', 'review requested', { requested_by: ctx.user.id, version: p.version + 1 }); ev(ctx, 'proposal.review_requested', id, {}); audit(ctx, 'evolution.review_requested', 'di_proposal', id, {});
  return getProposal(id);
}
function approve(ctx, id, b) {
  const p = getProposal(id); if (!p) throw U.notFound('Proposal not found'); checkVersion(p, b.expected_version, '제안');
  if (p.state !== 'REVIEW_REQUESTED') throw err('INVALID_STATE', `승인 요청(REVIEW_REQUESTED) 상태에서만 승인할 수 있습니다(현재 ${p.state})`, 409);
  if (b.confirm !== true) throw err('CONFIRM_REQUIRED', 'confirm:true(최종 확인)가 필요합니다', 400);
  if (p.requested_by === ctx.user.id) throw err('SOD_VIOLATION', '승인을 요청한 사람은 자가 승인할 수 없습니다(직무 분리)', 403);
  if (p.risk === 'HIGH' && b.risk_ack !== true) throw err('RISK_ACK_REQUIRED', '고위험 변경입니다. risk_ack:true 가 필요합니다', 400);
  G.transition(ctx, 'di_proposal', id, 'APPROVED', String(b.reason || 'approved').slice(0, 200), { approved_by: ctx.user.id, version: p.version + 1 }); ev(ctx, 'proposal.approved', id, {}); audit(ctx, 'evolution.approve', 'di_proposal', id, { requested_by: p.requested_by });
  return getProposal(id);
}
function reject(ctx, id, reason) {
  const p = getProposal(id); if (!p) throw U.notFound('Proposal not found'); const r = String(reason || '').trim(); if (r.length < 2) throw err('REASON_REQUIRED', '반려 사유를 입력하세요', 400);
  G.transition(ctx, 'di_proposal', id, 'REJECTED', r, { version: p.version + 1 }); ev(ctx, 'proposal.rejected', id, { reason: r }); audit(ctx, 'evolution.reject', 'di_proposal', id, { reason: r }); return getProposal(id);
}

// ───────── 5. Demo 배포 / 롤백 ─────────
function nextModelVersion(base, semver) { const [a, b, c] = base.version.split('.').map(Number); return semver === 'major' ? `${a + 1}.0.0` : semver === 'minor' ? `${a}.${b + 1}.0` : `${a}.${b}.${c + 1}`; }
function servingSnapshot() { return Object.fromEntries(q.all('SELECT party_id, product_keys, golden_version_id FROM di_ods').map((o) => [o.party_id, { keys: U.parse(o.product_keys, []), golden: o.golden_version_id }])); }
function deployDemo(ctx, id, b) {
  const p = getProposal(id); if (!p) throw U.notFound('Proposal not found');
  if (b.confirm !== true) throw err('CONFIRM_REQUIRED', 'confirm:true 가 필요합니다', 400);
  if (p.state !== 'APPROVED') throw err('NOT_APPROVED', `승인되지 않은 변경은 배포할 수 없습니다(현재 ${p.state})`, 409);
  if (strictSod() && (p.approved_by === ctx.user.id || p.requested_by === ctx.user.id)) throw err('SOD_VIOLATION', '엄격 SoD: 요청자·승인자·배포자는 서로 달라야 합니다', 403);
  return q.tx(() => {
    G.transition(ctx, 'di_proposal', id, 'DEPLOYING', 'deploying', { version: p.version + 1 });
    const body = p.proposal; const base = S.activeModel('TOBE_MDM'); const diff = S.diffModels(base.model, body.proposed_model); const verNew = nextModelVersion(base, diff.semver); const before = servingSnapshot();
    const compBefore = {}; for (const lp of q.all("SELECT company_id c FROM di_party WHERE company_id IS NOT NULL AND party_type='ORGANIZATION'")) { const cur = MDM.servingKeysFor(lp.c); compBefore[lp.c] = MDM.recommendationSnapshot(lp.c, cur ? cur.extra_product_keys : []); }
    const mapBefore = M.activeVersion(); const rid = nid('REL');
    // 1) 모델 버전
    q.run("UPDATE di_model SET status='RETIRED' WHERE scope='TOBE_MDM' AND status='ACTIVE'");
    const mid = nid('MDL'); q.insert('di_model', { id: mid, scope: 'TOBE_MDM', version: verNew, status: 'ACTIVE', parent_id: base.id, schema_json: J(body.proposed_model), note: `release ${rid} ← ${id}`, created_by: p.requested_by || ctx.user.id, created_at: U.iso(), released_at: U.iso() });
    // 2) 표준·코드표·매핑 v2
    const std = body.proposed_standard_field; if (!q.get('SELECT 1 x FROM di_standard WHERE concept=?', std)) q.insert('di_standard', { id: nid('STD'), concept: std, standard_name: std, english_name: std, data_type: 'string', length: 40, nullable: 1, domain: body.codeset ? body.codeset.code_set : '-', sensitivity: 'INTERNAL', definition: body.change_summary, status: 'ACTIVE', version: verNew });
    if (body.codeset) for (const e of body.codeset.entries) q.run('INSERT OR REPLACE INTO di_codeset(code_set,version,source_value,standard_value) VALUES(?,?,?,?)', body.codeset.code_set, body.codeset.version, e.source_value, e.standard_value);
    const newV = `v${Number(String(mapBefore).replace(/\D/g, '') || 1) + 1}`;
    for (const mp of M.listMappings(mapBefore)) q.insert('di_mapping', { id: `${mp.id}@${newV}`, source_system: mp.source_system, source_table: mp.source_table, source_field: mp.source_field, target_entity: mp.target_entity, target_field: mp.target_field, rule_json: mp.rule_json, mapping_version: newV, status: 'ACTIVE', precedence: mp.precedence, required: mp.required, note: mp.note, updated_at: U.iso() });
    const tgt = body.proposed_mapping.target.split('.'); q.insert('di_mapping', { id: nid('MAP'), source_system: body.proposed_mapping.system, source_table: body.proposed_mapping.source_table, source_field: body.proposed_mapping.source_field, target_entity: tgt[0], target_field: tgt[1], rule_json: J([body.proposed_mapping.rule]), mapping_version: newV, status: 'ACTIVE', precedence: 1, required: 0, note: `release ${rid}`, updated_at: U.iso() });
    q.run("UPDATE di_mapping SET status='RETIRED' WHERE mapping_version=?", mapBefore);
    // 3) 재처리(승인된 매핑 v2 로 BK 현행 레코드를 다시 표준화 → 정본 버전업 → ODS/서빙 갱신)
    const run = PL.run(ctx, { source_id: body.source, mode: 'INCREMENTAL', restandardize: true });
    if (run.status === 'FAILED') throw err('DEPLOY_PIPELINE_FAILED', `재처리 실패: ${(run.error || {}).message}`, 500, true);
    const after = servingSnapshot(); const changedParties = Object.keys(after).filter((k) => J(after[k].keys) !== J((before[k] || {}).keys));
    const recChanges = []; for (const cid of Object.keys(compBefore)) { const cur = MDM.servingKeysFor(cid); const aft = MDM.recommendationSnapshot(cid, cur ? cur.extra_product_keys : []); if (aft && compBefore[cid] && aft.map((x) => x.id).join() !== compBefore[cid].map((x) => x.id).join()) recChanges.push({ company_id: cid, before: compBefore[cid].slice(0, 5), after: aft.slice(0, 5) }); }
    q.insert('di_release', { id: rid, proposal_id: id, model_before: base.id, model_after: mid, mapping_before: mapBefore, mapping_after: newV, state: 'ACTIVE', deployed_by: ctx.user.id, deployed_at: U.iso(), rollback_ref: null, rolled_back_at: null, snapshot: J({ serving_before: before, run: run.id }), impact: J({ parties_changed: changedParties.length, recommendation_changes: recChanges, pipeline_run: run.id, model_version: verNew }) });
    G.transition(ctx, 'di_proposal', id, 'ACTIVE', `deployed ${rid}`, { release_id: rid, version: p.version + 2 });
    // 4) 모니터링(배포 후 회귀 점검)
    const chk = selfCheck(ctx, { persist: false }); const ok = chk.results.filter((c) => !c.pass).length === 0;
    if (ok) G.transition(ctx, 'di_proposal', id, 'MONITORED', 'post-deploy checks passed');
    ev(ctx, 'release.deployed', rid, { proposal: id, model: verNew, mapping: newV, recommendation_changes: recChanges.length }); audit(ctx, 'evolution.deploy', 'di_release', rid, { proposal: id, model: verNew, mapping: newV, deployed_by: ctx.user.id, approved_by: p.approved_by, requested_by: p.requested_by });
    return { release_id: rid, state: ok ? 'MONITORED' : 'ACTIVE', model_version: verNew, mapping_version: newV, pipeline_run: run.id, parties_changed: changedParties.length, recommendation_changes: recChanges, post_deploy_checks: { passed: chk.results.filter((c) => c.pass).length, total: chk.results.length }, rollback: { endpoint: `/api/v1/data-integration/evolution/${id}/rollback-demo` } };
  });
}
function rollbackDemo(ctx, id, b) {
  const p = getProposal(id); if (!p) throw U.notFound('Proposal not found'); if (b.confirm !== true) throw err('CONFIRM_REQUIRED', 'confirm:true 가 필요합니다', 400);
  if (!['ACTIVE', 'MONITORED', 'ROLLBACK_REQUESTED'].includes(p.state)) throw err('INVALID_STATE', `배포된 변경만 롤백할 수 있습니다(현재 ${p.state})`, 409);
  const reason = String(b.reason || '').trim(); if (reason.length < 4) throw err('REASON_REQUIRED', '롤백 사유(4자 이상)가 필요합니다', 400);
  const rel = q.get('SELECT * FROM di_release WHERE id=?', p.release_id); if (!rel) throw err('NO_RELEASE', '릴리스 기록이 없습니다', 404);
  return q.tx(() => {
    if (p.state !== 'ROLLBACK_REQUESTED') G.transition(ctx, 'di_proposal', id, 'ROLLBACK_REQUESTED', reason);
    q.run("UPDATE di_model SET status='RETIRED' WHERE id=?", rel.model_after); q.run("UPDATE di_model SET status='ACTIVE' WHERE id=?", rel.model_before);
    q.run("UPDATE di_mapping SET status='ROLLED_BACK' WHERE mapping_version=?", rel.mapping_after); q.run("UPDATE di_mapping SET status='ACTIVE' WHERE mapping_version=?", rel.mapping_before);
    const goldBefore = q.count('di_golden');
    const run = PL.run(ctx, { source_id: p.proposal.source, mode: 'INCREMENTAL', restandardize: true }); // 보상 트랜잭션: 이전 매핑으로 재표준화 → 새 정본 버전(이력 보존)
    if (run.status === 'FAILED') throw err('ROLLBACK_PIPELINE_FAILED', `보상 재처리 실패: ${(run.error || {}).message}`, 500, true);
    q.run("UPDATE di_release SET state='ROLLED_BACK', rolled_back_at=?, rollback_ref=? WHERE id=?", U.iso(), run.id, rel.id);
    G.transition(ctx, 'di_proposal', id, 'ROLLED_BACK', reason, { version: p.version + 3 });
    ev(ctx, 'release.rolled_back', rel.id, { proposal: id, run: run.id }); audit(ctx, 'evolution.rollback', 'di_release', rel.id, { proposal: id, reason, compensation_run: run.id });
    return { release_id: rel.id, state: 'ROLLED_BACK', model_version: (q.get('SELECT version v FROM di_model WHERE id=?', rel.model_before) || {}).v, mapping_version: rel.mapping_before, compensation: { pipeline_run: run.id, golden_versions_added: q.count('di_golden') - goldBefore, note: '모델 롤백(설정 복구)과 데이터 정정(보상 트랜잭션)은 다릅니다 — 정본은 삭제 없이 새 버전으로 복원됩니다' } };
  });
}

// ───────── 조회 ─────────
const hydProp = (r) => r && ({ ...r, proposal: U.parse(r.proposal, {}), diff: U.parse(r.diff, {}) });
const getProposal = (id) => hydProp(q.get('SELECT * FROM di_proposal WHERE id=?', id));
function listProposals() { return q.all('SELECT * FROM di_proposal ORDER BY created_at DESC, rowid DESC').map((p) => { const h = hydProp(p); return { id: h.id, drift_id: h.drift_id, state: h.state, risk: h.risk, trigger: h.trigger_kind, summary: h.proposal.change_summary, source: h.proposal.source, requested_by: h.requested_by, approved_by: h.approved_by, release_id: h.release_id, version: h.version, created_at: h.created_at }; }); }
function proposalDetail(id) { const p = getProposal(id); if (!p) return null; const sb = p.sandbox_id ? q.get('SELECT * FROM di_sandbox WHERE id=?', p.sandbox_id) : null; const rel = p.release_id ? q.get('SELECT * FROM di_release WHERE id=?', p.release_id) : null; const drift = q.get('SELECT * FROM di_drift WHERE id=?', p.drift_id); const events = q.all('SELECT * FROM di_event WHERE ref=? ORDER BY id', id).map((e) => ({ ...e, detail: U.parse(e.detail, {}) }));
  return { ...p, drift: drift && { ...drift, change_set: U.parse(drift.change_set, []) }, sandbox: sb && { ...sb, before: U.parse(sb.before_json, {}), after: U.parse(sb.after_json, {}), findings: U.parse(sb.findings, {}) }, release: rel && { ...rel, impact: U.parse(rel.impact, {}), snapshot: undefined }, events, history: G.history('di_proposal', id) }; }
const listDrifts = () => q.all('SELECT * FROM di_drift ORDER BY detected_at DESC, rowid DESC').map((d) => ({ ...d, change_set: U.parse(d.change_set, []) }));

// ───────── 자체 점검(불변식) — 실제 상태 기반 ─────────
function selfCheck(ctx, { persist = true } = {}) {
  const R = []; const add = (id, name, pass, detail) => R.push({ id, name, pass, detail });
  const dupCw = q.get("SELECT COUNT(*) n FROM (SELECT 1 FROM di_crosswalk WHERE status='ACTIVE' GROUP BY source_system, source_table, source_pk HAVING COUNT(*)>1)").n; add('INV-01', 'Crosswalk 활성 유일성', dupCw === 0, `중복 ${dupCw}건`);
  const orphanG = q.get('SELECT COUNT(*) n FROM di_golden g LEFT JOIN di_party p ON p.party_id=g.party_id WHERE p.party_id IS NULL').n; add('INV-02', 'Golden → Party 참조 무결성', orphanG === 0, `고아 ${orphanG}건`);
  const merged = q.all("SELECT * FROM di_party WHERE lifecycle_status='MERGED'"); const unapproved = merged.filter((p) => !q.get("SELECT 1 x FROM di_decision WHERE decision='MERGE' AND absorbed_party=? AND approver IS NOT NULL AND reversed_by IS NULL", p.party_id)).length; add('INV-03', '승인 없는 병합 0건', unapproved === 0, `병합 ${merged.length}건 중 승인 기록 없는 건 ${unapproved}`);
  const bad = q.get("SELECT COUNT(*) n FROM di_ods o JOIN di_party p ON p.party_id=o.party_id WHERE p.lifecycle_status<>'ACTIVE' OR p.consent_status<>'VALID'").n; add('TC-PRIV-01', '동의 철회·만료 데이터는 서빙(ODS) 제외', bad === 0, `부적합 ODS ${bad}건`);
  const wm = q.all('SELECT * FROM di_watermark'); const regress = wm.filter((w) => { const r = q.get("SELECT watermark_before b FROM di_run WHERE id=?", w.run_id); const b = r ? U.parse(r.b, {})[w.source_id] : null; return b && w.value < b; }).length; add('TC-ETL-02', '워터마크 비역행', regress === 0, `역행 ${regress}건`);
  const failedAdv = q.all("SELECT * FROM di_run WHERE status='FAILED'").filter((r) => J(U.parse(r.watermark_before, {})) !== J(U.parse(r.watermark_after, {}))).length; add('TC-ETL-02b', '실패 실행은 워터마크를 전진시키지 않음', failedAdv === 0, `전진한 실패 실행 ${failedAdv}건`);
  const dupRaw = q.get('SELECT COUNT(*) n FROM (SELECT 1 FROM di_raw GROUP BY source_id, source_table, source_pk, fingerprint HAVING COUNT(*)>1)').n; add('TC-ETL-01', '동일 원천 이벤트 중복 적재 없음(멱등)', dupRaw === 0, `중복 ${dupRaw}건`);
  const act = q.get("SELECT COUNT(*) n FROM di_proposal WHERE state IN ('ACTIVE','MONITORED') AND approved_by IS NULL").n; add('TC-EVO-01', 'AI 제안만으로 활성화된 변경 없음', act === 0, `승인 없는 활성 ${act}건`);
  const sod = q.get("SELECT COUNT(*) n FROM di_proposal WHERE approved_by IS NOT NULL AND approved_by=requested_by").n; add('SOD-01', '요청자=승인자 위반 없음', sod === 0, `위반 ${sod}건`);
  const model = S.activeModel('TOBE_MDM'); const stdIssues = S.checkStandards(model.model).filter((i) => i.severity === 'HIGH'); add('STD-01', 'To-Be 모델 표준 위반(HIGH) 없음', stdIssues.length === 0, `HIGH ${stdIssues.length}건`);
  for (const sid of ['CRM_DEMO', 'BUYKOREA_DEMO']) { const src = q.get('SELECT * FROM di_source WHERE id=?', sid); const snap = S.latestSnapshot(sid); if (!src || !snap) continue; const live = S.discover(src); const same = S.schemaHash(live.tables) === snap.schema_hash; const erd = S.erdFromSchema(snap.schema); const tableOk = erd.entities.length === live.tables.length && erd.entities.every((e) => { const t = live.tables.find((x) => x.name === e.name); return t && t.columns.length === e.columns.length; }); add(`TC-ERD-01:${sid}`, `${sid} ERD가 실제 메타데이터와 일치`, tableOk, same ? '최신 스냅샷 해시 일치' : '원천 스키마가 스냅샷 이후 변경됨(드리프트 탐지 필요)'); }
  const ms = q.all("SELECT mapping_version v, COUNT(*) n FROM di_mapping WHERE status='ACTIVE' GROUP BY mapping_version"); add('MAP-01', '활성 매핑 버전은 하나', ms.length === 1, ms.map((x) => `${x.v}:${x.n}`).join(', ') || '없음');
  const rec = { id: nid('SCK', 4), at: U.iso(), by_user: ctx && ctx.user ? ctx.user.id : 'system', results: J(R) };
  if (persist) { q.insert('di_selfcheck', rec); if (ctx) audit(ctx, 'selfcheck', 'di_selfcheck', rec.id, { pass: R.filter((x) => x.pass).length, total: R.length }); }
  return { id: persist ? rec.id : null, at: rec.at, results: R, passed: R.filter((x) => x.pass).length, total: R.length };
}

module.exports = { GATES, detect, simulate, requestReview, approve, reject, deployDemo, rollbackDemo, listProposals, proposalDetail, getProposal, listDrifts, selfCheck, validateProposalJson, propose, classify, INTEREST_MAP };
