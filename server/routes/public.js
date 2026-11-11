'use strict';
const { api } = require('../router');
const { q, hyd, hydAll, getSetting } = require('../db');
const U = require('../util');
const A = require('../auth');
const G = require('../gov');
const S = require('../domain/services');
const RAG = require('../ai/rag');
const LLM = require('../ai/llm');
const { COUNTRIES, PRODUCTS } = require('../seed/catalog');
const SC = require('../domain/scoring');
const P_ = require('../seed/people');

const started = Date.now();
const page = (rows, query, def = 12) => { const size = Math.min(60, Number(query.size) || def); const pg = Math.max(1, Number(query.page) || 1); return { items: rows.slice((pg - 1) * size, pg * size), total: rows.length, page: pg, pages: Math.max(1, Math.ceil(rows.length / size)), size }; };
const like = (s, qn) => String(s || '').toLowerCase().includes(String(qn).toLowerCase());
const pushCookie = (ctx, token) => { ctx.headers['set-cookie'] = A.cookieHeader(token); };

api.get('/api/health', () => {
  let db = 'ok'; try { q.get('SELECT 1 x'); } catch { db = 'error'; }
  return { status: db === 'ok' ? 'UP' : 'DEGRADED', db, uptime_s: Math.round((Date.now() - started) / 1000), time: U.iso(), version: '1.0.0', llm: LLM.status().provenance, checks: { db, rag_chunks: q.count('chunks'), documents: q.count('documents') } };
}, { auth: false });

api.get('/api/config', () => ({
  demo_mode: process.env.DEMO_MODE !== 'false', demo_code_required: !!process.env.DEMO_ACCESS_CODE, axdev_enabled: process.env.AX_DEV_DOCK !== 'false', di_enabled: require('../di/core').enabled(), public_url: A.PUBLIC_URL || null, clock: getSetting('demo_clock', null), today: U.today(), llm: LLM.status(),
  personas: process.env.DEMO_MODE !== 'false' ? Object.entries(P_.PERSONAS).map(([k, v]) => ({ key: k, email: v.email, ko: v.ko, en: v.en })) : [],
  countries: COUNTRIES.map((c) => ({ code: c.code, ko: c.ko, en: c.en, region_ko: c.region_ko, region_en: c.region_en })), products: PRODUCTS.map((p) => ({ key: p.key, ko: p.ko, en: p.en, hs: p.hs, cat_ko: p.cat_ko, cat_en: p.cat_en })),
  labels: { SYNTHETIC: '시연용 합성 데이터', MOCK: 'Mock API', CACHED: 'Cached', LIVE: 'Live' },
}), { auth: false });

// ---------- auth ----------
api.post('/api/auth/login', (ctx) => {
  const { email, password } = ctx.body;
  if (!A.rateLimit(`login:${ctx.ip}`, 10, 60000)) throw new U.HttpError(429, 'RATE_LIMITED', 'Too many login attempts');
  let r; try { r = A.login(email, password, ctx.ip); } catch (e) { G.audit({ user: null, ip: ctx.ip }, 'auth.login_failed', 'user', String(email).slice(0, 80), {}); throw e; }
  pushCookie(ctx, r.token); G.audit({ user: r.user, ip: ctx.ip }, 'auth.login', 'user', r.user.id, {});
  return { user: r.user };
}, { auth: false });
// Public-URL protection: staff/admin one-click personas need DEMO_ACCESS_CODE (otherwise only company & buyer personas are open).
function demoGate(ctx) {
  const code = process.env.DEMO_ACCESS_CODE || '';
  if (code) { if (!A.rateLimit(`demo:${ctx.ip}`, 10, 60000)) throw new U.HttpError(429, 'RATE_LIMITED', 'Too many attempts'); if (String(ctx.body.code || '') !== code) throw new U.HttpError(403, 'DEMO_CODE_REQUIRED', '시연 접근 코드가 필요합니다 / Demo access code required'); return; }
  if (A.PUBLIC_URL && !['company', 'buyer'].includes(ctx.body.persona)) throw new U.HttpError(403, 'DEMO_STAFF_DISABLED', '공개 URL에서는 직원/관리자 원클릭 로그인이 비활성화되어 있습니다. 계정으로 로그인하세요 / One-click staff login is disabled on the public URL; use an account.');
}
api.post('/api/auth/demo-login', (ctx) => {
  if (process.env.DEMO_MODE === 'false') throw U.forbidden('Demo login disabled', 'DEMO_DISABLED');
  const persona = P_.PERSONAS[ctx.body.persona];
  if (!persona) throw U.bad('Unknown persona');
  demoGate(ctx);
  const u = q.get('SELECT id FROM users WHERE email=?', persona.email);
  const r = A.loginAs(u.id, ctx.ip); pushCookie(ctx, r.token); G.audit({ user: r.user, ip: ctx.ip }, 'auth.demo_login', 'user', r.user.id, { persona: ctx.body.persona });
  return { user: r.user };
}, { auth: false });
api.post('/api/auth/logout', (ctx) => { A.logout(ctx.req); ctx.headers['set-cookie'] = A.cookieHeader('', true); if (ctx.user) G.audit(ctx, 'auth.logout', 'user', ctx.user.id, {}); return { ok: true }; }, { auth: false });
api.patch('/api/me', (ctx) => { const loc = ctx.body.locale === 'en' ? 'en' : 'ko'; if (ctx.user) q.update('users', ctx.user.id, { locale: loc }); return { ok: true, locale: loc }; }, { auth: false });

