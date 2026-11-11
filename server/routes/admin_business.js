'use strict';
const { api } = require('../router');
const { q, nextId, hyd, hydAll } = require('../db');
const U = require('../util');
const G = require('../gov');
const S = require('../domain/services');
const SC = require('../domain/scoring');
const RAG = require('../ai/rag');
const { COUNTRIES, PRODUCTS } = require('../seed/catalog');
const CBY = Object.fromEntries(COUNTRIES.map((c) => [c.code, c]));
const ADMIN = ['admin'];
const STAFF = ['admin', 'consultant', 'office'];
const MGR = ['admin', 'consultant'];
const like = (s, qn) => String(s || '').toLowerCase().includes(String(qn).toLowerCase());
const page = (rows, query, def = 20) => { const size = Math.min(100, Number(query.size) || def); const pg = Math.max(1, Number(query.page) || 1); return { items: rows.slice((pg - 1) * size, pg * size), total: rows.length, page: pg, pages: Math.max(1, Math.ceil(rows.length / size)), size }; };
const group = (table, col, where = '') => Object.fromEntries(q.all(`SELECT ${col} k, COUNT(*) n FROM ${table} ${where} GROUP BY ${col}`).map((r) => [r.k, r.n]));

// ---------- dashboard ----------
api.get('/api/admin/dashboard', () => {
  const logs = q.all('SELECT ms,status FROM api_logs ORDER BY id DESC LIMIT 500'); const ms = logs.map((l) => l.ms).sort((a, b) => a - b);
  const runs = q.all("SELECT status, latency_ms FROM agent_runs WHERE mode='chat'");
  return {
    kpis: { users: q.count('users'), companies: q.count('companies'), programs_open: q.all('SELECT * FROM programs').map(S.programView).filter((p) => p.live_status === 'OPEN').length, applications: q.count('applications'), consultations_open: q.count('consultations', "WHERE status NOT IN ('CLOSED','RESOLVED')"), matches: q.count('match_requests'), research_active: q.count('research_requests', "WHERE status NOT IN ('COMPLETED','EVALUATED','DRAFT')"), approvals_pending: q.count('approvals', "WHERE status='PENDING'"), ai_queries: runs.length, ai_success: runs.length ? U.round(runs.filter((r) => r.status === 'OK').length / runs.length * 100, 1) : null, p95_ms: ms.length ? ms[Math.floor(ms.length * 0.95)] : null },
    applications: group('applications', 'status'), consultations: group('consultations', 'status'), matches: group('match_requests', 'status'), research: group('research_requests', 'status'), channels: group('consultations', 'channel'),
    pipelines: group('pipelines', 'status'), quality_issues_open: q.count('quality_issues', "WHERE status='OPEN'"),
    recent_audit: q.all('SELECT id,ts,actor_id,action,target_type,target_id FROM audit_events ORDER BY id DESC LIMIT 8'), pending_approvals: hydAll(q.all("SELECT id,kind,title,risk,created_at FROM approvals WHERE status='PENDING' ORDER BY created_at DESC LIMIT 6")),
    ai_provenance: { local: runs.length, note: 'AI 응답 출처 표시: LOCAL(내장 근거 엔진) / LIVE(외부 LLM)' },
  };
}, { roles: STAFF });

// ---------- customers / companies ----------
api.get('/api/admin/companies', (ctx) => {
  let rows = hydAll(q.all('SELECT * FROM companies ORDER BY id')); const f = ctx.query;
  if (f.q) rows = rows.filter((c) => like(c.name, f.q) || like(c.name_en, f.q) || like(c.industry, f.q)); if (f.stage) rows = rows.filter((c) => c.export_stage === f.stage);
  return page(rows.map((c) => ({ ...c, biz_no: c.biz_no ? c.biz_no.slice(0, 3) + '-**-*****' : null, users: q.count('users', 'WHERE company_id=?', c.id), applications: q.count('applications', 'WHERE company_id=?', c.id), consultations: q.count('consultations', 'WHERE company_id=?', c.id), matches: q.count('match_requests', 'WHERE company_id=?', c.id) })), f, 25);
}, { roles: STAFF });
api.get('/api/admin/companies/:id', (ctx) => {
  const c = S.getCompany(ctx.params.id); if (!c) throw U.notFound(); G.audit(ctx, 'company.viewed', 'company', c.id, {});
  return { company: { ...c, biz_no: c.biz_no ? c.biz_no.slice(0, 3) + '-**-*****' : null }, users: q.all('SELECT id,name,email,role FROM users WHERE company_id=?', c.id).map((u) => ({ ...u, email: U.maskEmail(u.email) })), projects: hydAll(q.all('SELECT * FROM export_projects WHERE company_id=?', c.id)), applications: q.all('SELECT a.id,a.status,p.title_ko FROM applications a JOIN programs p ON p.id=a.program_id WHERE a.company_id=?', c.id), consultations: q.all('SELECT id,title,status,channel FROM consultations WHERE company_id=? ORDER BY created_at DESC', c.id), matches: q.all('SELECT id,status,buyer_id,event_id FROM match_requests WHERE company_id=?', c.id) };
}, { roles: STAFF });

