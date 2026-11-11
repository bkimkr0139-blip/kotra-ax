'use strict';
const { api } = require('../router');
const { q, nextId, hyd, hydAll, getSetting } = require('../db');
const U = require('../util');
const G = require('../gov');
const A = require('../auth');
const S = require('../domain/services');
const T = require('../ai/tools');
const AG = require('../ai/agents');

const MEMBER = ['customer', 'buyer', 'consultant', 'office', 'admin'];
const recent = new Map(); // repeat-query guard (SFR-029)
const jobs = new Map();

function limits() { return getSetting('ai_limits', { per_minute: 20, repeat_max: 3, repeat_window_s: 120, max_attach_kb: 200 }); }
function guard(ctx, message) {
  const lim = limits(); const key = ctx.user ? ctx.user.id : 'ip:' + ctx.ip;
  if (!A.rateLimit(`chat:${key}`, lim.per_minute, 60000)) { G.audit(ctx, 'ai.rate_limited', 'user', key, {}); throw new U.HttpError(429, 'AI_RATE_LIMITED', '질의 횟수 제한을 초과했습니다. 잠시 후 다시 시도해 주세요. / Query limit exceeded, please retry shortly.'); }
  const norm = message.toLowerCase().replace(/\s+/g, ' ').trim(); const now = Date.now();
  const arr = (recent.get(key + '|' + norm) || []).filter((t) => now - t < lim.repeat_window_s * 1000); arr.push(now); recent.set(key + '|' + norm, arr);
  if (arr.length > lim.repeat_max) { G.audit(ctx, 'ai.repeat_blocked', 'user', key, { q: norm.slice(0, 80) }); throw new U.HttpError(429, 'AI_REPEAT_BLOCKED', '동일하거나 유사한 질의가 반복되어 제한되었습니다. / Repeated identical queries are limited.'); }
}
function cleanAttachments(list) {
  const lim = limits(); const out = [];
  for (const a of (Array.isArray(list) ? list : []).slice(0, 5)) {
    const name = String(a.name || 'file').slice(0, 120); const ext = name.split('.').pop().toLowerCase();
    if (!['txt', 'csv', 'md', 'json'].includes(ext)) throw new U.HttpError(422, 'FILE_PARSE_FAILED', `${name}: 이 형식은 텍스트 추출을 지원하지 않습니다(txt·csv·md·json). / Unsupported format; text extraction supports txt, csv, md, json.`);
    const text = String(a.text || ''); if (text.length > lim.max_attach_kb * 1024) throw new U.HttpError(413, 'ATTACHMENT_TOO_LARGE', `${name}: 첨부 용량 제한 ${lim.max_attach_kb}KB를 초과했습니다.`);
    out.push({ name, text });
  }
  return out;
}

api.post('/api/ai/chat', async (ctx) => {
  const message = String(ctx.body.message || '').trim();
  if (!message) throw U.bad('message is required', 'VALIDATION');
  if (message.length > 4000) throw U.bad('message too long (max 4000)', 'VALIDATION');
  guard(ctx, message);
  const attachments = cleanAttachments(ctx.body.attachments);
  const locale = ctx.body.locale === 'en' ? 'en' : 'ko';
  const base = { ctx, message, locale, sessionId: ctx.body.session_id || null, projectId: ctx.body.project_id || null, attachments };
  if (ctx.query.stream === '1') {
    ctx.sse = true; const res = ctx.res;
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    try {
      const pace = (ms) => new Promise((r) => setTimeout(r, ms));
      const pending = [];
      const r = await AG.chat({ ...base, emit: (e) => pending.push(e) });
      for (const e of pending) { if (e.type === 'step') { send('step', e); await pace(70); } }
      // answer is streamed in chunks (transport streaming of the composed answer; see LIMITATIONS)
      const text = r.answer || ''; for (let i = 0; i < text.length; i += 24) { send('token', { text: text.slice(i, i + 24) }); await pace(8); }
      send('final', r); res.end();
    } catch (e) { send('error', { code: e.code || 'ERROR', message: e.message }); res.end(); }
    return;
  }
  return AG.chat(base);
}, { roles: [...MEMBER], auth: false });