api.get('/api/me', (ctx) => {
  const u = ctx.user;
  if (!u) return { user: null, permissions: {} };
  const company = S.companyOf(u);
  const buyer = u.buyer_id ? hyd(q.get('SELECT id,name,name_en,country,type,products,verified FROM buyers WHERE id=?', u.buyer_id)) : null;
  const unread = q.count('notifications', 'WHERE user_id=? AND is_read=0', u.id);
  const pendingApprovals = q.count('approvals', "WHERE status='PENDING' AND ((approver_role='self' AND requester_id=?) OR approver_role IN ('admin','consultant'))", u.id);
  return { user: u, company, buyer, unread, pending_approvals: u.role === 'customer' || u.role === 'buyer' ? q.count('approvals', "WHERE status='PENDING' AND approver_role='self' AND requester_id=?", u.id) : pendingApprovals, permissions: Object.fromEntries(Object.keys(A.PERMS).map((p) => [p, A.can(u, p)])) };
}, { auth: false });

// ---------- home ----------
api.get('/api/home', (ctx) => {
  const programs = q.all('SELECT * FROM programs').map(S.programView).filter((p) => p.live_status === 'OPEN').sort((a, b) => (a.d_day ?? 999) - (b.d_day ?? 999));
  const mc = hydAll(q.all("SELECT id,type,country,industry,title_ko,title_en,source_name,published_at,views FROM market_content WHERE status='PUBLISHED' ORDER BY published_at DESC LIMIT 8"));
  const events = hydAll(q.all("SELECT * FROM events WHERE status IN ('RECRUITING','UPCOMING') ORDER BY start_date LIMIT 4"));
  const notices = q.all('SELECT * FROM notices ORDER BY pinned DESC, published_at DESC LIMIT 6');
  const banners = q.all('SELECT * FROM cms_banners WHERE active=1 ORDER BY sort');
  return {
    banners, notices, closing_soon: programs.slice(0, 6), latest_content: mc, events,
    stats: { programs_open: programs.length, buyers: q.count('buyers'), countries: COUNTRIES.length, documents: q.count('documents'), events: events.length },
    popular_searches: [{ ko: '베트남 화장품', en: 'Vietnam cosmetics' }, { ko: '미국 MoCRA', en: 'US MoCRA' }, { ko: '수출바우처', en: 'Export voucher' }, { ko: '인코텀즈', en: 'Incoterms' }, { ko: '일본 수출', en: 'Export to Japan' }, { ko: '바이어 발굴', en: 'Buyer discovery' }],
    quick_agents: [{ id: 'market', ko: '유망시장 찾기', en: 'Find promising markets', prompt_ko: '우리 제품에 맞는 유망 시장을 추천해줘', prompt_en: 'Recommend promising markets for my product' }, { id: 'buyer', ko: '바이어 찾기', en: 'Find buyers', prompt_ko: '베트남 화장품 바이어를 추천해줘', prompt_en: 'Recommend buyers in Vietnam' }, { id: 'regulation', ko: '규제·인증 확인', en: 'Check regulation', prompt_ko: '베트남 화장품 수출 규제·인증 체크리스트를 만들어줘', prompt_en: 'Create a regulation checklist for exporting cosmetics to Vietnam' }, { id: 'program', ko: '지원사업 찾기', en: 'Find programs', prompt_ko: '신청 가능한 지원사업을 추천해줘', prompt_en: 'Recommend programs I can apply to' }, { id: 'exhibition', ko: '전시회·상담회', en: 'Exhibitions & meetings', prompt_ko: '베트남 뷰티 상담회를 알려줘', prompt_en: 'Show me beauty meetings for Vietnam' }, { id: 'contract', ko: '계약서 검토', en: 'Review contract', prompt_ko: '독점 판매 계약서에서 점검할 조항을 알려줘', prompt_en: 'What clauses should I check in an exclusive distribution contract?' }, { id: 'report', ko: '시장보고서 만들기', en: 'Create market report', prompt_ko: '베트남 화장품 시장진출 보고서를 만들어줘', prompt_en: 'Create a Vietnam cosmetics market-entry report' }],
  };
}, { auth: false });