// ---------- programs CMS ----------
const progPatch = (b) => {
  const p = {};
  for (const k of ['title_ko', 'title_en', 'summary_ko', 'summary_en', 'type', 'target_ko', 'target_en', 'dept_ko', 'dept_en', 'mode', 'region', 'benefit_ko', 'benefit_en', 'url', 'event_id']) if (b[k] !== undefined) p[k] = String(b[k]).slice(0, 600);
  for (const k of ['apply_start', 'apply_end', 'event_start', 'event_end']) if (b[k] !== undefined) { if (b[k] && !/^\d{4}-\d{2}-\d{2}$/.test(b[k])) throw U.bad(`${k} must be YYYY-MM-DD`, 'VALIDATION'); p[k] = b[k] || null; }
  for (const k of ['industries', 'countries', 'stages', 'customer_groups', 'required_docs']) if (b[k] !== undefined) p[k] = JSON.stringify(b[k]);
  return p;
};
api.post('/api/admin/programs', (ctx) => {
  const b = ctx.body; if (!b.title_ko || !b.apply_start || !b.apply_end) throw U.bad('title_ko, apply_start, apply_end required', 'VALIDATION'); if (b.apply_end < b.apply_start) throw U.bad('apply_end must be after apply_start', 'VALIDATION');
  const id = nextId('PG', 3); const p = progPatch(b);
  q.insert('programs', { id, title_en: b.title_en || b.title_ko, summary_ko: '', summary_en: '', type: 'TAILORED', target_ko: '', target_en: '', industries: '["ALL"]', countries: '["ALL"]', stages: '[1,2]', customer_groups: '["READY","NOVICE","PROMISING","MIDCAP"]', sizes: '[]', dept_ko: 'KOTRA', dept_en: 'KOTRA', mode: 'ONLINE', region: '온라인', status: 'OPEN', eligibility: '{}', required_docs: '[]', benefit_ko: '', benefit_en: '', url: null, event_id: null, source_type: 'user', is_synthetic: 0, created_at: U.iso(), updated_at: U.iso(), ...p });
  const d = hyd(q.get('SELECT * FROM programs WHERE id=?', id)); RAG.addDocument({ id: 'D-' + id, collection_id: 'PROGRAM', title: d.title_ko, title_en: d.title_en, text: `${d.summary_ko} 신청기간: ${d.apply_start} ~ ${d.apply_end}.`, text_en: `${d.summary_en} Application period: ${d.apply_start} to ${d.apply_end}.`, org: 'KOTRA ' + d.dept_ko, url: `#/programs/${id}`, published_at: d.apply_start, doc_type: 'program', access_scope: 'PUBLIC', status: 'ACTIVE', uploaded_by: ctx.user.id, source_type: 'user', is_synthetic: 0, updated_at: U.iso() });
  G.audit(ctx, 'program.created', 'program', id, {}); return { id };
}, { roles: MGR });
api.put('/api/admin/programs/:id', (ctx) => {
  const cur = q.get('SELECT * FROM programs WHERE id=?', ctx.params.id); if (!cur) throw U.notFound(); const p = progPatch(ctx.body);
  const s = p.apply_start || cur.apply_start, e = p.apply_end || cur.apply_end; if (e < s) throw U.bad('apply_end must be after apply_start', 'VALIDATION');
  q.update('programs', cur.id, { ...p, updated_at: U.iso() });
  const d = hyd(q.get('SELECT * FROM programs WHERE id=?', cur.id));
  q.run('UPDATE documents SET title=?, title_en=?, text=?, text_en=? WHERE id=?', d.title_ko, d.title_en, `${d.summary_ko} 신청기간: ${d.apply_start} ~ ${d.apply_end}.`, `${d.summary_en} Application period: ${d.apply_start} to ${d.apply_end}.`, 'D-' + cur.id); RAG.reindexCollection('PROGRAM'); RAG.reindexCollection('EXHIBITION');
  G.audit(ctx, 'program.updated', 'program', cur.id, p); return { ok: true };
}, { roles: MGR });
api.get('/api/admin/applications', (ctx) => {
  let rows = q.all('SELECT a.*, p.title_ko, p.title_en, c.name AS company_name FROM applications a JOIN programs p ON p.id=a.program_id JOIN companies c ON c.id=a.company_id ORDER BY a.updated_at DESC').map((r) => ({ ...hyd(r), form: undefined })); if (ctx.query.status) rows = rows.filter((r) => r.status === ctx.query.status);
  return { items: rows, counts: group('applications', 'status') };
}, { roles: MGR });
api.post('/api/admin/applications/:id/complete', (ctx) => { const a = q.get('SELECT * FROM applications WHERE id=?', ctx.params.id); if (!a) throw U.notFound(); G.transition(ctx, 'application', a.id, 'COMPLETED', 'received & processed by KOTRA'); G.notify(a.user_id, 'application', '사업 신청 접수가 완료되었습니다', a.id, '#/mykotra/applications'); G.integrationEvent('사업관리시스템', 'application.completed', { id: a.id }); return { status: 'COMPLETED' }; }, { roles: MGR });

