'use strict';
// Business services shared by REST routes and AI tools. All state changes go through gov.transition (server-validated).
const { q, nextId, hyd, hydAll } = require('../db');
const U = require('../util');
const G = require('./../gov');
const SC = require('./scoring');
const { COUNTRIES } = require('../seed/catalog');
const CBY = Object.fromEntries(COUNTRIES.map((c) => [c.code, c]));

const getCompany = (id) => (id ? hyd(q.get('SELECT * FROM companies WHERE id=?', id)) : null);
const companyOf = (user) => (user && user.company_id ? getCompany(user.company_id) : null);
const primaryProject = (companyId) => hyd(q.get("SELECT * FROM export_projects WHERE company_id=? AND status='ACTIVE' ORDER BY created_at LIMIT 1", companyId));

// ---------- Export journey (Case Memory) ----------
const STEP_NAMES = [
  [1, '목표 설정', 'Set goal'], [2, '시장 탐색', 'Explore market'], [3, '규제·인증', 'Regulation & certification'], [4, '바이어 탐색', 'Buyer discovery'],
  [5, '마케팅·상담', 'Marketing & meetings'], [6, '계약·수출 실행', 'Contract & shipment'], [7, '사후관리', 'After-care'],
];
function advanceJourney(companyId, step, state, note) {
  const pr = primaryProject(companyId);
  if (!pr) return null;
  const j = pr.journey || {};
  const order = { NOT_STARTED: 0, WARNING: 1, IN_PROGRESS: 2, DONE: 3 };
  const cur = j[step] || 'NOT_STARTED';
  if (state !== 'WARNING' && (order[state] ?? 0) <= (order[cur] ?? 0)) return pr;
  j[step] = state;
  const mem = pr.memory || {};
  mem.case = mem.case || {};
  mem.case.진행 = mem.case.진행 || [];
  if (note) mem.case.진행.push(`${STEP_NAMES[step - 1][1]}: ${note}`);
  q.update('export_projects', pr.id, { journey: JSON.stringify(j), memory: JSON.stringify(mem), updated_at: U.iso() });
  const company = getCompany(companyId);
  q.update('companies', companyId, { readiness: SC.readiness(company, j), updated_at: U.iso() });
  return { ...pr, journey: j };
}

// ---------- Buyers ----------
function canSeeBuyerContact(user, buyerId) {
  if (!user) return false;
  if (user.role === 'admin' || user.role === 'consultant') return true;
  if (user.role === 'buyer') return user.buyer_id === buyerId;
  if (user.role === 'customer' && user.company_id) {
    return q.count('match_requests', "WHERE company_id=? AND buyer_id=? AND status IN ('ACCEPTED','SCHEDULED','COMPLETED','FOLLOW_UP')", user.company_id, buyerId) > 0;
  }
  return false;
}
function buyerView(b, user, { detail = false } = {}) {
  const o = hyd(b);
  const see = canSeeBuyerContact(user, o.id);
  const out = { ...o, contact_visible: see, synthetic: !!o.is_synthetic, country_name: CBY[o.country] ? { ko: CBY[o.country].ko, en: CBY[o.country].en } : null };
  if (!see) { out.contact_name = U.maskPII(o.contact_name ? o.contact_name[0] + '***' : ''); out.contact_email = U.maskEmail(o.contact_email); out.contact_phone = o.contact_phone ? o.contact_phone.slice(0, 4) + '-****-' + o.contact_phone.slice(-4) : null; }
  if (!detail) { delete out.description_en; }
  return out;
}
function availabilityOverlap(eventId, companyId, buyerId) {
  if (!eventId) return null;
  const a = new Set(q.all("SELECT slot_start FROM availability_slots WHERE event_id=? AND kind='COMPANY' AND ref_id=? AND available=1", eventId, companyId).map((r) => r.slot_start));
  const b = q.all("SELECT slot_start FROM availability_slots WHERE event_id=? AND kind='BUYER' AND ref_id=? AND available=1", eventId, buyerId).map((r) => r.slot_start);
  if (!a.size || !b.length) return null;
  const both = b.filter((s) => a.has(s)).length;
  return both / Math.max(1, Math.min(a.size, b.length));
}
function recommendBuyers(company, { country, productKeys, limit = 8, eventId = null, user } = {}) {
  let rows = hydAll(q.all('SELECT * FROM buyers'));
  let keys = productKeys && productKeys.length ? productKeys : company.product_keys;
  if (!(productKeys && productKeys.length)) { // 승인된 데이터 통합(MDM 병합·진화 릴리스) 결과만 서빙 키를 확장한다. 명시적 productKeys 가 있으면 그대로 사용.
    try { if (require('../di/core').enabled()) { const e = require('../di/mdm').servingKeysFor(company.id); if (e) keys = [...new Set([...(keys || []), ...e.extra_product_keys])]; } } catch { /* DI 미초기화 시 무시 */ }
  }
  const favs = new Set(q.all('SELECT buyer_id FROM buyer_favorites WHERE company_id=?', company.id).map((r) => r.buyer_id));
  const requested = new Set(q.all("SELECT buyer_id FROM match_requests WHERE company_id=? AND initiator='BUYER'", company.id).map((r) => r.buyer_id));
  if (country) rows = rows.filter((b) => b.country === country);
  const comp = { ...company, product_keys: keys };
  const activeMatch = {};
  q.all("SELECT * FROM match_requests WHERE company_id=? AND status IN ('REQUESTED','ACCEPTED','SCHEDULED') ORDER BY created_at", company.id).forEach((m) => { activeMatch[m.buyer_id] = m; });
  const out = rows.map((b) => {
    const ov = availabilityOverlap(eventId, company.id, b.id);
    const sc = SC.scoreBuyer(comp, b, { favorite: favs.has(b.id), requestedByBuyer: requested.has(b.id), availabilityOverlap: ov });
    const m = activeMatch[b.id];
    return { ...buyerView(b, user), score: sc.total, score_parts: sc.parts, score_max: sc.max, reasons: sc.reasons, favorite: favs.has(b.id), match: m ? { id: m.id, status: m.status, initiator: m.initiator, event_id: m.event_id } : null };
  }).filter((b) => b.score_parts.product > 0 || b.score_parts.country >= 10).sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
}

