'use strict';
// Pipeline Control Tower: SNAPSHOT → LANDING → CONSENT → STANDARDIZE → QUALITY → IDENTITY → MDM APPLY → ODS → SERVING → VERIFY.
// 한 번의 실행은 하나의 트랜잭션이며, 실패하면 전체가 롤백되고 워터마크는 전진하지 않는다(TC-ETL-02).
const crypto = require('node:crypto');
const { q } = require('../db');
const U = require('../util');
const S = require('./schema');
const M = require('./mapping');
const MDM = require('./mdm');
const DQ = require('./quality');
const { J, P, nid, ev, audit, err } = require('./core');

const STAGES = ['SNAPSHOT', 'LANDING', 'CONSENT', 'STANDARDIZE', 'QUALITY', 'IDENTITY', 'MDM_APPLY', 'ODS', 'SERVING', 'VERIFY'];
const ENTITY_TABLE = { CRM_DEMO: 'demo_crm_customer', BUYKOREA_DEMO: 'demo_bk_member' };
const CHILD = { CRM_DEMO: [['demo_crm_participation', 'participation_id', 'PARTICIPATION', 'crm_customer_id', 'participated_at'], ['demo_crm_voc', 'voc_id', 'VOC', 'crm_customer_id', 'created_at']], BUYKOREA_DEMO: [['demo_bk_inquiry', 'inquiry_id', 'INQUIRY', 'buyer_member_id', 'created_at']] };
const sysOf = (sid) => (sid === 'CRM_DEMO' ? 'CRM' : 'BUYKOREA');
const fingerprint = (o) => crypto.createHash('sha256').update(J(Object.keys(o).sort().map((k) => [k, o[k]]))).digest('hex');
const wmOf = (sid) => (q.get('SELECT value FROM di_watermark WHERE source_id=?', sid) || {}).value || null;
const stageLog = (stages, name, t0, status, extra = {}) => stages.push({ name, status, ms: Date.now() - t0, ...extra });

function standardizeRow(row, ctxFixes = true) {
  const p = U.parse(row.payload, {}); const sys = sysOf(row.source_id);
  const payload = { ...p };
  if (ctxFixes) for (const f of DQ.fixesFor(sys, row.source_table, row.source_pk)) payload[f.field] = f.new_value;
  const std = M.standardizeRecord(sys, row.source_table, payload);
  const quarantined = std.flags.some((f) => f.flag === 'UNKNOWN_CODE' || f.flag === 'CAST_FAIL');
  return { ...std, quarantined, mapping_version: M.activeVersion() };
}

