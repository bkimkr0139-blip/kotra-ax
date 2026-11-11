'use strict';
// AX개발(피드백·RTM·게이트·제안·컨소시엄) + AXOS(폐루프 자동개발) API.  docs/15_AX_DEV_LOOP.md
const { api } = require('../router');
const { q } = require('../db');
const U = require('../util');
const A = require('../auth');
const G = require('../gov');
const REG = require('../axdev/registry');
const RTM = require('../axdev/rtm');
const LOOP = require('../axdev/loop');
const SUP = require('../axdev/support');

const MEMBER = ['customer', 'buyer', 'consultant', 'office', 'admin'];
const STAFF = ['consultant', 'office', 'admin'];
const REVIEWER = ['admin', 'consultant'];
const ADMIN = ['admin'];
const isStaff = (u) => STAFF.includes(u.role);
const isReviewer = (u) => REVIEWER.includes(u.role);
const enabled = () => process.env.AX_DEV_DOCK !== 'false';
const guardOn = () => { if (!enabled()) throw new U.HttpError(404, 'NOT_FOUND', 'AX개발 기능이 비활성화되어 있습니다'); };

// ── 화면 카탈로그 ────────────────────────────────────────────
function fbCounts(user) {
  const staff = isReviewer(user); const where = staff ? '' : 'WHERE author_id=?';
  const rows = q.all(`SELECT screen_key k, status s, COUNT(*) c FROM ax_feedback ${where} GROUP BY screen_key, status`, ...(staff ? [] : [user.id]));
  const m = {};
  for (const r of rows) { const t = (m[r.k] = m[r.k] || { total: 0, open: 0, done: 0 }); t.total += r.c; if (['SUBMITTED', 'NEEDS_INFO', 'APPROVED', 'REOPENED'].includes(r.s)) t.open += r.c; if (r.s === 'DONE') t.done += r.c; }
  return m;
}
function screenView(s, user, counts) {
  const base = { key: s.key, route: s.route, group: s.group, kind: s.kind, ko: s.ko, en: s.en, features: s.features, feedback: counts[s.key] || { total: 0, open: 0, done: 0 } };
  if (isStaff(user)) { base.file = s.file; base.api = s.api; }
  return base;
}
api.get('/api/ax/screens', (ctx) => {
  guardOn(); const counts = fbCounts(ctx.user); const reqs = q.all('SELECT req_id,screens FROM ax_rtm');
  const reqBy = {}; reqs.forEach((r) => U.parse(r.screens, []).forEach((k) => { (reqBy[k] = reqBy[k] || []).push(r.req_id); }));
  return { groups: REG.GROUPS, screens: REG.SCREENS.map((s) => ({ ...screenView(s, ctx.user, counts), req_ids: reqBy[s.key] || [] })), kinds: LOOP.KINDS };
}, { roles: MEMBER });

api.get('/api/ax/context', (ctx) => {
  guardOn(); const s = REG.matchRoute(ctx.query.route); if (!s) return { screen: null, kinds: LOOP.KINDS };
  const counts = fbCounts(ctx.user);
  const reqs = RTM.rows({ screen: s.key }).map((r) => ({ req_id: r.req_id, name: r.name, impl_status: r.impl_status, verify_status: r.verify_status }));
  const recent = LOOP.listFeedback(ctx.user, { screen: s.key, limit: 8 }).map((f) => ({ id: f.id, title: f.title, status: f.status, priority: f.priority, kind: f.kind, feature_id: f.feature_id, author_name: isReviewer(ctx.user) || f.author_id === ctx.user.id ? f.author_name : undefined, mine: f.author_id === ctx.user.id, created_at: f.created_at, order_id: f.order_id }));
  return { screen: screenView(s, ctx.user, counts), reqs, recent, kinds: LOOP.KINDS, can_review: isReviewer(ctx.user) };
}, { roles: MEMBER });