// anonymous visitors may use the public assistant (limited tools) — handled by tool role checks
api.get('/api/ai/sessions', (ctx) => {
  let rows = hydAll(q.all('SELECT s.*, (SELECT COUNT(*) FROM chat_messages m WHERE m.session_id=s.id) AS n FROM chat_sessions s WHERE user_id=? ORDER BY starred DESC, updated_at DESC', ctx.user.id));
  if (ctx.query.q) { const qn = ctx.query.q.toLowerCase(); const ids = new Set(q.all('SELECT DISTINCT session_id FROM chat_messages WHERE lower(content) LIKE ?', `%${qn}%`).map((r) => r.session_id)); rows = rows.filter((r) => ids.has(r.id) || r.title.toLowerCase().includes(qn)); }
  if (ctx.query.project_id) rows = rows.filter((r) => r.project_id === ctx.query.project_id);
  return { items: rows };
}, { roles: MEMBER });
const ownSession = (ctx) => { const s = hyd(q.get('SELECT * FROM chat_sessions WHERE id=?', ctx.params.id)); if (!s || s.user_id !== ctx.user.id) throw U.notFound('Session not found'); return s; };
api.get('/api/ai/sessions/:id', (ctx) => { const s = ownSession(ctx); return { session: s, messages: hydAll(q.all('SELECT * FROM chat_messages WHERE session_id=? ORDER BY created_at, id', s.id)) }; }, { roles: MEMBER });
api.patch('/api/ai/sessions/:id', (ctx) => { const s = ownSession(ctx); const p = {}; if (ctx.body.title) p.title = String(ctx.body.title).slice(0, 80); if (ctx.body.starred !== undefined) p.starred = ctx.body.starred ? 1 : 0; q.update('chat_sessions', s.id, p); return { ok: true }; }, { roles: MEMBER });
api.del('/api/ai/sessions/:id', (ctx) => { const s = ownSession(ctx); q.run('DELETE FROM chat_messages WHERE session_id=?', s.id); q.run('DELETE FROM chat_sessions WHERE id=?', s.id); G.audit(ctx, 'ai.session_deleted', 'session', s.id, {}); return { ok: true }; }, { roles: MEMBER });
api.post('/api/ai/sessions/:id/summarize', (ctx) => {
  const s = ownSession(ctx); const msgs = q.all('SELECT role, content FROM chat_messages WHERE session_id=? ORDER BY created_at, id', s.id);
  const users = msgs.filter((m) => m.role === 'user').map((m) => m.content); const last = msgs.filter((m) => m.role === 'assistant').slice(-1)[0];
  const summary = `질문 ${users.length}건: ${users.map((u2) => '“' + u2.slice(0, 40) + '”').join(' → ')}\n최근 결론: ${last ? (last.content.split('\n')[1] || '').slice(0, 160) : '-'}`;
  q.update('chat_sessions', s.id, { summary }); return { summary };
}, { roles: MEMBER });
api.get('/api/ai/sessions/:id/export', (ctx) => {
  const s = ownSession(ctx); const msgs = hydAll(q.all('SELECT * FROM chat_messages WHERE session_id=? ORDER BY created_at, id', s.id)); const fmt = (ctx.query.fmt || 'txt').toLowerCase();
  const fname = `kotra-chat-${s.id}.${fmt}`;
  if (fmt === 'json') return { __raw: true, type: 'application/json; charset=utf-8', headers: { 'content-disposition': `attachment; filename="${fname}"` }, body: JSON.stringify({ session: s, messages: msgs }, null, 2) };
  if (fmt === 'html') return { __raw: true, type: 'text/html; charset=utf-8', headers: { 'content-disposition': `attachment; filename="${fname}"` }, body: `<!doctype html><meta charset="utf-8"><title>${s.title.replace(/[<>&]/g, '')}</title><body style="font-family:sans-serif;max-width:760px;margin:2rem auto">${msgs.map((m) => `<h4>${m.role === 'user' ? 'Q' : 'A'}</h4><pre style="white-space:pre-wrap">${String(m.content).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))}</pre>`).join('')}</body>` };
  return { __raw: true, type: 'text/plain; charset=utf-8', headers: { 'content-disposition': `attachment; filename="${fname}"` }, body: msgs.map((m) => `[${m.role === 'user' ? 'Q' : 'A'}] ${m.content}`).join('\n\n') };
}, { roles: MEMBER });