// ---------- global search ----------
const hrefOf = (id, type) => (id.startsWith('D-MC-') ? `#/markets/content/${id.slice(2)}` : id.startsWith('D-RG-') ? `#/markets/regulations/${id.slice(2)}` : id.startsWith('D-PG-') ? `#/programs/${id.slice(2).replace(/-P$/, '')}` : id.startsWith('D-B-') ? `#/buyers/${id.slice(2)}` : id.startsWith('D-FQ-') ? '#/consult/faq' : id.startsWith('D-EV-') ? `#/events/${id.slice(2)}` : id.startsWith('D-RS-') ? '#/markets/content' : `#/library/${id}`);
api.get('/api/search', (ctx) => {
  const qn = String(ctx.query.q || '').trim();
  if (qn.length < 1) return { results: [], total: 0, groups: {} };
  const clearance = A.clearanceOf(ctx.user);
  const lang = ctx.query.lang === 'en' ? 'en' : 'ko';
  const r = RAG.search({ query: qn, collections: [], k: 24, clearance, lang, threshold: 0.3 });
  const typeOf = (h) => (h.doc_id.startsWith('D-MC') ? 'market' : h.doc_id.startsWith('D-RG') ? 'regulation' : h.doc_id.startsWith('D-PG') ? 'program' : h.doc_id.startsWith('D-B-') ? 'buyer' : h.doc_id.startsWith('D-FQ') ? 'faq' : h.doc_id.startsWith('D-EV') ? 'event' : 'guide');
  const seen = new Set();
  const results = r.hits.map((h) => ({ type: typeOf(h), id: h.doc_id.replace(/-P$/, ''), title: lang === 'en' ? h.title_en || h.title : h.title, snippet: h.text.slice(0, 150), org: h.org, date: h.published_at, score: Math.round(h.relevance * 100), href: hrefOf(h.doc_id) })).filter((x) => (seen.has(x.id) ? false : seen.add(x.id)));
  // title LIKE fallbacks (so exact names always hit)
  q.all('SELECT id,title_ko,title_en,summary_ko FROM programs').filter((p) => like(p.title_ko, qn) || like(p.title_en, qn)).forEach((p) => { if (!seen.has(p.id)) { seen.add(p.id); results.unshift({ type: 'program', id: p.id, title: lang === 'en' ? p.title_en : p.title_ko, snippet: p.summary_ko, score: 95, href: `#/programs/${p.id}` }); } });
  const groups = {}; results.forEach((x) => { groups[x.type] = (groups[x.type] || 0) + 1; });
  return { results, total: results.length, groups, ai_hint: true, abstained: r.abstained && !results.length, trace: { ms: r.trace.latency_ms } };
}, { auth: false });