// ───────── MDM Apply (신규 정본 생성 / 정본 버전업 / 동의 재평가) ─────────
function personCw(table) { return `${table}#contact`; }
function applyMaster(ctx, row, counts, reasonPrefix = 'source') {
  const sys = sysOf(row.source_id); const v = MDM.viewOf(row); const table = row.source_table; const pk = row.source_pk; const now = U.iso();
  const consent = MDM.evalConsent(sys, U.parse(row.payload, {}));
  const orgTarget = v.kind === 'ORG';
  const upsertParty = (cwTable, type, display) => {
    let cw = q.get("SELECT * FROM di_crosswalk WHERE source_system=? AND source_table=? AND source_pk=? AND status='ACTIVE'", sys, cwTable, pk);
    if (cw) return { party_id: cw.party_id, created: false };
    if (!consent.eligible) return null; // 동의 부적합 레코드는 정본을 만들지 않는다(대상 제외)
    const pid = nid('PTY'); q.insert('di_party', { party_id: pid, party_type: type, display_name: display, country_code: v.country, lifecycle_status: 'ACTIVE', consent_status: consent.status, golden_version_id: null, merged_into: null, company_id: null, created_at: now, updated_at: now, version: 1 });
    q.insert('di_crosswalk', { id: nid('XWK'), party_id: pid, source_system: sys, source_table: cwTable, source_pk: pk, status: 'ACTIVE', valid_from: now, valid_to: null, version: 1, decision_id: null });
    return { party_id: pid, created: true };
  };
  const touched = [];
  if (orgTarget) {
    const r = upsertParty(table, 'ORGANIZATION', v.name_raw);
    if (r) {
      const g = MDM.newGolden(ctx, r.party_id, r.created ? `초기 적재(${reasonPrefix})` : `원천 변경 반영(${reasonPrefix})`);
      counts[r.created ? 'master_new' : (g.unchanged ? 'master_unchanged' : 'master_updated')]++; if (r.created) counts.parties_created++; touched.push(r.party_id);
      const p = q.get('SELECT * FROM di_party WHERE party_id=?', r.party_id); if (!p.company_id && sys === 'CRM') { const c = MDM.companyLinkFor(v.name_raw); if (c) q.run('UPDATE di_party SET company_id=? WHERE party_id=?', c, r.party_id); } // CRM 기준 MDM: 서비스 고객(company)과는 CRM 정본(또는 승인된 병합 정본)만 연결
      q.run('DELETE FROM di_consent WHERE source_ref=?', v.ref); q.insert('di_consent', { id: nid('CNS'), party_id: r.party_id, source_ref: v.ref, purpose: consent.purpose || 'DATA_INTEGRATION', legal_basis: consent.basis, scope: 'PROFILE', valid_from: consent.granted || null, valid_to: consent.until || null, revoked_at: consent.revoked || null, status: consent.status });
      if (v.contact || v.email_hash) { const pr = upsertParty(personCw(table), 'PERSON', v.contact); if (pr) { MDM.newGolden(ctx, pr.party_id, '담당자 정본'); if (pr.created) { counts.persons_created++; q.insert('di_affiliation', { id: nid('AFF'), person_party_id: pr.party_id, org_party_id: r.party_id, role_type: 'CONTACT', valid_from: now, status: 'ACTIVE' }); } } }
    } else { // 동의 부적합 + 기존 정본 → 상태만 보수적으로 갱신
      const cw = q.get("SELECT party_id FROM di_crosswalk WHERE source_system=? AND source_table=? AND source_pk=? AND status='ACTIVE'", sys, table, pk);
      if (cw) { MDM.newGolden(ctx, cw.party_id, `동의 재평가: ${consent.status}`); touched.push(cw.party_id); counts.consent_reevaluated++; }
      else counts.excluded_no_master++;
    }
  } else { // CRM 개인 고객 → PERSON 정본
    const r = upsertParty(table, 'PERSON', v.contact || v.name_raw);
    if (r) { MDM.newGolden(ctx, r.party_id, r.created ? '초기 적재' : '원천 변경 반영'); counts[r.created ? 'master_new' : 'master_updated']++; if (r.created) counts.persons_created++; touched.push(r.party_id); } else counts.excluded_no_master++;
  }
  return touched;
}
function linkCandidateParties() {
  for (const c of q.all('SELECT id,left_ref,right_ref FROM di_candidate')) q.run('UPDATE di_candidate SET left_party=?, right_party=? WHERE id=?', MDM.partyOfRef(c.left_ref), MDM.partyOfRef(c.right_ref), c.id);
}