// ---------- content CMS (SFR-006) ----------
api.get('/api/admin/content', (ctx) => { let rows = q.all('SELECT id,type,country,industry,title_ko,status,published_at,views,source_type,is_synthetic FROM market_content ORDER BY published_at DESC'); if (ctx.query.q) rows = rows.filter((r) => like(r.title_ko, ctx.query.q)); if (ctx.query.status) rows = rows.filter((r) => r.status === ctx.query.status); return page(rows, ctx.query, 25); }, { roles: STAFF });
api.post('/api/admin/content', (ctx) => {
  const b = ctx.body; if (!b.title_ko || !b.body_ko || b.body_ko.length < 20) throw U.bad('title_ko and body_ko (20+ chars) required', 'VALIDATION'); const id = nextId('MC', 3); const pub = b.publish !== false;
  q.insert('market_content', { id, type: b.type || 'news', country: b.country || null, industry: b.industry || null, title_ko: String(b.title_ko).slice(0, 200), title_en: b.title_en || b.title_ko, body_ko: String(b.body_ko).slice(0, 20000), body_en: b.body_en || b.body_ko, source_name: b.source_name || 'KOTRA', source_url: b.source_url || null, published_at: U.today(), tags: JSON.stringify(b.tags || []), status: pub ? 'PUBLISHED' : 'DRAFT', views: 0, source_type: 'user', is_synthetic: 0, created_at: U.iso(), updated_at: U.iso() });
  RAG.addDocument({ id: 'D-' + id, collection_id: 'MARKET', title: b.title_ko, title_en: b.title_en || b.title_ko, text: b.body_ko, text_en: b.body_en || null, org: b.source_name || 'KOTRA', url: `#/markets/content/${id}`, published_at: U.today(), country: b.country || null, hs: (PRODUCTS.find((p) => p.key === b.industry) || {}).hs || null, doc_type: b.type || 'news', access_scope: 'PUBLIC', status: pub ? 'ACTIVE' : 'ARCHIVED', uploaded_by: ctx.user.id, source_type: 'user', is_synthetic: 0, updated_at: U.iso() });
  G.audit(ctx, 'content.created', 'content', id, { publish: pub }); return { id };
}, { roles: STAFF });
api.post('/api/admin/content/:id/status', (ctx) => { const c = q.get('SELECT * FROM market_content WHERE id=?', ctx.params.id); if (!c) throw U.notFound(); const st = ctx.body.status === 'PUBLISHED' ? 'PUBLISHED' : 'DRAFT'; q.update('market_content', c.id, { status: st, updated_at: U.iso() }); q.update('documents', 'D-' + c.id, { status: st === 'PUBLISHED' ? 'ACTIVE' : 'ARCHIVED' }); RAG.invalidate(); G.audit(ctx, 'content.status', 'content', c.id, { status: st }); return { status: st }; }, { roles: STAFF });
api.get('/api/admin/banners', () => ({ items: q.all('SELECT * FROM cms_banners ORDER BY sort') }), { roles: STAFF });
api.put('/api/admin/banners/:id', (ctx) => { const b = ctx.body; const p = {}; for (const k of ['title_ko', 'title_en', 'body_ko', 'body_en', 'link']) if (b[k] !== undefined) p[k] = String(b[k]).slice(0, 300); if (b.active !== undefined) p.active = b.active ? 1 : 0; if (b.sort !== undefined) p.sort = Number(b.sort) || 0; q.update('cms_banners', ctx.params.id, p); G.audit(ctx, 'banner.updated', 'banner', ctx.params.id, p); return { ok: true }; }, { roles: STAFF });
api.post('/api/admin/banners', (ctx) => { const b = ctx.body; if (!b.title_ko) throw U.bad('title_ko required', 'VALIDATION'); const id = nextId('BN', 3); q.insert('cms_banners', { id, site: 'trade24', title_ko: b.title_ko, title_en: b.title_en || b.title_ko, body_ko: b.body_ko || '', body_en: b.body_en || '', link: b.link || '#/programs', active: 1, sort: 99, groups: '[]' }); G.audit(ctx, 'banner.created', 'banner', id, {}); return { id }; }, { roles: STAFF });
api.post('/api/admin/notices', (ctx) => { const b = ctx.body; if (!b.title_ko || !b.body_ko) throw U.bad('title_ko and body_ko required', 'VALIDATION'); const id = nextId('NT', 3); q.insert('notices', { id, kind: b.kind || 'notice', title_ko: b.title_ko, title_en: b.title_en || b.title_ko, body_ko: b.body_ko, body_en: b.body_en || b.body_ko, published_at: U.today(), pinned: b.pinned ? 1 : 0, source_type: 'user', is_synthetic: 0 }); G.audit(ctx, 'notice.created', 'notice', id, {}); return { id }; }, { roles: STAFF });

