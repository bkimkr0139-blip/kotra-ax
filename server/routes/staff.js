'use strict';
const { api } = require('../router');
const { q, nextId, hyd, hydAll } = require('../db');
const U = require('../util');
const G = require('../gov');
const S = require('../domain/services');
const RAG = require('../ai/rag');
const NLP = require('../ai/nlp');
const T = require('../ai/tools');
const { summarize } = require('../domain/summarize');
const STT = require('../domain/stt_samples');
const { COUNTRIES, PRODUCTS } = require('../seed/catalog');
const CBY = Object.fromEntries(COUNTRIES.map((c) => [c.code, c]));

const STAFF = ['consultant', 'office', 'admin'];
const CONSULT = ['consultant', 'admin'];
const like = (s, qn) => String(s || '').toLowerCase().includes(String(qn).toLowerCase());

// =============== Consultation desk (Single View) ===============
api.get('/api/staff/consultations', (ctx) => {
  const f = ctx.query; let rows = hydAll(q.all('SELECT c.*, co.name AS company_name, co.name_en AS company_name_en FROM consultations c LEFT JOIN companies co ON co.id=c.company_id ORDER BY c.created_at DESC'));
  if (f.status) rows = rows.filter((r) => r.status === f.status); if (f.channel) rows = rows.filter((r) => r.channel === f.channel);
  if (f.mine === '1') rows = rows.filter((r) => r.assigned_to === ctx.user.id);
  if (f.q) rows = rows.filter((r) => like(r.title, f.q) || like(r.company_name, f.q) || like(r.id, f.q));
  const seeX = ctx.user.role === 'consultant' || ctx.user.role === 'admin';
  rows = rows.map((r) => ({ ...r, extra_care: seeX ? r.extra_care : undefined, body: undefined, draft_pending: !!q.get("SELECT 1 x FROM consultation_summaries WHERE consultation_id=? AND status='DRAFT'", r.id) }));
  const counts = {}; rows.forEach((r) => { counts[r.status] = (counts[r.status] || 0) + 1; });
  return { items: rows.slice(0, 120), counts, total: rows.length };
}, { roles: STAFF });
api.get('/api/staff/consultations/:id', (ctx) => {
  const c = hyd(q.get('SELECT * FROM consultations WHERE id=?', ctx.params.id)); if (!c) throw U.notFound('Consultation not found');
  G.audit(ctx, 'consultation.viewed', 'consultation', c.id, { sensitive: true }); // access history (SFR-014)
  const seeX = ctx.user.role === 'consultant' || ctx.user.role === 'admin';
  const company = c.company_id ? S.getCompany(c.company_id) : null;
  const cust = c.user_id ? q.get('SELECT id,name,name_en,email,title FROM users WHERE id=?', c.user_id) : null;
  const history = hydAll(q.all('SELECT id,title,channel,status,topic,created_at FROM consultations WHERE company_id=? AND id<>? ORDER BY created_at DESC LIMIT 8', c.company_id || '', c.id));
  const applications = c.company_id ? q.all('SELECT a.id,a.status,p.title_ko,p.title_en,a.created_at FROM applications a JOIN programs p ON p.id=a.program_id WHERE a.company_id=?', c.company_id) : [];
  const matches = c.company_id ? q.all('SELECT m.id,m.status,m.slot_start,b.name AS buyer,e.title_ko FROM match_requests m JOIN buyers b ON b.id=m.buyer_id JOIN events e ON e.id=m.event_id WHERE m.company_id=? ORDER BY m.updated_at DESC LIMIT 6', c.company_id) : [];
  const recs = company ? S.recommendPrograms(company, { limit: 4 }).map((p) => ({ id: p.id, title_ko: p.title_ko, title_en: p.title_en, recommend: p.recommend, d_day: p.d_day })) : [];
  return {
    consultation: { ...c, extra_care: seeX ? c.extra_care : undefined },
    customer: cust ? { ...cust, email: U.maskEmail(cust.email) } : null,
    company: company ? { id: company.id, name: company.name, name_en: company.name_en, industry: company.industry, product: company.product, size: company.size, employees: company.employees, export_stage: company.export_stage, target_markets: company.target_markets, region: company.region, biz_no: company.biz_no ? company.biz_no.slice(0, 3) + '-**-*****' : null, readiness: company.readiness } : null,
    extra_care: seeX && company ? { flagged: !!c.extra_care, note: c.extra_care ? '지속 관리 대상(시연 값) — 우선 응대' : '해당 없음', scope: 'SENSITIVE' } : null,
    messages: q.all('SELECT * FROM consultation_messages WHERE consultation_id=? ORDER BY COALESCE(at_sec, 0), created_at, id', c.id),
    summary: hyd(q.get('SELECT * FROM consultation_summaries WHERE consultation_id=? ORDER BY created_at DESC LIMIT 1', c.id)),
    history, applications, matches, recommended_programs: recs, transfers: hydAll(q.all('SELECT * FROM consultation_transfers WHERE consultation_id=? ORDER BY created_at DESC', c.id)),
    status_history: G.history('consultation', c.id), stt_jobs: hydAll(q.all('SELECT id,filename,mode,state,latency_ms,created_at FROM stt_jobs WHERE consultation_id=?', c.id)),
  };
}, { roles: STAFF });
api.post('/api/staff/consultations/:id/assign', (ctx) => {
  const c = q.get('SELECT * FROM consultations WHERE id=?', ctx.params.id); if (!c) throw U.notFound();
  const to = ctx.body.user_id || ctx.user.id; const u = q.get("SELECT id,role FROM users WHERE id=? AND role IN ('consultant','admin','office')", to); if (!u) throw U.bad('Invalid assignee');
  if (c.status === 'OPEN') G.transition(ctx, 'consultation', c.id, 'AI_CLASSIFIED', 'auto-classified');
  const cur = q.get('SELECT status FROM consultations WHERE id=?', c.id).status;
  if (cur === 'AI_CLASSIFIED') G.transition(ctx, 'consultation', c.id, 'ASSIGNED', `assigned to ${to}`, { assigned_to: to }); else q.update('consultations', c.id, { assigned_to: to, updated_at: U.iso() });
  G.audit(ctx, 'consultation.assigned', 'consultation', c.id, { to }); if (to !== ctx.user.id) G.notify(to, 'consultation', `상담 ${c.id} 배정`, c.title, '#/staff/consult');
  return { ok: true };
}, { roles: CONSULT });
api.post('/api/staff/consultations/:id/status', (ctx) => {
  const to = ctx.body.to; if (!['IN_PROGRESS', 'RESOLVED', 'CLOSED'].includes(to)) throw U.bad('to must be IN_PROGRESS, RESOLVED or CLOSED');
  const c = q.get('SELECT * FROM consultations WHERE id=?', ctx.params.id); if (!c) throw U.notFound();
  if (to === 'CLOSED') { const sum = q.get("SELECT status FROM consultation_summaries WHERE consultation_id=? ORDER BY created_at DESC LIMIT 1", c.id); if (c.channel === 'PHONE' && (!sum || sum.status !== 'CONFIRMED')) throw U.conflict('상담일지(요약)를 확정해야 종결할 수 있습니다 / Confirm the journal before closing', 'JOURNAL_REQUIRED'); }
  G.transition(ctx, 'consultation', c.id, to, ctx.body.note || '');
  if (to === 'RESOLVED' && c.user_id) G.notify(c.user_id, 'consultation', `상담 ${c.id} 답변이 완료되었습니다`, c.title, '#/mykotra/consults');
  return { status: to };
}, { roles: CONSULT });
api.post('/api/staff/consultations/:id/reply', (ctx) => {
  const c = q.get('SELECT * FROM consultations WHERE id=?', ctx.params.id); if (!c) throw U.notFound(); const body = String(ctx.body.body || '').trim(); if (!body) throw U.bad('Empty reply', 'VALIDATION');
  if (c.status === 'ASSIGNED') G.transition(ctx, 'consultation', c.id, 'IN_PROGRESS', 'first reply');
  q.insert('consultation_messages', { id: nextId('CM', 5), consultation_id: c.id, sender: 'consultant', sender_id: ctx.user.id, speaker: 'agent', body: U.maskPII(body).slice(0, 3000), at_sec: null, created_at: U.iso() });
  q.update('consultations', c.id, { updated_at: U.iso() }); if (c.user_id) G.notify(c.user_id, 'consultation', `상담 ${c.id}에 답변이 등록되었습니다`, body.slice(0, 60), '#/mykotra/consults');
  return { ok: true };
}, { roles: CONSULT });
function transcriptLines(cid) { return q.all('SELECT speaker, body AS text, COALESCE(at_sec,0) AS at FROM consultation_messages WHERE consultation_id=? ORDER BY COALESCE(at_sec,0), created_at, id', cid).map((m) => ({ speaker: m.speaker === 'agent' ? 'agent' : 'customer', text: m.text, at: m.at })); }
api.post('/api/staff/consultations/:id/summary/generate', (ctx) => {
  const c = q.get('SELECT * FROM consultations WHERE id=?', ctx.params.id); if (!c) throw U.notFound();
  const t0 = Date.now(); const lines = transcriptLines(c.id); if (!lines.length) throw U.bad('No conversation to summarise');
  const sm = summarize(lines); const ex = q.get('SELECT * FROM consultation_summaries WHERE consultation_id=? ORDER BY created_at DESC LIMIT 1', c.id);
  if (ex && ex.status === 'CONFIRMED') throw U.conflict('Already confirmed', 'ALREADY_CONFIRMED');
  const row = { id: ex ? ex.id : nextId('SUM', 4), consultation_id: c.id, status: 'DRAFT', draft: JSON.stringify(sm), final: null, confidence: sm.confidence, source: 'ai', confirmed_by: null, created_at: ex ? ex.created_at : U.iso(), updated_at: U.iso() };
  q.upsert('consultation_summaries', row);
  G.audit(ctx, 'summary.generated', 'consultation', c.id, { confidence: sm.confidence, ms: Date.now() - t0 });
  return { summary: hyd(q.get('SELECT * FROM consultation_summaries WHERE id=?', row.id)), latency_ms: Date.now() - t0, manual_recommended: sm.low_confidence };
}, { roles: CONSULT });
api.put('/api/staff/consultations/:id/summary', (ctx) => {
  const s = hyd(q.get('SELECT * FROM consultation_summaries WHERE consultation_id=? ORDER BY created_at DESC LIMIT 1', ctx.params.id)); const c = q.get('SELECT id FROM consultations WHERE id=?', ctx.params.id);
  if (!c) throw U.notFound(); if (s && s.status === 'CONFIRMED') throw U.conflict('Confirmed journal is locked', 'LOCKED');
  const keys = ['topic', 'inquiry', 'answer', 'keywords', 'handling', 'followup', 'transfer_needed', 'recommended_services', 'actions']; const base = s && s.draft ? s.draft : {}; const fin = { ...base };
  for (const k of keys) if (ctx.body[k] !== undefined) fin[k] = typeof ctx.body[k] === 'string' ? U.maskPII(ctx.body[k]).slice(0, 1500) : ctx.body[k];
  const row = { id: s ? s.id : nextId('SUM', 4), consultation_id: c.id, status: 'EDITED', draft: s ? JSON.stringify(s.draft) : JSON.stringify({}), final: JSON.stringify(fin), confidence: s ? s.confidence : null, source: s ? (s.source === 'ai' ? 'ai+human' : s.source) : 'manual', confirmed_by: null, created_at: s ? s.created_at : U.iso(), updated_at: U.iso() };
  q.upsert('consultation_summaries', row); G.audit(ctx, 'summary.edited', 'consultation', c.id, { fields: Object.keys(ctx.body) });
  return { summary: hyd(q.get('SELECT * FROM consultation_summaries WHERE id=?', row.id)) };
}, { roles: CONSULT });
api.post('/api/staff/consultations/:id/summary/confirm', (ctx) => {
  const c = hyd(q.get('SELECT * FROM consultations WHERE id=?', ctx.params.id)); if (!c) throw U.notFound();
  const s = hyd(q.get('SELECT * FROM consultation_summaries WHERE consultation_id=? ORDER BY created_at DESC LIMIT 1', c.id)); if (!s) throw U.conflict('Generate or write a journal first', 'NO_SUMMARY');
  if (s.status === 'CONFIRMED') throw U.conflict('Already confirmed', 'ALREADY_CONFIRMED');
  const fin = s.final || s.draft; if (!fin || !fin.inquiry) throw U.bad('Inquiry field is required', 'VALIDATION');
  if (ctx.body.confirm !== true) throw U.bad('Explicit confirmation required (confirm=true)', 'CONFIRM_REQUIRED');
  const sat = ctx.body.satisfaction ? Math.max(1, Math.min(10, Math.round(ctx.body.satisfaction))) : null;
  const finalObj = { ...fin, satisfaction: sat };
  q.update('consultation_summaries', s.id, { status: 'CONFIRMED', final: JSON.stringify(finalObj), confirmed_by: ctx.user.id, updated_at: U.iso() });
  G.audit(ctx, 'summary.confirmed', 'consultation', c.id, { by: ctx.user.id, edited: s.status === 'EDITED' });
  G.integrationEvent('CRM·사업관리 DB', 'consultation.journal.registered', { id: c.id }); G.integrationEvent('통합 데이터 저장소(Lakehouse)', 'consultation.summary.loaded', { id: c.id });
  if (c.status === 'IN_PROGRESS') G.transition(ctx, 'consultation', c.id, 'RESOLVED', 'journal confirmed');
  const recs = (fin.recommended_services || []).map((id) => q.get('SELECT id,title_ko FROM programs WHERE id=?', id)).filter(Boolean);
  if (c.user_id && recs.length) G.notify(c.user_id, 'program', '상담 후속 추천 지원사업', recs.map((r) => r.title_ko).join(', '), `#/programs/${recs[0].id}`);
  if (c.company_id) S.advanceJourney(c.company_id, 5, 'IN_PROGRESS', `상담 ${c.id} 완료`);
  return { summary: hyd(q.get('SELECT * FROM consultation_summaries WHERE id=?', s.id)), followup_programs: recs, integration: ['CRM 상담일지 등록(Mock)', 'Lakehouse 적재(Mock)'] };
}, { roles: CONSULT });
api.post('/api/staff/consultations/:id/transfer', (ctx) => {
  const c = q.get('SELECT * FROM consultations WHERE id=?', ctx.params.id); if (!c) throw U.notFound();
  const b = ctx.body; if (!b.to_target || !b.reason) throw U.bad('to_target and reason are required', 'VALIDATION');
  const id = nextId('TRF', 4);
  q.insert('consultation_transfers', { id, consultation_id: c.id, from_user: ctx.user.id, to_target: String(b.to_target).slice(0, 80), reason: U.maskPII(String(b.reason)).slice(0, 500), status: 'SENT', approval_id: null, created_at: U.iso() });
  G.integrationEvent('사업관리시스템 VOC 통합관리', 'consultation.transferred', { id: c.id, to: b.to_target }); G.audit(ctx, 'consultation.transferred', 'consultation', c.id, { to: b.to_target });
  const off = q.get("SELECT id FROM users WHERE role='office' AND office LIKE ?", `%${String(b.to_target).slice(0, 3)}%`); if (off) G.notify(off.id, 'consultation', `이관된 상담 ${c.id}`, b.reason.slice(0, 60), '#/staff/consult');
  return { id, status: 'SENT' };
}, { roles: CONSULT });
api.post('/api/staff/consultations/:id/callback', (ctx) => {
  const c = q.get('SELECT * FROM consultations WHERE id=?', ctx.params.id); if (!c) throw U.notFound(); const at = String(ctx.body.at || ''); if (!/^\d{4}-\d{2}-\d{2}/.test(at)) throw U.bad('at must be a date', 'VALIDATION');
  q.update('consultations', c.id, { callback_at: at }); G.notify(ctx.user.id, 'callback', `콜백 예약: ${c.id}`, at, '#/staff/consult'); G.audit(ctx, 'consultation.callback', 'consultation', c.id, { at });
  return { ok: true };
}, { roles: CONSULT });