// ---------- overseas markets ----------
api.get('/api/countries', () => hydAll(q.all('SELECT * FROM countries WHERE code<>\'KR\' ORDER BY name_ko')), { auth: false });
api.get('/api/countries/:code', (ctx) => {
  const c = q.get('SELECT * FROM countries WHERE code=?', ctx.params.code.toUpperCase());
  if (!c) throw U.notFound('Country not found');
  const content = hydAll(q.all("SELECT id,type,industry,title_ko,title_en,source_name,published_at FROM market_content WHERE country=? ORDER BY published_at DESC", c.code));
  const regs = hydAll(q.all('SELECT id,industry,hs_prefix,title_ko,title_en,risk,agency FROM regulations WHERE country=?', c.code));
  const stats = q.all('SELECT hs_prefix, year, export_usd_m, yoy FROM trade_stats WHERE country=? ORDER BY hs_prefix, year', c.code);
  const programs = q.all('SELECT * FROM programs').map(S.programView).filter((p) => (p.countries.includes('ALL') || p.countries.includes(c.code)) && p.live_status !== 'CLOSED').slice(0, 6);
  const buyers = q.count('buyers', 'WHERE country=?', c.code);
  const tip = { ko: '모든 지표는 시연용 합성 값입니다.', en: 'All indicators are synthetic demo values.' };
  return { country: c, content, regulations: regs, stats, programs, buyers_count: buyers, note: tip };
}, { auth: false });
api.get('/api/market-content', (ctx) => {
  let rows = hydAll(q.all("SELECT id,type,country,industry,title_ko,title_en,body_ko,body_en,source_name,source_url,published_at,tags,views,is_synthetic FROM market_content WHERE status='PUBLISHED' ORDER BY published_at DESC"));
  const { type, country, industry, q: qn } = ctx.query;
  if (type) rows = rows.filter((r) => r.type === type);
  if (country) rows = rows.filter((r) => r.country === country);
  if (industry) { const cat = PRODUCTS.find((p) => p.key === industry); rows = rows.filter((r) => r.industry === industry || (cat && PRODUCTS.find((p) => p.key === r.industry)?.cat_en === cat.cat_en && ctx.query.group === '1')); }
  if (qn) rows = rows.filter((r) => like(r.title_ko, qn) || like(r.title_en, qn) || like(r.body_ko, qn) || like(r.body_en, qn));
  rows = rows.map((r) => ({ ...r, body_ko: r.body_ko.slice(0, 160), body_en: r.body_en.slice(0, 200) }));
  return page(rows, ctx.query, 12);
}, { auth: false });
api.get('/api/market-content/:id', (ctx) => {
  const r = hyd(q.get('SELECT * FROM market_content WHERE id=?', ctx.params.id)); if (!r) throw U.notFound();
  q.run('UPDATE market_content SET views=views+1 WHERE id=?', r.id);
  const related = hydAll(q.all('SELECT id,type,title_ko,title_en,published_at FROM market_content WHERE (country=? OR industry=?) AND id<>? ORDER BY published_at DESC LIMIT 5', r.country, r.industry, r.id));
  return { content: r, related, regs: hydAll(q.all('SELECT id,title_ko,title_en,risk FROM regulations WHERE country=? LIMIT 3', r.country)) };
}, { auth: false });
api.get('/api/regulations', (ctx) => {
  let rows = hydAll(q.all('SELECT id,country,hs_prefix,industry,title_ko,title_en,risk,agency,updated_at,requirements FROM regulations ORDER BY updated_at DESC'));
  const { country, industry, risk, q: qn } = ctx.query;
  if (country) rows = rows.filter((r) => r.country === country); if (industry) rows = rows.filter((r) => r.industry === industry); if (risk) rows = rows.filter((r) => r.risk === risk);
  if (qn) rows = rows.filter((r) => like(r.title_ko, qn) || like(r.title_en, qn));
  return page(rows, ctx.query, 12);
}, { auth: false });
api.get('/api/regulations/:id', (ctx) => { const r = hyd(q.get('SELECT * FROM regulations WHERE id=?', ctx.params.id)); if (!r) throw U.notFound(); return { regulation: r }; }, { auth: false });
api.get('/api/stats', (ctx) => {
  const { country, hs } = ctx.query;
  const rows = q.all(`SELECT * FROM trade_stats WHERE (? IS NULL OR country=?) AND (? IS NULL OR hs_prefix=?) ORDER BY year`, country || null, country || null, hs || null, hs || null);
  return { rows, synthetic: true, sql: 'SELECT * FROM trade_stats WHERE country = ? AND hs_prefix = ? ORDER BY year' };
}, { auth: false });
api.get('/api/library', (ctx) => {
  let rows = hydAll(q.all("SELECT id,collection_id,title,title_en,org,url,published_at,doc_type,access_scope,country FROM documents WHERE id LIKE 'DOC-%' AND status='ACTIVE'"));
  const cl = A.clearanceOf(ctx.user); rows = rows.filter((r) => (A.SCOPE[r.access_scope] ?? 0) <= cl);
  if (ctx.query.collection) rows = rows.filter((r) => r.collection_id === ctx.query.collection);
  if (ctx.query.q) rows = rows.filter((r) => like(r.title, ctx.query.q) || like(r.title_en, ctx.query.q));
  return { items: rows };
}, { auth: false });
api.get('/api/library/:id', (ctx) => { const d = hyd(q.get('SELECT * FROM documents WHERE id=?', ctx.params.id)); if (!d) throw U.notFound(); if ((A.SCOPE[d.access_scope] ?? 0) > A.clearanceOf(ctx.user)) { G.audit(ctx, 'doc.denied', 'document', d.id, {}); throw U.forbidden('Insufficient access scope for this document', 'SCOPE_DENIED'); } return { document: d }; }, { auth: false });