// ---------- Matching admin (SFR-033~041) ----------
const LANG_BY_COUNTRY = { VN: 'vi', JP: 'ja', US: 'en', GB: 'en', AU: 'en', SG: 'en', IN: 'en', AE: 'en', SA: 'en', DE: 'en', FR: 'en', MY: 'en', TH: 'en', PH: 'en', ID: 'en', PL: 'en', MX: 'en', BR: 'en', TR: 'en', CN: 'en' };
const evOr404 = (id) => { const e = hyd(q.get('SELECT * FROM events WHERE id=?', id)); if (!e) throw U.notFound('Event not found'); return e; };
api.get('/api/admin/events', () => ({ items: hydAll(q.all('SELECT * FROM events ORDER BY start_date')).map((e) => ({ ...e, participants: group('event_participants', 'status', `WHERE event_id='${e.id}'`), matches: group('match_requests', 'status', `WHERE event_id='${e.id}'`) })) }), { roles: STAFF });
api.get('/api/admin/events/:id/overview', (ctx) => {
  const e = evOr404(ctx.params.id);
  const parts = q.all('SELECT * FROM event_participants WHERE event_id=? ORDER BY kind, created_at', e.id).map((p) => ({ ...p, name: p.kind === 'COMPANY' ? (q.get('SELECT name FROM companies WHERE id=?', p.ref_id) || {}).name : (q.get('SELECT name FROM buyers WHERE id=?', p.ref_id) || {}).name, country: p.kind === 'BUYER' ? (q.get('SELECT country FROM buyers WHERE id=?', p.ref_id) || {}).country : 'KR' }));
  const ms = hydAll(q.all('SELECT * FROM match_requests WHERE event_id=? ORDER BY slot_start, created_at', e.id)).map((m) => ({ ...m, company: (q.get('SELECT name FROM companies WHERE id=?', m.company_id) || {}).name, buyer: (q.get('SELECT name,country FROM buyers WHERE id=?', m.buyer_id) || {}) }));
  const sat = q.all('SELECT s.by_kind, s.score FROM satisfaction s JOIN match_requests m ON m.id=s.match_id WHERE m.event_id=?', e.id);
  const slots = SC.genSlots(e).length; const scheduled = ms.filter((m) => ['SCHEDULED', 'COMPLETED', 'FOLLOW_UP'].includes(m.status)).length;
  const interpreters = hydAll(q.all('SELECT * FROM interpreters WHERE event_id=?', e.id));
  return { event: e, participants: parts, matches: ms, interpreters, stats: { by_status: ms.reduce((a, m) => { a[m.status] = (a[m.status] || 0) + 1; return a; }, {}), slot_capacity: slots * e.halls.length, scheduled, utilization: slots ? U.round(scheduled / (slots * e.halls.length) * 100, 1) : 0, satisfaction_avg: sat.length ? U.round(sat.reduce((a, s) => a + s.score, 0) / sat.length, 2) : null, satisfaction_n: sat.length, mutual: ms.filter((m) => ms.some((o) => o.id !== m.id && o.company_id === m.company_id && o.buyer_id === m.buyer_id && o.initiator !== m.initiator)).length / 2 } };
}, { roles: STAFF });
api.post('/api/admin/events/:id/participants/:pid/decision', (ctx) => {
  const e = evOr404(ctx.params.id); const p = q.get('SELECT * FROM event_participants WHERE id=? AND event_id=?', ctx.params.pid, e.id); if (!p) throw U.notFound(); if (p.status !== 'PENDING') throw U.conflict('Already decided', 'ALREADY_DECIDED');
  const ok = ctx.body.decision === 'APPROVE'; q.update('event_participants', p.id, { status: ok ? 'APPROVED' : 'REJECTED', approved_by: ctx.user.id });
  if (ok) SC.genSlots(e).forEach((s) => q.run('INSERT OR IGNORE INTO availability_slots(id,event_id,kind,ref_id,slot_start,available) VALUES(?,?,?,?,?,1)', `${e.id}|${p.kind[0]}|${p.ref_id}|${s}`, e.id, p.kind, p.ref_id, s));
  const u = p.kind === 'COMPANY' ? q.get('SELECT id FROM users WHERE company_id=?', p.ref_id) : q.get("SELECT id FROM users WHERE buyer_id=? AND role='buyer'", p.ref_id); if (u) G.notify(u.id, 'event', ok ? '행사 참가가 승인되었습니다' : '행사 참가가 반려되었습니다', e.title_ko, '#/events/' + e.id);
  G.audit(ctx, ok ? 'event.participant.approved' : 'event.participant.rejected', 'event_participant', p.id, { event: e.id }); return { status: ok ? 'APPROVED' : 'REJECTED' };
}, { roles: MGR });