// ── 피드백 ───────────────────────────────────────────────────
api.get('/api/ax/feedback', (ctx) => { guardOn(); const items = LOOP.listFeedback(ctx.user, { screen: ctx.query.screen, status: ctx.query.status, mine: ctx.query.mine === '1', qtext: ctx.query.q, limit: ctx.query.limit }); return { items, total: items.length, staff: isReviewer(ctx.user) }; }, { roles: MEMBER });
api.post('/api/ax/feedback', (ctx) => { guardOn(); return LOOP.createFeedback(ctx, ctx.body); }, { roles: MEMBER });
api.get('/api/ax/feedback/similar', (ctx) => { guardOn(); const s = REG.BY_KEY.get(ctx.query.screen) || REG.matchRoute(ctx.query.route); return { items: s ? LOOP.similar(s.key, ctx.query.title || '', ctx.query.to_be || '', '') : [] }; }, { roles: MEMBER });
api.get('/api/ax/feedback/:id', (ctx) => {
  guardOn(); const f = LOOP.getFeedback(ctx.params.id); if (!f) throw U.notFound('Feedback not found'); if (!LOOP.visibleTo(ctx.user, f)) throw U.forbidden('본인 피드백만 조회할 수 있습니다 / Not your feedback');
  const order = f.order_id ? LOOP.getOrder(f.order_id, isReviewer(ctx.user)) : null; const screen = REG.BY_KEY.get(f.screen_key);
  const reqs = q.all('SELECT req_id,name,impl_status,verify_status FROM ax_rtm').filter((r) => f.rfp_ids.includes(r.req_id));
  const orders = q.all('SELECT id,status,rev,created_at FROM ax_orders WHERE feedback_id=? ORDER BY created_at', f.id);
  const res = { ...f, screen: screen && { key: screen.key, ko: screen.ko, en: screen.en, route: screen.route, features: screen.features }, order, orders, reqs, events: LOOP.events('feedback', f.id).concat(order ? LOOP.events('order', order.id) : []).sort((a, b) => a.id - b.id) };
  if (!isReviewer(ctx.user)) { delete res.similar; if (res.review) res.review = { decision: res.review.decision, note: res.review.note, at: res.review.at }; }
  return res;
}, { roles: MEMBER });
api.post('/api/ax/feedback/:id/review', (ctx) => { guardOn(); return LOOP.review(ctx, ctx.params.id, ctx.body); }, { roles: REVIEWER });
api.post('/api/ax/feedback/:id/respond', (ctx) => { guardOn(); return LOOP.respond(ctx, ctx.params.id, ctx.body); }, { roles: MEMBER });
api.post('/api/ax/feedback/:id/withdraw', (ctx) => { guardOn(); return LOOP.withdraw(ctx, ctx.params.id); }, { roles: MEMBER });
api.post('/api/ax/feedback/:id/comment', (ctx) => { guardOn(); return LOOP.comment(ctx, ctx.params.id, ctx.body.text); }, { roles: MEMBER });

api.get('/api/ax/changelog', (ctx) => {
  guardOn(); const rows = q.all('SELECT * FROM ax_releases ORDER BY at DESC, id DESC LIMIT 100');
  return { items: rows.map((r) => ({ ...r, files: U.parse(r.files, []), rfp_ids: U.parse(r.rfp_ids, []), screen: (() => { const o = q.get('SELECT screen_key k FROM ax_orders WHERE id=?', r.order_id); const s = o && REG.BY_KEY.get(o.k); return s ? { key: s.key, ko: s.ko, en: s.en, route: s.route } : null; })() })) };
}, { auth: false });

