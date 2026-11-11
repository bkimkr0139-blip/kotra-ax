'use strict';
const { api } = require('../router');
const { q, nextId, hyd, hydAll } = require('../db');
const U = require('../util');
const G = require('../gov');
const A = require('../auth');
const S = require('../domain/services');
const SC = require('../domain/scoring');
const T = require('../ai/tools');
const { COUNTRIES, PRODUCTS } = require('../seed/catalog');
const CBY = Object.fromEntries(COUNTRIES.map((c) => [c.code, c]));
const PBY = Object.fromEntries(PRODUCTS.map((p) => [p.key, p]));

const CUST = ['customer', 'admin'];
const MEMBER = ['customer', 'buyer', 'consultant', 'office', 'admin'];
const like = (s, qn) => String(s || '').toLowerCase().includes(String(qn).toLowerCase());
const page = (rows, query, def = 12) => { const size = Math.min(60, Number(query.size) || def); const pg = Math.max(1, Number(query.page) || 1); return { items: rows.slice((pg - 1) * size, pg * size), total: rows.length, page: pg, pages: Math.max(1, Math.ceil(rows.length / size)), size }; };
const myCompany = (ctx) => { const c = S.companyOf(ctx.user); if (!c) throw U.forbidden('This account has no company profile', 'NO_COMPANY'); return c; };

// ---------- MyKOTRA cockpit ----------
api.get('/api/dashboard', (ctx) => {
  const u = ctx.user;
  if (u.role === 'buyer') {
    const buyer = hyd(q.get('SELECT * FROM buyers WHERE id=?', u.buyer_id));
    const matches = hydAll(q.all('SELECT * FROM match_requests WHERE buyer_id=? ORDER BY created_at DESC', u.buyer_id));
    return { role: 'buyer', buyer, kpis: { pending: matches.filter((m) => m.status === 'REQUESTED' && m.initiator === 'COMPANY').length, scheduled: matches.filter((m) => m.status === 'SCHEDULED').length, events: q.count('event_participants', "WHERE kind='BUYER' AND ref_id=? AND status='APPROVED'", u.buyer_id) }, matches: matches.slice(0, 8) };
  }
  if (u.role !== 'customer' && u.role !== 'admin') return { role: u.role };
  const company = myCompany(ctx);
  const project = S.primaryProject(company.id);
  const journey = project ? project.journey : {};
  const steps = S.STEP_NAMES.map(([n, ko, en]) => ({ step: n, ko, en, state: journey[n] || 'NOT_STARTED' }));
  const tm = company.target_markets || [];
  const progs = S.recommendPrograms(company, { limit: 12 });
  const open = progs.filter((p) => p.live_status === 'OPEN' && p.recommend >= 60);
  const buyers = S.recommendBuyers(company, { country: tm[0], limit: 8, user: u });
  const regs = q.count('regulations', 'WHERE country=? AND industry=?', tm[0], company.product_keys[0]);
  const consults = q.all("SELECT * FROM consultations WHERE company_id=? ORDER BY created_at DESC", company.id);
  const matches = hydAll(q.all('SELECT * FROM match_requests WHERE company_id=? ORDER BY updated_at DESC', company.id));
  const received = matches.filter((m) => m.status === 'REQUESTED' && m.initiator === 'BUYER');
  const drafts = q.all("SELECT a.*, p.title_ko, p.title_en FROM applications a JOIN programs p ON p.id=a.program_id WHERE a.company_id=? AND a.status IN ('DRAFT','READY_FOR_REVIEW','APPROVAL_REQUIRED')", company.id);
  const pendingAp = q.all("SELECT * FROM approvals WHERE status='PENDING' AND approver_role='self' AND requester_id=?", u.id);
  const hs = (company.hs_code || '').slice(0, 4);
  const marketRank = q.all('SELECT country, export_usd_m, yoy FROM trade_stats WHERE hs_prefix=? AND year=(SELECT MAX(year) FROM trade_stats) ORDER BY export_usd_m DESC LIMIT 10', hs).map((r) => ({ ...r, name_ko: CBY[r.country]?.ko, name_en: CBY[r.country]?.en, in_target: tm.includes(r.country) }));
  const next = [];
  const jStep = (n) => journey[n] || 'NOT_STARTED';
  const tmName = (L) => (tm[0] ? (L === 'en' ? CBY[tm[0]].en : CBY[tm[0]].ko) : '');
  if (pendingAp.length) next.push({ id: 'approval', priority: 'HIGH', ko: `승인 대기 ${pendingAp.length}건: 내용을 확인하고 최종 승인해 주세요.`, en: `${pendingAp.length} approval(s) waiting for your confirmation.`, evidence: pendingAp.length, buttons: [{ ko: '승인 확인', en: 'Review', href: '#/mykotra/approvals' }] });
  if (received.length) next.push({ id: 'match-in', priority: 'HIGH', ko: `바이어 상담 신청 ${received.length}건이 도착했습니다. 수락 또는 반려해 주세요.`, en: `${received.length} buyer meeting request(s) received. Accept or decline.`, evidence: received.length, buttons: [{ ko: '상담 신청 확인', en: 'View requests', href: '#/mykotra/matching' }] });
  if (jStep(3) !== 'DONE') next.push({ id: 'reg', priority: 'HIGH', ko: `${tmName('ko')} ${company.product_keys[0] ? PBY[company.product_keys[0]].ko : ''} 시장 진입 전에 제품 등록·인증 요건을 확인하세요.`, en: `Before entering ${tmName('en')}, confirm product registration and certification requirements.`, evidence: regs, evidence_label: { ko: `규제정보 ${regs}건`, en: `${regs} regulation records` }, buttons: [{ ko: 'AI에게 확인', en: 'Ask AI', ai: `${tmName('ko')} ${PBY[company.product_keys[0]]?.ko || ''} 수출 규제·인증 체크리스트를 만들어줘` }, { ko: '체크리스트 생성', en: 'Create checklist', ai: `${tmName('ko')} ${PBY[company.product_keys[0]]?.ko || ''} 규제 체크리스트 만들어줘` }, { ko: '전문가 상담', en: 'Expert consulting', href: '#/consult/new' }] });
  if (buyers.length) next.push({ id: 'buyer', priority: jStep(4) === 'DONE' ? 'LOW' : 'MEDIUM', ko: `적합 바이어 ${buyers.length}곳을 검토하세요. 1순위: ${buyers[0].name} (AI Match ${buyers[0].score})`, en: `Review ${buyers.length} well-matched buyers. Top: ${buyers[0].name} (AI Match ${buyers[0].score})`, evidence: buyers.length, buttons: [{ ko: '바이어 보기', en: 'View buyers', href: '#/buyers/recommend' }, { ko: 'AI에게 확인', en: 'Ask AI', ai: `${tmName('ko')} 바이어를 추천해줘` }] });
  if (open.length) { const soon = open.filter((p) => p.d_day != null && p.d_day <= 14).sort((a, b) => a.d_day - b.d_day)[0]; next.push({ id: 'program', priority: soon && soon.d_day <= 7 ? 'HIGH' : 'MEDIUM', ko: `신청 가능한 지원사업 ${open.length}건${soon ? ` — "${soon.title_ko}" 마감 D-${soon.d_day}` : ''}`, en: `${open.length} programs you can apply to${soon ? ` — "${soon.title_en}" closes in ${soon.d_day} days` : ''}`, evidence: open.length, buttons: [{ ko: '맞춤 사업 보기', en: 'View programs', href: '#/programs/recommend' }, { ko: '신청 초안', en: 'Draft application', href: soon ? `#/programs/${soon.id}` : '#/programs' }] }); }
  if (drafts.length) next.push({ id: 'draft', priority: 'MEDIUM', ko: `작성 중인 신청서 ${drafts.length}건을 마무리하세요.`, en: `Finish ${drafts.length} application(s) in progress.`, evidence: drafts.length, buttons: [{ ko: '신청 현황', en: 'My applications', href: '#/mykotra/applications' }] });
  const act = consults.filter((c) => ['ASSIGNED', 'IN_PROGRESS', 'AI_CLASSIFIED', 'OPEN'].includes(c.status));
  if (act.length) next.push({ id: 'consult', priority: 'LOW', ko: `진행 중인 상담 ${act.length}건의 답변 현황을 확인하세요.`, en: `Check progress of ${act.length} ongoing consultation(s).`, evidence: act.length, buttons: [{ ko: '상담 이력', en: 'Consultations', href: '#/mykotra/consults' }] });
  const rank = { HIGH: 0, MEDIUM: 1, LOW: 2 }; next.sort((a, b) => rank[a.priority] - rank[b.priority]);
  const latest = hydAll(q.all("SELECT id,type,country,title_ko,title_en,published_at FROM market_content WHERE country IN (" + (tm.length ? tm.map(() => '?').join(',') : "'XX'") + ') ORDER BY published_at DESC LIMIT 5', ...tm));
  const scheduled = matches.filter((m) => m.status === 'SCHEDULED').map((m) => ({ ...m, buyer: q.get('SELECT name FROM buyers WHERE id=?', m.buyer_id), event: q.get('SELECT title_ko,title_en,start_date FROM events WHERE id=?', m.event_id) }));
  const saved = q.all("SELECT * FROM saved_items WHERE user_id=? ORDER BY created_at DESC LIMIT 5", u.id);
  return {
    role: 'customer', company, project, steps,
    kpis: { readiness: company.readiness || SC.readiness(company, journey), target_markets: tm.map((c) => ({ code: c, ko: CBY[c]?.ko, en: CBY[c]?.en })), recommended_markets: marketRank.filter((m) => m.in_target || true).slice(0, 5).length, recommended_buyers: buyers.length, programs_available: open.length, consults_active: act.length, open_actions: next.length },
    next_actions: next, market_ranking: marketRank.slice(0, 6), latest_content: latest, closing_programs: progs.filter((p) => p.live_status === 'OPEN' && p.d_day != null).sort((a, b) => a.d_day - b.d_day).slice(0, 4),
    top_buyers: buyers.slice(0, 4), scheduled_meetings: scheduled.slice(0, 4), received_requests: received.length, saved, ai_findings: [{ ko: `${tmName('ko')} 시장 관련 신규 콘텐츠 ${latest.length}건 등록`, en: `${latest.length} new content items for ${tmName('en')}` }, { ko: '규제 확인 단계가 아직 완료되지 않았습니다 — 리스크', en: 'Regulation step is not complete yet — risk', risk: jStep(3) !== 'DONE' }].filter((x) => x.risk !== false),
    synthetic_note: { ko: '시장 순위는 시연용 합성 통계 기반입니다.', en: 'Market ranking is based on synthetic demo statistics.' },
  };
}, { roles: MEMBER });