// Auto-match planner: mutual first, then one-sided, honouring refusals, group/hall, availability, interpreter and min meetings per company.
function planAutoMatch(e, rules) {
  const reqs = hydAll(q.all("SELECT * FROM match_requests WHERE event_id=? AND status IN ('REQUESTED','ACCEPTED')", e.id));
  const rejected = new Set(q.all("SELECT company_id||'|'||buyer_id k FROM match_requests WHERE event_id=? AND status='REJECTED'", e.id).map((r) => r.k));
  const sched = hydAll(q.all("SELECT * FROM match_requests WHERE event_id=? AND status IN ('SCHEDULED','COMPLETED')", e.id));
  const pairs = new Map();
  reqs.forEach((r) => { const k = `${r.company_id}|${r.buyer_id}`; if (rejected.has(k)) return; const x = pairs.get(k) || { company_id: r.company_id, buyer_id: r.buyer_id, ids: [], initiators: new Set(), statuses: new Set(), score: r.score }; x.ids.push(r.id); x.initiators.add(r.initiator); x.statuses.add(r.status); pairs.set(k, x); });
  const list = [...pairs.values()].map((x) => ({ ...x, priority: x.statuses.has('ACCEPTED') || x.initiators.size > 1 ? 1 : x.initiators.has('COMPANY') ? 2 : 3, source: 'REQUEST' }));
  const have = {}; sched.forEach((m) => { have[m.company_id] = (have[m.company_id] || 0) + 1; }); list.forEach((x) => { have[x.company_id] = have[x.company_id] || 0; });
  if (rules.min_per_company > 0 && rules.use_ai) { // AI suggestions fill the gap (SFR-043)
    const comps = q.all("SELECT ref_id FROM event_participants WHERE event_id=? AND kind='COMPANY' AND status='APPROVED'", e.id).map((r) => r.ref_id);
    const buyers = hydAll(q.all("SELECT b.* FROM buyers b JOIN event_participants p ON p.kind='BUYER' AND p.ref_id=b.id AND p.event_id=? AND p.status='APPROVED'", e.id));
    for (const cid of comps) {
      const company = S.getCompany(cid); let cnt = (have[cid] || 0) + list.filter((x) => x.company_id === cid).length;
      if (cnt >= rules.min_per_company) continue;
      const cand = buyers.filter((b) => !rejected.has(`${cid}|${b.id}`) && !pairs.has(`${cid}|${b.id}`)).map((b) => ({ b, sc: SC.scoreBuyer(company, b, { availabilityOverlap: S.availabilityOverlap(e.id, cid, b.id) }) })).filter((x) => x.sc.total >= (rules.min_score || 55)).sort((a, b) => b.sc.total - a.sc.total);
      for (const c of cand) { if (cnt >= rules.min_per_company) break; list.push({ company_id: cid, buyer_id: c.b.id, ids: [], initiators: new Set(['ADMIN']), statuses: new Set(), score: c.sc.total, priority: 4, source: 'AI_SUGGESTED' }); cnt++; }
    }
  }
  list.sort((a, b) => a.priority - b.priority || b.score - a.score);
  const slots = SC.genSlots(e); const interps = hydAll(q.all('SELECT * FROM interpreters WHERE event_id=?', e.id));
  const taken = { C: {}, B: {}, H: {}, I: {} }; sched.forEach((m) => { (taken.C[m.company_id] ||= new Set()).add(m.slot_start); (taken.B[m.buyer_id] ||= new Set()).add(m.slot_start); (taken.H[m.hall] ||= new Set()).add(m.slot_start); if (m.interpreter_id) (taken.I[m.interpreter_id] ||= new Set()).add(m.slot_start); });
  const av = (kind, ref) => new Set(q.all('SELECT slot_start FROM availability_slots WHERE event_id=? AND kind=? AND ref_id=? AND available=1', e.id, kind, ref).map((r) => r.slot_start));
  const out = [], failed = []; const perCompany = { ...have };
  const groupsOf = (cid, bid) => { const pc = q.get("SELECT grp FROM event_participants WHERE event_id=? AND kind='COMPANY' AND ref_id=?", e.id, cid); const pb = q.get("SELECT grp FROM event_participants WHERE event_id=? AND kind='BUYER' AND ref_id=?", e.id, bid); return [pc && pc.grp, pb && pb.grp]; };
  for (const pr of list) {
    if (rules.max_per_company && (perCompany[pr.company_id] || 0) >= rules.max_per_company) { failed.push({ ...pr, reason: 'MAX_PER_COMPANY' }); continue; }
    const ac = av('COMPANY', pr.company_id), ab = av('BUYER', pr.buyer_id); const bCountry = (q.get('SELECT country FROM buyers WHERE id=?', pr.buyer_id) || {}).country; const lang = LANG_BY_COUNTRY[bCountry] || 'en';
    const [gc, gb] = groupsOf(pr.company_id, pr.buyer_id);
    const hallIdx = rules.group_halls && gb ? Math.abs([...gb].reduce((a, ch) => a + ch.charCodeAt(0), 0)) % e.halls.length : 0;
    const hallOrder = [...e.halls.keys()].map((i) => (i + hallIdx) % e.halls.length).map((i) => e.halls[i]);
    let placed = null;
    for (const s of slots) {
      if (!ac.has(s) || !ab.has(s) || taken.C[pr.company_id]?.has(s) || taken.B[pr.buyer_id]?.has(s)) continue;
      const hall = hallOrder.find((h) => !taken.H[h]?.has(s)); if (!hall) continue;
      const ip = interps.find((i) => i.languages.includes(lang) && !taken.I[i.id]?.has(s)) || interps.find((i) => !taken.I[i.id]?.has(s));
      placed = { slot: s, hall, interpreter_id: ip ? ip.id : null }; break;
    }
    if (!placed) { failed.push({ ...pr, reason: 'NO_COMMON_SLOT' }); continue; }
    (taken.C[pr.company_id] ||= new Set()).add(placed.slot); (taken.B[pr.buyer_id] ||= new Set()).add(placed.slot); (taken.H[placed.hall] ||= new Set()).add(placed.slot); if (placed.interpreter_id) (taken.I[placed.interpreter_id] ||= new Set()).add(placed.slot);
    perCompany[pr.company_id] = (perCompany[pr.company_id] || 0) + 1; out.push({ company_id: pr.company_id, buyer_id: pr.buyer_id, ids: pr.ids, priority: pr.priority, source: pr.source, score: pr.score, ...placed });
  }
  const names = (r) => ({ ...r, company: (q.get('SELECT name FROM companies WHERE id=?', r.company_id) || {}).name, buyer: (q.get('SELECT name FROM buyers WHERE id=?', r.buyer_id) || {}).name });
  const lvl = { 1: '상호신청/수락(1순위)', 2: '기업→바이어(2순위)', 3: '바이어→기업(3순위)', 4: 'AI 추천(보충)' };
  return { scheduled: out.map((o) => ({ ...names(o), priority_label: lvl[o.priority] })), unscheduled: failed.map((f) => ({ ...names(f), initiators: undefined, statuses: undefined })), per_company: perCompany, rules };
}
api.post('/api/admin/events/:id/auto-match/preview', (ctx) => { const e = evOr404(ctx.params.id); const rules = { min_per_company: Number(ctx.body.min_per_company) || 0, max_per_company: Number(ctx.body.max_per_company) || 0, use_ai: !!ctx.body.use_ai, min_score: Number(ctx.body.min_score) || 55, group_halls: ctx.body.group_halls !== false }; return planAutoMatch(e, rules); }, { roles: MGR });
api.post('/api/admin/events/:id/auto-match/commit', (ctx) => {
  const e = evOr404(ctx.params.id); if (ctx.body.confirm !== true) throw U.bad('Commit requires confirm=true (HITL)', 'CONFIRM_REQUIRED');
  const rules = { min_per_company: Number(ctx.body.min_per_company) || 0, max_per_company: Number(ctx.body.max_per_company) || 0, use_ai: !!ctx.body.use_ai, min_score: Number(ctx.body.min_score) || 55, group_halls: ctx.body.group_halls !== false };
  const plan = planAutoMatch(e, rules); let applied = 0;
  q.tx(() => { for (const m of plan.scheduled) {
    let id = m.ids[0];
    if (!id) { const company = S.getCompany(m.company_id), buyer = hyd(q.get('SELECT * FROM buyers WHERE id=?', m.buyer_id)); id = nextId('MR', 4); q.insert('match_requests', { id, event_id: e.id, company_id: m.company_id, buyer_id: m.buyer_id, initiator: 'ADMIN', status: 'ACCEPTED', score: m.score, score_detail: JSON.stringify(SC.scoreBuyer(company, buyer, {}).parts), slot_start: null, hall: null, interpreter_id: null, message: 'AI 추천 자동 매칭', reject_reason: null, journal: null, source_type: 'admin-auto', is_synthetic: 0, created_at: U.iso(), updated_at: U.iso() }); q.run('INSERT INTO status_history(entity,entity_id,from_state,to_state,actor_id,note,ts) VALUES(?,?,?,?,?,?,?)', 'match', id, null, 'ACCEPTED', ctx.user.id, 'AI suggested by auto-match', U.iso()); }
    const cur = q.get('SELECT status FROM match_requests WHERE id=?', id).status;
    if (cur === 'REQUESTED') G.transition(ctx, 'match', id, 'ACCEPTED', 'auto-match: accepted by 주최');
    G.transition(ctx, 'match', id, 'SCHEDULED', `auto-match ${m.slot}`, { slot_start: m.slot, hall: m.hall, interpreter_id: m.interpreter_id });
    m.ids.slice(1).forEach((dup) => { const dc = q.get('SELECT status FROM match_requests WHERE id=?', dup).status; if (dc === 'REQUESTED') G.transition(ctx, 'match', dup, 'ACCEPTED', 'merged'), G.transition(ctx, 'match', dup, 'SCHEDULED', 'merged duplicate', { slot_start: m.slot, hall: m.hall, interpreter_id: m.interpreter_id }); });
    [q.get('SELECT id FROM users WHERE company_id=?', m.company_id), q.get("SELECT id FROM users WHERE buyer_id=? AND role='buyer'", m.buyer_id)].filter(Boolean).forEach((u) => G.notify(u.id, 'match', '상담 일정이 확정되었습니다', `${m.slot} ${m.hall}`, '#/mykotra/matching'));
    applied++; } });
  G.sendMock('EMAIL', 'participants@example.com', '[KOTRA] Pre-matching completed', `${applied} meetings were scheduled for ${e.title_en}.`, e.id); G.audit(ctx, 'automatch.committed', 'event', e.id, { applied, rules });
  return { applied, unscheduled: plan.unscheduled.length };
}, { roles: MGR });
api.post('/api/admin/matches/:id/reschedule', (ctx) => {
  const m = hyd(q.get('SELECT * FROM match_requests WHERE id=?', ctx.params.id)); if (!m) throw U.notFound(); const e = evOr404(m.event_id); const b = ctx.body;
  if (!['ACCEPTED', 'SCHEDULED'].includes(m.status)) throw U.conflict('Only accepted/scheduled matches can be (re)scheduled', 'INVALID_STATE');
  if (!SC.genSlots(e).includes(b.slot)) throw U.bad('Invalid slot', 'VALIDATION'); const hall = b.hall || m.hall || e.halls[0]; const ip = b.interpreter_id || m.interpreter_id || null;
  const conf = S.matchSlotConflicts(e.id, b.slot, { companyId: m.company_id, buyerId: m.buyer_id, interpreterId: ip, hall, excludeId: m.id });
  if (conf.length) throw U.conflict(`충돌: ${conf.map((c) => ({ COMPANY: '기업', BUYER: '바이어', INTERPRETER: '통역사', HALL: '상담장' }[c.type])).join(', ')} 일정이 이미 있습니다`, 'SLOT_CONFLICT');
  if (m.status === 'ACCEPTED') G.transition(ctx, 'match', m.id, 'SCHEDULED', 'admin scheduled', { slot_start: b.slot, hall, interpreter_id: ip }); else { q.update('match_requests', m.id, { slot_start: b.slot, hall, interpreter_id: ip, updated_at: U.iso() }); q.run('INSERT INTO status_history(entity,entity_id,from_state,to_state,actor_id,note,ts) VALUES(?,?,?,?,?,?,?)', 'match', m.id, 'SCHEDULED', 'SCHEDULED', ctx.user.id, `rescheduled → ${b.slot}`, U.iso()); G.audit(ctx, 'match.rescheduled', 'match', m.id, { slot: b.slot, hall }); G.sendMock('EMAIL', 'participants@example.com', '[KOTRA] Meeting schedule changed', `Match ${m.id} moved to ${b.slot}.`, m.id); }
  return { ok: true };
}, { roles: MGR });
api.get('/api/admin/events/:id/conflicts', (ctx) => {
  const e = evOr404(ctx.params.id); const ms = q.all("SELECT * FROM match_requests WHERE event_id=? AND status IN ('SCHEDULED','COMPLETED') AND slot_start IS NOT NULL", e.id); const seen = {}; const out = [];
  ms.forEach((m) => [['COMPANY', m.company_id], ['BUYER', m.buyer_id], ['INTERPRETER', m.interpreter_id], ['HALL', m.hall]].forEach(([t, ref]) => { if (!ref) return; const k = `${t}|${ref}|${m.slot_start}`; if (seen[k]) out.push({ type: t, ref, slot: m.slot_start, matches: [seen[k], m.id] }); else seen[k] = m.id; }));
  return { conflicts: out, ok: out.length === 0, checked: ms.length };
}, { roles: STAFF });
api.post('/api/admin/events/:id/onsite', (ctx) => {
  const e = evOr404(ctx.params.id); const { company_id, buyer_id, slot } = ctx.body; if (!company_id || !buyer_id) throw U.bad('company_id and buyer_id required', 'VALIDATION');
  const r = S.createMatchRequest(ctx, { event_id: e.id, company_id, buyer_id, initiator: 'COMPANY', message: '현장 매칭' }); q.update('match_requests', r.id, { initiator: 'ONSITE', source_type: 'onsite' });
  G.transition(ctx, 'match', r.id, 'ACCEPTED', 'on-site match');
  if (slot) { const conf = S.matchSlotConflicts(e.id, slot, { companyId: company_id, buyerId: buyer_id, hall: ctx.body.hall || e.halls[0], excludeId: r.id }); if (conf.length) throw U.conflict('Slot conflict', 'SLOT_CONFLICT'); G.transition(ctx, 'match', r.id, 'SCHEDULED', 'on-site scheduled', { slot_start: slot, hall: ctx.body.hall || e.halls[0] }); }
  return { id: r.id };
}, { roles: MGR });
api.post('/api/admin/matches/:id/complete', (ctx) => {
  const m = q.get('SELECT * FROM match_requests WHERE id=?', ctx.params.id); if (!m) throw U.notFound(); const text = String(ctx.body.notes || '').trim();
  const lines = text ? text.split(/\n+/).map((t, i) => ({ speaker: i % 2 ? 'customer' : 'agent', at: i * 20, text: t })) : [];
  const journal = lines.length ? { ...require('../domain/summarize').summarize(lines), notes: U.maskPII(text) } : { summary: '상담 완료(상세 기록 없음)', next: '후속지원 검토' };
  G.transition(ctx, 'match', m.id, 'COMPLETED', 'meeting completed', { journal: JSON.stringify(journal) }); G.integrationEvent('CRM', 'match.completed', { id: m.id }); return { status: 'COMPLETED', journal };
}, { roles: MGR });
api.post('/api/admin/interpreters/:id/attendance', (ctx) => { const i = hyd(q.get('SELECT * FROM interpreters WHERE id=?', ctx.params.id)); if (!i) throw U.notFound(); const att = i.attendance || {}; att[ctx.body.date || U.today()] = !!ctx.body.present; q.update('interpreters', i.id, { attendance: JSON.stringify(att) }); G.audit(ctx, 'interpreter.attendance', 'interpreter', i.id, att); return { attendance: att }; }, { roles: STAFF });
api.get('/api/admin/events/:id/schedule.csv', (ctx) => {
  const e = evOr404(ctx.params.id); const rows = q.all("SELECT m.*, c.name AS company, b.name AS buyer, b.country FROM match_requests m JOIN companies c ON c.id=m.company_id JOIN buyers b ON b.id=m.buyer_id WHERE m.event_id=? AND m.slot_start IS NOT NULL ORDER BY m.slot_start, m.hall", e.id);
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`; const head = ['match_id', 'status', 'slot_local', 'hall', 'company', 'buyer', 'buyer_country', 'interpreter', 'score'];
  const body = rows.map((r) => [r.id, r.status, r.slot_start, r.hall, r.company, r.buyer, r.country, r.interpreter_id, r.score].map(esc).join(','));
  return { __raw: true, type: 'text/csv; charset=utf-8', headers: { 'content-disposition': `attachment; filename="${e.id}-schedule.csv"` }, body: '﻿' + [head.join(','), ...body].join('\n') };
}, { roles: STAFF });