// ---------- Programs ----------
function programView(p) {
  const o = hyd(p);
  const left = o.apply_end ? U.dday(o.apply_end) : null, st = o.apply_start ? U.dday(o.apply_start) : null;
  o.live_status = left != null && left < 0 ? 'CLOSED' : st != null && st > 0 ? 'UPCOMING' : 'OPEN';
  o.d_day = left;
  o.days_to_start = st;
  o.event_d_day = o.event_start ? U.dday(o.event_start) : null;
  return o;
}
function recommendPrograms(company, { limit = 8, onlyOpen = true, filter = null } = {}) {
  const pr = primaryProject(company.id);
  const focus = pr ? Object.entries(pr.journey || {}).filter(([, s]) => s === 'IN_PROGRESS').map(([k]) => Number(k)) : [];
  const comp = { ...company, journey_focus: focus.length ? focus : [2, 3, 4] };
  let rows = q.all('SELECT * FROM programs').map(programView);
  if (filter) rows = rows.filter(filter);
  const out = rows.map((p) => { const s = SC.scoreProgram(comp, p); return { ...p, recommend: s.score, reasons: s.reasons, missing: s.missing, eligibility_status: s.status }; });
  return out.filter((p) => !onlyOpen || p.live_status !== 'CLOSED').sort((a, b) => (b.recommend - a.recommend) || ((a.d_day ?? 999) - (b.d_day ?? 999))).slice(0, limit);
}