// ───────── 계보(Lineage) ─────────
function edge(from, to, kind, ref, version) { q.run('INSERT OR IGNORE INTO di_lineage(from_node,to_node,kind,ref,version,created_at) VALUES(?,?,?,?,?,?)', from, to, kind, ref || null, version || null, U.iso()); }
function buildLineage() {
  for (const m of M.listMappings().filter((x) => x.status === 'ACTIVE')) { edge(`field:${m.source_system}.${m.source_table}.${m.source_field}`, `std:${m.target_entity}.${m.target_field}`, 'MAPPING', m.id, m.mapping_version); }
  for (const p of q.all("SELECT * FROM di_party WHERE lifecycle_status='ACTIVE' OR lifecycle_status='MERGED'")) {
    for (const cw of q.all("SELECT * FROM di_crosswalk WHERE party_id=? AND status='ACTIVE'", p.party_id)) edge(`record:${cw.source_system}:${cw.source_table}:${cw.source_pk}`, `party:${p.party_id}`, 'CROSSWALK', cw.id, `v${cw.version}`);
    if (p.party_type !== 'ORGANIZATION') continue;
    const ods = q.get('SELECT * FROM di_ods WHERE party_id=?', p.party_id);
    if (ods) { edge(`party:${p.party_id}`, `ods:${p.party_id}`, 'MATERIALIZE', ods.golden_version_id, ods.mapping_version); if (p.company_id) for (const svc of ['MyKOTRA', 'BuyerRecommendation', 'ProgramRecommendation', 'ConsultationSingleView']) edge(`ods:${p.party_id}`, `svc:${svc}:${p.company_id}`, 'SERVES', null, ods.mapping_version); }
  }
}
function lineageOf(node, depth = 6) {
  const edges = q.all('SELECT * FROM di_lineage'); const up = new Map(); const down = new Map();
  edges.forEach((e) => { (down.get(e.from_node) || down.set(e.from_node, []).get(e.from_node)).push(e); (up.get(e.to_node) || up.set(e.to_node, []).get(e.to_node)).push(e); });
  const walk = (start, map, key) => { const seen = new Set([start]); const out = []; let frontier = [start]; for (let d = 0; d < depth && frontier.length; d++) { const nxt = []; for (const n of frontier) for (const e of map.get(n) || []) { out.push(e); const t = e[key]; if (!seen.has(t)) { seen.add(t); nxt.push(t); } } frontier = nxt; } return out; };
  const upstream = walk(node, up, 'from_node'); const downstream = walk(node, down, 'to_node');
  return { node, upstream, downstream, nodes: [...new Set([node, ...upstream.flatMap((e) => [e.from_node, e.to_node]), ...downstream.flatMap((e) => [e.from_node, e.to_node])])] };
}