// ── 개요 · RTM · 게이트 · 백로그 ─────────────────────────────
api.get('/api/ax/overview', (ctx) => {
  guardOn(); const m = LOOP.metrics(); const gates = RTM.gates(); const st = LOOP.settings();
  const recent = q.all('SELECT * FROM ax_events ORDER BY id DESC LIMIT 14').map((e) => ({ ...e, detail: U.parse(e.detail, {}) }));
  const snaps = q.all('SELECT * FROM ax_rtm_snapshots ORDER BY at DESC, id DESC LIMIT 12').reverse().map((s) => ({ id: s.id, at: s.at, totals: U.parse(s.totals, {}) }));
  const byGroup = {}; for (const s of REG.SCREENS) { const g = (byGroup[s.group] = byGroup[s.group] || { screens: 0 }); g.screens++; }
  return { metrics: m, rtm: RTM.summary(), gates, gate_pass: gates.filter((g) => g.status === 'PASS').length, axos: { mode: st.mode, worker: LOOP.workerStatus(), token_configured: LOOP.tokenConfigured() }, recent, snapshots: snaps, screens: REG.SCREENS.filter((s) => s.kind === 'screen').length, features: REG.SCREENS.reduce((a, s) => a + s.features.length, 0) };
}, { roles: STAFF });
api.get('/api/ax/rtm', (ctx) => { guardOn(); const rows = RTM.rows({ cat: ctx.query.cat, status: ctx.query.status, verify: ctx.query.verify, q: ctx.query.q, screen: ctx.query.screen, open: ctx.query.open === '1' }); return { summary: RTM.summary(), items: rows }; }, { roles: STAFF });
api.get('/api/ax/rtm/snapshots', () => ({ items: q.all('SELECT * FROM ax_rtm_snapshots ORDER BY at DESC, id DESC LIMIT 50').map((s) => ({ ...s, totals: U.parse(s.totals, {}) })) }), { roles: STAFF });
api.post('/api/ax/rtm/rebuild', (ctx) => { guardOn(); return RTM.rebuildRtm(ctx, String(ctx.body.note || '').slice(0, 120)); }, { roles: ADMIN });
api.get('/api/ax/rtm/:id', (ctx) => {
  const r = RTM.rows().find((x) => x.req_id === ctx.params.id.toUpperCase()); if (!r) throw U.notFound('Requirement not found');
  const cov = q.get('SELECT detail FROM rfp_coverage WHERE id=?', r.req_id); const fbs = q.all('SELECT id,title,status,priority,screen_key,created_at FROM ax_feedback').filter((f) => r.feedback.ids.includes(f.id));
  return { ...r, rfp_detail: cov ? String(cov.detail || '').slice(0, 1800) : '', feedback_items: fbs, orders: q.all('SELECT id,title,status,risk FROM ax_orders').filter((o) => r.orders.ids.includes(o.id)) };
}, { roles: STAFF });
api.patch('/api/ax/rtm/:id', (ctx) => {
  guardOn(); const id = ctx.params.id.toUpperCase(); const cur = q.get('SELECT * FROM ax_rtm WHERE req_id=?', id); if (!cur) throw U.notFound('Requirement not found');
  const b = ctx.body; const patch = { updated_at: U.iso() };
  if (b.owner !== undefined) patch.owner = String(b.owner).slice(0, 60);
  if (b.verify_status !== undefined) { if (!['UNVERIFIED', 'VERIFIED', 'FAILED'].includes(b.verify_status)) throw U.bad('verify_status 값이 올바르지 않습니다', 'VALIDATION'); patch.verify_status = b.verify_status; patch.verified_by = ctx.user.id; patch.verified_at = U.iso(); patch.verify_note = String(b.verify_note || '').slice(0, 300); }
  q.update('ax_rtm', id, patch, 'req_id'); G.audit(ctx, 'ax.rtm.update', 'ax_rtm', id, { owner: patch.owner, verify: patch.verify_status, from: cur.verify_status });
  return { ok: true };
}, { roles: REVIEWER });
api.get('/api/ax/gates', () => ({ items: RTM.gates() }), { roles: STAFF });
api.get('/api/ax/backlog', () => {
  const reqs = RTM.rows().filter((r) => ['PARTIAL', 'MOCK', 'DESIGN_ONLY'].includes(r.impl_status)).map((r) => ({ type: 'REQ', id: r.req_id, title: r.name, status: r.impl_status, note: r.notes, open_feedback: r.feedback.open, screens: r.screen_titles }));
  const fb = LOOP.listFeedback({ role: 'admin', id: '-' }, { status: 'SUBMITTED,NEEDS_INFO,APPROVED,REOPENED', limit: 300 }).map((f) => ({ type: 'FEEDBACK', id: f.id, title: f.title, status: f.status, priority: f.priority, screen: f.screen_title, order_id: f.order_id }));
  const out = q.count('ax_rtm', "WHERE impl_status='OUT_OF_MVP'");
  return { requirements: reqs, feedback: fb, out_of_mvp: out };
}, { roles: STAFF });