// =============== STT (SFR-018) ===============
const STAGES = ['UPLOAD', 'STT', 'DIARIZATION', 'PII_MASK', 'SUMMARY', 'DRAFT', 'REVIEW'];
function runStt(ctx, { filename, mode, sample, lines, consultation_id }) {
  const id = nextId('STT', 4); const t0 = Date.now(); const stages = [];
  const mark = (name, status = 'Success', extra = {}) => stages.push({ name, status, at: Date.now() - t0, ...extra });
  const ext = (filename || '').split('.').pop().toLowerCase();
  if (mode !== 'BROWSER' && !['wav', 'mp3', 'm4a', 'webm', 'ogg', 'flac'].includes(ext)) {
    q.insert('stt_jobs', { id, consultation_id: consultation_id || null, filename, mode: 'MOCK', state: 'FAILED', stages: JSON.stringify([{ name: 'UPLOAD', status: 'Failed', at: 0 }]), transcript: null, masked_count: 0, duration_s: null, latency_ms: 0, created_by: ctx.user.id, error: 'FILE_PARSE_FAILED: 지원하지 않는 오디오 형식입니다 (wav, mp3, m4a, webm, ogg, flac)', created_at: U.iso() });
    return hyd(q.get('SELECT * FROM stt_jobs WHERE id=?', id));
  }
  mark('UPLOAD');
  let src = lines; let note = null;
  if (mode === 'BROWSER') note = 'BROWSER_STT: 브라우저 음성인식(Web Speech API)으로 변환된 텍스트입니다';
  else { const keys = Object.keys(STT); const k = sample && STT[sample] ? sample : keys[Math.abs([...filename].reduce((a, ch) => a + ch.charCodeAt(0), 0)) % keys.length]; src = STT[k].lines; note = `MOCK_STT: 실제 음성인식이 아닌 샘플 대본 라이브러리(${k})를 사용했습니다`; }
  mark('STT', mode === 'BROWSER' ? 'Success' : 'Mock');
  mark('DIARIZATION', mode === 'BROWSER' ? 'Manual' : 'Mock', { note: '화자 구분(상담원/고객)' });
  let masked = 0;
  const maskedLines = src.map((l) => { const m = U.maskPII(l.text).replace(/\d{3}-\d{2}-\d{5}/g, '***-**-*****'); if (m !== l.text) masked++; return { speaker: l.speaker, at: l.at, text: m }; });
  mark('PII_MASK', 'Success', { masked });
  const sm = summarize(maskedLines); mark('SUMMARY'); mark('DRAFT');
  if (consultation_id) {
    const c = q.get('SELECT id FROM consultations WHERE id=?', consultation_id);
    if (c) {
      q.run('DELETE FROM consultation_messages WHERE consultation_id=? AND at_sec IS NOT NULL', c.id);
      maskedLines.forEach((l) => q.insert('consultation_messages', { id: nextId('CM', 5), consultation_id: c.id, sender: l.speaker === 'agent' ? 'consultant' : 'customer', sender_id: null, speaker: l.speaker, body: l.text, at_sec: l.at, created_at: U.iso() }));
      const ex = q.get('SELECT * FROM consultation_summaries WHERE consultation_id=? ORDER BY created_at DESC LIMIT 1', c.id);
      if (!ex || ex.status !== 'CONFIRMED') q.upsert('consultation_summaries', { id: ex ? ex.id : nextId('SUM', 4), consultation_id: c.id, status: 'DRAFT', draft: JSON.stringify(sm), final: null, confidence: sm.confidence, source: 'ai', confirmed_by: null, created_at: ex ? ex.created_at : U.iso(), updated_at: U.iso() });
    }
  }
  mark('REVIEW', 'Pending', { note: '상담원 검토·확정 대기' });
  q.insert('stt_jobs', { id, consultation_id: consultation_id || null, filename, mode: mode === 'BROWSER' ? 'BROWSER' : 'MOCK', state: 'REVIEW_PENDING', stages: JSON.stringify(stages), transcript: JSON.stringify({ lines: maskedLines, summary: sm, note }), masked_count: masked, duration_s: maskedLines.length ? maskedLines[maskedLines.length - 1].at : 0, latency_ms: Date.now() - t0, created_by: ctx.user.id, error: null, created_at: U.iso() });
  G.audit(ctx, 'stt.processed', 'stt', id, { mode, masked, consultation_id });
  return hyd(q.get('SELECT * FROM stt_jobs WHERE id=?', id));
}
api.post('/api/stt', (ctx) => {
  const b = ctx.body; const mode = b.mode === 'BROWSER' ? 'BROWSER' : 'FILE';
  if (mode === 'BROWSER') { if (!Array.isArray(b.lines) || !b.lines.length) throw U.bad('lines required', 'VALIDATION'); b.lines = b.lines.slice(0, 400).map((l, i) => ({ speaker: l.speaker === 'agent' ? 'agent' : 'customer', at: Number(l.at) || i * 5, text: String(l.text || '').slice(0, 800) })); }
  return runStt(ctx, { filename: b.filename || (mode === 'BROWSER' ? 'browser-mic.webm' : 'upload.wav'), mode, sample: b.sample, lines: b.lines, consultation_id: b.consultation_id });
}, { roles: CONSULT });
api.get('/api/stt/samples', () => ({ samples: Object.entries(STT).map(([k, v]) => ({ file: k, title: v.title, duration: v.duration, lines: v.lines.length })) }), { roles: STAFF });
api.get('/api/stt', () => {
  const jobs = hydAll(q.all('SELECT id,consultation_id,filename,mode,state,masked_count,duration_s,latency_ms,error,created_at,stages FROM stt_jobs ORDER BY created_at DESC LIMIT 50'));
  const done = jobs.filter((j) => j.state !== 'FAILED'); const sums = q.all("SELECT final FROM consultation_summaries WHERE status='CONFIRMED'").map((r) => JSON.parse(r.final || '{}')).filter((f) => f.satisfaction);
  return { items: jobs, kpi: { cer: { value: null, label: 'N/A', note: '평가 데이터셋(KOTRA 제공) 없이는 측정하지 않습니다 — 목표 5% 이하는 본사업 검증 항목' }, processing_ms_avg: done.length ? Math.round(done.reduce((a, j) => a + (j.latency_ms || 0), 0) / done.length) : null, summary_satisfaction: sums.length ? U.round(sums.reduce((a, f) => a + f.satisfaction, 0) / sums.length, 1) : null, summary_satisfaction_n: sums.length, failure_rate: jobs.length ? U.round(jobs.filter((j) => j.state === 'FAILED').length / jobs.length * 100, 1) : 0, total: jobs.length } };
}, { roles: STAFF });
api.get('/api/stt/:id', (ctx) => { const j = hyd(q.get('SELECT * FROM stt_jobs WHERE id=?', ctx.params.id)); if (!j) throw U.notFound(); return { job: j }; }, { roles: STAFF });
api.post('/api/stt/:id/retry', (ctx) => { const j = q.get('SELECT * FROM stt_jobs WHERE id=?', ctx.params.id); if (!j) throw U.notFound(); if (j.state !== 'FAILED') throw U.conflict('Only failed jobs can be retried', 'INVALID_STATE'); return runStt(ctx, { filename: ctx.body.filename || 'retry.wav', mode: 'FILE', sample: ctx.body.sample, consultation_id: j.consultation_id }); }, { roles: CONSULT });

