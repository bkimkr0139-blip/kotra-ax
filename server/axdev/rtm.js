'use strict';
// RTM(요구사항 추적 매트릭스) — RFP 150건 ↔ 화면 ↔ API ↔ 테스트 ↔ 증빙 ↔ 피드백/작업지시서.
// 원천: rfp_coverage(제안요청서 분석) + 화면 레지스트리. 사람이 입력한 필드(owner·검증상태·rev>1 구현상태)는 재구축 시 보존한다.
const fs = require('node:fs');
const path = require('node:path');
const { q, nextId } = require('../db');
const U = require('../util');
const G = require('../gov');
const REG = require('./registry');

const ROOT = path.join(__dirname, '..', '..');
const IMPL = ['IMPLEMENTED', 'MOCK', 'PARTIAL', 'DESIGN_ONLY', 'OUT_OF_MVP'];
// 자동 테스트가 실제로 실행하는 화면/기능만 연결한다(과장 방지). 출처: test/*.test.js
const TESTED = {
  'test/scenarios.test.js': ['assistant', 'programs.detail', 'mykotra', 'mykotra.application', 'mykotra.approvals', 'events.detail', 'mykotra.matching', 'buyers.recommend', 'staff.consult', 'staff.research', 'admin.approvals', 'admin.audit', 'admin.data', 'sys.api', 'sys.tests'],
  'test/axdev.test.js': ['axdev', 'axos', 'admin.audit'],
  'test/di.test.js': ['admin.di', 'admin.di.tab', 'admin.audit', 'sys.api'],
};
const testsFor = (screens) => Object.entries(TESTED).filter(([, keys]) => screens.some((k) => keys.includes(k))).map(([f]) => f);

function rebuildRtm(ctx, note = '') {
  const cov = q.all('SELECT * FROM rfp_coverage ORDER BY id');
  let created = 0; let updated = 0;
  q.tx(() => {
    for (const c of cov) {
      const screens = REG.screensFor(c.screen);
      if (!screens.length && c.impl_status === 'DESIGN_ONLY') screens.push('sys.docs'); // 설계 제시 항목은 문서(비화면)에 연결
      const apis = U.uniq(screens.flatMap((k) => (REG.BY_KEY.get(k) || {}).api || []));
      const tests = testsFor(screens);
      const cur = q.get('SELECT rev FROM ax_rtm WHERE req_id=?', c.id);
      const base = { category: c.category, name: c.name, demo_status: c.demo_status, screens: JSON.stringify(screens), apis: JSON.stringify(apis), tests: JSON.stringify(tests), notes: c.notes, updated_at: U.iso() };
      if (!cur) { q.insert('ax_rtm', { req_id: c.id, ...base, impl_status: c.impl_status, evidence: c.evidence, owner: null, verify_status: 'UNVERIFIED', rev: 1 }); created++; }
      else {
        // 현업 확인으로 갱신된 구현상태(rev>1)와 evidence 이력은 덮어쓰지 않는다.
        q.update('ax_rtm', c.id, cur.rev > 1 ? base : { ...base, impl_status: c.impl_status, evidence: c.evidence }, 'req_id'); updated++;
      }
    }
  });
  const snap = snapshot(ctx, note || 'RTM rebuild');
  if (ctx) G.audit(ctx, 'ax.rtm.rebuild', 'rtm', snap.id, { created, updated, total: cov.length });
  return { created, updated, total: cov.length, snapshot: snap };
}

function summary() {
  const rows = q.all('SELECT impl_status s, verify_status v, category c, screens sc FROM ax_rtm');
  const by = Object.fromEntries(IMPL.map((k) => [k, 0]));
  const cats = {}; let verified = 0; let linked = 0; let scoped = 0;
  for (const r of rows) {
    by[r.s] = (by[r.s] || 0) + 1; if (r.v === 'VERIFIED') verified++;
    const c = (cats[r.c] = cats[r.c] || { total: 0, done: 0 }); c.total++; if (['IMPLEMENTED', 'MOCK', 'PARTIAL'].includes(r.s)) c.done++;
    if (r.s !== 'OUT_OF_MVP') { scoped++; if (U.parse(r.sc, []).length) linked++; }
  }
  const total = rows.length;
  const covered = by.IMPLEMENTED + by.MOCK + by.PARTIAL;
  return { total, by, verified, categories: cats, mvp_coverage_pct: total ? U.round((covered / total) * 100, 1) : 0, full_pct: total ? U.round((by.IMPLEMENTED / total) * 100, 1) : 0, screen_link_pct: scoped ? U.round((linked / scoped) * 100, 1) : 0, scoped };
}