// ───────── 실행 ─────────
function run(ctx, opts = {}) {
  const mode = opts.mode === 'FULL' ? 'FULL' : 'INCREMENTAL'; const sids = (opts.source_id && opts.source_id !== 'ALL') ? [opts.source_id] : ['CRM_DEMO', 'BUYKOREA_DEMO'];
  for (const sid of sids) { const s = q.get('SELECT * FROM di_source WHERE id=?', sid); if (!s) throw U.notFound(`Source ${sid} not found`); if (!s.enabled) throw err('SOURCE_DISABLED', `${sid} 는 비활성입니다`, 409); if (!['SYNTHETIC', 'MOCK'].includes(s.integration_mode)) throw err('SOURCE_NOT_APPROVED', `${sid} (${s.integration_mode}) 는 승인 전 연결할 수 없습니다`, 403); }
  const key = opts.idempotency_key; if (key) { const ex = q.get('SELECT * FROM di_run WHERE idempotency_key=?', key); if (ex) return { ...hydRun(ex), idempotent_replay: true }; }
  const id = nid('RUN'); const started = U.iso(); const wmBefore = Object.fromEntries(sids.map((s) => [s, wmOf(s)])); const stages = []; const counts = { sources: sids, read: 0, landed_new: 0, landed_changed: 0, duplicate_skipped: 0, eligible: 0, ineligible: 0, standardized_ok: 0, standardization_failed: 0, quarantined: 0, parties_created: 0, persons_created: 0, master_new: 0, master_updated: 0, master_unchanged: 0, consent_reevaluated: 0, excluded_no_master: 0, candidates_created: 0, candidates_updated: 0, comparisons: 0, ods_rows: 0, activities: 0, dq_overall: null, dq_issues_created: 0 };
  const t00 = Date.now(); let wmAfter = { ...wmBefore }; let status = 'SUCCEEDED'; let error = null; let recon = [];
  const inject = opts.inject_error; const boom = (stage) => { if (inject === stage) throw new Error(`INJECTED_FAILURE:${stage}`); };
  try {
    q.tx(() => {
      let t = Date.now(); const batches = [];
      boom('SNAPSHOT_PRE');
      for (const sid of sids) {
        const src = q.get('SELECT * FROM di_source WHERE id=?', sid); const c = S.conn(src); const table = ENTITY_TABLE[sid]; const since = mode === 'INCREMENTAL' ? (opts.since || wmBefore[sid]) : null;
        const rows = S.readRows(c, src, table, { since }); counts.read += rows.length; batches.push({ sid, table, rows, since, pkCol: S.pkOf(S.tableMeta(c, src, table)) });
      }
      stageLog(stages, 'SNAPSHOT', t, 'OK', { in: batches.reduce((a, b) => a + b.rows.length, 0), out: counts.read, note: `${mode}${batches.map((b) => b.since ? ` · ${b.sid} since ${String(b.since).slice(0, 19)}` : '').join('')}` }); boom('SNAPSHOT');

      t = Date.now(); const landed = []; const now = U.iso();
      for (const b of batches) for (const r of b.rows) {
        const pk = r[b.pkCol]; const fp = fingerprint(r);
        const dup = q.get('SELECT id FROM di_raw WHERE source_id=? AND source_table=? AND source_pk=? AND fingerprint=?', b.sid, b.table, String(pk), fp);
        if (dup) { counts.duplicate_skipped++; continue; }
        const prior = q.get("SELECT id FROM di_raw WHERE source_id=? AND source_table=? AND source_pk=? AND status<>'SUPERSEDED'", b.sid, b.table, String(pk));
        if (prior) { q.run("UPDATE di_raw SET status='SUPERSEDED' WHERE source_id=? AND source_table=? AND source_pk=? AND status<>'SUPERSEDED'", b.sid, b.table, String(pk)); counts.landed_changed++; } else counts.landed_new++;
        const rid = nid('RAW', 5); q.insert('di_raw', { id: rid, source_id: b.sid, source_table: b.table, source_pk: String(pk), fingerprint: fp, payload: J(r), std_json: null, run_id: id, collected_at: now, source_updated_at: r.updated_at || r.modified_at || null, eligible: null, reason: null, status: 'LANDED' }); landed.push(rid);
      }
      if (opts.restandardize) for (const sid of sids) for (const cur of q.all("SELECT id FROM di_raw WHERE source_id=? AND source_table=? AND status<>'SUPERSEDED'", sid, ENTITY_TABLE[sid])) if (!landed.includes(cur.id)) { landed.push(cur.id); counts.reprocessed = (counts.reprocessed || 0) + 1; }
      stageLog(stages, 'LANDING', t, 'OK', { in: counts.read, out: landed.length, duplicate: counts.duplicate_skipped, note: `신규 ${counts.landed_new} · 변경 ${counts.landed_changed} · 중복 건너뜀(멱등) ${counts.duplicate_skipped}` }); boom('LANDING');

      t = Date.now(); const rows = landed.map((rid) => q.get('SELECT * FROM di_raw WHERE id=?', rid));
      for (const r of rows) { const c = MDM.evalConsent(sysOf(r.source_id), U.parse(r.payload, {})); q.run('UPDATE di_raw SET eligible=?, reason=? WHERE id=?', c.eligible ? 1 : 0, c.reason, r.id); if (c.eligible) counts.eligible++; else counts.ineligible++; r.eligible = c.eligible ? 1 : 0; r.reason = c.reason; }
      stageLog(stages, 'CONSENT', t, 'OK', { in: rows.length, out: counts.eligible, excluded: counts.ineligible, note: `동의 부적합(철회·만료·5년 범위 밖·목적 불일치) ${counts.ineligible}건 대상 제외` }); boom('CONSENT');

      t = Date.now();
      for (const r of rows) {
        const sd = standardizeRow(r); const st = r.eligible ? (sd.quarantined ? 'QUARANTINED' : 'STANDARDIZED') : 'INELIGIBLE';
        q.run('UPDATE di_raw SET std_json=?, status=? WHERE id=?', J({ std: sd.std, flags: sd.flags, provenance: sd.provenance, mapping_version: sd.mapping_version }), st, r.id); r.status = st;
        if (st === 'STANDARDIZED') counts.standardized_ok++; if (st === 'QUARANTINED') { counts.standardization_failed++; counts.quarantined++; }
      }
      stageLog(stages, 'STANDARDIZE', t, counts.quarantined ? 'WARN' : 'OK', { in: counts.eligible, out: counts.standardized_ok, failed: counts.standardization_failed, note: `매핑 ${M.activeVersion()} · 미등록 코드 ${counts.quarantined}건 격리(QUARANTINE)` }); boom('STANDARDIZE');

      t = Date.now(); const dq = DQ.run(ctx, { createIssues: true }); counts.dq_overall = dq.overall; counts.dq_issues_created = dq.issues_created;
      stageLog(stages, 'QUALITY', t, 'OK', { out: dq.overall, note: `품질점수 ${dq.overall ?? 'N/A'} · 신규 이슈 ${dq.issues_created}건` }); boom('QUALITY');

      t = Date.now(); const cr = MDM.resolveCandidates(ctx, id); counts.candidates_created = cr.created; counts.candidates_updated = cr.updated; counts.comparisons = cr.compared;
      stageLog(stages, 'IDENTITY', t, 'OK', { out: cr.created + cr.updated, note: `블로킹으로 비교 ${cr.compared}/${cr.total_pairs}쌍(감소 ${cr.reduction_pct ?? 'N/A'}%) · 자동 병합 없음(승인형)` }); boom('IDENTITY');

      t = Date.now(); const touched = new Set();
      for (const r of rows.filter((x) => x.status === 'STANDARDIZED' || x.status === 'INELIGIBLE')) applyMaster(ctx, r, counts, id).forEach((p) => touched.add(p));
      linkCandidateParties();
      stageLog(stages, 'MDM_APPLY', t, 'OK', { out: touched.size, note: `신규 정본 ${counts.master_new} · 버전업 ${counts.master_updated} · 변동 없음 ${counts.master_unchanged} · 동의 재평가 ${counts.consent_reevaluated}` }); boom('MDM_APPLY');

      t = Date.now(); const orgs = q.all("SELECT party_id FROM di_party WHERE party_type='ORGANIZATION'"); orgs.forEach((p) => MDM.refreshOds(p.party_id)); counts.ods_rows = q.count('di_ods');
      stageLog(stages, 'ODS', t, 'OK', { out: counts.ods_rows, note: '동의 유효 ORG 정본만 ODS 물질화' }); boom('ODS');

      t = Date.now(); let acts = 0;
      for (const sid of sids) for (const [tbl, pkc, type, owner, tsc] of CHILD[sid]) for (const r of S.readRows(S.conn(q.get('SELECT * FROM di_source WHERE id=?', sid)), q.get('SELECT * FROM di_source WHERE id=?', sid), tbl)) {
        const aid = `ACT-${tbl}-${r[pkc]}`; const own = r[owner]; const cw = own ? q.get("SELECT party_id FROM di_crosswalk WHERE source_system=? AND source_table=? AND source_pk=? AND status='ACTIVE'", sysOf(sid), ENTITY_TABLE[sid], own) : null;
        if (!cw) continue; q.run('INSERT OR REPLACE INTO di_activity(id,party_id,source_system,source_pk,event_type,occurred_at,ref) VALUES(?,?,?,?,?,?,?)', aid, cw.party_id, sysOf(sid), String(r[pkc]), type, r[tsc] || null, tbl); acts++;
      }
      counts.activities = q.count('di_activity'); buildLineage();
      stageLog(stages, 'SERVING', t, 'OK', { out: acts, note: `활동 이벤트 ${acts}건 연결 · 계보 엣지 ${q.count('di_lineage')}개 · 서빙은 목적·동의 검사 통과분만` }); boom('SERVING');

      t = Date.now(); recon = reconcile(sids, mode); const failed = recon.filter((c) => !c.pass);
      if (failed.length) throw new Error(`RECONCILIATION_FAILED:${failed.map((f) => f.name).join(',')}`);
      for (const sid of sids) { const mx = q.get("SELECT MAX(source_updated_at) m FROM di_raw WHERE source_id=? AND status<>'SUPERSEDED'", sid).m || wmBefore[sid]; wmAfter[sid] = mx && wmBefore[sid] && mx < wmBefore[sid] ? wmBefore[sid] : mx; }
      for (const sid of sids) if (wmBefore[sid] && wmAfter[sid] < wmBefore[sid]) throw new Error('WATERMARK_REGRESSION');
      stageLog(stages, 'VERIFY', t, 'OK', { out: recon.length, checks: recon.map((c) => ({ name: c.name, expected: c.expected, actual: c.actual, pass: c.pass })), note: `정합성 검증 ${recon.filter((c) => c.pass).length}/${recon.length} 통과` });
      if (counts.quarantined > 0) status = 'PARTIAL';
      for (const sid of sids) { q.run('INSERT OR REPLACE INTO di_watermark(source_id,value,run_id,updated_at) VALUES(?,?,?,?)', sid, wmAfter[sid], id, U.iso()); q.run('UPDATE di_source SET last_run_at=? WHERE id=?', U.iso(), sid); } // 워터마크는 최종 검증 성공 후에만 전진
    });
  } catch (e) {
    status = 'FAILED'; wmAfter = { ...wmBefore }; error = { message: String(e.message).slice(0, 400), stage: (e.message.match(/INJECTED_FAILURE:(\w+)/) || [])[1] || (e.message.startsWith('RECONCILIATION') ? 'VERIFY' : 'UNKNOWN'), retryable: !e.message.startsWith('RECONCILIATION'), rolled_back: true };
    stages.push({ name: error.stage, status: 'FAILED', ms: 0, note: error.message });
  }
  const row = { id, source_id: sids.join(','), mode, status, watermark_before: J(wmBefore), watermark_after: J(wmAfter), counts: J(counts), stages: J(stages), error: error ? J(error) : null, retry_no: opts.retry_no || 0, parent_run_id: opts.parent_run_id || null, idempotency_key: key || null, started_at: started, finished_at: U.iso(), by_user: ctx && ctx.user ? ctx.user.id : 'system' };
  q.insert('di_run', row); if (status !== 'FAILED') { const d2 = DQ.run(ctx, { createIssues: false }); counts.dq_overall = d2.overall; q.update('di_run', id, { counts: J(counts) }); row.counts = J(counts); } // 연결·적시성 지표는 실행 이력/후보 생성 이후에 계산
  ev(ctx, `pipeline.${status.toLowerCase()}`, id, { mode, counts: { read: counts.read, quarantined: counts.quarantined, master_new: counts.master_new } }); audit(ctx, `pipeline.${status.toLowerCase()}`, 'di_run', id, { mode, sources: sids, status, error });
  return { ...hydRun(row), recon, duration_ms: Date.now() - t00 };
}