api.put('/api/company', (ctx) => {
  const company = myCompany(ctx); const b = ctx.body; const patch = {};
  for (const k of ['name', 'name_en', 'industry', 'industry_en', 'product', 'product_en', 'hs_code', 'size', 'website', 'description', 'description_en', 'export_experience', 'region']) if (b[k] !== undefined) patch[k] = String(b[k]).slice(0, 600);
  if (b.employees !== undefined) patch.employees = Math.max(0, Math.min(100000, Number(b.employees) || 0));
  if (b.export_stage && SC.GROUP_LABEL[b.export_stage]) patch.export_stage = b.export_stage;
  if (Array.isArray(b.target_markets)) patch.target_markets = JSON.stringify(b.target_markets.filter((c) => CBY[c]).slice(0, 8));
  if (Array.isArray(b.product_keys)) patch.product_keys = JSON.stringify(b.product_keys.filter((k) => PBY[k]).slice(0, 5));
  if (Array.isArray(b.hashtags)) patch.hashtags = JSON.stringify(b.hashtags.slice(0, 10).map((h) => String(h).slice(0, 30)));
  if (patch.hs_code && !/^\d{4}(\.\d{2}){0,2}$/.test(patch.hs_code)) throw U.bad('HS code format: 3304 or 3304.99', 'VALIDATION');
  if (patch.website && !/^https?:\/\//.test(patch.website)) throw U.bad('Website must start with http(s)://', 'VALIDATION');
  if (!Object.keys(patch).length) throw U.bad('No editable fields');
  patch.updated_at = U.iso();
  q.update('companies', company.id, patch);
  const fresh = S.getCompany(company.id);
  q.update('companies', company.id, { readiness: SC.readiness(fresh, (S.primaryProject(company.id) || {}).journey) });
  G.audit(ctx, 'company.updated', 'company', company.id, { fields: Object.keys(patch) });
  return { company: S.getCompany(company.id) };
}, { roles: CUST });
api.get('/api/projects', (ctx) => ({ items: hydAll(q.all('SELECT * FROM export_projects WHERE company_id=?', myCompany(ctx).id)) }), { roles: CUST });
api.put('/api/projects/:id', (ctx) => {
  const pr = hyd(q.get('SELECT * FROM export_projects WHERE id=?', ctx.params.id)); if (!pr || pr.company_id !== myCompany(ctx).id) throw U.notFound();
  const b = ctx.body; const patch = { updated_at: U.iso() };
  if (b.goal) patch.goal = String(b.goal).slice(0, 300); if (b.name) patch.name = String(b.name).slice(0, 100); if (b.country && CBY[b.country]) patch.country = b.country;
  if (b.step && b.state && ['NOT_STARTED', 'IN_PROGRESS', 'DONE', 'WARNING'].includes(b.state) && b.step >= 1 && b.step <= 7) { const j = pr.journey; j[b.step] = b.state; patch.journey = JSON.stringify(j); }
  q.update('export_projects', pr.id, patch); G.audit(ctx, 'project.updated', 'project', pr.id, { keys: Object.keys(patch) });
  q.update('companies', pr.company_id, { readiness: SC.readiness(S.getCompany(pr.company_id), hyd(q.get('SELECT * FROM export_projects WHERE id=?', pr.id)).journey) });
  return { project: hyd(q.get('SELECT * FROM export_projects WHERE id=?', pr.id)) };
}, { roles: CUST });

// ---------- programs ----------
api.get('/api/programs', (ctx) => {
  const u = ctx.user; const company = u && u.company_id ? S.companyOf(u) : null;
  let rows = q.all('SELECT * FROM programs').map(S.programView);
  const f = ctx.query;
  const favs = u ? new Set(q.all('SELECT program_id FROM program_favorites WHERE user_id=?', u.id).map((r) => r.program_id)) : new Set();
  if (f.type) rows = rows.filter((p) => p.type === f.type);
  if (f.country) rows = rows.filter((p) => p.countries.includes('ALL') || p.countries.includes(f.country));
  if (f.industry) rows = rows.filter((p) => p.industries.includes('ALL') || p.industries.includes(f.industry) || (PRODUCTS.filter((x) => x.cat_en === f.industry).some((x) => p.industries.includes(x.key))));
  if (f.group) rows = rows.filter((p) => p.customer_groups.includes(f.group));
  if (f.status) rows = rows.filter((p) => p.live_status === f.status);
  if (f.mode) rows = rows.filter((p) => p.mode === f.mode);
  if (f.stage) rows = rows.filter((p) => p.stages.includes(Number(f.stage)));
  if (f.fav === '1') rows = rows.filter((p) => favs.has(p.id));
  if (f.q) rows = rows.filter((p) => like(p.title_ko, f.q) || like(p.title_en, f.q) || like(p.summary_ko, f.q) || like(p.summary_en, f.q));
  rows = rows.map((p) => { const s = company ? SC.scoreProgram({ ...company, journey_focus: [2, 3, 4] }, p) : null; return { ...p, favorite: favs.has(p.id), recommend: s ? s.score : null }; });
  const sort = f.sort || 'deadline';
  if (sort === 'recommend' && company) rows.sort((a, b) => b.recommend - a.recommend);
  else if (sort === 'new') rows.sort((a, b) => String(b.apply_start).localeCompare(String(a.apply_start)));
  else rows.sort((a, b) => (a.live_status === 'CLOSED') - (b.live_status === 'CLOSED') || (a.d_day ?? 9999) - (b.d_day ?? 9999));
  const counts = { OPEN: 0, UPCOMING: 0, CLOSED: 0 }; rows.forEach((p) => { counts[p.live_status]++; });
  return { ...page(rows, f, 12), counts };
}, { auth: false });
api.get('/api/programs/recommended', (ctx) => ({ items: S.recommendPrograms(myCompany(ctx), { limit: Number(ctx.query.limit) || 10, onlyOpen: ctx.query.all !== '1' }) }), { roles: CUST });
api.get('/api/programs/:id', (ctx) => {
  const p = q.get('SELECT * FROM programs WHERE id=?', ctx.params.id); if (!p) throw U.notFound('Program not found');
  const pv = S.programView(p); const u = ctx.user; const company = u && u.company_id ? S.companyOf(u) : null;
  const rec = company ? SC.scoreProgram({ ...company, journey_focus: [2, 3, 4] }, pv) : null;
  const myApp = company ? hyd(q.get('SELECT * FROM applications WHERE company_id=? AND program_id=? ORDER BY created_at DESC LIMIT 1', company.id, p.id)) : null;
  const ev = pv.event_id ? hyd(q.get('SELECT id,title_ko,title_en,start_date,end_date,city,venue,status FROM events WHERE id=?', pv.event_id)) : null;
  const fav = u ? !!q.get('SELECT 1 x FROM program_favorites WHERE user_id=? AND program_id=?', u.id, p.id) : false;
  const related = q.all('SELECT * FROM programs WHERE type=? AND id<>? LIMIT 3', p.type, p.id).map(S.programView);
  return { program: pv, recommend: rec, my_application: myApp, event: ev, favorite: fav, related };
}, { auth: false });
api.post('/api/programs/:id/favorite', (ctx) => {
  const p = q.get('SELECT id FROM programs WHERE id=?', ctx.params.id); if (!p) throw U.notFound();
  const ex = q.get('SELECT 1 x FROM program_favorites WHERE user_id=? AND program_id=?', ctx.user.id, p.id);
  if (ex) q.run('DELETE FROM program_favorites WHERE user_id=? AND program_id=?', ctx.user.id, p.id); else q.run('INSERT INTO program_favorites(user_id,program_id,created_at) VALUES(?,?,?)', ctx.user.id, p.id, U.iso());
  return { favorite: !ex };
}, { roles: MEMBER });

// ---------- applications ----------
api.post('/api/applications', (ctx) => {
  const company = myCompany(ctx); const p = q.get('SELECT * FROM programs WHERE id=?', ctx.body.program_id); if (!p) throw U.notFound('Program not found');
  const pv = S.programView(p);
  if (pv.live_status === 'CLOSED') throw U.conflict('이 사업은 모집이 종료되었습니다 / Recruitment has closed', 'PROGRAM_CLOSED');
  if (pv.live_status === 'UPCOMING') throw U.conflict('아직 모집 전입니다 / Not yet open for applications', 'PROGRAM_NOT_OPEN');
  const app = S.createApplicationDraft(ctx, company, pv, { ai: !!ctx.body.ai });
  return { application: app, missing: S.missingForApplication(app) };
}, { roles: CUST });
api.get('/api/applications', (ctx) => {
  const rows = q.all('SELECT a.*, p.title_ko, p.title_en, p.type, p.apply_end FROM applications a JOIN programs p ON p.id=a.program_id WHERE a.company_id=? ORDER BY a.updated_at DESC', myCompany(ctx).id);
  return { items: rows.map((r) => ({ ...hyd(r), history: G.history('application', r.id) })) };
}, { roles: CUST });
const ownApp = (ctx) => { const a = hyd(q.get('SELECT * FROM applications WHERE id=?', ctx.params.id)); if (!a) throw U.notFound('Application not found'); if (ctx.user.role !== 'admin' && a.company_id !== ctx.user.company_id) { G.audit(ctx, 'access.denied', 'application', a.id, {}); throw U.forbidden('Not your application', 'NOT_OWNER'); } return a; };
api.get('/api/applications/:id', (ctx) => { const a = ownApp(ctx); const prog = S.programView(q.get('SELECT * FROM programs WHERE id=?', a.program_id)); return { application: a, program: prog, missing: S.missingForApplication(a), history: G.history('application', a.id), approval: a.approval_id ? hyd(q.get('SELECT * FROM approvals WHERE id=?', a.approval_id)) : null }; }, { roles: CUST });
api.patch('/api/applications/:id', (ctx) => {
  const a = ownApp(ctx);
  if (!['DRAFT', 'READY_FOR_REVIEW'].includes(a.status)) throw U.conflict(`Cannot edit an application in ${a.status}`, 'NOT_EDITABLE');
  const form = { ...a.form }; const b = ctx.body;
  if (b.form) for (const k of Object.keys(b.form)) { if (!(k in form)) continue; form[k] = typeof b.form[k] === 'boolean' ? b.form[k] : String(b.form[k]).slice(0, 1200); }
  const checklist = Array.isArray(b.checklist) ? a.checklist.map((d) => { const n = b.checklist.find((x) => x.id === d.id); return n ? { ...d, done: !!n.done, note: String(n.note || d.note || '').slice(0, 200) } : d; }) : a.checklist;
  q.update('applications', a.id, { form: JSON.stringify(form), checklist: JSON.stringify(checklist), updated_at: U.iso() });
  G.audit(ctx, 'application.updated', 'application', a.id, { fields: Object.keys(b.form || {}) });
  const fresh = hyd(q.get('SELECT * FROM applications WHERE id=?', a.id));
  return { application: fresh, missing: S.missingForApplication(fresh) };
}, { roles: CUST });
api.post('/api/applications/:id/ai-assist', (ctx) => {
  const a = ownApp(ctx); if (!['DRAFT', 'READY_FOR_REVIEW'].includes(a.status)) throw U.conflict('Not editable', 'NOT_EDITABLE');
  const company = myCompany(ctx); const prog = hyd(q.get('SELECT * FROM programs WHERE id=?', a.program_id));
  const tm = (company.target_markets || []).map((c) => CBY[c]?.ko).filter(Boolean)[0] || '해외';
  const form = { ...a.form };
  form.purpose = `${company.name}은(는) ${company.industry} 분야의 ${company.size}으로, "${prog.title_ko}"를 통해 ${tm} 시장의 현지 파트너를 확보하고 ${company.product} 수출을 시작하고자 합니다.`;
  form.expected_outcome = `사업 종료 후 6개월 내 ${tm} 후보 바이어 3곳 이상과 상담하고 샘플 거래 1건 이상 협의`;
  form.budget_plan = form.budget_plan || '자체 부담금 일부는 마케팅·샘플 제작비로 집행 예정(세부 금액은 직접 입력)';
  q.update('applications', a.id, { form: JSON.stringify(form), ai_draft: 1, updated_at: U.iso() });
  G.audit(ctx, 'application.ai_assist', 'application', a.id, {});
  const fresh = hyd(q.get('SELECT * FROM applications WHERE id=?', a.id));
  return { application: fresh, missing: S.missingForApplication(fresh), note: 'AI 초안(템플릿 기반)입니다. 제출 전에 직접 검토·수정하세요.' };
}, { roles: CUST });
api.post('/api/applications/:id/submit', (ctx) => {
  const a = ownApp(ctx);
  if (!['DRAFT', 'READY_FOR_REVIEW'].includes(a.status)) throw U.conflict(`Cannot submit from ${a.status}`, 'INVALID_STATE');
  const miss = S.missingForApplication(a);
  if (miss.length) throw new U.HttpError(422, 'VALIDATION_FAILED', 'Required items are missing', { missing: miss });
  const aid = S.requestApplicationSubmit(ctx, a, null);
  return { approval_id: aid, status: 'APPROVAL_REQUIRED', message: '제출 전 최종 확인(HITL) 단계입니다.' };
}, { roles: CUST });

// ---------- buyers ----------
api.get('/api/buyers', (ctx) => {
  const u = ctx.user; const company = u && u.company_id ? S.companyOf(u) : null; const f = ctx.query;
  let rows = hydAll(q.all('SELECT * FROM buyers'));
  if (f.country) rows = rows.filter((b) => b.country === f.country);
  if (f.product) rows = rows.filter((b) => b.products.includes(f.product));
  if (f.category) rows = rows.filter((b) => b.products.some((k) => PBY[k]?.cat_en === f.category));
  if (f.type) rows = rows.filter((b) => b.type === f.type);
  if (f.channel) rows = rows.filter((b) => b.channels.includes(f.channel));
  if (f.size) rows = rows.filter((b) => b.size === f.size);
  if (f.hs) rows = rows.filter((b) => b.hs_codes.some((h) => String(h).startsWith(String(f.hs).slice(0, 4))));
  if (f.minTrust) rows = rows.filter((b) => b.trust >= Number(f.minTrust));
  if (f.verified === '1') rows = rows.filter((b) => b.verified);
  if (f.q) rows = rows.filter((b) => like(b.name, f.q) || like(b.description, f.q) || like(b.description_en, f.q) || b.hashtags.some((h) => like(h, f.q)));
  const favs = company ? new Set(q.all('SELECT buyer_id FROM buyer_favorites WHERE company_id=?', company.id).map((r) => r.buyer_id)) : new Set();
  let out = rows.map((b) => { const v = S.buyerView(b, u); if (company) { const sc = SC.scoreBuyer(company, b, { favorite: favs.has(b.id) }); v.score = sc.total; v.score_parts = sc.parts; } v.favorite = favs.has(b.id); return v; });
  if (f.sort === 'score' && company) out.sort((a, b) => b.score - a.score); else if (f.sort === 'trust') out.sort((a, b) => b.trust - a.trust); else out.sort((a, b) => (b.score || 0) - (a.score || 0) || b.trust - a.trust);
  return page(out, f, 12);
}, { roles: MEMBER });
api.post('/api/buyers/recommend', (ctx) => {
  const company = myCompany(ctx); const b = ctx.body;
  const r = T.runTool({ ctx, runId: 'API', lang: ctx.body.lang || 'ko' }, 'buyer.recommend', { country: b.country, productKeys: b.productKeys, eventId: b.eventId, limit: Math.min(20, b.limit || 8) });
  if (r.error) throw U.forbidden(r.message || r.error);
  return { buyers: r.output.buyers, tool: { id: r.id, latency_ms: r.latency_ms }, formula: { product: 30, country: 20, conditions: 15, interest: 10, time: 10, past: 10, other: 5 } };
}, { roles: CUST });
api.get('/api/buyers/favorites', (ctx) => { const company = myCompany(ctx); const rows = hydAll(q.all('SELECT b.* FROM buyers b JOIN buyer_favorites f ON f.buyer_id=b.id WHERE f.company_id=? ORDER BY f.created_at DESC', company.id)); return { items: rows.map((b) => ({ ...S.buyerView(b, ctx.user), score: SC.scoreBuyer(company, b, { favorite: true }).total, favorite: true })) }; }, { roles: CUST });
api.get('/api/buyers/:id', (ctx) => {
  const b = q.get('SELECT * FROM buyers WHERE id=?', ctx.params.id); if (!b) throw U.notFound('Buyer not found');
  const u = ctx.user; const company = u.company_id ? S.companyOf(u) : null; const bh = hyd(b);
  const view = S.buyerView(b, u, { detail: true });
  let score = null;
  if (company) { const sc = SC.scoreBuyer(company, bh, { favorite: !!q.get('SELECT 1 x FROM buyer_favorites WHERE company_id=? AND buyer_id=?', company.id, b.id) }); score = { total: sc.total, parts: sc.parts, max: sc.max, reasons: sc.reasons }; }
  const matches = company ? hydAll(q.all('SELECT * FROM match_requests WHERE company_id=? AND buyer_id=? ORDER BY created_at DESC', company.id, b.id)) : [];
  const events = hydAll(q.all("SELECT e.id,e.title_ko,e.title_en,e.start_date,e.status FROM events e JOIN event_participants p ON p.event_id=e.id AND p.kind='BUYER' AND p.ref_id=? AND p.status='APPROVED'", b.id));
  const myEvents = company ? q.all("SELECT event_id FROM event_participants WHERE kind='COMPANY' AND ref_id=? AND status='APPROVED'", company.id).map((r) => r.event_id) : [];
  const past = q.count('match_requests', "WHERE buyer_id=? AND status IN ('COMPLETED','FOLLOW_UP')", b.id);
  return { buyer: view, score, matches, events: events.map((e) => ({ ...e, joined: myEvents.includes(e.id) })), favorite: !!(company && q.get('SELECT 1 x FROM buyer_favorites WHERE company_id=? AND buyer_id=?', company.id, b.id)), past_meetings: past, synthetic_note: '시연용 합성 바이어 데이터 / Synthetic demo buyer' };
}, { roles: MEMBER });
api.post('/api/buyers/:id/favorite', (ctx) => {
  const company = myCompany(ctx); const b = q.get('SELECT id FROM buyers WHERE id=?', ctx.params.id); if (!b) throw U.notFound();
  const ex = q.get('SELECT 1 x FROM buyer_favorites WHERE company_id=? AND buyer_id=?', company.id, b.id);
  if (ex) q.run('DELETE FROM buyer_favorites WHERE company_id=? AND buyer_id=?', company.id, b.id); else { q.run('INSERT INTO buyer_favorites(company_id,buyer_id,created_at) VALUES(?,?,?)', company.id, b.id, U.iso()); S.advanceJourney(company.id, 4, 'IN_PROGRESS', `바이어 저장: ${b.id}`); }
  G.audit(ctx, 'buyer.favorite', 'buyer', b.id, { on: !ex });
  return { favorite: !ex };
}, { roles: CUST });
api.post('/api/buyers/:id/verify', (ctx) => { const r = T.runTool({ ctx, runId: 'API', lang: 'ko' }, 'buyer.verify', { id: ctx.params.id }); if (r.error) throw U.forbidden(r.message || r.error); return { ...r.output, tool_run: r.id }; }, { roles: MEMBER });

// ---------- events / matching ----------
const partyOf = (ctx) => (ctx.user.role === 'buyer' ? { kind: 'BUYER', id: ctx.user.buyer_id } : { kind: 'COMPANY', id: ctx.user.company_id });
const evOr404 = (id) => { const e = hyd(q.get('SELECT * FROM events WHERE id=?', id)); if (!e) throw U.notFound('Event not found'); return e; };
api.post('/api/events/:id/apply', (ctx) => {
  const e = evOr404(ctx.params.id); const p = partyOf(ctx);
  if (!p.id) throw U.forbidden('No profile', 'NO_PROFILE');
  if (U.dday(e.apply_end) < 0) throw U.conflict('Application period has ended', 'EVENT_CLOSED');
  const ex = q.get('SELECT * FROM event_participants WHERE event_id=? AND kind=? AND ref_id=?', e.id, p.kind, p.id);
  if (ex) return { status: ex.status, already: true };
  const id = nextId('EP', 5);
  q.insert('event_participants', { id, event_id: e.id, kind: p.kind, ref_id: p.id, status: 'PENDING', grp: e.groups[0], approved_by: null, created_at: U.iso() });
  G.audit(ctx, 'event.apply', 'event', e.id, { kind: p.kind, ref: p.id });
  q.all("SELECT id FROM users WHERE role IN ('admin','consultant')").forEach((s) => G.notify(s.id, 'event', `행사 참가 신청: ${e.title_ko}`, `${p.kind} ${p.id}`, '#/admin/matching'));
  return { status: 'PENDING', message: '참가 신청이 접수되었습니다. 주최 담당자 승인 후 행사운영 페이지를 이용할 수 있습니다.' };
}, { roles: ['customer', 'buyer'] });
api.get('/api/events/:id/participants', (ctx) => {
  const e = evOr404(ctx.params.id); const p = partyOf(ctx);
  const mine = q.get("SELECT status FROM event_participants WHERE event_id=? AND kind=? AND ref_id=?", e.id, p.kind, p.id);
  if (!mine || mine.status !== 'APPROVED') throw U.forbidden('Approved event participants only', 'NOT_PARTICIPANT');
  const f = ctx.query;
  if (p.kind === 'COMPANY') {
    const company = S.getCompany(p.id);
    const ids = q.all("SELECT ref_id FROM event_participants WHERE event_id=? AND kind='BUYER' AND status='APPROVED'", e.id).map((r) => r.ref_id);
    const favs = new Set(q.all('SELECT buyer_id FROM buyer_favorites WHERE company_id=?', company.id).map((r) => r.buyer_id));
    let rows = hydAll(q.all(`SELECT * FROM buyers WHERE id IN (${ids.map(() => '?').join(',') || "''"})`, ...ids));
    if (f.q) rows = rows.filter((b) => like(b.name, f.q) || b.hashtags.some((h) => like(h, f.q)) || like(b.description, f.q));
    if (f.country) rows = rows.filter((b) => b.country === f.country);
    const reqs = hydAll(q.all('SELECT * FROM match_requests WHERE event_id=? AND company_id=?', e.id, company.id));
    return { kind: 'BUYER', items: rows.map((b) => { const ov = S.availabilityOverlap(e.id, company.id, b.id); const sc = SC.scoreBuyer(company, b, { favorite: favs.has(b.id), availabilityOverlap: ov }); const m = reqs.filter((r) => r.buyer_id === b.id).sort((a, c) => String(c.created_at).localeCompare(a.created_at))[0]; return { ...S.buyerView(b, ctx.user), score: sc.total, score_parts: sc.parts, reasons: sc.reasons, favorite: favs.has(b.id), overlap: ov, match: m ? { id: m.id, status: m.status, slot_start: m.slot_start } : null }; }).sort((a, b) => b.score - a.score) };
  }
  const buyer = hyd(q.get('SELECT * FROM buyers WHERE id=?', p.id));
  const ids = q.all("SELECT ref_id FROM event_participants WHERE event_id=? AND kind='COMPANY' AND status='APPROVED'", e.id).map((r) => r.ref_id);
  const reqs = hydAll(q.all('SELECT * FROM match_requests WHERE event_id=? AND buyer_id=?', e.id, buyer.id));
  const rows = ids.map((id) => S.getCompany(id)).filter(Boolean).map((c) => { const sc = SC.scoreBuyer(c, buyer, { availabilityOverlap: S.availabilityOverlap(e.id, c.id, buyer.id) }); const m = reqs.filter((r) => r.company_id === c.id)[0]; return { id: c.id, name: c.name, name_en: c.name_en, industry: c.industry, industry_en: c.industry_en, product: c.product, product_en: c.product_en, hs_code: c.hs_code, hashtags: c.hashtags, description: c.description, description_en: c.description_en, score: sc.total, reasons: sc.reasons, match: m ? { id: m.id, status: m.status, slot_start: m.slot_start } : null }; }).sort((a, b) => b.score - a.score);
  return { kind: 'COMPANY', items: rows };
}, { roles: ['customer', 'buyer'] });
api.get('/api/events/:id/availability', (ctx) => {
  const e = evOr404(ctx.params.id); const p = partyOf(ctx); const target = ctx.query.party ? ctx.query.party.split(':') : null;
  const slots = SC.genSlots(e);
  const get = (kind, ref) => new Set(q.all('SELECT slot_start FROM availability_slots WHERE event_id=? AND kind=? AND ref_id=? AND available=1', e.id, kind, ref).map((r) => r.slot_start));
  const mineSet = get(p.kind, p.id); const other = target ? get(target[0], target[1]) : null;
  const booked = new Set(q.all("SELECT slot_start FROM match_requests WHERE event_id=? AND status IN ('SCHEDULED','COMPLETED') AND (company_id=? OR buyer_id=?)", e.id, p.kind === 'COMPANY' ? p.id : '', p.kind === 'BUYER' ? p.id : '').map((r) => r.slot_start));
  const cOff = e.tz_offset; const bCountry = target && target[0] === 'BUYER' ? q.get('SELECT country FROM buyers WHERE id=?', target[1]) : p.kind === 'BUYER' ? q.get('SELECT country FROM buyers WHERE id=?', p.id) : null;
  const bOff = bCountry ? (q.get('SELECT tz_offset FROM countries WHERE code=?', bCountry.country) || {}).tz_offset : null;
  return { event: { id: e.id, tz_offset: cOff, city: e.city, slot_minutes: e.slot_minutes }, counterpart_tz_offset: bOff, slots: slots.map((s) => ({ slot: s, mine: mineSet.has(s), other: other ? other.has(s) : null, both: other ? mineSet.has(s) && other.has(s) : null, booked: booked.has(s), buyer_local: bOff != null ? SC.toLocal(s, cOff, bOff) : null })) };
}, { roles: ['customer', 'buyer'] });
api.put('/api/events/:id/availability', (ctx) => {
  const e = evOr404(ctx.params.id); const p = partyOf(ctx);
  const mine = q.get("SELECT status FROM event_participants WHERE event_id=? AND kind=? AND ref_id=?", e.id, p.kind, p.id);
  if (!mine || mine.status !== 'APPROVED') throw U.forbidden('Approved event participants only', 'NOT_PARTICIPANT');
  const valid = new Set(SC.genSlots(e)); const slots = (ctx.body.slots || []).filter((s) => valid.has(s));
  q.tx(() => { q.run('UPDATE availability_slots SET available=0 WHERE event_id=? AND kind=? AND ref_id=?', e.id, p.kind, p.id); for (const s of slots) q.run('INSERT INTO availability_slots(id,event_id,kind,ref_id,slot_start,available) VALUES(?,?,?,?,?,1) ON CONFLICT(id) DO UPDATE SET available=1', `${e.id}|${p.kind[0]}|${p.id}|${s}`, e.id, p.kind, p.id, s); });
  G.audit(ctx, 'availability.updated', 'event', e.id, { count: slots.length });
  return { saved: slots.length };
}, { roles: ['customer', 'buyer'] });
api.get('/api/events/:id/schedule', (ctx) => {
  const e = evOr404(ctx.params.id); const p = partyOf(ctx);
  const rows = hydAll(q.all(`SELECT * FROM match_requests WHERE event_id=? AND ${p.kind === 'COMPANY' ? 'company_id' : 'buyer_id'}=? ORDER BY slot_start, created_at`, e.id, p.id));
  const items = rows.map((m) => {
    const buyer = q.get('SELECT id,name,country FROM buyers WHERE id=?', m.buyer_id); const comp = q.get('SELECT id,name,name_en FROM companies WHERE id=?', m.company_id);
    const bOff = (q.get('SELECT tz_offset FROM countries WHERE code=?', buyer.country) || {}).tz_offset;
    const interp = m.interpreter_id ? q.get('SELECT id,name FROM interpreters WHERE id=?', m.interpreter_id) : null;
    return { ...m, buyer, company: comp, local_time: m.slot_start, buyer_local_time: m.slot_start && bOff != null ? SC.toLocal(m.slot_start, e.tz_offset, bOff) : null, interpreter: interp, i_am_receiver: (m.initiator === 'COMPANY' && p.kind === 'BUYER') || (m.initiator === 'BUYER' && p.kind === 'COMPANY') };
  });
  const part = q.get('SELECT status FROM event_participants WHERE event_id=? AND kind=? AND ref_id=?', e.id, p.kind, p.id);
  return { event: e, participant_status: part ? part.status : null, items, summary: { requested: items.filter((i) => i.status === 'REQUESTED').length, accepted: items.filter((i) => i.status === 'ACCEPTED').length, scheduled: items.filter((i) => i.status === 'SCHEDULED').length, completed: items.filter((i) => ['COMPLETED', 'FOLLOW_UP'].includes(i.status)).length } };
}, { roles: ['customer', 'buyer'] });
api.get('/api/matches', (ctx) => {
  const p = partyOf(ctx);
  const rows = hydAll(q.all(`SELECT m.*, e.title_ko, e.title_en, e.start_date, e.tz_offset FROM match_requests m JOIN events e ON e.id=m.event_id WHERE m.${p.kind === 'COMPANY' ? 'company_id' : 'buyer_id'}=? ORDER BY m.updated_at DESC`, p.id));
  return { items: rows.map((m) => ({ ...m, buyer: q.get('SELECT id,name,country,type FROM buyers WHERE id=?', m.buyer_id), company: q.get('SELECT id,name,name_en FROM companies WHERE id=?', m.company_id), i_am_receiver: (m.initiator === 'COMPANY' && p.kind === 'BUYER') || (m.initiator === 'BUYER' && p.kind === 'COMPANY'), satisfaction: q.all('SELECT by_kind,score,comment FROM satisfaction WHERE match_id=?', m.id) })) };
}, { roles: ['customer', 'buyer'] });
api.post('/api/matches/request', (ctx) => {
  const b = ctx.body; const p = partyOf(ctx);
  let companyId, buyerId;
  if (p.kind === 'COMPANY') { companyId = p.id; buyerId = b.buyer_id; } else { buyerId = p.id; companyId = b.company_id; }
  if (!b.event_id || !companyId || !buyerId) throw U.bad('event_id and counterpart required');
  if (p.kind === 'COMPANY') {
    const r = T.runTool({ ctx, runId: 'API', lang: 'ko' }, 'matching.request', { event_id: b.event_id, buyer_id: buyerId, message: b.message });
    if (r.error) throw new U.HttpError(r.http || (r.error === 'NOT_PARTICIPANT' || r.error === 'BUYER_NOT_PARTICIPANT' ? 403 : 400), r.error, r.message || r.error);
    return { approval_id: r.output.approval_id, status: 'APPROVAL_REQUIRED', message: '상대방에게 전달되는 외부 영향 작업이므로 최종 확인(HITL)이 필요합니다.' };
  }
  // buyer-initiated: validate then create approval (self)
  const ev = evOr404(b.event_id);
  const aid = G.requestApproval(ctx, { kind: 'MATCH_REQUEST', refType: 'match', refId: `${ev.id}:${companyId}`, title: `상담 신청(바이어): ${companyId} @ ${ev.title_ko}`, risk: 'HIGH', approverRole: 'self', payload: { event_id: ev.id, company_id: companyId, buyer_id: buyerId, message: b.message || '', initiator: 'BUYER' } });
  return { approval_id: aid, status: 'APPROVAL_REQUIRED' };
}, { roles: ['customer', 'buyer'] });
const myMatch = (ctx) => { const m = hyd(q.get('SELECT * FROM match_requests WHERE id=?', ctx.params.id)); if (!m) throw U.notFound('Match not found'); const p = partyOf(ctx); const ok = ctx.user.role === 'admin' || ctx.user.role === 'consultant' || (p.kind === 'COMPANY' && m.company_id === p.id) || (p.kind === 'BUYER' && m.buyer_id === p.id); if (!ok) { G.audit(ctx, 'access.denied', 'match', m.id, {}); throw U.forbidden('Not a party to this match', 'NOT_PARTY'); } return m; };
api.get('/api/matches/:id', (ctx) => { const m = myMatch(ctx); return { match: m, history: G.history('match', m.id), buyer: q.get('SELECT id,name,country FROM buyers WHERE id=?', m.buyer_id), company: q.get('SELECT id,name,name_en FROM companies WHERE id=?', m.company_id), satisfaction: q.all('SELECT * FROM satisfaction WHERE match_id=?', m.id) }; }, { roles: MEMBER });
api.post('/api/matches/:id/respond', (ctx) => {
  const m = myMatch(ctx); const p = partyOf(ctx); const dec = ctx.body.decision;
  const receiver = (m.initiator === 'COMPANY' && p.kind === 'BUYER') || (m.initiator === 'BUYER' && p.kind === 'COMPANY');
  if (!receiver && ctx.user.role !== 'admin') throw U.forbidden('Only the receiving party can respond', 'NOT_RECEIVER');
  if (dec === 'ACCEPT') G.transition(ctx, 'match', m.id, 'ACCEPTED', 'accepted'); else if (dec === 'REJECT') { if (!ctx.body.reason) throw U.bad('A reason is required to decline', 'VALIDATION'); G.transition(ctx, 'match', m.id, 'REJECTED', ctx.body.reason, { reject_reason: String(ctx.body.reason).slice(0, 300) }); } else throw U.bad('decision must be ACCEPT or REJECT');
  const other = m.initiator === 'COMPANY' ? q.get('SELECT id FROM users WHERE company_id=?', m.company_id) : q.get("SELECT id FROM users WHERE buyer_id=? AND role='buyer'", m.buyer_id);
  if (other) G.notify(other.id, 'match', dec === 'ACCEPT' ? '상담 신청이 수락되었습니다' : '상담 신청이 반려되었습니다', `${m.id}`, '#/mykotra/matching');
  G.sendMock('EMAIL', 'participant@example.com', `[KOTRA] Meeting request ${dec === 'ACCEPT' ? 'accepted' : 'declined'}`, `Match ${m.id} was ${dec === 'ACCEPT' ? 'accepted' : 'declined'}.`, m.id);
  return { match: hyd(q.get('SELECT * FROM match_requests WHERE id=?', m.id)) };
}, { roles: MEMBER });
api.post('/api/matches/:id/schedule', (ctx) => {
  const m = myMatch(ctx); const e = evOr404(m.event_id); const slot = ctx.body.slot;
  if (m.status !== 'ACCEPTED') throw U.conflict('Only accepted requests can be scheduled', 'INVALID_STATE');
  if (!SC.genSlots(e).includes(slot)) throw U.bad('Invalid slot for this event', 'VALIDATION');
  const avC = q.get("SELECT 1 x FROM availability_slots WHERE event_id=? AND kind='COMPANY' AND ref_id=? AND slot_start=? AND available=1", e.id, m.company_id, slot);
  const avB = q.get("SELECT 1 x FROM availability_slots WHERE event_id=? AND kind='BUYER' AND ref_id=? AND slot_start=? AND available=1", e.id, m.buyer_id, slot);
  if (!avC || !avB) throw U.conflict('Both parties must be available in the selected slot', 'SLOT_UNAVAILABLE');
  const hall = ctx.body.hall || e.halls[0]; const interp = ctx.body.interpreter_id || null;
  const conf = S.matchSlotConflicts(e.id, slot, { companyId: m.company_id, buyerId: m.buyer_id, interpreterId: interp, hall, excludeId: m.id });
  if (conf.length) throw U.conflict(`Conflict: ${conf.map((c) => c.type).join(', ')} already booked in this slot`, 'SLOT_CONFLICT');
  G.transition(ctx, 'match', m.id, 'SCHEDULED', `scheduled ${slot}`, { slot_start: slot, hall, interpreter_id: interp });
  [q.get('SELECT id FROM users WHERE company_id=?', m.company_id), q.get("SELECT id FROM users WHERE buyer_id=? AND role='buyer'", m.buyer_id)].filter(Boolean).forEach((u2) => G.notify(u2.id, 'match', '상담 일정이 확정되었습니다', `${slot} (${e.city})`, '#/mykotra/matching'));
  G.sendMock('EMAIL', 'participant@example.com', '[KOTRA] Meeting schedule confirmed', `Match ${m.id} confirmed at ${slot} (${e.city} time).`, m.id);
  return { match: hyd(q.get('SELECT * FROM match_requests WHERE id=?', m.id)) };
}, { roles: MEMBER });
api.post('/api/matches/:id/satisfaction', (ctx) => {
  const m = myMatch(ctx); if (!['COMPLETED', 'FOLLOW_UP'].includes(m.status)) throw U.conflict('Available after the meeting is completed', 'INVALID_STATE');
  const p = partyOf(ctx); const score = Math.round(Number(ctx.body.score)); if (!(score >= 1 && score <= 5)) throw U.bad('score 1-5', 'VALIDATION');
  q.run('DELETE FROM satisfaction WHERE match_id=? AND by_kind=?', m.id, p.kind);
  q.insert('satisfaction', { id: nextId('SAT', 4), match_id: m.id, by_kind: p.kind, score, comment: String(ctx.body.comment || '').slice(0, 300), created_at: U.iso() });
  if (m.status === 'COMPLETED') G.transition(ctx, 'match', m.id, 'FOLLOW_UP', 'satisfaction submitted → follow-up recommended');
  const reco = p.kind === 'COMPANY' ? S.recommendPrograms(S.getCompany(p.id), { limit: 3 }).map((x) => ({ id: x.id, title_ko: x.title_ko, title_en: x.title_en, d_day: x.d_day })) : [];
  G.integrationEvent('CRM', 'match.followup', { match: m.id });
  return { ok: true, follow_up_programs: reco };
}, { roles: ['customer', 'buyer'] });

// ---------- consultations (customer side) ----------
api.get('/api/consultations', (ctx) => ({ items: hydAll(q.all('SELECT * FROM consultations WHERE company_id=? OR user_id=? ORDER BY created_at DESC', ctx.user.company_id || '', ctx.user.id)) }), { roles: MEMBER });
api.post('/api/consultations', (ctx) => {
  const b = ctx.body; if (!b.title || !b.body) throw U.bad('title and body are required', 'VALIDATION');
  if (String(b.body).length < 10) throw U.bad('Please describe your inquiry in more detail (10+ chars)', 'VALIDATION');
  const ch = ['ONLINE', 'GRIEVANCE', 'REGULATION_REPORT', 'VISIT'].includes(b.channel) ? b.channel : 'ONLINE';
  const r = T.runTool({ ctx, runId: 'API', lang: 'ko' }, 'consultation.create', { title: String(b.title).slice(0, 200), body: String(b.body).slice(0, 4000), channel: ch });
  if (r.error) throw U.forbidden(r.message || r.error);
  return { id: r.output.consultation_id, classification: r.output.classification, status: 'AI_CLASSIFIED' };
}, { roles: MEMBER });
api.post('/api/consultations/classify-preview', (ctx) => { const t = String(ctx.body.text || ''); if (t.length < 5) throw U.bad('text required', 'VALIDATION'); return { classification: T.classifyText(t) }; }, { roles: MEMBER });
const ownConsult = (ctx) => { const c = hyd(q.get('SELECT * FROM consultations WHERE id=?', ctx.params.id)); if (!c) throw U.notFound('Consultation not found'); const staff = ['consultant', 'admin', 'office'].includes(ctx.user.role); if (!staff && c.user_id !== ctx.user.id && (!ctx.user.company_id || c.company_id !== ctx.user.company_id)) { G.audit(ctx, 'access.denied', 'consultation', c.id, {}); throw U.forbidden('Not your consultation', 'NOT_OWNER'); } return c; };
api.get('/api/consultations/:id', (ctx) => {
  const c = ownConsult(ctx); const staff = ['consultant', 'admin', 'office'].includes(ctx.user.role);
  const msgs = q.all('SELECT * FROM consultation_messages WHERE consultation_id=? ORDER BY created_at, id', c.id).filter((m) => staff || m.at_sec == null);
  const sum = hyd(q.get('SELECT * FROM consultation_summaries WHERE consultation_id=? ORDER BY created_at DESC LIMIT 1', c.id));
  return { consultation: c, messages: msgs, summary: staff ? sum : sum && sum.status === 'CONFIRMED' ? { status: sum.status, final: sum.final } : null, history: G.history('consultation', c.id) };
}, { roles: MEMBER });
api.post('/api/consultations/:id/messages', (ctx) => {
  const c = ownConsult(ctx); const body = String(ctx.body.body || '').trim(); if (!body) throw U.bad('Message is empty', 'VALIDATION');
  if (['CLOSED'].includes(c.status)) throw U.conflict('This consultation is closed', 'CLOSED');
  q.insert('consultation_messages', { id: nextId('CM', 5), consultation_id: c.id, sender: ['consultant', 'admin'].includes(ctx.user.role) ? 'consultant' : 'customer', sender_id: ctx.user.id, speaker: ['consultant', 'admin'].includes(ctx.user.role) ? 'agent' : 'customer', body: U.maskPII(body).slice(0, 3000), at_sec: null, created_at: U.iso() });
  q.update('consultations', c.id, { updated_at: U.iso() });
  if (c.assigned_to && ctx.user.id !== c.assigned_to) G.notify(c.assigned_to, 'consultation', `상담 ${c.id} 고객 추가 문의`, body.slice(0, 80), '#/staff/consult');
  return { ok: true };
}, { roles: MEMBER });
api.post('/api/consultations/:id/classify', (ctx) => {
  const c = ownConsult(ctx); const cls = T.classifyText(c.title + ' ' + c.body);
  q.update('consultations', c.id, { ai_class: JSON.stringify(cls), category: cls.category, topic: cls.category, updated_at: U.iso() });
  if (c.status === 'OPEN') G.transition(ctx, 'consultation', c.id, 'AI_CLASSIFIED', 'AI classified');
  return { classification: cls, status: q.get('SELECT status FROM consultations WHERE id=?', c.id).status };
}, { roles: MEMBER });

// ---------- notifications / saved / documents / approvals ----------
api.get('/api/notifications', (ctx) => ({ items: q.all('SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC, id DESC LIMIT 60', ctx.user.id), unread: q.count('notifications', 'WHERE user_id=? AND is_read=0', ctx.user.id) }), { roles: MEMBER });
api.post('/api/notifications/read', (ctx) => { if (ctx.body.all) q.run('UPDATE notifications SET is_read=1 WHERE user_id=?', ctx.user.id); else q.run('UPDATE notifications SET is_read=1 WHERE user_id=? AND id=?', ctx.user.id, ctx.body.id); return { ok: true }; }, { roles: MEMBER });
api.get('/api/saved', (ctx) => ({ items: hydAll(q.all('SELECT * FROM saved_items WHERE user_id=? ORDER BY created_at DESC', ctx.user.id)).filter((s) => !ctx.query.kind || s.kind === ctx.query.kind) }), { roles: MEMBER });
api.post('/api/saved', (ctx) => { const b = ctx.body; if (!b.kind || !b.title) throw U.bad('kind and title required'); const id = nextId('SV', 4); q.insert('saved_items', { id, user_id: ctx.user.id, kind: b.kind, ref_id: b.ref_id || null, title: String(b.title).slice(0, 200), payload: JSON.stringify(b.payload || {}), created_at: U.iso() }); if (b.kind === 'checklist' && ctx.user.company_id) S.advanceJourney(ctx.user.company_id, 3, 'IN_PROGRESS', '규제 체크리스트 저장'); return { id }; }, { roles: MEMBER });
api.del('/api/saved/:id', (ctx) => { q.run('DELETE FROM saved_items WHERE id=? AND user_id=?', ctx.params.id, ctx.user.id); return { ok: true }; }, { roles: MEMBER });
api.get('/api/saved/:id', (ctx) => { const s = hyd(q.get('SELECT * FROM saved_items WHERE id=? AND user_id=?', ctx.params.id, ctx.user.id)); if (!s) throw U.notFound(); return { item: s }; }, { roles: MEMBER });
api.get('/api/approvals', (ctx) => {
  const u = ctx.user; const staff = ['admin', 'consultant', 'office'].includes(u.role);
  const mine = hydAll(q.all('SELECT * FROM approvals WHERE requester_id=? ORDER BY created_at DESC LIMIT 60', u.id));
  const queue = staff ? hydAll(q.all("SELECT * FROM approvals WHERE status='PENDING' AND approver_role<>'self' ORDER BY created_at DESC")).filter((a) => G.canDecide(u, a)) : [];
  return { mine, queue, pending_self: mine.filter((a) => a.status === 'PENDING' && a.approver_role === 'self').length };
}, { roles: MEMBER });
api.get('/api/approvals/:id', (ctx) => { const a = hyd(q.get('SELECT * FROM approvals WHERE id=?', ctx.params.id)); if (!a) throw U.notFound(); if (a.requester_id !== ctx.user.id && !G.canDecide(ctx.user, a) && ctx.user.role !== 'admin') throw U.forbidden('Not allowed', 'NOT_ALLOWED'); return { approval: a, history: G.history('approval', a.id) }; }, { roles: MEMBER });
api.post('/api/approvals/:id/decision', (ctx) => {
  const d = String(ctx.body.decision || '').toUpperCase();
  if (!['APPROVE', 'REJECT', 'CANCEL'].includes(d)) throw U.bad('decision must be APPROVE, REJECT or CANCEL');
  if (d === 'APPROVE' && ctx.body.confirm !== true) throw U.bad('Explicit confirmation required (confirm=true)', 'CONFIRM_REQUIRED');
  const ap = require('../domain/services').decideApproval(ctx, ctx.params.id, d, String(ctx.body.reason || '').slice(0, 300));
  return { approval: ap };
}, { roles: MEMBER });
api.get('/api/documents', (ctx) => {
  const u = ctx.user; const items = [];
  hydAll(q.all("SELECT * FROM saved_items WHERE user_id=? AND kind IN ('report','email','checklist')", u.id)).forEach((s) => items.push({ kind: s.kind, id: s.id, title: s.title, created_at: s.created_at, ref: `#/mykotra/documents/${s.id}` }));
  if (u.company_id) q.all('SELECT a.id, a.status, a.created_at, p.title_ko, p.title_en FROM applications a JOIN programs p ON p.id=a.program_id WHERE a.company_id=?', u.company_id).forEach((a) => items.push({ kind: 'application', id: a.id, title: a.title_ko, title_en: a.title_en, status: a.status, created_at: a.created_at, ref: '#/mykotra/applications' }));
  items.sort((a, b) => String(b.created_at).localeCompare(a.created_at));
  return { items };
}, { roles: MEMBER });