// ---------- Applications (DRAFT → READY_FOR_REVIEW → APPROVAL_REQUIRED → SUBMITTED_DEMO → COMPLETED) ----------
function buildApplicationForm(company, program, user) {
  return {
    company_name: company.name, company_name_en: company.name_en, biz_no: company.biz_no, ceo_contact: user ? user.name : '', email: user ? U.maskEmail(user.email) : '', industry: company.industry, main_product: company.product,
    hs_code: company.hs_code, employees: company.employees, size: company.size, website: company.website || '', target_markets: (company.target_markets || []).map((c) => CBY[c]?.ko || c).join(', '),
    export_experience: company.export_experience, purpose: `${program.title_ko} 참여를 통해 ${(company.target_markets || []).map((c) => CBY[c]?.ko).filter(Boolean)[0] || '해외'} 시장 진출을 추진하고자 합니다.`,
    expected_outcome: '현지 후보 바이어 3곳 이상과 상담 및 샘플 거래 협의', budget_plan: '', agree_privacy: false,
  };
}
function createApplicationDraft(ctx, company, program, { ai = true } = {}) {
  const existing = q.get("SELECT * FROM applications WHERE company_id=? AND program_id=? AND status NOT IN ('COMPLETED')", company.id, program.id);
  if (existing) return hyd(existing);
  const docs = (program.required_docs || []).map((n, i) => ({ id: `d${i + 1}`, name: n, done: i === 0, note: i === 0 ? '기업정보에서 자동 확인' : '' }));
  const id = nextId('APP', 4);
  const form = buildApplicationForm(company, program, ctx.user);
  q.insert('applications', { id, program_id: program.id, company_id: company.id, user_id: ctx.user.id, status: 'DRAFT', form: JSON.stringify(form), checklist: JSON.stringify(docs), ai_draft: ai ? 1 : 0, approval_id: null, submitted_at: null, source_type: 'user', is_synthetic: 0, created_at: U.iso(), updated_at: U.iso() });
  G.audit(ctx, 'application.created', 'application', id, { program: program.id, ai });
  return hyd(q.get('SELECT * FROM applications WHERE id=?', id));
}
function missingForApplication(app) {
  const f = app.form || {}; const miss = [];
  for (const k of ['company_name', 'biz_no', 'purpose', 'expected_outcome']) if (!f[k]) miss.push(k);
  if (!f.agree_privacy) miss.push('agree_privacy');
  (app.checklist || []).filter((d) => !d.done).forEach((d) => miss.push('doc:' + d.name));
  return miss;
}
function requestApplicationSubmit(ctx, app, traceId) {
  if (app.status === 'DRAFT') G.transition(ctx, 'application', app.id, 'READY_FOR_REVIEW', 'user ready');
  const cur = q.get('SELECT * FROM applications WHERE id=?', app.id);
  if (cur.status !== 'READY_FOR_REVIEW') throw U.conflict('Application must be READY_FOR_REVIEW', 'INVALID_STATE');
  const program = hyd(q.get('SELECT * FROM programs WHERE id=?', app.program_id));
  const aid = G.requestApproval(ctx, { kind: 'APPLICATION_SUBMIT', refType: 'application', refId: app.id, title: `사업 신청 제출: ${program.title_ko}`, risk: 'HIGH', approverRole: 'self', payload: { program_id: program.id, form: app.form }, traceId });
  G.transition(ctx, 'application', app.id, 'APPROVAL_REQUIRED', 'HITL approval requested', { approval_id: aid });
  return aid;
}