// ── 제안·입찰 지원 ───────────────────────────────────────────
const PROPOSAL = ['admin', 'consultant', 'office'];
api.get('/api/ax/proposal/answers', (ctx) => { const items = SUP.answers({ cat: ctx.query.cat, status: ctx.query.status, q: ctx.query.q }); const by = {}; items.forEach((a) => { by[a.stance_ko] = (by[a.stance_ko] || 0) + 1; }); return { items, total: items.length, by_stance: by }; }, { roles: PROPOSAL });
api.get('/api/ax/proposal/answers.csv', (ctx) => { G.audit(ctx, 'ax.proposal.export', 'rtm', 'answers.csv', {}); return { __raw: true, type: 'text/csv; charset=utf-8', headers: { 'content-disposition': 'attachment; filename="kotra-ax-rfp-answers.csv"' }, body: SUP.answersCsv() }; }, { roles: PROPOSAL });
api.get('/api/ax/proposal/evidence', () => SUP.evidencePack(), { roles: PROPOSAL });
api.get('/api/ax/proposal/checklist', () => ({ items: SUP.listChecklist(), states: SUP.CHECK_STATES }), { roles: PROPOSAL });
api.patch('/api/ax/proposal/checklist/:id', (ctx) => SUP.patchChecklist(ctx, ctx.params.id, ctx.body), { roles: REVIEWER });
api.get('/api/ax/proposal/qna', () => ({ items: SUP.listQna() }), { roles: PROPOSAL });
api.post('/api/ax/proposal/qna', (ctx) => SUP.createQna(ctx, ctx.body), { roles: REVIEWER });
api.patch('/api/ax/proposal/qna/:id', (ctx) => SUP.patchQna(ctx, ctx.params.id, ctx.body), { roles: REVIEWER });

// ── 컨소시엄 ─────────────────────────────────────────────────
api.get('/api/ax/consortium', () => SUP.consortium(), { roles: REVIEWER });
api.put('/api/ax/consortium/raci', (ctx) => SUP.setRaci(ctx, ctx.body), { roles: ADMIN });
api.patch('/api/ax/consortium/staff/:id', (ctx) => SUP.setPledge(ctx, ctx.params.id, ctx.body.pledge), { roles: ADMIN });