function snapshot(ctx, note = '') {
  const t = summary(); const id = nextId('RTS', 4);
  const digest = U.sha(JSON.stringify(q.all('SELECT req_id,impl_status,verify_status,rev FROM ax_rtm ORDER BY req_id')));
  q.insert('ax_rtm_snapshots', { id, at: U.iso(), by_user: ctx && ctx.user ? ctx.user.id : 'system', totals: JSON.stringify({ total: t.total, ...t.by, verified: t.verified, mvp_coverage_pct: t.mvp_coverage_pct }), hash: digest, note });
  return { id, at: U.iso(), hash: digest.slice(0, 16), totals: t };
}

function rows({ cat, status, verify, q: text, screen, open } = {}) {
  let list = q.all('SELECT * FROM ax_rtm ORDER BY req_id').map((r) => ({ ...r, screens: U.parse(r.screens, []), apis: U.parse(r.apis, []), tests: U.parse(r.tests, []) }));
  const fb = q.all("SELECT id,status,rfp_ids,priority FROM ax_feedback WHERE status NOT IN ('REJECTED','DUPLICATE','WITHDRAWN')");
  const wo = q.all('SELECT id,status,rfp_ids FROM ax_orders');
  const tallyFb = {}; const tallyWo = {};
  for (const f of fb) for (const id of U.parse(f.rfp_ids, [])) { const t = (tallyFb[id] = tallyFb[id] || { open: 0, done: 0, ids: [] }); (f.status === 'DONE' ? t.done++ : t.open++); t.ids.push(f.id); }
  for (const o of wo) for (const id of U.parse(o.rfp_ids, [])) { const t = (tallyWo[id] = tallyWo[id] || { n: 0, ids: [] }); t.n++; t.ids.push(o.id); }
  list = list.map((r) => ({ ...r, feedback: tallyFb[r.req_id] || { open: 0, done: 0, ids: [] }, orders: tallyWo[r.req_id] || { n: 0, ids: [] }, screen_titles: r.screens.map((k) => { const s = REG.BY_KEY.get(k); return s ? { key: k, ko: s.ko, en: s.en, route: s.route } : { key: k }; }) }));
  if (cat) list = list.filter((r) => r.category === cat);
  if (status) list = list.filter((r) => r.impl_status === status);
  if (verify) list = list.filter((r) => r.verify_status === verify);
  if (screen) list = list.filter((r) => r.screens.includes(screen));
  if (open) list = list.filter((r) => r.feedback.open > 0);
  if (text) { const t = String(text).toLowerCase(); list = list.filter((r) => `${r.req_id} ${r.name} ${r.evidence} ${r.notes}`.toLowerCase().includes(t)); }
  return list;
}