api.post('/api/ai/feedback', (ctx) => {
  const b = ctx.body; const m = q.get('SELECT m.*, s.user_id FROM chat_messages m JOIN chat_sessions s ON s.id=m.session_id WHERE m.id=?', b.message_id);
  if (!m || m.user_id !== ctx.user.id) throw U.notFound('Message not found');
  const kind = b.kind === 'ERROR_REPORT' ? 'ERROR_REPORT' : 'RATING'; const rating = b.rating ? Math.max(1, Math.min(5, Math.round(b.rating))) : null;
  if (kind === 'RATING' && !rating) throw U.bad('rating 1-5 required', 'VALIDATION');
  if (rating) q.update('chat_messages', m.id, { rating });
  q.insert('message_feedback', { id: nextId('FB', 4), message_id: m.id, user_id: ctx.user.id, rating, kind, comment: U.maskPII(String(b.comment || '')).slice(0, 500), status: 'OPEN', created_at: U.iso() });
  G.audit(ctx, 'ai.feedback', 'message', m.id, { kind, rating });
  return { ok: true };
}, { roles: MEMBER });

// action buttons rendered in answers → every action re-enters the tool layer (permission, risk, audit)
api.post('/api/ai/action', (ctx) => {
  const b = ctx.body; const env = { ctx, runId: ctx.body.trace_id || 'ACT', lang: b.lang === 'en' ? 'en' : 'ko' };
  const run = (tool, input) => { const r = T.runTool(env, tool, input); if (r.error && r.status === 'BLOCKED') throw U.forbidden(r.message || r.error, r.error); if (r.error) throw new U.HttpError(r.http || 400, r.error, r.message || r.error); return r; };
  switch (b.type) {
    case 'draft_application': { const r = run('document.generate', { type: 'application', program_id: b.program_id }); return { type: 'application', application: r.output.application, missing: r.output.missing, tool_run: r.id }; }
    case 'draft_email': { const r = run('document.generate', { type: 'email', buyer_id: b.buyer_id }); return { type: 'email', ...r.output, tool_run: r.id }; }
    case 'request_match': { const r = run('matching.request', { event_id: b.event_id, buyer_id: b.buyer_id, message: b.message }); return { type: 'approval', approval_id: r.output.approval_id, tool_run: r.id }; }
    case 'send_email': { const r = run('email.send', { to: b.to, subject: b.subject, body: b.body }); return { type: 'approval', approval_id: r.output.approval_id, tool_run: r.id }; }
    case 'submit_application': { const r = run('application.submit', { application_id: b.application_id }); return { type: r.output.approval_id ? 'approval' : 'validation', ...r.output, tool_run: r.id }; }
    case 'save_buyer': { const company = S.companyOf(ctx.user); if (!company) throw U.forbidden('Company required'); q.run('INSERT OR IGNORE INTO buyer_favorites(company_id,buyer_id,created_at) VALUES(?,?,?)', company.id, b.buyer_id, U.iso()); S.advanceJourney(company.id, 4, 'IN_PROGRESS', `바이어 저장 ${b.buyer_id}`); G.audit(ctx, 'buyer.favorite', 'buyer', b.buyer_id, { on: true, via: 'ai' }); return { type: 'saved', buyer_id: b.buyer_id }; }
    case 'save_checklist': { const id = nextId('SV', 4); q.insert('saved_items', { id, user_id: ctx.user.id, kind: 'checklist', ref_id: b.data && b.data.country, title: (b.data && b.data.title) || 'Checklist', payload: JSON.stringify(b.data || {}), created_at: U.iso() }); if (ctx.user.company_id) S.advanceJourney(ctx.user.company_id, 3, 'IN_PROGRESS', '규제 체크리스트 저장'); G.audit(ctx, 'checklist.saved', 'saved', id, {}); return { type: 'saved', id }; }
    case 'consult_expert': { const r = run('consultation.create', { title: 'AI 수출비서 연계 전문가 상담', body: String(b.prefill || '').slice(0, 2000) + '\n\n(AI 수출비서에서 근거 부족/전문가 확인 요청으로 연결됨)', channel: 'ONLINE' }); return { type: 'consultation', ...r.output, tool_run: r.id }; }
    default: throw U.bad('Unknown action type');
  }
}, { roles: MEMBER });