// ---------- faq, notices ----------
api.get('/api/faqs', (ctx) => { let rows = q.all('SELECT * FROM faqs ORDER BY id'); if (ctx.query.q) rows = rows.filter((f) => like(f.q_ko, ctx.query.q) || like(f.q_en, ctx.query.q) || like(f.a_ko, ctx.query.q)); return { items: rows }; }, { auth: false });
api.get('/api/notices', (ctx) => { let rows = q.all('SELECT * FROM notices ORDER BY pinned DESC, published_at DESC'); if (ctx.query.kind) rows = rows.filter((n) => n.kind === ctx.query.kind); return page(rows, ctx.query, 10); }, { auth: false });

// ---------- events (public view) ----------
api.get('/api/events', (ctx) => {
  const rows = hydAll(q.all('SELECT * FROM events ORDER BY start_date')).map((e) => ({ ...e, d_day: U.dday(e.start_date), apply_d_day: U.dday(e.apply_end), participants: { companies: q.count('event_participants', "WHERE event_id=? AND kind='COMPANY' AND status='APPROVED'", e.id), buyers: q.count('event_participants', "WHERE event_id=? AND kind='BUYER' AND status='APPROVED'", e.id) } }));
  return { items: rows };
}, { auth: false });
api.get('/api/events/:id', (ctx) => {
  const e = hyd(q.get('SELECT * FROM events WHERE id=?', ctx.params.id)); if (!e) throw U.notFound();
  const prog = q.get('SELECT id FROM programs WHERE event_id=?', e.id);
  const mine = ctx.user && ctx.user.company_id ? q.get("SELECT status FROM event_participants WHERE event_id=? AND kind='COMPANY' AND ref_id=?", e.id, ctx.user.company_id) : ctx.user && ctx.user.buyer_id ? q.get("SELECT status FROM event_participants WHERE event_id=? AND kind='BUYER' AND ref_id=?", e.id, ctx.user.buyer_id) : null;
  return { event: { ...e, d_day: U.dday(e.start_date), apply_d_day: U.dday(e.apply_end) }, program_id: prog && prog.id, my_status: mine ? mine.status : null, slots_per_day: SC.genSlots({ ...e, end_date: e.start_date }).length };
}, { auth: false });