// ───────── 완료 게이트(G0~G8): 모두 저장소/파일/로그에서 계산한다(고정 문구 아님) ─────────
function gates() {
  const t = summary(); const out = [];
  const exists = (f) => fs.existsSync(path.join(ROOT, f));
  const G_ = (id, ko, en, status, value, detail_ko, detail_en) => out.push({ id, ko, en, status, value, detail_ko, detail_en });
  const dup = q.get('SELECT COUNT(*) c FROM (SELECT req_id FROM ax_rtm GROUP BY req_id HAVING COUNT(*)>1)').c;
  G_('G0', 'RFP 원장', 'RFP ledger', t.total === 150 && !dup ? 'PASS' : 'FAIL', `${t.total}/150`, 'RFP에서 추출한 요구사항 150건이 고유 ID로 RTM에 적재되었는지', 'All 150 RFP requirements loaded with unique IDs');
  G_('G1', '메뉴/화면 연결', 'Menu/screen linkage', t.screen_link_pct >= 85 ? 'PASS' : 'WARN', `${t.screen_link_pct}%`, '범위 내 요구사항 중 화면·시스템 요소에 연결된 비율(기준 85%)', 'Share of in-scope requirements linked to a screen/system element (threshold 85%)');
  const docs = ['docs/02_ARCHITECTURE.md', 'docs/04_DATA_MODEL.md', 'docs/05_API_CONTRACT.md', 'docs/08_SECURITY.md', 'docs/11_RFP_TRACEABILITY.md'].filter(exists).length;
  G_('G2', '데이터·설계 문서', 'Data & design docs', docs === 5 ? 'PASS' : 'WARN', `${docs}/5`, '아키텍처·데이터모델·API·보안·추적성 문서 존재', 'Architecture, data model, API, security, traceability docs exist');
  const { routes } = require('../router');
  const hasOpen = routes.some((r) => r.pattern === '/open-api/v1/:dataset'); const hasHealth = routes.some((r) => r.pattern === '/api/health');
  G_('G3', 'API/연계', 'API & integration', hasOpen && hasHealth ? 'PASS' : 'FAIL', `${routes.length} routes`, 'Open API(JSON/XML)·Health·연계 이벤트(Mock) 라우트 등록', 'Open API, health and (mock) integration routes registered');
  const last = q.get('SELECT batch_id b FROM eval_results ORDER BY rowid DESC LIMIT 1');
  if (last) { const e = q.get('SELECT COUNT(*) n, SUM(passed) p FROM eval_results WHERE batch_id=?', last.b); const pct = e.n ? U.round((e.p / e.n) * 100) : 0; G_('G4', 'AI/자동화', 'AI & automation', pct >= 90 ? 'PASS' : 'WARN', `${pct}%`, `최근 AI 자동평가(${last.b}) 통과율(기준 90%)`, `Latest AI auto-evaluation pass rate (${last.b}, threshold 90%)`); }
  else G_('G4', 'AI/자동화', 'AI & automation', 'WARN', 'n/a', 'AI 자동평가 결과가 아직 없습니다(관리자 > AI Operations에서 실행)', 'No AI evaluation run yet (run it in Admin > AI Operations)');
  const testFiles = fs.existsSync(path.join(ROOT, 'test')) ? fs.readdirSync(path.join(ROOT, 'test')).filter((f) => f.endsWith('.test.js')) : [];
  const nTests = testFiles.reduce((a, f) => a + (fs.readFileSync(path.join(ROOT, 'test', f), 'utf8').match(/^test\(/gm) || []).length, 0);
  const impl = rows().filter((r) => r.impl_status === 'IMPLEMENTED'); const withTests = impl.filter((r) => r.tests.length).length; const tp = impl.length ? U.round((withTests / impl.length) * 100) : 0;
  G_('G5', '테스트', 'Testing', nTests >= 7 && tp >= 40 ? 'PASS' : 'WARN', `${nTests} tests · ${tp}%`, `자동 테스트 ${nTests}건, 완전 구현 요구사항 중 테스트 연결 ${withTests}/${impl.length}건(기준 40%)`, `${nTests} automated tests; ${withTests}/${impl.length} implemented requirements linked to a test (threshold 40%)`);
  const chain = G.verifyAuditChain(); const lat = q.get("SELECT COUNT(*) n, SUM(CASE WHEN ms>3000 THEN 1 ELSE 0 END) slow FROM api_logs WHERE path LIKE '/api/%'");
  G_('G6', '보안·성능', 'Security & performance', chain.ok && !(lat.slow > 0) ? 'PASS' : chain.ok ? 'WARN' : 'FAIL', chain.ok ? `chain OK · ${lat.slow || 0} slow` : 'chain BROKEN', `감사 해시체인 무결성 ${chain.ok ? '정상' : '훼손'}, 3초 초과 API ${lat.slow || 0}건/${lat.n}건`, `Audit hash-chain ${chain.ok ? 'intact' : 'BROKEN'}; ${lat.slow || 0} of ${lat.n} API calls exceeded 3s`);
  const docCount = fs.existsSync(path.join(ROOT, 'docs')) ? fs.readdirSync(path.join(ROOT, 'docs')).filter((f) => f.endsWith('.md')).length : 0;
  G_('G7', '산출물', 'Deliverables', docCount >= 12 ? 'PASS' : 'WARN', `${docCount} docs`, '설계·운영·검수 문서 패키지(기준 12건)', 'Design, operations and acceptance document set (threshold 12)');
  const p1 = q.get("SELECT COUNT(*) c FROM ax_feedback WHERE priority='P1' AND status IN ('SUBMITTED','NEEDS_INFO','APPROVED','REOPENED')").c; const acc = q.get("SELECT COUNT(*) c FROM ax_orders WHERE status='ACCEPTED'").c;
  G_('G8', 'UAT·현업 확인', 'UAT & acceptance', p1 === 0 && acc > 0 ? 'PASS' : p1 === 0 ? 'INFO' : 'WARN', `P1 open ${p1} · accepted ${acc}`, `미해결 P1 피드백 ${p1}건, 현업 확인 완료 작업 ${acc}건`, `${p1} open P1 feedback; ${acc} work orders accepted by business users`);
  return out;
}

module.exports = { rebuildRtm, summary, snapshot, rows, gates, IMPL };