// async report job (spec: POST /api/ai/report, GET /api/ai/jobs/{id})
api.post('/api/ai/report', (ctx) => {
  const b = ctx.body; const id = nextId('JOB', 4);
  const msg = String(b.message || `${b.country || ''} ${b.product || ''} 시장진출 보고서를 만들어줘`).trim();
  const job = { id, user_id: ctx.user.id, status: 'RUNNING', progress: 5, steps: [], result: null, started: Date.now(), error: null };
  jobs.set(id, job); setTimeout(() => jobs.delete(id), 3600e3);
  guard(ctx, msg + ' ' + id);
  AG.chat({ ctx, message: msg + ' 보고서', locale: b.locale === 'en' ? 'en' : 'ko', emit: (e) => { if (e.type === 'step') { job.steps.push({ label: e.label, kind: e.kind }); job.progress = Math.min(95, job.progress + 12); } } })
    .then((r) => { job.status = r.abstained || r.blocked ? 'FAILED' : 'DONE'; job.progress = 100; job.result = { trace_id: r.trace_id, answer: r.answer, artifact: r.artifact, sources: r.sources, abstained: r.abstained }; if (job.status === 'FAILED') job.error = r.abstained ? 'INSUFFICIENT_EVIDENCE' : 'BLOCKED'; })
    .catch((e) => { job.status = 'FAILED'; job.error = String(e.message || e); });
  return { job_id: id, status: 'RUNNING' };
}, { roles: MEMBER });
api.get('/api/ai/jobs/:id', (ctx) => { const j = jobs.get(ctx.params.id); if (!j || j.user_id !== ctx.user.id) throw U.notFound('Job not found'); return { id: j.id, status: j.status, progress: j.progress, steps: j.steps, elapsed_ms: Date.now() - j.started, result: j.result, error: j.error }; }, { roles: MEMBER });

// prompt library (SFR-027)
api.get('/api/prompts', (ctx) => ({ items: q.all('SELECT * FROM prompt_library WHERE user_id=? OR shared=1 ORDER BY shared, created_at DESC', ctx.user.id) }), { roles: MEMBER });
api.post('/api/prompts', (ctx) => { const b = ctx.body; if (!b.title || !b.body) throw U.bad('title and body required', 'VALIDATION'); const id = nextId('PRL', 4); q.insert('prompt_library', { id, user_id: ctx.user.id, title: String(b.title).slice(0, 80), body: String(b.body).slice(0, 2000), category: 'user', shared: 0, uses: 0, created_at: U.iso() }); return { id }; }, { roles: MEMBER });
api.del('/api/prompts/:id', (ctx) => { q.run('DELETE FROM prompt_library WHERE id=? AND user_id=?', ctx.params.id, ctx.user.id); return { ok: true }; }, { roles: MEMBER });
api.post('/api/prompts/:id/use', (ctx) => { q.run('UPDATE prompt_library SET uses=uses+1 WHERE id=?', ctx.params.id); return { ok: true }; }, { roles: MEMBER });

api.get('/api/ai/starters', (ctx) => {
  const top = q.all("SELECT question, COUNT(*) n FROM agent_runs WHERE status='OK' AND length(question)<80 GROUP BY question ORDER BY n DESC LIMIT 4");
  return {
    suggested: [{ ko: '베트남에 화장품을 수출하려는데 시장성, 인증, 바이어, 지원사업을 한 번에 알려줘', en: 'I want to export cosmetics to Vietnam — tell me the market, certification, buyers and support programs at once' }, { ko: '미국 MoCRA 대응 체크리스트를 만들어줘', en: 'Create a MoCRA compliance checklist for the US' }, { ko: 'Incoterms FOB와 CIF 차이를 알려줘', en: 'What is the difference between FOB and CIF under Incoterms?' }, { ko: '신청 가능한 지원사업을 추천해줘', en: 'Recommend programs I can apply to' }, { ko: '독점 판매 계약서에서 점검할 조항을 알려줘', en: 'What should I check in an exclusive distribution contract?' }],
    popular: top.map((t) => t.question), agents: [['market', '시장분석', 'Market analysis'], ['buyer', '바이어 찾기', 'Find buyers'], ['regulation', '규제·인증', 'Regulation'], ['program', '지원사업', 'Programs'], ['contract', '계약·문서', 'Contracts & docs'], ['report', '보고서', 'Reports']],
  };
}, { roles: MEMBER });
