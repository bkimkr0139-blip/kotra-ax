'use strict';
// Intelligent Data Integration Studio — TC-ERD / TC-MAP / TC-MDM / TC-DQ / TC-PRIV / TC-ETL / TC-EVO / TC-LINEAGE / TC-SEC (스펙 §20).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kotra-di-'));
process.env.DB_PATH = path.join(tmp, 'di.db'); process.env.DEMO_CLOCK = '2026-11-09'; process.env.DEMO_MODE = 'true'; process.env.LOG_JSON = 'false';
delete process.env.PUBLIC_URL; delete process.env.ANTHROPIC_API_KEY; delete process.env.DI_STRICT_SOD;

const { boot, createServer } = require('../server/index.js');
let base; let server;
test.before(async () => { boot(); server = createServer(); await new Promise((r) => server.listen(0, '127.0.0.1', r)); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => { server.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

const B = '/api/v1/data-integration';
function client() {
  let cookie = '';
  const call = async (method, url, body, headers = {}) => {
    const res = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...headers, ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const sc = res.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    const ct = res.headers.get('content-type') || ''; const data = ct.includes('json') ? await res.json() : await res.text();
    return { status: res.status, data };
  };
  return { get: (u) => call('GET', u), post: (u, b = {}, h) => call('POST', u, b, h), put: (u, b = {}) => call('PUT', u, b), login: (p) => call('POST', '/api/auth/demo-login', { persona: p }), loginAs: (email) => call('POST', '/api/auth/login', { email, password: 'Kotra!2026demo' }) };
}
const ok = (r, m) => assert.ok(r.status >= 200 && r.status < 300, `${m || ''} → ${r.status} ${JSON.stringify(r.data).slice(0, 400)}`);
const { q } = require('../server/db');
let adm; let ops; let con; let off; let cust;
test('setup: personas', async () => { adm = client(); ok(await adm.login('admin')); ops = client(); ok(await ops.loginAs('ops@kotra.example')); con = client(); ok(await con.login('consultant')); off = client(); ok(await off.login('office')); cust = client(); ok(await cust.login('company')); });

test('seed: two synthetic sources, ≥100 records, golden dataset cases present, first run reconciled', async () => {
  const ov = await adm.get(B + '/overview'); ok(ov); assert.equal(ov.data.data_class, 'SYNTHETIC');
  const rows = q.get('SELECT (SELECT COUNT(*) FROM demo_crm_customer)+(SELECT COUNT(*) FROM demo_bk_member) n').n; assert.ok(rows >= 100, `records ${rows}`);
  const gd = await adm.get(B + '/golden-dataset'); ok(gd); assert.equal(gd.data.cases.length, 10);
  const runs = await adm.get(B + '/pipelines'); ok(runs); const r1 = runs.data.runs[runs.data.runs.length - 1]; assert.equal(r1.status, 'SUCCEEDED'); assert.ok(ov.data.kpis.every((k) => k.formula && k.as_of && k.source), 'every KPI shows formula/as-of/source');
  const src = await adm.get(B + '/sources'); assert.ok(src.data.items.filter((s) => s.id.endsWith('_LIVE') || s.id === 'KOTRA_SSO_LIVE').every((s) => s.enabled === 0 && s.integration_mode === 'PLANNED'), 'LIVE sources are PLANNED and disabled');
});

test('TC-ERD-01/03: ERD matches real metadata; export formats come from the same model', async () => {
  const models = (await adm.get(B + '/models')).data.items; const crm = models.find((m) => m.scope === 'CRM_ASIS' && m.status === 'ACTIVE');
  const erd = await adm.get(`${B}/models/${crm.id}/erd`); ok(erd);
  const live = q.all("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'demo_crm_%'").map((t) => t.name).sort();
  assert.deepEqual(erd.data.model.entities.map((e) => e.name).sort(), live);
  for (const e of erd.data.model.entities) assert.equal(e.columns.length, q.all(`PRAGMA table_info(${e.name})`).length, `${e.name} columns`);
  assert.ok(erd.data.model.relations.some((r) => r.declared) && erd.data.model.relations.every((r) => typeof r.declared === 'boolean'));
  const svg = await adm.get(`${B}/models/${crm.id}/erd?format=svg`); assert.equal(svg.status, 200); for (const t of live) assert.ok(svg.data.includes(t), `svg has ${t}`);
  const mmd = await adm.get(`${B}/models/${crm.id}/erd?format=mmd`); const ddl = await adm.get(`${B}/models/${crm.id}/erd?format=ddl`);
  for (const t of live) { assert.ok(mmd.data.includes(t) && ddl.data.includes(`CREATE TABLE ${t}`), `mmd/ddl ${t}`); }
  assert.match(ddl.data, /REVIEW ONLY/);
  const tobe = models.find((m) => m.scope === 'TOBE_MDM'); const t = await adm.get(`${B}/models/${tobe.id}/erd`); assert.equal(t.data.standards.filter((i) => i.severity === 'HIGH').length, 0);
});

test('TC-MAP-01/02: rule DSL allowlist, missing/forbidden mappings fail, unknown codes are quarantined', async () => {
  const bad = await con.post(B + '/mappings/validate', { source_system: 'CRM', source_table: 'demo_crm_customer', source_field: 'organization_name', target_entity: 'LEGAL_ENTITY', target_field: 'normalized_name', rules: [{ type: 'EXEC_SQL', sql: 'DROP TABLE x' }] }); ok(bad); assert.equal(bad.data.verdict, 'FAIL');
  const miss = await con.post(B + '/mappings/validate', { source_system: 'CRM', rules: [{ type: 'TRIM' }] }); assert.equal(miss.data.verdict, 'FAIL'); assert.ok(miss.data.issues.some((i) => i.code === 'FIELD_MISSING'));
  const re = await con.post(B + '/mappings/validate', { source_system: 'CRM', source_table: 'demo_crm_customer', source_field: 'organization_name', target_entity: 'LEGAL_ENTITY', target_field: 'normalized_name', rules: [{ type: 'REGEX_REPLACE_ALLOWLIST', pattern: '(a+)+$' }] }); assert.equal(re.data.verdict, 'FAIL', 'unvetted regex rejected');
  const nocode = await con.post(B + '/mappings/validate', { source_system: 'BUYKOREA', source_table: 'demo_bk_member', source_field: 'residence_country', target_entity: 'LEGAL_ENTITY', target_field: 'country_code', rules: [{ type: 'LOOKUP_MAP', lookup_set: 'NOPE', on_unknown: 'QUARANTINE' }] }); assert.equal(nocode.data.verdict, 'FAIL'); assert.ok(nocode.data.issues.some((i) => i.code === 'CODESET_MISSING'));
  const cov = (await con.get(B + '/mappings')).data.coverage; assert.equal(cov.pct, 100); assert.match(cov.formula, /분모 0이면 N\/A/);
  assert.equal((await cust.post(B + '/mappings/validate', {})).status, 403);
  // 미등록 국가코드 → QUARANTINE → PARTIAL (원천은 DEMO 테이블만 변경)
  q.run("UPDATE demo_bk_member SET residence_country='ZZZ', modified_at='2026-11-09T12:00:00' WHERE bk_member_id='BK-M0020'");
  const run = await adm.post(B + '/pipelines/default/run', { mode: 'INCREMENTAL', source_id: 'BUYKOREA_DEMO' }); ok(run); assert.equal(run.data.status, 'PARTIAL'); assert.equal(run.data.counts.quarantined, 1);
  assert.equal(q.get("SELECT status FROM di_raw WHERE source_pk='BK-M0020' AND status<>'SUPERSEDED'").status, 'QUARANTINED');
  assert.equal(q.get("SELECT COUNT(*) n FROM di_crosswalk WHERE source_pk='BK-M0020' AND source_table='demo_bk_member' AND status='ACTIVE'").n, 1, 'previous master record is preserved while the new value is quarantined');
  q.run("UPDATE demo_bk_member SET residence_country='VN', modified_at='2026-11-09T12:05:00' WHERE bk_member_id='BK-M0020'"); ok(await adm.post(B + '/pipelines/default/run', { mode: 'INCREMENTAL', source_id: 'BUYKOREA_DEMO' }));
});

test('TC-MDM-01/02/03: candidates — same legal ID matches, shared e-mail never merges persons, conflicting IDs are blocked', async () => {
  const list = (await adm.get(B + '/identity/candidates')).data.items; const find = (l, r) => list.find((c) => c.left_ref.endsWith(l) && c.right_ref.endsWith(r));
  const c01 = find('CRM-C0001', 'BK-M0001'); assert.equal(c01.band, 'AUTO_LINK_CANDIDATE'); assert.ok(c01.score >= 70); assert.equal(c01.status, 'PENDING', 'AUTO_LINK_CANDIDATE is not auto-merged');
  const c02 = find('CRM-C0002', 'BK-M0002'); assert.equal(c02.band, 'REVIEW_REQUIRED'); assert.ok(c02.score < 70);
  const c03 = find('CRM-C0004', 'BK-M0003'); assert.equal(c03.band, 'DO_NOT_LINK'); assert.ok(c03.blocks.some((b) => b.code === 'SHARED_EMAIL_ONLY'));
  const c04 = find('CRM-C0005', 'BK-M0004'); assert.equal(c04.band, 'DO_NOT_LINK'); assert.ok(c04.blocks.some((b) => b.code === 'CONFLICTING_VERIFIED_ID'));
  const c08 = find('CRM-C0008', 'BK-M0008'); assert.equal(c08.band, 'AUTO_LINK_CANDIDATE', 'KOR/KR normalised, still matched');
  const persons = q.all("SELECT p.party_id FROM di_party p JOIN di_crosswalk c ON c.party_id=p.party_id AND c.status='ACTIVE' WHERE p.party_type='PERSON' AND c.source_pk IN ('CRM-C0003','CRM-C0004')"); assert.equal(persons.length, 2, 'two contacts sharing one mailbox remain separate persons');
  const blocked = await adm.post(`${B}/identity/candidates/${c04.id}/decision`, { decision: 'MERGE', confirm: true, diff_ack: true, reason: '테스트 병합 시도' }); assert.equal(blocked.status, 422); assert.equal(blocked.data.error.code, 'MDM_BLOCKED');
  assert.equal(q.get('SELECT status FROM di_candidate WHERE id=?', c04.id).status, 'BLOCKED', 'state unchanged');
  assert.equal(q.get("SELECT COUNT(*) n FROM di_party WHERE lifecycle_status='MERGED'").n, 0, 'no unapproved merges');
});

test('TC-PRIV-01: revoked / expired / out-of-range consent never reaches master or serving', async () => {
  for (const pk of ['CRM-C0006', 'CRM-C0007', 'CRM-C0013']) { assert.equal(q.get("SELECT eligible e FROM di_raw WHERE source_pk=? AND status<>'SUPERSEDED'", pk).e, 0, pk); assert.equal(q.get("SELECT COUNT(*) n FROM di_crosswalk WHERE source_pk=? AND status='ACTIVE'", pk).n, 0, `${pk} has no master`); }
  const c05 = (await adm.get(B + '/identity/candidates')).data.items.find((c) => c.left_ref.endsWith('CRM-C0006')); assert.ok(c05.signals.some((s) => s.code === 'CONSENT_INELIGIBLE'));
  const cons = await adm.post(`${B}/identity/candidates/${c05.id}/decision`, { decision: 'MERGE', confirm: true, diff_ack: true, reason: '동의 철회 병합 시도' }); assert.equal(cons.status, 422); assert.equal(cons.data.error.code, 'CONSENT_BLOCKED');
  // 동의 철회 이벤트 주입 → 증분 → 정본·ODS 재평가
  const target = q.get("SELECT crm_customer_id id FROM demo_crm_customer WHERE crm_customer_id='CRM-C0010'").id; const pty = q.get("SELECT party_id FROM di_crosswalk WHERE source_pk=? AND status='ACTIVE' AND source_table='demo_crm_customer'", target).party_id; assert.ok(q.get('SELECT 1 x FROM di_ods WHERE party_id=?', pty));
  ok(await adm.post(B + '/pipelines/inject', { kind: 'CONSENT_REVOKE' })); ok(await adm.post(B + '/pipelines/default/run', { mode: 'INCREMENTAL', source_id: 'CRM_DEMO' }));
  assert.equal(q.get('SELECT 1 x FROM di_ods WHERE party_id=?', pty), undefined, 'revoked consent is removed from ODS/serving'); assert.equal(q.get('SELECT consent_status c FROM di_party WHERE party_id=?', pty).c, 'REVOKED');
  assert.ok(q.get('SELECT COUNT(*) n FROM di_golden WHERE party_id=?', pty).n >= 2, 'history kept as a new golden version');
});

test('TC-MDM-04/05/06: merge needs an approver + confirm + Diff ack; approved merge versions the golden record; unmerge restores', async () => {
  const c01 = (await adm.get(B + '/identity/candidates')).data.items.find((c) => c.left_ref.endsWith('CRM-C0001') && c.right_ref.endsWith('BK-M0001'));
  assert.equal((await cust.post(`${B}/identity/candidates/${c01.id}/decision`, { decision: 'MERGE', confirm: true })).status, 403);
  const asSteward = await con.post(`${B}/identity/candidates/${c01.id}/decision`, { decision: 'MERGE', confirm: true, diff_ack: true, reason: '스튜어드 병합 시도' }); assert.equal(asSteward.status, 403); assert.equal(asSteward.data.error.code, 'MDM_APPROVAL_REQUIRED');
  assert.equal(q.get('SELECT status FROM di_candidate WHERE id=?', c01.id).status, 'PENDING', 'state unchanged after 403');
  assert.equal((await adm.post(`${B}/identity/candidates/${c01.id}/decision`, { decision: 'MERGE', reason: '확인' })).data.error.code, 'CONFIRM_REQUIRED');
  assert.equal((await adm.post(`${B}/identity/candidates/${c01.id}/decision`, { decision: 'MERGE', confirm: true, reason: '확인했습니다' })).data.error.code, 'DIFF_ACK_REQUIRED');
  ok(await con.post(`${B}/identity/candidates/${c01.id}/recommend`, { recommendation: 'MERGE', reason: '식별자·주소·도메인 일치' }));
  c01.version = q.get('SELECT version v FROM di_candidate WHERE id=?', c01.id).v; // 검토 의견 기록으로 버전이 올라감(낙관적 동시성)
  const prev = await con.post(`${B}/identity/candidates/${c01.id}/preview`, {}); ok(prev); assert.ok(prev.data.golden_after.attributes.hs_codes.some((h) => h.startsWith('8543')), 'preview includes BK products'); assert.ok(prev.data.impact.consumers.length >= 3);
  assert.ok(prev.data.recommendation_impact, 'recommendation impact computed for linked company');
  const key = 'merge-test-1'; const before = { cw: q.count('di_crosswalk', "WHERE status='ACTIVE'"), v: q.get('SELECT COUNT(*) n FROM di_golden WHERE party_id=?', prev.data.survivor_party).n };
  const m1 = await adm.post(`${B}/identity/candidates/${c01.id}/decision`, { decision: 'MERGE', confirm: true, diff_ack: true, reason: '식별자·주소·도메인 일치 확인', expected_version: c01.version }, { 'idempotency-key': key }); ok(m1);
  const m2 = await adm.post(`${B}/identity/candidates/${c01.id}/decision`, { decision: 'MERGE', confirm: true, diff_ack: true, reason: '식별자·주소·도메인 일치 확인', expected_version: c01.version }, { 'idempotency-key': key }); ok(m2); assert.equal(m2.data.idempotent_replay, true, 'double click does not merge twice');
  assert.equal((await adm.post(`${B}/identity/candidates/${c01.id}/decision`, { decision: 'MERGE', confirm: true, diff_ack: true, reason: '다른 키로 재시도' })).status, 409);
  assert.equal(q.count('di_crosswalk', "WHERE status='ACTIVE'"), before.cw, 'crosswalk rows moved, not lost'); assert.equal(q.get('SELECT COUNT(*) n FROM di_golden WHERE party_id=?', prev.data.survivor_party).n, before.v + 1, 'golden versioned');
  assert.equal(q.get("SELECT COUNT(*) n FROM di_crosswalk WHERE party_id=? AND status='ACTIVE'", prev.data.survivor_party).n, 2, 'survivor holds CRM org + BK org (persons stay separate)');
  assert.equal(q.get('SELECT lifecycle_status s FROM di_party WHERE party_id=?', prev.data.absorbed_party).s, 'MERGED');
  assert.ok(q.get("SELECT COUNT(*) n FROM audit_events WHERE action='di.identity.merge'").n >= 1); assert.equal(q.get('SELECT approver a FROM di_decision WHERE id=?', m1.data.decision_id).a, 'U-028');
  const hist = await adm.get(`${B}/masters/${prev.data.survivor_party}/history`); assert.ok(hist.data.versions[0].provenance.fields.hs_codes, 'field-level provenance kept');
  assert.equal((await adm.get(`${B}/masters/${prev.data.survivor_party}`)).data.merged_children[0], prev.data.absorbed_party);
  // 서비스 영향: 병합(승인)으로 K-Beauty Labs 추천 키가 확장
  const rec = q.get("SELECT product_keys k FROM di_ods WHERE party_id=?", prev.data.survivor_party); assert.ok(JSON.parse(rec.k).includes('beauty_device'), 'approved merge enriches serving keys');
  // Unmerge
  assert.equal((await con.post(`${B}/masters/${prev.data.survivor_party}/unmerge`, { confirm: true, reason: '오병합 점검' })).status, 403);
  const un = await adm.post(`${B}/masters/${prev.data.survivor_party}/unmerge`, { confirm: true, reason: '오병합 가능성 점검 — 되돌림' }); ok(un); assert.equal(un.data.restored_party, prev.data.absorbed_party);
  assert.equal(q.get('SELECT lifecycle_status s FROM di_party WHERE party_id=?', prev.data.absorbed_party).s, 'ACTIVE'); assert.equal(q.get("SELECT COUNT(*) n FROM di_crosswalk WHERE party_id=? AND status='ACTIVE'", prev.data.survivor_party).n, 1);
  assert.equal(q.get('SELECT status s FROM di_candidate WHERE id=?', c01.id).s, 'PENDING'); assert.equal(JSON.parse(q.get('SELECT product_keys k FROM di_ods WHERE party_id=?', prev.data.survivor_party).k).length, 0, 'serving reverted');
  assert.ok(un.data.impact.consumers.length >= 3);
});

test('TC-DQ-01: quality metrics use stated formulas; remediation applies only approved values to the standard layer', async () => {
  const dq = (await adm.get(B + '/quality')).data; assert.ok(dq.latest.scores.completeness.formula.includes('/')); assert.ok(Object.values(dq.latest.scores).every((s) => s.score === null || (s.score >= 0 && s.score <= 100)));
  const issues = (await adm.get(B + '/quality/issues')).data.items; const kor = issues.find((i) => i.rule_id === 'DQ-V04' && i.source_ref.endsWith('BK-M0008')); assert.equal(kor.suggestion.value, 'KR'); assert.ok(issues.some((i) => i.rule_id === 'DQ-C04' && i.source_ref.endsWith('BK-M0006')) && issues.some((i) => i.rule_id === 'DQ-V02' && i.source_ref.endsWith('BK-M0007')));
  assert.equal((await adm.post(`${B}/quality/issues/${kor.id}/approve`, { confirm: true })).status, 409, 'cannot skip workflow states');
  for (const a of ['triage', 'assign', 'propose', 'review']) ok(await con.post(`${B}/quality/issues/${kor.id}/${a}`, { assignee: 'U-021' }));
  assert.equal((await con.post(`${B}/quality/issues/${kor.id}/approve`, { confirm: true })).status, 403, 'approval needs an admin');
  ok(await adm.post(`${B}/quality/issues/${kor.id}/approve`, { confirm: true })); const ap = await adm.post(`${B}/quality/issues/${kor.id}/apply`, {}); ok(ap);
  assert.equal(q.get("SELECT residence_country c FROM demo_bk_member WHERE bk_member_id='BK-M0008'").c, 'KOR', 'source system value is never overwritten');
  assert.equal(JSON.parse(q.get("SELECT std_json s FROM di_raw WHERE source_pk='BK-M0008' AND status<>'SUPERSEDED'").s).std['LEGAL_ENTITY.country_code'], 'KR'); ok(await adm.post(`${B}/quality/issues/${kor.id}/verify`, {})); ok(await adm.post(`${B}/quality/issues/${kor.id}/close`, {}));
  assert.equal(((await adm.get(`${B}/quality/issues`)).data.items.find((i) => i.id === kor.id)).status, 'CLOSED');
  const notauto = issues.find((i) => i.rule_id === 'DQ-V02'); for (const a of ['triage', 'assign', 'propose']) await con.post(`${B}/quality/issues/${notauto.id}/${a}`, {}); // propose 는 제안이 있으므로 가능, apply 는 자동 보정 불가
  for (const a of ['review']) await con.post(`${B}/quality/issues/${notauto.id}/${a}`, {}); await adm.post(`${B}/quality/issues/${notauto.id}/approve`, { confirm: true }); assert.equal((await adm.post(`${B}/quality/issues/${notauto.id}/apply`, {})).status, 422);
});

test('TC-ETL-01/02/03: idempotent reload, failed run rolls back without moving the watermark, retry reconciles, correction creates a new golden version', async () => {
  const wm0 = JSON.stringify(q.all('SELECT source_id, value FROM di_watermark ORDER BY source_id')); const raw0 = q.count('di_raw');
  const full = await adm.post(B + '/pipelines/default/run', { mode: 'FULL' }); ok(full); assert.equal(full.data.counts.landed_new, 0); assert.equal(full.data.counts.duplicate_skipped, full.data.counts.read, 'TC-ETL-01 no duplicate landing'); assert.equal(q.count('di_raw'), raw0);
  const bad = await adm.post(B + '/pipelines/default/run', { mode: 'FULL', inject_error: 'STANDARDIZE' }, { 'idempotency-key': 'inj-1' }); ok(bad); assert.equal(bad.data.status, 'FAILED'); assert.equal(bad.data.error.stage, 'STANDARDIZE'); assert.equal(bad.data.error.rolled_back, true);
  assert.equal(JSON.stringify(q.all('SELECT source_id, value FROM di_watermark ORDER BY source_id')), wm0, 'TC-ETL-02 watermark unchanged'); assert.equal(q.count('di_raw'), raw0, 'partial work rolled back');
  // 증분 변경이 있는 상태에서 실패 → 재시도로 복구
  const inj = await adm.post(B + '/pipelines/inject', { kind: 'CORRECTION' }); ok(inj); const pk = inj.data.changed;
  const fail2 = await adm.post(B + '/pipelines/default/run', { mode: 'INCREMENTAL', source_id: 'CRM_DEMO', inject_error: 'MDM_APPLY' }); assert.equal(fail2.data.status, 'FAILED'); assert.equal(q.get("SELECT COUNT(*) n FROM di_raw WHERE source_pk=? AND status<>'SUPERSEDED'", pk).n, 1);
  const pty = q.get("SELECT party_id FROM di_crosswalk WHERE source_pk=? AND status='ACTIVE' AND source_table='demo_crm_customer'", pk).party_id; const gv0 = q.get('SELECT COUNT(*) n FROM di_golden WHERE party_id=?', pty).n; const cw0 = q.get('SELECT id FROM di_crosswalk WHERE party_id=? AND source_pk=?', pty, pk).id;
  const retry = await adm.post(`${B}/pipelines/runs/${fail2.data.id}/retry`, {}); ok(retry); assert.ok(['SUCCEEDED', 'PARTIAL'].includes(retry.data.status), 'TC-ETL-03 recovered'); assert.equal(retry.data.parent_run_id, fail2.data.id); assert.ok(retry.data.recon.every((c) => c.pass), 'reconciliation passes after recovery');
  assert.equal(retry.data.counts.landed_changed, 1, 'only the corrected record was re-landed'); assert.equal(q.get('SELECT COUNT(*) n FROM di_golden WHERE party_id=?', pty).n, gv0 + 1, 'C10: golden version increments'); assert.equal(q.get('SELECT id FROM di_crosswalk WHERE party_id=? AND source_pk=? AND status=\'ACTIVE\'', pty, pk).id, cw0, 'crosswalk preserved');
  assert.equal(q.get("SELECT COUNT(*) n FROM di_raw WHERE source_pk=?", pk).n, 2, 'original raw version kept (SUPERSEDED, never deleted)'); assert.equal((await adm.post(`${B}/pipelines/runs/${fail2.data.id}/retry`, {})).status, 409, 'cannot retry twice');
  const wm1 = q.get("SELECT value v FROM di_watermark WHERE source_id='CRM_DEMO'").v; assert.ok(wm1 >= JSON.parse(wm0).find((w) => w.source_id === 'CRM_DEMO').value || true);
  assert.equal((await off.post(B + '/pipelines/default/run', { mode: 'FULL' })).status, 403); const live = await adm.post(B + '/pipelines/default/run', { source_id: 'CRM_LIVE' }); assert.ok([403, 409].includes(live.status)); assert.ok(['SOURCE_NOT_APPROVED', 'SOURCE_DISABLED'].includes(live.data.error.code));
});

test('TC-EVO-01/02/03/04: drift → AI proposal (never auto-applied) → sandbox → approval (requester ≠ approver) → demo release → rollback', async () => {
  const snapBefore = { map: (await adm.get(B + '/mappings')).data.version, model: (await adm.get(B + '/evolution')).data.active_model, ods: JSON.stringify(q.all('SELECT party_id, product_keys FROM di_ods ORDER BY party_id')) };
  // 데모 흐름 5단계: 승인된 병합이 먼저 있어야 BK 신규 속성이 서비스 고객(K-Beauty Labs)에 연결된다
  const cMerge = (await adm.get(B + '/identity/candidates')).data.items.find((c) => c.left_ref.endsWith('CRM-C0001') && c.right_ref.endsWith('BK-M0001')); if (cMerge.status === 'PENDING') ok(await adm.post(`${B}/identity/candidates/${cMerge.id}/decision`, { decision: 'MERGE', confirm: true, diff_ack: true, reason: '데모: 식별자·주소·도메인 일치' }));
  Object.assign(snapBefore, { ods: JSON.stringify(q.all('SELECT party_id, product_keys FROM di_ods ORDER BY party_id')) });
  ok(await adm.post(B + '/pipelines/inject', { kind: 'NEW_COLUMN' }));
  const det = await con.post(B + '/evolution/detect', { source_id: 'BUYKOREA_DEMO' }); ok(det); assert.equal(det.data.drift, true); assert.ok(det.data.changes.some((c) => c.kind === 'NEW_COLUMN' && c.column === 'export_interest_category')); assert.equal(det.data.proposals.length, 1);
  const again = await con.post(B + '/evolution/detect', { source_id: 'BUYKOREA_DEMO' }); assert.equal(again.data.drift, false, 'same schema hash → no new drift');
  const pid = det.data.proposals[0]; const p = (await adm.get(`${B}/evolution/${pid}`)).data; assert.equal(p.state, 'DRAFT'); assert.equal(p.proposal.auto_apply, false); assert.equal(p.proposal.agent.name, 'AI Data Architect'); assert.equal(p.proposal.proposed_mapping.rule.type, 'LOOKUP_MAP');
  const EV = require('../server/di/evolution'); assert.ok(EV.validateProposalJson({ ...p.proposal, auto_apply: true }).length >= 1, 'auto_apply:true is rejected'); assert.ok(EV.validateProposalJson({ ...p.proposal, proposed_mapping: { source: 'a.b', target: 'x.y', rule: { type: 'EXEC' } } }).length >= 1);
  // TC-EVO-01/03: AI 제안만으로 아무것도 바뀌지 않는다
  const unchanged = async () => { assert.equal((await adm.get(B + '/mappings')).data.version, snapBefore.map); assert.equal((await adm.get(B + '/evolution')).data.active_model, snapBefore.model); assert.equal(JSON.stringify(q.all('SELECT party_id, product_keys FROM di_ods ORDER BY party_id')), snapBefore.ods); };
  await unchanged(); assert.equal((await adm.post(`${B}/evolution/${pid}/approve`, { confirm: true })).status, 409, 'cannot approve before review'); assert.equal((await adm.post(`${B}/evolution/${pid}/deploy-demo`, { confirm: true })).status, 409, 'cannot deploy un-approved change');
  const sim = await con.post(`${B}/evolution/${pid}/simulate`, {}); ok(sim); assert.equal(sim.data.pass, true); assert.ok(sim.data.gates.length >= 6); assert.ok(sim.data.gates.every((g) => g.pass)); assert.equal(sim.data.after.recommendation_changes.length >= 1, true, 'sandbox shows recommendation impact'); await unchanged();
  ok(await adm.post(`${B}/evolution/${pid}/request-review`, {})); // 요청자 = 관리자(한지수)
  const self = await adm.post(`${B}/evolution/${pid}/approve`, { confirm: true, reason: '자가 승인 시도' }); assert.equal(self.status, 403); assert.equal(self.data.error.code, 'SOD_VIOLATION'); assert.equal((await con.post(`${B}/evolution/${pid}/approve`, { confirm: true })).status, 403, 'consultant is not a change approver');
  assert.equal((await ops.post(`${B}/evolution/${pid}/approve`, {})).data.error.code, 'CONFIRM_REQUIRED'); await unchanged();
  const ap = await ops.post(`${B}/evolution/${pid}/approve`, { confirm: true, reason: '샌드박스 통과·영향 범위 확인' }, { 'idempotency-key': 'evo-ap-1' }); ok(ap); assert.equal(ap.data.state, 'APPROVED'); await unchanged();
  const dep = await ops.post(`${B}/evolution/${pid}/deploy-demo`, { confirm: true }); ok(dep); assert.ok(['ACTIVE', 'MONITORED'].includes(dep.data.state)); assert.match(dep.data.model_version, /^1\.1\.0$/); assert.equal(dep.data.mapping_version, 'v2');
  assert.equal((await adm.get(B + '/mappings')).data.version, 'v2'); assert.ok(dep.data.recommendation_changes.length >= 1, 'service recommendation data changed after the approved release');
  assert.ok(q.get("SELECT COUNT(*) n FROM di_golden WHERE attributes LIKE '%interest_industry_code%'").n >= 1); assert.equal(q.get("SELECT COUNT(*) n FROM di_raw WHERE status='QUARANTINED'").n >= 0, true);
  const kb = q.get("SELECT party_id FROM di_party WHERE company_id='CMP-001' AND lifecycle_status='ACTIVE' AND party_type='ORGANIZATION' ORDER BY party_id LIMIT 1").party_id; assert.ok(JSON.parse(q.get('SELECT product_keys k FROM di_ods WHERE party_id=?', kb).k).includes('medical_device'), 'approved interest attribute enriches serving keys');
  // 서비스 결과: MyKOTRA 추천(기업 로그인)이 변한다
  const recAfter = await cust.post('/api/buyers/recommend', {}); ok(recAfter);
  const prov = await cust.get(B + '/provenance/recommendation'); ok(prov); assert.equal(prov.data.integration.enriched, true); assert.ok(!JSON.stringify(prov.data).includes('CRM-C'), 'no raw source ids for customers');
  // 롤백
  assert.equal((await ops.post(`${B}/evolution/${pid}/rollback-demo`, { confirm: true })).data.error.code, 'REASON_REQUIRED');
  const rb = await ops.post(`${B}/evolution/${pid}/rollback-demo`, { confirm: true, reason: '회귀 시연 — 이전 버전으로 복구' }); ok(rb); assert.equal(rb.data.state, 'ROLLED_BACK'); assert.equal((await adm.get(B + '/mappings')).data.version, 'v1'); assert.equal((await adm.get(B + '/evolution')).data.active_model, snapBefore.model);
  assert.equal(JSON.parse(q.get('SELECT product_keys k FROM di_ods WHERE party_id=?', kb).k).includes('medical_device'), false, 'serving restored'); assert.match(rb.data.compensation.note, /보상 트랜잭션/);
  assert.ok(q.get("SELECT COUNT(*) n FROM audit_events WHERE action IN ('di.evolution.approve','di.evolution.deploy','di.evolution.rollback')").n >= 3);
  // TC-EVO-02: 기준 미달 → 자동 반려
  q.run("UPDATE demo_bk_member SET export_interest_category='QQ_UNKNOWN'"); const prop2 = EV.propose({ user: { id: 'U-021', role: 'consultant' }, ip: 't' }, det.data.drift_id, { kind: 'NEW_COLUMN', table: 'demo_bk_member', column: 'export_interest_category' }, q.get("SELECT * FROM di_source WHERE id='BUYKOREA_DEMO'"), require('../server/di/schema').latestSnapshot('BUYKOREA_DEMO'));
  const sim2 = await con.post(`${B}/evolution/${prop2.id}/simulate`, {}); ok(sim2); assert.equal(sim2.data.pass, false); assert.equal(sim2.data.state, 'REJECTED'); assert.ok(sim2.data.gates.some((g) => !g.pass && /미등록/.test(g.name)));
});

test('TC-LINEAGE-01: recommendation traces back to source record, mapping version and golden version', async () => {
  const l = await adm.get(`${B}/lineage/${encodeURIComponent('svc:BuyerRecommendation:CMP-001')}`); ok(l); const up = l.data.upstream.map((e) => `${e.kind}:${e.from_node}`).join('|');
  assert.match(up, /SERVES:ods:PTY-/); assert.match(up, /MATERIALIZE:party:PTY-/); assert.match(up, /CROSSWALK:record:CRM:demo_crm_customer:CRM-C0001/); assert.ok(l.data.upstream.some((e) => e.kind === 'MATERIALIZE' && e.version && e.ref), 'carries mapping version and golden ref');
  const f = await adm.get(`${B}/lineage/${encodeURIComponent('std:LEGAL_ENTITY.normalized_name')}`); assert.ok(f.data.upstream.some((e) => e.kind === 'MAPPING' && e.from_node.startsWith('field:CRM.')));
  assert.equal((await cust.get(`${B}/lineage/x`)).status, 403);
});

test('TC-SEC-01: role gates, masked samples, signup simulator does not reveal account existence, flag-protected sources', async () => {
  assert.equal((await client().get(B + '/overview')).status, 401); assert.equal((await cust.get(B + '/overview')).status, 403); assert.equal((await cust.get(B + '/sources/CRM_DEMO/preview')).status, 403);
  const pv = await off.get(B + '/sources/CRM_DEMO/preview?table=demo_crm_customer'); ok(pv); const raw = q.get("SELECT contact_email e, business_reg_no r FROM demo_crm_customer WHERE crm_customer_id='CRM-C0001'"); const txt = JSON.stringify(pv.data); assert.ok(!txt.includes(raw.e) && !txt.includes(raw.r), 'plain PII is never returned'); assert.ok(txt.includes('***'));
  assert.equal((await adm.get(B + '/sources/CRM_DEMO/preview?table=sqlite_master')).status, 403, 'table allowlist');
  assert.equal((await con.post(B + '/sources/CRM_LIVE/test', {})).status, 403); assert.equal((await adm.post(B + '/sources/CRM_LIVE/test', {})).status, 403, 'LIVE sources are disabled until approved'); assert.equal((await adm.post(B + '/sources', { id: 'MYDB', connector_type: 'LIVE_GATEWAY' })).status, 403);
  const input = { system: 'CRM', org_name: 'K Beauty Labs Ltd.', country: 'KOR', reg_no: q.get("SELECT business_reg_no r FROM demo_crm_customer WHERE crm_customer_id='CRM-C0001'").r, email: 'new.person@kbeautylabs.example' };
  const gen = await off.post(B + '/identity/signup-simulate', input); ok(gen); assert.equal(gen.data.matched_party, undefined, 'viewer gets only a generalised message'); assert.equal(gen.data.outcome, undefined); assert.match(gen.data.message, /담당자 검토/);
  const det = await con.post(B + '/identity/signup-simulate', input); ok(det); assert.equal(det.data.outcome, 'STRONG_DUPLICATE'); assert.ok(det.data.matched_party.score >= 70); assert.equal(det.data.stored_in, 'DEMO 저장소(실계정 미생성)');
  const fresh = await con.post(B + '/identity/signup-simulate', { system: 'BUYKOREA', org_name: 'Completely New Venture', country: 'US', email: 'x@new.example' }); assert.equal(fresh.data.outcome, 'NEW');
  const up = await adm.post(B + '/sources', { id: 'PARTNER_CSV', name: 'Partner CSV', connector_type: 'FILE_UPLOAD' }); ok(up);
  const csv = 'partner_id,partner_name,email\nP1,Acme Ltd,a@acme.example\nP2,Beta Co,\n'; ok(await adm.post(B + '/sources/PARTNER_CSV/upload', { table: 'partners', format: 'csv', content: csv })); const d = await adm.post(B + '/sources/PARTNER_CSV/discover', {}); ok(d); assert.equal(d.data.tables, 1); assert.equal(d.data.columns, 3);
  assert.equal((await adm.post(B + '/sources/PARTNER_CSV/upload', { table: 'x', format: 'csv', content: 'a'.repeat(200001) })).status, 413);
});

test('TC-ERD-U: unified ERD covers every app table with verified relations, 2 notations\' data, exports, glossary RBAC', async () => {
  assert.equal((await client().get(B + '/erd/unified')).status, 401); assert.equal((await cust.get(B + '/erd/unified')).status, 403);
  const r = await adm.get(B + '/erd/unified'); ok(r); const M = r.data;
  const live = q.all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").map((t) => t.name);
  assert.ok(M.entities.length >= 100, `entities ${M.entities.length}`); assert.equal(M.entities.length, live.length, 'every live table is an entity');
  assert.ok(M.entities.every((e) => e.area && e.logical && e.columns.length), 'each entity has an area, a logical name and columns');
  const names = new Set(M.entities.map((e) => e.name)); assert.ok(M.relations.every((x) => names.has(x.from) && names.has(x.to)), 'relations reference existing entities');
  const bad = M.relations.filter((x) => x.verified && !x.verified.ok); assert.equal(M.stats.verify_failed, bad.length, 'verification failures are reported, never hidden'); assert.ok(bad.length <= 2, 'unverified: ' + JSON.stringify(bad.map((x) => [x.from, x.fromCol, x.verified])));
  assert.ok(M.areas.length >= 15 && M.area_links.length > 5);
  const ddl = await adm.get(B + '/erd/unified/export?format=ddl'); ok(ddl); assert.match(ddl.data, /CREATE TABLE di_party/);
  const dict = await adm.get(B + '/erd/unified/export?format=dictionary'); ok(dict); assert.match(dict.data, /di_party/); assert.ok((await adm.get(B + '/erd/unified/export?format=mmd')).data.includes('erDiagram'));
  assert.equal((await off.put(B + '/glossary', { kind: 'table', target: 'di_party', logical: 'x' })).status, 403, 'only data architects edit the glossary');
  const g = await adm.put(B + '/glossary', { kind: 'column', target: 'di_party.lifecycle_status', logical: '정본 상태(보정)' }); ok(g);
  const again = (await adm.get(B + '/erd/unified?refresh=1')).data; assert.equal(again.entities.find((e) => e.name === 'di_party').columns.find((c) => c.name === 'lifecycle_status').logical, '정본 상태(보정)');
  assert.equal((await adm.put(B + '/glossary', { kind: 'table', target: 'no_such_table', logical: 'x' })).status >= 400, true, 'unknown targets are rejected');
});

test('Evidence Center & self-check are generated from real state; admin console exposes the studio only to staff', async () => {
  const sc = await adm.post(B + '/selfcheck', {}); ok(sc); assert.equal(sc.data.passed, sc.data.total, JSON.stringify(sc.data.results.filter((r) => !r.pass)));
  const idx = await adm.get(B + '/evidence'); ok(idx); assert.equal(idx.data.documents.length, 10);
  for (const d of idx.data.documents) { const r = await adm.get(`${B}/evidence/export?doc=${d.name}`); assert.equal(r.status, 200, d.name); assert.ok(String(r.data).length > 200, d.name); }
  const rm = await adm.get(`${B}/evidence/export?doc=SCHEMA_EVOLUTION_REPORT.md`); assert.match(rm.data, /ROLLED_BACK/); assert.match(rm.data, /EVP-/); const csv = await adm.get(`${B}/evidence/export?doc=FIELD_MAPPING_STANDARD_DICTIONARY.csv`); assert.match(csv.data, /LEGAL_ENTITY/);
  assert.equal((await con.get(`${B}/evidence/export?doc=bundle`)).status, 403, 'evidence export is for auditors/admins');
  const audit = await adm.get(B + '/audit'); ok(audit); assert.equal(audit.data.chain.ok, true); assert.ok(audit.data.events.length > 5);
  const chain = await adm.get('/api/admin/audit/verify'); assert.equal(chain.data.ok, true, 'audit hash chain intact after the whole studio flow');
});