function reconcile(sids, mode) {
  const checks = []; const add = (name, expected, actual, pass, note) => checks.push({ name, expected, actual, pass, note });
  for (const sid of sids) {
    const table = ENTITY_TABLE[sid]; const srcRows = q.get(`SELECT COUNT(*) n FROM ${table}`).n; const cur = q.get("SELECT COUNT(*) n FROM di_raw WHERE source_id=? AND source_table=? AND status<>'SUPERSEDED'", sid, table).n;
    if (mode === 'FULL' || cur >= 0) add(`${sid}: 원천 건수 = 적재(현행) 건수`, srcRows, cur, srcRows === cur || mode === 'INCREMENTAL' && cur === srcRows, mode === 'FULL' ? '전체 적재 기준' : '증분 후 현행본 기준');
    const el = q.get("SELECT COUNT(*) n FROM di_raw WHERE source_id=? AND status<>'SUPERSEDED' AND eligible=1", sid).n; const inel = q.get("SELECT COUNT(*) n FROM di_raw WHERE source_id=? AND status<>'SUPERSEDED' AND eligible=0", sid).n; const unk = q.get("SELECT COUNT(*) n FROM di_raw WHERE source_id=? AND status<>'SUPERSEDED' AND eligible IS NULL", sid).n;
    add(`${sid}: source = eligible + ineligible`, cur, el + inel + unk, cur === el + inel + unk, `eligible ${el} + ineligible ${inel}`);
    const ok = q.get("SELECT COUNT(*) n FROM di_raw WHERE source_id=? AND status='STANDARDIZED'", sid).n; const qt = q.get("SELECT COUNT(*) n FROM di_raw WHERE source_id=? AND status='QUARANTINED'", sid).n;
    add(`${sid}: eligible = standardized_ok + quarantined`, el, ok + qt, el === ok + qt, `ok ${ok} + quarantined ${qt}`);
    const mastered = q.get("SELECT COUNT(DISTINCT r.source_pk) n FROM di_raw r JOIN di_crosswalk c ON c.source_system=? AND c.source_table=r.source_table AND c.source_pk=r.source_pk AND c.status='ACTIVE' WHERE r.source_id=? AND r.status='STANDARDIZED'", sysOf(sid), sid).n;
    add(`${sid}: standardized_ok 정본 연결(Crosswalk)`, ok, mastered, ok === mastered, '표준화 통과 레코드는 모두 활성 Crosswalk 보유');
  }
  const dupCw = q.get("SELECT COUNT(*) n FROM (SELECT 1 FROM di_crosswalk WHERE status='ACTIVE' GROUP BY source_system, source_table, source_pk HAVING COUNT(*)>1)").n; add('Crosswalk 활성 유일성', 0, dupCw, dupCw === 0, 'UNIQUE(system,table,pk,active)');
  const orphan = q.get("SELECT COUNT(*) n FROM di_golden g LEFT JOIN di_party p ON p.party_id=g.party_id WHERE p.party_id IS NULL").n; add('Golden → Party 참조 무결성', 0, orphan, orphan === 0, 'FK 대체 검증');
  const odsBad = q.get("SELECT COUNT(*) n FROM di_ods o JOIN di_party p ON p.party_id=o.party_id WHERE p.lifecycle_status<>'ACTIVE' OR p.consent_status<>'VALID'").n; add('ODS: 비활성·동의 부적합 정본 미포함', 0, odsBad, odsBad === 0, '동의 철회/만료 시 서빙 제외');
  return checks;
}
const hydRun = (r) => r && ({ ...r, watermark_before: U.parse(r.watermark_before, {}), watermark_after: U.parse(r.watermark_after, {}), counts: U.parse(r.counts, {}), stages: U.parse(r.stages, []), error: U.parse(r.error, null) });
const getRun = (id) => hydRun(q.get('SELECT * FROM di_run WHERE id=?', id));
const listRuns = (limit = 30) => q.all('SELECT * FROM di_run ORDER BY started_at DESC, rowid DESC LIMIT ?', limit).map(hydRun);