// ---------- Matching ----------
function createMatchRequest(ctx, { event_id, company_id, buyer_id, initiator = 'COMPANY', message = '' }) {
  const ev = q.get('SELECT * FROM events WHERE id=?', event_id);
  if (!ev) throw U.notFound('Event not found');
  const cp = q.get("SELECT * FROM event_participants WHERE event_id=? AND kind='COMPANY' AND ref_id=? AND status='APPROVED'", event_id, company_id);
  const bp = q.get("SELECT * FROM event_participants WHERE event_id=? AND kind='BUYER' AND ref_id=? AND status='APPROVED'", event_id, buyer_id);
  if (!cp || !bp) throw U.forbidden('Both parties must be approved participants of the event', 'NOT_PARTICIPANT');
  const dup = q.get("SELECT id FROM match_requests WHERE event_id=? AND company_id=? AND buyer_id=? AND status IN ('REQUESTED','ACCEPTED','SCHEDULED')", event_id, company_id, buyer_id);
  if (dup) throw U.conflict('An active request already exists for this pair', 'DUPLICATE_REQUEST');
  const company = getCompany(company_id), buyer = hyd(q.get('SELECT * FROM buyers WHERE id=?', buyer_id));
  const sc = SC.scoreBuyer(company, buyer, { availabilityOverlap: availabilityOverlap(event_id, company_id, buyer_id), favorite: !!q.get('SELECT 1 x FROM buyer_favorites WHERE company_id=? AND buyer_id=?', company_id, buyer_id) });
  const id = nextId('MR', 4);
  q.insert('match_requests', { id, event_id, company_id, buyer_id, initiator, status: 'REQUESTED', score: sc.total, score_detail: JSON.stringify(sc.parts), slot_start: null, hall: null, interpreter_id: null, message, reject_reason: null, journal: null, source_type: 'user', is_synthetic: 0, created_at: U.iso(), updated_at: U.iso() });
  q.run('INSERT INTO status_history(entity,entity_id,from_state,to_state,actor_id,note,ts) VALUES(?,?,?,?,?,?,?)', 'match', id, null, 'REQUESTED', ctx.user ? ctx.user.id : 'system', 'created', U.iso());
  G.audit(ctx, 'match.requested', 'match', id, { event_id, company_id, buyer_id, initiator });
  const target = initiator === 'COMPANY' ? q.get("SELECT id FROM users WHERE buyer_id=? AND role='buyer'", buyer_id) : q.get('SELECT id FROM users WHERE company_id=?', company_id);
  if (target) G.notify(target.id, 'match', `[상담 신청] ${initiator === 'COMPANY' ? company.name : buyer.name}`, ev.title_ko, '#/mykotra/matching');
  G.sendMock('EMAIL', initiator === 'COMPANY' ? buyer.contact_email : 'company@example.com', `[KOTRA] Meeting request — ${ev.title_en}`, `${initiator === 'COMPANY' ? company.name_en : buyer.name} requested a 30-minute meeting. ${message}`, id);
  G.integrationEvent('CRM', 'match.requested', { match: id });
  if (initiator === 'COMPANY') advanceJourney(company_id, 5, 'IN_PROGRESS', `상담 신청: ${buyer.name}`);
  return hyd(q.get('SELECT * FROM match_requests WHERE id=?', id));
}
function matchSlotConflicts(eventId, slot, { companyId, buyerId, interpreterId, hall, excludeId }) {
  const rows = q.all("SELECT * FROM match_requests WHERE event_id=? AND slot_start=? AND status IN ('SCHEDULED','COMPLETED') AND id<>?", eventId, slot, excludeId || '');
  const out = [];
  for (const r of rows) {
    if (r.company_id === companyId) out.push({ type: 'COMPANY', with: r.id });
    if (r.buyer_id === buyerId) out.push({ type: 'BUYER', with: r.id });
    if (interpreterId && r.interpreter_id === interpreterId) out.push({ type: 'INTERPRETER', with: r.id });
    if (hall && r.hall === hall) out.push({ type: 'HALL', with: r.id });
  }
  return out;
}