// =============== Overseas research workflow (SFR-045~051) ===============
const OFFICE_BY_COUNTRY = { VN: 'U-024', US: 'U-025', JP: 'U-026', AE: 'U-027' };
const researchView = (r) => { const o = hyd(r); o.d_day = o.due_date ? U.dday(o.due_date) : null; o.overdue = o.d_day != null && o.d_day < 0 && !['COMPLETED', 'EVALUATED'].includes(o.status); return o; };
api.get('/api/research', (ctx) => {
  let rows = q.all('SELECT * FROM research_requests ORDER BY updated_at DESC').map(researchView); const f = ctx.query;
  if (ctx.user.role === 'office') rows = rows.filter((r) => r.assignee_id === ctx.user.id || (r.office && ctx.user.office && ctx.user.office.startsWith(String(r.office).slice(0, 2))) || r.requester_id === ctx.user.id);
  if (f.status) rows = rows.filter((r) => r.status === f.status); if (f.country) rows = rows.filter((r) => r.country === f.country); if (f.kind) rows = rows.filter((r) => r.kind === f.kind);
  if (f.overdue === '1') rows = rows.filter((r) => r.overdue); if (f.q) rows = rows.filter((r) => like(r.title, f.q));
  return { items: rows.map((r) => ({ ...r, report: undefined, form: undefined })), total: rows.length };
}, { roles: STAFF });
api.get('/api/research/dashboard', () => {
  const rows = q.all('SELECT * FROM research_requests').map(researchView);
  const byStatus = {}; rows.forEach((r) => { byStatus[r.status] = (byStatus[r.status] || 0) + 1; });
  const offices = {}; rows.forEach((r) => { const o = offices[r.office] || (offices[r.office] = { office: r.office, country: r.country, total: 0, in_progress: 0, delayed: 0, done: 0, evaluated: 0 }); o.total++; if (['ASSIGNED', 'IN_PROGRESS', 'SUBMITTED', 'REVISION_REQUESTED'].includes(r.status)) o.in_progress++; if (r.overdue) o.delayed++; if (['COMPLETED', 'EVALUATED'].includes(r.status)) o.done++; if (r.status === 'EVALUATED') o.evaluated++; });
  const done = rows.filter((r) => ['COMPLETED', 'EVALUATED'].includes(r.status)); const avgDays = done.length ? U.round(done.reduce((a, r) => a + Math.max(0, (new Date(r.updated_at) - new Date(r.created_at)) / 86400000), 0) / done.length, 1) : null;
  const ev = rows.filter((r) => r.evaluation); const avgScore = ev.length ? U.round(ev.reduce((a, r) => a + (r.evaluation.score || 0), 0) / ev.length, 1) : null;
  return { total: rows.length, by_status: byStatus, offices: Object.values(offices).sort((a, b) => b.total - a.total), delayed: rows.filter((r) => r.overdue).length, avg_turnaround_days: avgDays, avg_evaluation: avgScore, due_soon: rows.filter((r) => r.d_day != null && r.d_day >= 0 && r.d_day <= 7 && !['COMPLETED', 'EVALUATED'].includes(r.status)).length, indexed: rows.filter((r) => r.indexed_doc_id).length };
}, { roles: STAFF });
api.post('/api/research', (ctx) => {
  const b = ctx.body; if (!b.title || !b.country) throw U.bad('title and country required', 'VALIDATION'); if (!CBY[b.country]) throw U.bad('Unknown country', 'VALIDATION');
  const id = nextId('RS', 4); const office = (CBY[b.country].office_ko || '').split('·')[0].replace(' 무역관', '');
  q.insert('research_requests', { id, kind: ['GMR', 'GIM', 'DIRECTED'].includes(b.kind) ? b.kind : 'DIRECTED', title: String(b.title).slice(0, 200), title_en: b.title_en || b.title, country: b.country, office, requester_id: ctx.user.id, assignee_id: null, status: 'DRAFT', due_date: b.due_date || U.addDays(U.today(), 21), form: JSON.stringify({ purpose: b.purpose || '', items: b.items || [], format: b.format || 'KOTRA 표준 조사양식' }), opinion: null, report: null, supplement: null, evaluation: null, indexed_doc_id: null, source_type: 'user', is_synthetic: 0, created_at: U.iso(), updated_at: U.iso() });
  q.run('INSERT INTO status_history(entity,entity_id,from_state,to_state,actor_id,note,ts) VALUES(?,?,?,?,?,?,?)', 'research', id, null, 'DRAFT', ctx.user.id, 'created', U.iso()); G.audit(ctx, 'research.created', 'research', id, {});
  return { id };
}, { roles: ['consultant', 'admin', 'office'] });
api.get('/api/research/:id', (ctx) => { const r = q.get('SELECT * FROM research_requests WHERE id=?', ctx.params.id); if (!r) throw U.notFound(); return { research: researchView(r), history: G.history('research', r.id), approval: hyd(q.get("SELECT * FROM approvals WHERE ref_type='research' AND ref_id=? ORDER BY created_at DESC LIMIT 1", r.id)) }; }, { roles: STAFF });
function indexResearch(ctx, r) {
  const rep = r.report || {}; const docId = 'D-' + r.id;
  q.run('DELETE FROM documents WHERE id=?', docId);
  const res = RAG.addDocument({ id: docId, collection_id: 'MARKET', title: `[조사보고서] ${r.title}`, title_en: `[Research] ${r.title_en || r.title}`, text: `${rep.summary || ''} ${rep.body || ''}`.trim(), text_en: `Research report from KOTRA ${r.office} office: ${r.title_en || r.title}. ${(rep.summary || '')}`, org: `KOTRA ${r.office} 무역관`, url: `#/admin/research`, published_at: U.today(), updated_at: U.iso(), country: r.country, hs: null, doc_type: 'research', access_scope: 'PUBLIC', status: 'ACTIVE', uploaded_by: ctx.user.id, source_type: 'research-flywheel', is_synthetic: 0 });
  q.update('research_requests', r.id, { indexed_doc_id: docId });
  q.update('datasets', 'DS-08', { last_sync: U.iso() }); q.update('datasets', 'DS-09', { last_sync: U.iso() });
  const runId = nextId('PRUN', 4); q.insert('pipeline_runs', { id: runId, pipeline_id: 'PL-08', status: 'Success', stages: JSON.stringify(['Source', 'Extract', 'Validate', 'Transform', 'Store', 'Index', 'Serving'].map((n) => ({ name: n, status: 'Success' }))), rows_in: 1, rows_out: 1, rejected: 0, started_at: U.iso(), finished_at: U.iso(), triggered_by: ctx.user.id });
  G.integrationEvent('통합 데이터 저장소(Lakehouse)', 'research.report.loaded', { id: r.id, doc: docId }); G.audit(ctx, 'research.indexed', 'research', r.id, { doc: docId, chunks: res.chunks });
  return { doc_id: docId, chunks: res.chunks, flagged: res.flagged };
}
api.post('/api/research/:id/transition', (ctx) => {
  const r = researchView(q.get('SELECT * FROM research_requests WHERE id=?', ctx.params.id) || (() => { throw U.notFound(); })());
  const b = ctx.body; const to = b.to; const u = ctx.user;
  const isOwnerOffice = u.role === 'office' && (r.assignee_id === u.id || (OFFICE_BY_COUNTRY[r.country] === u.id));
  const isRequester = u.role === 'admin' || r.requester_id === u.id || u.role === 'consultant';
  const need = (ok, msg) => { if (!ok) throw U.forbidden(msg, 'TRANSITION_FORBIDDEN'); };
  if (to === 'ASSIGNED') throw U.conflict('배정은 총괄 승인(HITL)을 통해서만 가능합니다 / Assignment requires approval', 'USE_APPROVAL');
  if (to === 'APPROVAL_REQUESTED') {
    need(isRequester || u.role === 'office', '조사 요청자만 승인을 요청할 수 있습니다');
    const rr = q.tx(() => { const ap = G.requestApproval(ctx, { kind: 'RESEARCH_APPROVAL', refType: 'research', refId: r.id, title: `지시조사 승인 요청: ${r.title}`, risk: 'MEDIUM', approverRole: 'admin', payload: {} }); G.transition(ctx, 'research', r.id, 'APPROVAL_REQUESTED', 'approval requested'); return ap; });
    return { approval_id: rr, status: 'APPROVAL_REQUESTED' };
  }
  if (to === 'IN_PROGRESS') { need(isOwnerOffice || u.role === 'admin', '배정된 무역관 담당자만 접수할 수 있습니다'); if (!r.assignee_id && u.role === 'office') q.update('research_requests', r.id, { assignee_id: u.id }); G.transition(ctx, 'research', r.id, 'IN_PROGRESS', b.note || 'accepted', { opinion: JSON.stringify({ note: String(b.note || '조사 접수 및 일정 확인').slice(0, 400), at: U.iso(), by: u.id }) }); }
  else if (to === 'SUBMITTED') {
    need(isOwnerOffice || u.role === 'admin', '배정된 무역관 담당자만 제출할 수 있습니다');
    const rep = b.report || {}; if (!rep.summary || !rep.body || String(rep.body).length < 30) throw U.bad('보고서 요약과 본문(30자 이상)을 입력하세요', 'VALIDATION');
    G.transition(ctx, 'research', r.id, 'SUBMITTED', 'report submitted', { report: JSON.stringify({ summary: String(rep.summary).slice(0, 600), body: String(rep.body).slice(0, 6000), sources: (rep.sources || []).slice(0, 10) }), supplement: r.status === 'REVISION_REQUESTED' ? JSON.stringify({ ...(r.supplement || {}), resubmitted_at: U.iso() }) : null });
  } else if (to === 'REVISION_REQUESTED') { need(isRequester, '요청 부서만 보완을 요청할 수 있습니다'); if (!b.request) throw U.bad('보완 요청 사유를 입력하세요', 'VALIDATION'); G.transition(ctx, 'research', r.id, 'REVISION_REQUESTED', b.request, { supplement: JSON.stringify({ request: String(b.request).slice(0, 500), at: U.iso(), by: u.id }) }); if (r.assignee_id) G.notify(r.assignee_id, 'research', `보완 요청: ${r.title}`, b.request.slice(0, 60), '#/staff/research'); }
  else if (to === 'COMPLETED') { need(isRequester, '요청 부서만 완료 처리할 수 있습니다'); G.transition(ctx, 'research', r.id, 'COMPLETED', 'accepted'); const fresh = researchView(q.get('SELECT * FROM research_requests WHERE id=?', r.id)); const idx = indexResearch(ctx, fresh); return { status: 'COMPLETED', indexed: idx }; }
  else if (to === 'EVALUATED') { need(isRequester, '요청 부서만 평가할 수 있습니다'); const sc = Math.round(Number(b.score)); if (!(sc >= 1 && sc <= 5)) throw U.bad('score 1-5', 'VALIDATION'); G.transition(ctx, 'research', r.id, 'EVALUATED', 'evaluated', { evaluation: JSON.stringify({ score: sc, comment: String(b.comment || '').slice(0, 300), by: u.id, at: U.iso() }) }); }
  else throw U.bad('Unsupported transition', 'VALIDATION');
  return { status: to };
}, { roles: STAFF });
api.post('/api/research/:id/ai-assist', (ctx) => {
  const r = researchView(q.get('SELECT * FROM research_requests WHERE id=?', ctx.params.id) || (() => { throw U.notFound(); })());
  const ent = NLP.extractEntities(r.title + ' ' + (ctx.body.text || '')); const cc = CBY[r.country];
  const hits = RAG.search({ query: r.title, collections: ['MARKET', 'REGULATION'], k: 3, filters: { country: r.country }, clearance: 3 }).hits;
  return { draft: { summary: `${cc.ko} ${r.title}: 기존 KOTRA 자료 ${hits.length}건을 참고한 조사 초안입니다. 현지 확인이 필요한 항목을 표시했습니다.`, body: `${hits.map((h) => '· ' + (h.text.split(/[.。]/)[0] || '')).join('\n')}\n\n[현지 확인 필요] 최신 수치와 규정은 현지 조사로 보완하세요.`, sources: hits.map((h) => ({ title: h.title, url: h.url })) }, note: 'AI 초안(기존 자료 요약)입니다. 사실 확인과 현지 조사를 통해 보완하세요.', entities: ent };
}, { roles: ['office', 'admin', 'consultant'] });