// ───────────────────────── AXOS ─────────────────────────
api.get('/api/axos/state', () => {
  const m = LOOP.metrics(); const st = LOOP.settings();
  const queue = LOOP.listOrders({ status: 'QUEUED,IN_PROGRESS,FAILED,REPORTED', limit: 50 });
  return { settings: st, in_window: LOOP.inWindow(st.schedule), worker: LOOP.workerStatus(), token_configured: LOOP.tokenConfigured(), env_token: !!process.env.AXOS_WORKER_TOKEN, metrics: m, queue, guardrails: LOOP.DEFAULT_GUARDRAILS, recent: q.all('SELECT * FROM ax_events WHERE ref_type=? ORDER BY id DESC LIMIT 20', 'order').map((e) => ({ ...e, detail: U.parse(e.detail, {}) })), rtm: RTM.summary(), releases: q.all('SELECT * FROM ax_releases ORDER BY at DESC, id DESC LIMIT 8') };
}, { roles: REVIEWER });
api.put('/api/axos/settings', (ctx) => {
  if (ctx.body.mode === 'AUTO' && ctx.body.confirm !== true) throw U.bad('AUTO(상시 자동개발) 전환에는 confirm:true가 필요합니다', 'CONFIRM_REQUIRED');
  return LOOP.saveSettings(ctx, ctx.body);
}, { roles: ADMIN });
api.post('/api/axos/worker/token', (ctx) => { if (ctx.body.confirm !== true) throw U.bad('토큰 재발급에는 confirm:true가 필요합니다', 'CONFIRM_REQUIRED'); return { token: LOOP.rotateToken(ctx), note: '이 토큰은 지금 한 번만 표시됩니다. 안전한 곳에 보관하세요 / Shown once only' }; }, { roles: ADMIN });
api.get('/api/axos/orders', (ctx) => ({ items: LOOP.listOrders({ status: ctx.query.status, limit: Number(ctx.query.limit) || 100 }) }), { roles: REVIEWER });
api.get('/api/axos/orders/:id', (ctx) => {
  const o = LOOP.getOrder(ctx.params.id, true); if (!o) throw U.notFound('Work order not found');
  if (!isReviewer(ctx.user)) { const fb = LOOP.getFeedback(o.feedback_id); if (!fb || fb.author_id !== ctx.user.id) throw U.forbidden(); delete o.instruction_md; }
  return { ...o, events: LOOP.events('order', o.id) };
}, { roles: MEMBER });
for (const act of ['dispatch', 'start', 'cancel', 'requeue', 'report']) api.post(`/api/axos/orders/:id/${act}`, (ctx) => LOOP.orderAction(ctx, ctx.params.id, act, ctx.body), { roles: ADMIN });
api.post('/api/axos/orders/:id/accept', (ctx) => LOOP.accept(ctx, ctx.params.id, ctx.body), { roles: MEMBER });
api.post('/api/axos/orders/:id/reopen', (ctx) => LOOP.reopen(ctx, ctx.params.id, ctx.body), { roles: MEMBER });
api.post('/api/axos/release-stale', (ctx) => ({ released: LOOP.releaseStale(ctx) }), { roles: ADMIN });

// Worker API — 토큰 인증(쿠키 세션 아님). 개발 PC/CI에서 scripts/axos-worker.js 가 호출한다.
function workerCtx(ctx) {
  if (!LOOP.tokenConfigured()) throw new U.HttpError(503, 'AXOS_TOKEN_NOT_CONFIGURED', 'Worker 토큰이 설정되지 않았습니다(관리자: AXOS > Worker 토큰 발급)');
  if (!A.rateLimit(`axtok:${ctx.ip}`, 60, 60000)) throw new U.HttpError(429, 'RATE_LIMITED', 'Too many requests');
  const h = String(ctx.req.headers.authorization || ''); const tok = h.startsWith('Bearer ') ? h.slice(7) : String(ctx.req.headers['x-axos-token'] || '');
  if (!LOOP.checkToken(tok)) { G.audit({ user: null, ip: ctx.ip }, 'axos.worker.denied', 'axos', 'worker', {}); throw new U.HttpError(401, 'AXOS_TOKEN_INVALID', 'Invalid worker token'); }
  const id = String(ctx.body.worker || 'worker').replace(/[^\w.\-@]/g, '').slice(0, 60) || 'worker';
  return { ...ctx, user: { id: 'axos-worker', role: 'worker', name: `AXOS Worker (${id})` }, workerId: id };
}
api.post('/api/axos/worker/heartbeat', (ctx) => { const w = workerCtx(ctx); LOOP.heartbeat(w.workerId, { phase: String(ctx.body.phase || 'idle').slice(0, 40) }); const st = LOOP.settings(); return { ok: true, mode: st.mode, in_window: LOOP.inWindow(st.schedule) }; });
api.post('/api/axos/worker/claim', (ctx) => { const w = workerCtx(ctx); return LOOP.claim(w, w.workerId, { orderId: ctx.body.order_id }); });
api.post('/api/axos/worker/orders/:id/report', (ctx) => { const w = workerCtx(ctx); return LOOP.report(w, ctx.params.id, { ...ctx.body, worker: w.workerId }); });