// ---------- Invest KOREA & Ombudsman channel ----------
api.get('/api/invest', () => {
  const docs = hydAll(q.all("SELECT id,title,title_en,text,text_en,org,url FROM documents WHERE collection_id='INVEST' AND status='ACTIVE' ORDER BY id"));
  return {
    docs,
    sections: [{ key: 'why', ko: 'Why Korea', en: 'Why Korea' }, { key: 'industry', ko: '산업·입지', en: 'Industry & location' }, { key: 'incentive', ko: '인센티브', en: 'Incentives' }, { key: 'guide', ko: '투자 가이드', en: 'Investment guide' }, { key: 'regulation', ko: '규제 정보', en: 'Regulatory information' }, { key: 'consult', ko: '투자 상담', en: 'Investment consulting' }, { key: 'ombudsman', ko: '고충 상담', en: 'Grievance consulting' }, { key: 'ai', ko: 'AI 투자도우미', en: 'AI Investment Assistant' }],
    clusters: [{ ko: '반도체', en: 'Semiconductors', note_ko: '수도권·충청 클러스터', note_en: 'Capital region & Chungcheong cluster' }, { ko: '2차전지', en: 'Batteries', note_ko: '충청·영남 클러스터', note_en: 'Chungcheong & Yeongnam cluster' }, { ko: '바이오', en: 'Bio', note_ko: '송도·오송 클러스터', note_en: 'Songdo & Osong cluster' }, { ko: '모빌리티', en: 'Mobility', note_ko: '호남·영남 클러스터', note_en: 'Honam & Yeongnam cluster' }],
    languages: ['ko', 'en', 'zh', 'ja'], note: 'Invest KOREA는 국문·영문·중문·일문 제공이 RFP 요구입니다. MVP는 국문·영문을 제공하며 중문·일문 확장 구조(i18n 키)를 갖춥니다.',
  };
}, { auth: false });
api.post('/api/invest/inquiries', (ctx) => {
  const b = ctx.body; if (!b.title || !b.body) throw U.bad('title and body required');
  if (!A.rateLimit(`inq:${ctx.ip}`, 5, 60000)) throw new U.HttpError(429, 'RATE_LIMITED', 'Too many inquiries');
  const ch = b.channel === 'OMBUDSMAN' ? 'OMBUDSMAN' : 'INVEST';
  const id = require('../db').nextId('CS', 4);
  q.insert('consultations', { id, channel: ch, company_id: ctx.user ? ctx.user.company_id : null, user_id: ctx.user ? ctx.user.id : null, topic: ch === 'OMBUDSMAN' ? '고충' : '투자', category: ch, title: String(b.title).slice(0, 200), body: U.maskPII(String(b.body)).slice(0, 4000), status: 'OPEN', priority: 'NORMAL', assigned_to: null, ai_class: JSON.stringify(require('../ai/tools').classifyText(b.title + ' ' + b.body)), extra_care: 0, callback_at: null, source_type: 'user', is_synthetic: 0, created_at: U.iso(), updated_at: U.iso() });
  G.audit(ctx, 'invest.inquiry', 'consultation', id, { channel: ch });
  q.all("SELECT id FROM users WHERE role='consultant'").forEach((s) => G.notify(s.id, 'consultation', `신규 ${ch === 'OMBUDSMAN' ? '고충' : '투자'} 상담 ${id}`, b.title, '#/staff/consult'));
  return { id, status: 'OPEN', note: ch === 'OMBUDSMAN' ? '고충 상담이 접수되었습니다(시연).' : '투자 상담이 접수되었습니다(시연).' };
}, { auth: false });

// ---------- Open API (SFR-061): JSON/XML, key + rate limit ----------
const toXml = (name, rows) => `<?xml version="1.0" encoding="UTF-8"?>\n<${name}>${rows.map((r) => `<item>${Object.entries(r).map(([k, v]) => `<${k}>${String(v ?? '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))}</${k}>`).join('')}</item>`).join('')}</${name}>`;
api.get('/open-api/v1/:dataset', (ctx) => {
  const key = ctx.req.headers['x-api-key'] || ctx.query.apikey;
  if (key !== (process.env.OPEN_API_KEY || 'demo-open-key')) throw new U.HttpError(401, 'INVALID_API_KEY', 'x-api-key required (demo key: demo-open-key)');
  if (!A.rateLimit(`open:${key}`, 60, 60000)) throw new U.HttpError(429, 'RATE_LIMITED', 'Open API rate limit (60/min)');
  const sets = { programs: () => q.all('SELECT id,title_ko,title_en,type,apply_start,apply_end,event_start,event_end,dept_ko FROM programs'), 'market-content': () => q.all("SELECT id,type,country,title_ko,title_en,source_name,source_url,published_at FROM market_content WHERE status='PUBLISHED'"), regulations: () => q.all('SELECT id,country,hs_prefix,title_ko,title_en,risk,agency,updated_at FROM regulations'), events: () => q.all('SELECT id,title_ko,title_en,start_date,end_date,city FROM events') };
  const fn = sets[ctx.params.dataset]; if (!fn) throw U.notFound('Unknown dataset');
  const rows = fn(); const fmt = (ctx.query.format || 'json').toLowerCase();
  if (fmt === 'xml') return { __raw: true, type: 'application/xml; charset=utf-8', body: toXml(ctx.params.dataset.replace(/-/g, '_'), rows) };
  return { dataset: ctx.params.dataset, count: rows.length, items: rows, license: 'Synthetic demo data — not official KOTRA data', format: 'json' };
}, { auth: false });