// =============== Overseas market news agents (SFR-052/053) ===============
const TYPO = { 안됩니다: '안 됩니다', 되요: '돼요', 됬: '됐', 몇일: '며칠', 어떻해: '어떡해', 할께: '할게', 웬지: '왠지', 금새: '금세', 희안: '희한', 설레임: '설렘', 바램: '바람', 있읍니다: '있습니다', 갯수: '개수', 컨텐츠: '콘텐츠', 메세지: '메시지', 어플리케이션: '애플리케이션', 악세사리: '액세서리', 카페트: '카펫', 써비스: '서비스', 쥬스: '주스', 윈도우즈: '윈도' };
const EXAGG = ['100% 보장', '무조건', '최고의', '절대', '확실히 성공'];
const FACT_RE = /(\d[\d,.]*\s*(%|퍼센트|억|만|조|달러|원|명|건|배)|전년\s*(대비|동기)|\d{4}년|시행|개정|법|규정|협정)/;
function correctNews({ type, title, text, lang }) {
  const diffs = []; let out = String(text || '');
  const note = (kind, from, to, reason) => diffs.push({ kind, from, to, reason });
  if (lang === 'en') note('translate', '(English draft)', '(번역 우선 — 번역 어댑터 미연결: Mock)', '외국어 원고는 한국어 문법에 맞게 번역 후 교정해야 하며, MVP에서는 번역 어댑터가 연결되지 않았습니다.');
  for (const [w, c] of Object.entries(TYPO)) { const re = new RegExp(w, 'g'); const n = (out.match(re) || []).length; if (n) { out = out.replace(re, c); note('typo', w, c, n > 1 ? `맞춤법·표기 교정 (${n}회)` : '맞춤법·표기 교정'); } }
  if (/ {2,}/.test(out)) { out = out.replace(/ {2,}/g, ' '); note('spacing', '중복 공백', '단일 공백', '공백 정리'); }
  if (/([.,!?])\1+/.test(out)) { out = out.replace(/([.,!?])\1+/g, '$1'); note('punct', '중복 문장부호', '단일 부호', '문장부호 정리'); }
  out = out.replace(/(?<![\d,.])(\d{5,})(?![\d,])/g, (m) => { const f = Number(m).toLocaleString('en-US'); note('number', m, f, '경제 숫자 표기: 천 단위 구분'); return f; });
  const pii = []; out = out.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|(?:\+?\d{1,3}[-.\s]?)?0\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}/g, (m) => { pii.push(m); return U.maskPII(m); }); if (pii.length) note('pii', `${pii.length}건`, '마스킹', '개인정보(이메일·전화) 마스킹');
  const exagg = EXAGG.filter((w) => out.includes(w)); exagg.forEach((w) => note('banned', w, '(삭제 또는 완화 권고)', '과장·금칙 표현'));
  const sentences = (out.replace(/\s+/g, ' ').match(/[^.!?。]+[.!?。]?/g) || []).map((s) => s.trim()).filter((s) => s.length > 8);
  const factChecks = sentences.filter((s) => FACT_RE.test(s)).slice(0, 8).map((s) => {
    if (/(출처|source|자료)\s*[:：]/i.test(s)) return { sentence: s, status: 'SOURCED', note: '출처 표기 있음' };
    const ent = NLP.extractEntities(s + ' ' + title); const r = RAG.search({ query: s, collections: ['MARKET', 'REGULATION', 'GENERAL'], k: 1, filters: { country: ent.countries[0] || null }, clearance: 3 });
    const h = r.hits[0]; return h && h.relevance >= 0.62 ? { sentence: s, status: 'VERIFIED', source: { doc_id: h.doc_id, title: h.title, org: h.org, url: h.url, relevance: Math.round(h.relevance * 100) } } : { sentence: s, status: 'NEEDS_SOURCE', note: 'KOTRA DB에서 뒷받침 근거를 찾지 못했습니다 — 출처 확인 필요' };
  });
  const ent = NLP.extractEntities(title + ' ' + out); const c0 = ent.countries[0] ? CBY[ent.countries[0]].ko : ''; const p0 = ent.products[0] ? PRODUCTS.find((p) => p.key === ent.products[0]).ko : '';
  const key = sentences.find((s) => FACT_RE.test(s)) || sentences[0] || ''; const short = key.replace(/[.。]$/, '').slice(0, 24);
  const summary = sentences.slice(0, 3).join(' ');
  const titles = [`${[c0, p0].filter(Boolean).join(' ')}, ${short}`.replace(/^, /, ''), `[${type || '트렌드'}] ${[c0, p0].filter(Boolean).join(' ')} 동향 — ${short.slice(0, 16)}`, `${c0 || '해외'} 시장 브리프: ${(p0 || '주요 품목')} 핵심 포인트`].map((t) => t.slice(0, 60));
  return { corrected: out, diffs, fact_checks: factChecks, title_suggestions: titles, summary, flags: { pii: pii.length, banned: exagg.length, unverified: factChecks.filter((f) => f.status === 'NEEDS_SOURCE').length }, stats: { typos: diffs.filter((d) => d.kind === 'typo').length, total_changes: diffs.length } };
}
api.post('/api/news/correct', (ctx) => {
  const b = ctx.body; if (!b.text || String(b.text).length < 20) throw U.bad('원고(20자 이상)를 입력하세요', 'VALIDATION'); if (String(b.text).length > 20000) throw U.bad('원고가 너무 깁니다', 'VALIDATION');
  const lang = NLP.detectLang(b.text); const res = correctNews({ type: b.type, title: b.title || '', text: b.text, lang });
  const id = nextId('NWS', 4);
  q.insert('news_drafts', { id, type: b.type || '트렌드', author_id: ctx.user.id, title: String(b.title || '').slice(0, 160), original: String(b.text), corrected: res.corrected, summary: res.summary, findings: JSON.stringify({ diffs: res.diffs, fact_checks: res.fact_checks, titles: res.title_suggestions, flags: res.flags, accepted: {} }), status: 'DRAFT', approved_by: null, applied_ratio: null, created_at: U.iso(), updated_at: U.iso() });
  G.audit(ctx, 'news.corrected', 'news', id, { changes: res.stats.total_changes });
  return { id, ...res, lang };
}, { roles: ['office', 'admin', 'consultant'] });
api.get('/api/news', () => ({ items: hydAll(q.all('SELECT id,type,title,status,applied_ratio,created_at,author_id FROM news_drafts ORDER BY created_at DESC LIMIT 60')) }), { roles: STAFF });
api.get('/api/news/stats', () => {
  const rows = hydAll(q.all('SELECT findings,applied_ratio,status,corrected,original FROM news_drafts'));
  const typos = rows.reduce((a, r) => a + (r.findings.diffs || []).filter((d) => d.kind === 'typo').length, 0); const ratios = rows.map((r) => r.applied_ratio).filter((x) => x != null);
  return { drafts: rows.length, typos_found: typos, avg_applied_ratio: ratios.length ? U.round(ratios.reduce((a, b) => a + b, 0) / ratios.length * 100, 1) : null, published: rows.filter((r) => r.status === 'PUBLISHED').length, human_ai_changed_chars: rows.reduce((a, r) => a + Math.abs((r.corrected || '').length - (r.original || '').length), 0) };
}, { roles: STAFF });
api.get('/api/news/:id', (ctx) => { const n = hyd(q.get('SELECT * FROM news_drafts WHERE id=?', ctx.params.id)); if (!n) throw U.notFound(); return { news: n, history: G.history('news', n.id) }; }, { roles: STAFF });
api.post('/api/news/:id/feedback', (ctx) => {
  const n = hyd(q.get('SELECT * FROM news_drafts WHERE id=?', ctx.params.id)); if (!n) throw U.notFound(); if (n.status !== 'DRAFT') throw U.conflict('Only drafts can be reviewed', 'INVALID_STATE');
  const acc = { ...(n.findings.accepted || {}), [ctx.body.index]: !!ctx.body.accept }; const total = (n.findings.diffs || []).length;
  const ratio = total ? Object.values(acc).filter(Boolean).length / total : null; n.findings.accepted = acc;
  let corrected = n.original; (n.findings.diffs || []).forEach((d, i) => { if (acc[i] !== false && d.kind === 'typo') corrected = corrected.split(d.from).join(d.to); }); // re-apply accepted typo fixes
  q.update('news_drafts', n.id, { findings: JSON.stringify(n.findings), applied_ratio: ratio, updated_at: U.iso() }); return { applied_ratio: ratio };
}, { roles: ['office', 'admin', 'consultant'] });
api.post('/api/news/:id/submit', (ctx) => {
  const n = hyd(q.get('SELECT * FROM news_drafts WHERE id=?', ctx.params.id)); if (!n) throw U.notFound(); if (n.status !== 'DRAFT') throw U.conflict('Already submitted', 'INVALID_STATE');
  if (!ctx.body.title && !n.title) throw U.bad('제목을 입력하세요', 'VALIDATION');
  if (n.findings.flags && n.findings.flags.unverified > 0 && !ctx.body.override_unverified) throw new U.HttpError(422, 'UNVERIFIED_FACTS', `사실 확인이 필요한 문장이 ${n.findings.flags.unverified}건 남아 있습니다. 출처를 보완하거나 확인 후 진행하세요.`);
  return q.tx(() => { if (ctx.body.title) q.update('news_drafts', n.id, { title: String(ctx.body.title).slice(0, 160) }); G.transition(ctx, 'news', n.id, 'REVIEW', 'submitted for approval'); const ap = G.requestApproval(ctx, { kind: 'NEWS_PUBLISH', refType: 'news', refId: n.id, title: `해외시장뉴스 게시 승인: ${ctx.body.title || n.title}`, risk: 'HIGH', approverRole: 'admin', payload: {} }); return { approval_id: ap, status: 'REVIEW' }; });
}, { roles: ['office', 'admin', 'consultant'] });

module.exports = { indexResearch, correctNews };