function retry(ctx, id, opts = {}) {
  const r = getRun(id); if (!r) throw U.notFound('Run not found'); if (r.status !== 'FAILED') throw err('NOT_RETRYABLE', `FAILED 상태의 실행만 재시도할 수 있습니다(현재 ${r.status})`, 409);
  if (q.get('SELECT 1 x FROM di_run WHERE parent_run_id=?', id) && !opts.force) throw err('ALREADY_RETRIED', '이미 재시도되었습니다', 409);
  return run(ctx, { source_id: r.source_id.includes(',') ? 'ALL' : r.source_id, mode: r.mode, parent_run_id: id, retry_no: r.retry_no + 1 });
}
function restandardizeOne(ctx, system, table, pk) {
  const sid = system === 'CRM' ? 'CRM_DEMO' : 'BUYKOREA_DEMO'; const row = q.get("SELECT * FROM di_raw WHERE source_id=? AND source_table=? AND source_pk=? AND status<>'SUPERSEDED' ORDER BY collected_at DESC, rowid DESC LIMIT 1", sid, table, pk); if (!row) return null;
  const sd = standardizeRow(row); const st = row.eligible ? (sd.quarantined ? 'QUARANTINED' : 'STANDARDIZED') : 'INELIGIBLE';
  q.run('UPDATE di_raw SET std_json=?, status=? WHERE id=?', J({ std: sd.std, flags: sd.flags, provenance: sd.provenance, mapping_version: sd.mapping_version }), st, row.id);
  const counts = { master_new: 0, master_updated: 0, master_unchanged: 0, parties_created: 0, persons_created: 0, consent_reevaluated: 0, excluded_no_master: 0 };
  const touched = st === 'STANDARDIZED' ? applyMaster(ctx, { ...row, status: st }, counts, 'dq_fix') : [];
  touched.forEach((p) => MDM.refreshOds(p)); MDM.resolveCandidates(ctx, null); linkCandidateParties(); buildLineage(); return { status: st, touched, counts };
}
// 시연: 원천 변경 주입(C10 정정, 신규 컬럼) — DEMO 원천 테이블만 변경한다(운영 쓰기 아님)
function injectSource(ctx, kind) {
  const now = U.iso();
  if (kind === 'CORRECTION') { // C10: 원천에서 정정 → 증분 반영 → 정본 버전업 + 영향 추적
    const t = q.get("SELECT crm_customer_id id, organization_name n FROM demo_crm_customer WHERE crm_customer_id='CRM-C0009'") || q.get("SELECT crm_customer_id id, organization_name n FROM demo_crm_customer WHERE customer_type='ORGANIZATION' LIMIT 1");
    const newName = t.n.includes('(Corrected)') ? t.n.replace(' (Corrected)', '') : `${t.n} (Corrected)`;
    q.run('UPDATE demo_crm_customer SET organization_name=?, address_line=COALESCE(address_line,?), updated_at=? WHERE crm_customer_id=?', newName, 'Corrected Address 1', now, t.id);
    ev(ctx, 'source.injected', 'CRM_DEMO', { kind, pk: t.id }); audit(ctx, 'source.injected', 'di_source', 'CRM_DEMO', { kind, pk: t.id }); return { source_id: 'CRM_DEMO', kind, changed: t.id, note: `${t.id} 정정(updated_at=${now.slice(0, 19)}) → 증분 실행으로 반영됩니다` };
  }
  if (kind === 'NEW_COLUMN') { // C09: BK 신규 속성 export_interest_category
    const cols = q.all('PRAGMA table_info(demo_bk_member)').map((c) => c.name);
    if (!cols.includes('export_interest_category')) q.exec('ALTER TABLE demo_bk_member ADD COLUMN export_interest_category VARCHAR(40)');
    const cats = ['BEAUTY_DEVICE', 'COSMETICS', 'FOOD', 'WELLNESS', 'MEDICAL'];
    const rows = q.all('SELECT bk_member_id FROM demo_bk_member ORDER BY bk_member_id'); let i = 0;
    for (const r of rows) { const first = r.bk_member_id === 'BK-M0001' ? 'MEDICAL' : (i % 17 === 16 ? 'UNKNOWN_CAT' : cats[i % cats.length]); q.run('UPDATE demo_bk_member SET export_interest_category=?, modified_at=? WHERE bk_member_id=?', first, now, r.bk_member_id); i++; }
    ev(ctx, 'source.injected', 'BUYKOREA_DEMO', { kind }); audit(ctx, 'source.injected', 'di_source', 'BUYKOREA_DEMO', { kind, column: 'export_interest_category' });
    return { source_id: 'BUYKOREA_DEMO', kind, added_column: 'export_interest_category', rows: rows.length, note: '신규 컬럼이 추가되었습니다. 승인 전에는 매핑·정본·서비스에 반영되지 않습니다 → 스키마 드리프트 탐지 실행' };
  }
  if (kind === 'CONSENT_REVOKE') { const t = q.get("SELECT crm_customer_id id FROM demo_crm_customer WHERE crm_customer_id='CRM-C0010'") || q.get("SELECT crm_customer_id id FROM demo_crm_customer WHERE customer_type='ORGANIZATION' AND consent_revoked_at IS NULL ORDER BY crm_customer_id DESC LIMIT 1"); q.run('UPDATE demo_crm_customer SET consent_revoked_at=?, updated_at=? WHERE crm_customer_id=?', now, now, t.id); ev(ctx, 'source.injected', 'CRM_DEMO', { kind, pk: t.id }); audit(ctx, 'source.injected', 'di_source', 'CRM_DEMO', { kind, pk: t.id }); return { source_id: 'CRM_DEMO', kind, changed: t.id, note: '동의 철회 이벤트 주입 → 증분 실행 시 정본/ODS/서빙 재평가' }; }
  throw err('BAD_INJECTION', 'kind 는 CORRECTION / NEW_COLUMN / CONSENT_REVOKE 입니다', 400);
}

module.exports = { STAGES, run, retry, getRun, listRuns, restandardizeOne, injectSource, lineageOf, buildLineage, reconcile, hydRun, standardizeRow, applyMaster, linkCandidateParties, ENTITY_TABLE };