// ---------- Approval handlers (HITL) ----------
const approvalHandlers = {
  APPLICATION_SUBMIT: {
    approve(ctx, ap) {
      G.transition(ctx, 'application', ap.ref_id, 'SUBMITTED_DEMO', 'approved by user (HITL)', { submitted_at: U.iso() });
      const app = hyd(q.get('SELECT * FROM applications WHERE id=?', ap.ref_id));
      G.integrationEvent('사업관리시스템', 'application.submitted', { application: app.id, program: app.program_id });
      G.notify(app.user_id, 'application', '사업 신청이 접수되었습니다(시연)', `신청번호 ${app.id}`, '#/mykotra/applications');
      const staff = q.all("SELECT id FROM users WHERE role='consultant'");
      staff.forEach((s) => G.notify(s.id, 'application', `신규 사업 신청 ${app.id}`, app.program_id, '#/admin/programs'));
      advanceJourney(app.company_id, 5, 'IN_PROGRESS', `사업 신청 제출 (${app.program_id})`);
      advanceJourney(app.company_id, 3, 'IN_PROGRESS');
    },
    reject(ctx, ap) { G.transition(ctx, 'application', ap.ref_id, 'DRAFT', 'approval rejected → back to draft'); },
  },
  MATCH_REQUEST: {
    approve(ctx, ap) { const p = JSON.parse(ap.payload); const r = createMatchRequest({ ...ctx, user: ctx.user }, { event_id: p.event_id, company_id: p.company_id, buyer_id: p.buyer_id, initiator: p.initiator || 'COMPANY', message: p.message }); q.update('approvals', ap.id, { ref_id: r.id }); },
    reject() {},
  },
  EMAIL_SEND: {
    approve(ctx, ap) { const p = JSON.parse(ap.payload); G.sendMock('EMAIL', p.to, p.subject, p.body, ap.id); G.integrationEvent('Mail Gateway', 'email.sent(mock)', { approval: ap.id }); },
    reject() {},
  },
  RESEARCH_APPROVAL: {
    approve(ctx, ap) {
      const r = q.get('SELECT * FROM research_requests WHERE id=?', ap.ref_id);
      const OFFICE = { VN: 'U-024', US: 'U-025', JP: 'U-026', AE: 'U-027' };
      G.transition(ctx, 'research', ap.ref_id, 'ASSIGNED', 'approved by 총괄 → assigned to KBC', { assignee_id: OFFICE[r.country] || null });
      if (OFFICE[r.country]) G.notify(OFFICE[r.country], 'research', `지시조사 배정: ${r.title}`, `기한 ${r.due_date}`, '#/staff/research');
    },
    reject(ctx, ap) { G.transition(ctx, 'research', ap.ref_id, 'DRAFT', 'rejected'); },
  },
  NEWS_PUBLISH: {
    approve(ctx, ap) {
      G.transition(ctx, 'news', ap.ref_id, 'APPROVED', 'approved'); G.transition(ctx, 'news', ap.ref_id, 'PUBLISHED', 'published');
      const n = hyd(q.get('SELECT * FROM news_drafts WHERE id=?', ap.ref_id)); const id = 'MC-' + n.id; const summary = n.summary || n.corrected.slice(0, 160);
      q.insert('market_content', { id, type: 'news', country: null, industry: null, title_ko: n.title || '해외시장뉴스', title_en: n.title || 'Overseas market news', body_ko: n.corrected, body_en: n.corrected, source_name: 'KOTRA 해외무역관(AI 교정·담당자 승인)', source_url: '#/markets/content/' + id, published_at: U.today(), tags: JSON.stringify(['뉴스']), status: 'PUBLISHED', views: 0, source_type: 'news-agent', is_synthetic: 0, created_at: U.iso(), updated_at: U.iso() });
      require('../ai/rag').addDocument({ id: 'D-' + id, collection_id: 'MARKET', title: n.title, title_en: n.title, text: n.corrected, text_en: summary, org: 'KOTRA 해외무역관', url: '#/markets/content/' + id, published_at: U.today(), country: null, doc_type: 'news', access_scope: 'PUBLIC', status: 'ACTIVE', uploaded_by: ctx.user.id, source_type: 'news-agent', is_synthetic: 0, updated_at: U.iso() });
      G.audit(ctx, 'news.published', 'news', n.id, { content: id });
    },
    reject(ctx, ap) { G.transition(ctx, 'news', ap.ref_id, 'REJECTED', 'rejected'); },
  },
  CONSULT_TRANSFER: {
    approve(ctx, ap) { q.update('consultation_transfers', ap.ref_id, { status: 'APPROVED' }); const t = q.get('SELECT * FROM consultation_transfers WHERE id=?', ap.ref_id); G.integrationEvent('사업관리시스템 VOC', 'consultation.transferred', { id: t.consultation_id, to: t.to_target }); },
    reject(ctx, ap) { q.update('consultation_transfers', ap.ref_id, { status: 'REJECTED' }); },
  },
  MDM_MERGE: { approve() {}, reject() {} },
  GENERIC: { approve() {}, reject() {} },
};
function decideApproval(ctx, id, decision, reason = '') {
  const ap = q.get('SELECT * FROM approvals WHERE id=?', id);
  if (!ap) throw U.notFound('Approval not found');
  if (ap.status !== 'PENDING') throw U.conflict('Approval already decided', 'ALREADY_DECIDED');
  if (!G.canDecide(ctx.user, ap)) throw U.forbidden('You are not allowed to decide this approval', 'APPROVAL_FORBIDDEN');
  const h = approvalHandlers[ap.kind] || approvalHandlers.GENERIC;
  return q.tx(() => {
    const to = decision === 'APPROVE' ? 'APPROVED' : decision === 'CANCEL' ? 'CANCELLED' : 'REJECTED';
    G.transition(ctx, 'approval', id, to, reason, { decided_by: ctx.user.id, reason, decided_at: U.iso() });
    const fresh = q.get('SELECT * FROM approvals WHERE id=?', id);
    if (to === 'APPROVED') h.approve(ctx, fresh); else h.reject(ctx, fresh);
    G.notify(ap.requester_id, 'approval', `승인 ${to === 'APPROVED' ? '완료' : '반려/취소'}: ${ap.title}`, reason, null);
    return hyd(q.get('SELECT * FROM approvals WHERE id=?', id));
  });
}

module.exports = { getCompany, companyOf, primaryProject, STEP_NAMES, advanceJourney, canSeeBuyerContact, buyerView, recommendBuyers, availabilityOverlap, programView, recommendPrograms, buildApplicationForm, createApplicationDraft, missingForApplication, requestApplicationSubmit, createMatchRequest, matchSlotConflicts, approvalHandlers, decideApproval, CBY };
