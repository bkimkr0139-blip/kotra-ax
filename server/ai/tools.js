'use strict';
// Tool registry runtime: permission → rate limit → risk policy (LOW auto / MEDIUM confirm / HIGH HITL / BLOCKED) → execute → ToolRun log.
const { q, nextId, hyd, hydAll } = require('../db');
const U = require('../util');
const G = require('../gov');
const A = require('../auth');
const RAG = require('./rag');
const NLP = require('./nlp');
const S = require('../domain/services');
const SC = require('../domain/scoring');
const { COUNTRIES, PRODUCTS } = require('../seed/catalog');
const CBY = Object.fromEntries(COUNTRIES.map((c) => [c.code, c]));
const PBY = Object.fromEntries(PRODUCTS.map((p) => [p.key, p]));

const TRUNC = (s, n = 280) => { const t = typeof s === 'string' ? s : JSON.stringify(s); return t.length > n ? t.slice(0, n) + '…' : t; };

// ---------- Text-to-SQL (read-only, whitelisted) ----------
const ALLOWED_TABLES = new Set(['trade_stats', 'countries', 'programs', 'buyers', 'market_content', 'regulations']);
function assertReadOnly(sql) {
  const s = sql.trim().replace(/;+\s*$/, '');
  if (!/^select\s/i.test(s)) throw U.forbidden('Only SELECT statements are allowed', 'SQL_NOT_READONLY');
  if (/\b(insert|update|delete|drop|alter|create|attach|pragma|replace|vacuum)\b/i.test(s) || s.includes(';')) throw U.forbidden('Unsafe SQL rejected', 'SQL_UNSAFE');
  const tables = [...s.matchAll(/\b(?:from|join)\s+([a-z_]+)/gi)].map((m) => m[1].toLowerCase());
  for (const t of tables) if (!ALLOWED_TABLES.has(t)) throw U.forbidden(`Table ${t} is not queryable`, 'SQL_TABLE_DENIED');
  return s;
}
function textToSql(question, ent) {
  const cc = ent.countries[0], pk = ent.products[0];
  const hs = pk ? PBY[pk].hs : (ent.hs[0] || '').slice(0, 4);
  if (cc && hs) return { kind: 'timeseries', sql: 'SELECT year, export_usd_m, import_usd_m, yoy FROM trade_stats WHERE country = ? AND hs_prefix = ? ORDER BY year', params: [cc, hs], desc: `${CBY[cc].ko} HS ${hs} 연도별 교역(시연 지표)` };
  if (hs) return { kind: 'ranking', sql: 'SELECT country, export_usd_m, yoy FROM trade_stats WHERE hs_prefix = ? AND year = (SELECT MAX(year) FROM trade_stats) ORDER BY export_usd_m DESC LIMIT 8', params: [hs], desc: `HS ${hs} 국가별 최근연도 규모 상위(시연 지표)` };
  if (cc) return { kind: 'country', sql: 'SELECT hs_prefix, export_usd_m, yoy FROM trade_stats WHERE country = ? AND year = (SELECT MAX(year) FROM trade_stats) ORDER BY export_usd_m DESC LIMIT 8', params: [cc], desc: `${CBY[cc].ko} 품목군별 최근연도 규모(시연 지표)` };
  return null;
}

// ---------- Contract risk review (rule-based; HITL required before signing) ----------
const CONTRACT_RULES = [
  { id: 'exclusive', re: /(독점|exclusive)/i, absent: /(최소\s*(판매|구매)|minimum|해지|terminat)/i, sev: 'HIGH', ko: '독점 판매권 조항: 대상 지역·기간·최소 판매 목표·미달 시 해지 조건이 명시되어 있지 않습니다.', en: 'Exclusivity clause lacks territory, term, minimum targets and termination on shortfall.' },
  { id: 'long_credit', re: /((90|120|180)\s*일|net\s*(90|120)|open account|후불)/i, sev: 'HIGH', ko: '장기 후불 결제 조건이 포함되어 있습니다. 수출보험·신용장·선수금 비율 협상을 검토하세요.', en: 'Long open-account payment terms. Consider export insurance, L/C or advance payment.' },
  { id: 'unlimited', re: /(무제한\s*책임|unlimited liability)/i, sev: 'HIGH', ko: '책임 한도가 무제한으로 되어 있습니다. 한도(예: 계약금액 이내)를 설정하세요.', en: 'Unlimited liability. Set a cap (e.g. contract value).' },
  { id: 'governing', neg: /(준거법|governing law)/i, sev: 'MEDIUM', ko: '준거법 조항이 없습니다.', en: 'No governing-law clause.' },
  { id: 'dispute', neg: /(중재|arbitration|관할|jurisdiction)/i, sev: 'MEDIUM', ko: '분쟁 해결(중재 기관·장소) 조항이 없습니다.', en: 'No dispute-resolution clause (arbitration body/seat).' },
  { id: 'quality', neg: /(검수|inspection|하자|defect|warranty)/i, sev: 'MEDIUM', ko: '검수 기간 및 불량 처리 방식이 명시되어 있지 않습니다.', en: 'Inspection period and defect handling are not specified.' },
  { id: 'autorenew', re: /(자동\s*갱신|automatic(ally)? renew)/i, sev: 'MEDIUM', ko: '자동 갱신 조항이 있습니다. 해지 통지 기간을 확인하세요.', en: 'Auto-renewal clause. Check the notice period for termination.' },
  { id: 'trademark', re: /(상표|trademark|brand license)/i, sev: 'MEDIUM', ko: '상표 사용권 범위와 종료 후 사용 중지 의무를 확인하세요.', en: 'Check trademark licence scope and post-termination cessation.' },
  { id: 'return', re: /(재고\s*반품|stock return)/i, sev: 'LOW', ko: '재고 반품 조건이 있습니다. 반품 비용과 기한을 확인하세요.', en: 'Stock-return terms present. Check cost and deadline.' },
];
function contractReview(text) {
  const t = String(text || '');
  const findings = [];
  for (const r of CONTRACT_RULES) {
    if (r.neg) { if (!r.neg.test(t)) findings.push({ id: r.id, severity: r.sev, ko: r.ko, en: r.en }); continue; }
    if (r.re.test(t) && (!r.absent || !r.absent.test(t))) findings.push({ id: r.id, severity: r.sev, ko: r.ko, en: r.en });
  }
  const amount = (t.match(/((?:USD|US\$|\$|KRW|₩)\s?[\d,]+(?:\.\d+)?|[\d,]+\s?(?:원|달러|USD))/i) || [])[0] || null;
  const ship = (t.match(/(?:선적|인도|shipment|delivery)[^\d]{0,14}(\d{4}[-./]\d{1,2}[-./]\d{1,2})/i) || [])[1] || null;
  const item = (t.match(/(?:품목|Item|Product)\s*[:：]\s*([^\n]{2,60})/i) || [])[1] || null;
  const rank = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  findings.sort((a, b) => rank[a.severity] - rank[b.severity]);
  return { findings, extracted: { item, amount, shipment_date: ship }, risk_level: findings.some((f) => f.severity === 'HIGH') ? 'HIGH' : findings.length ? 'MEDIUM' : 'LOW', disclaimer: '자동 점검 결과이며 법률 자문이 아닙니다. 계약 체결 전 사용자의 최종 검토(HITL)와 전문가 검토가 필요합니다.' };
}

// ---------- Consultation classification / routing ----------
const CLASS_RULES = [
  ['인증·규제', /(인증|규제|등록|허가|라벨|FDA|할랄|공고)/i, '인증지원팀 / 해외무역관'], ['바이어', /(바이어|유통|파트너|발굴)/i, '바이어발굴팀'], ['지원사업', /(지원사업|바우처|신청|자격)/i, '수출지원사업팀'],
  ['물류·통관', /(통관|물류|운송|샘플|관세|선적)/i, '물류지원팀'], ['계약·결제', /(계약|결제|신용장|보험|후불)/i, '무역아카데미 / 법률자문'], ['전시·상담회', /(전시|상담회|박람회|행사)/i, '해외전시팀'],
  ['시장정보', /(시장|동향|진출|전략|트렌드)/i, '해외정보팀'], ['무역사기', /(사기|선결제|의심)/i, '무역사기대응팀'], ['투자', /(투자|인센티브|입지)/i, 'Invest KOREA'], ['고충', /(고충|인허가 지연|옴부즈만)/i, '외국인투자옴부즈만'],
];
function classifyText(text) {
  const t = String(text || '');
  const scored = CLASS_RULES.map(([cat, re, team]) => ({ cat, team, n: (t.match(new RegExp(re.source, 'gi')) || []).length })).filter((x) => x.n).sort((a, b) => b.n - a.n);
  const top = scored[0];
  return { category: top ? top.cat : '일반 문의', suggested_team: top ? top.team : '수출상담센터', confidence: top ? U.clamp(0.55 + top.n * 0.12, 0.55, 0.95) : 0.4, candidates: scored.slice(0, 3).map((x) => x.cat) };
}

// ---------- tool handlers ----------
function ragTool(collections, env, input) {
  const user = env.ctx.user;
  const r = RAG.search({ query: input.query, collections, k: input.k || 5, filters: input.filters || {}, clearance: A.clearanceOf(user), lang: env.lang, mode: input.mode || 'hybrid', opts: env.ragOpts || null });
  return { hits: r.hits, trace: r.trace, abstained: r.abstained };
}
const H = {
  'knowledge.search': (env, i) => ragTool(i.collections || [], env, i),
  'market.search': (env, i) => ragTool(['MARKET'], env, i),
  'regulation.search': (env, i) => ragTool(['REGULATION'], env, i),
  'stats.query': (env, i) => {
    const plan = textToSql(i.question, i.entities || NLP.extractEntities(i.question));
    if (!plan) return { sql: null, rows: [], note: 'NO_PLAN' };
    const sql = assertReadOnly(plan.sql);
    const rows = q.all(sql, ...plan.params);
    return { sql, params: plan.params, rows, kind: plan.kind, desc: plan.desc, synthetic: true };
  },
  'buyer.search': (env, i) => {
    const user = env.ctx.user;
    let rows = q.all('SELECT * FROM buyers');
    if (i.country) rows = rows.filter((b) => b.country === i.country);
    if (i.product) rows = rows.filter((b) => (JSON.parse(b.products) || []).includes(i.product));
    if (i.type) rows = rows.filter((b) => b.type === i.type);
    return { buyers: rows.slice(0, i.limit || 10).map((b) => S.buyerView(b, user)), total: rows.length };
  },
  'buyer.detail': (env, i) => { const b = q.get('SELECT * FROM buyers WHERE id=?', i.id); if (!b) throw U.notFound('Buyer not found'); return { buyer: S.buyerView(b, env.ctx.user, { detail: true }) }; },
  'buyer.recommend': (env, i) => {
    const company = S.companyOf(env.ctx.user);
    if (!company) throw U.forbidden('Company profile required for recommendations', 'NO_COMPANY');
    const list = S.recommendBuyers(company, { country: i.country, productKeys: i.productKeys, limit: i.limit || 6, eventId: i.eventId, user: env.ctx.user });
    return { buyers: list };
  },
  'buyer.verify': (env, i) => {
    const b = hyd(q.get('SELECT * FROM buyers WHERE id=?', i.id)); if (!b) throw U.notFound('Buyer not found');
    return { buyer_id: b.id, checks: [{ item: '법인 등록 확인', ok: !!b.verified }, { item: '거래 이력(KOTRA DB)', ok: b.past_success >= 60 }, { item: '신용도 지표', ok: b.trust >= 75 }, { item: '제재·불량 거래 이력', ok: true }], trust: b.trust, verified: !!b.verified, note: 'KOTRA 바이어 검증 DB 연계(시연 Mock)', provenance: 'MOCK' };
  },
  'program.search': (env, i) => {
    let rows = q.all('SELECT * FROM programs').map(S.programView);
    if (i.type) rows = rows.filter((p) => p.type === i.type);
    if (i.country) rows = rows.filter((p) => p.countries.includes('ALL') || p.countries.includes(i.country));
    if (i.product) rows = rows.filter((p) => p.industries.includes('ALL') || p.industries.includes(i.product));
    if (i.openOnly !== false) rows = rows.filter((p) => p.live_status !== 'CLOSED');
    return { programs: rows.slice(0, i.limit || 8) };
  },
  'program.detail': (env, i) => { const p = q.get('SELECT * FROM programs WHERE id=?', i.id); if (!p) throw U.notFound('Program not found'); return { program: S.programView(p) }; },
  'program.recommend': (env, i) => {
    const company = S.companyOf(env.ctx.user);
    if (!company) throw U.forbidden('Company profile required for recommendations', 'NO_COMPANY');
    const filter = (p) => (!i.country || p.countries.includes('ALL') || p.countries.includes(i.country)) && (!i.product || p.industries.includes('ALL') || p.industries.includes(i.product));
    return { programs: S.recommendPrograms(company, { limit: i.limit || 5, filter }) };
  },
  'event.search': (env, i) => {
    let rows = hydAll(q.all("SELECT * FROM events WHERE status<>'COMPLETED' ORDER BY start_date"));
    if (i.country) rows = rows.filter((e) => e.country === i.country || e.country === 'KR');
    const progs = q.all("SELECT * FROM programs WHERE type IN ('MEETING','EXHIBITION')").map(S.programView).filter((p) => p.live_status !== 'CLOSED' && (!i.country || p.countries.includes('ALL') || p.countries.includes(i.country)) && (!i.product || p.industries.includes('ALL') || p.industries.includes(i.product)));
    return { events: rows, programs: progs };
  },
  'contract.review': (env, i) => contractReview(i.text),
  'report.create': (env, i) => {
    const id = nextId('RPT', 4);
    q.insert('saved_items', { id, user_id: env.ctx.user.id, kind: 'report', ref_id: env.runId, title: i.title, payload: JSON.stringify({ markdown: i.markdown, sources: i.sources || [] }), created_at: U.iso() });
    return { report_id: id, title: i.title };
  },
  'document.generate': (env, i) => {
    const user = env.ctx.user; const company = S.companyOf(user);
    if (!company) throw U.forbidden('Company profile required', 'NO_COMPANY');
    if (i.type === 'application') {
      const program = hyd(q.get('SELECT * FROM programs WHERE id=?', i.program_id)); if (!program) throw U.notFound('Program not found');
      const app = S.createApplicationDraft(env.ctx, company, S.programView(program));
      return { application: app, missing: S.missingForApplication(app) };
    }
    if (i.type === 'email') {
      const b = i.buyer_id ? hyd(q.get('SELECT * FROM buyers WHERE id=?', i.buyer_id)) : null;
      const first = b ? b.name : 'Sir/Madam';
      const subject = `${company.product_en} supply proposal from ${company.name_en} (Korea)`;
      const body = `Dear ${first},\n\nI am ${user.name_en || user.name} from ${company.name_en}, a Korean company specialising in ${company.product_en}. ${b ? `We noticed that ${b.name} focuses on ${(b.products || []).map((k) => PBY[k]?.en).filter(Boolean).join(', ')} in ${CBY[b.country]?.en}, which closely matches our product line.` : ''}\n\nKey points:\n- Product: ${company.product_en}\n- Certifications and ingredient list available on request\n- Low minimum order quantity suitable for a pilot order\n- Samples can be shipped with the required customs documents\n\nWould you be available for a 30-minute video meeting next week? I can propose two or three time slots that suit your time zone.\n\nBest regards,\n${user.name_en || user.name}\n${company.name_en}`;
      return { subject, body, to: b ? b.contact_email : null, buyer: b ? { id: b.id, name: b.name } : null, note: 'AI draft assembled from your profile and buyer data. Review before sending (HITL).' };
    }
    throw U.bad('Unknown document type');
  },
  'consultation.create': (env, i) => {
    const user = env.ctx.user; const cls = classifyText(i.title + ' ' + i.body);
    const id = nextId('CS', 4);
    q.insert('consultations', { id, channel: i.channel || 'ONLINE', company_id: user.company_id, user_id: user.id, topic: cls.category, category: cls.category, title: i.title, body: i.body, status: 'OPEN', priority: 'NORMAL', assigned_to: null, ai_class: JSON.stringify(cls), extra_care: 0, callback_at: null, source_type: 'user', is_synthetic: 0, created_at: U.iso(), updated_at: U.iso() });
    q.insert('consultation_messages', { id: nextId('CM', 5), consultation_id: id, sender: 'customer', sender_id: user.id, speaker: 'customer', body: U.maskPII(i.body), at_sec: null, created_at: U.iso() });
    G.transition(env.ctx, 'consultation', id, 'AI_CLASSIFIED', 'AI classified');
    G.audit(env.ctx, 'consultation.created', 'consultation', id, { category: cls.category });
    G.integrationEvent('CRM', 'consultation.created', { id });
    q.all("SELECT id FROM users WHERE role='consultant'").forEach((s) => G.notify(s.id, 'consultation', `신규 상담 ${id}`, i.title, '#/staff/consult'));
    return { consultation_id: id, classification: cls };
  },
  'consultation.route': (env, i) => classifyText(i.text),
  'matching.request': (env, i) => {
    const user = env.ctx.user; const company = S.companyOf(user);
    if (!company) throw U.forbidden('Company profile required', 'NO_COMPANY');
    const buyer = q.get('SELECT * FROM buyers WHERE id=?', i.buyer_id); if (!buyer) throw U.notFound('Buyer not found');
    const ev = q.get('SELECT * FROM events WHERE id=?', i.event_id); if (!ev) throw U.notFound('Event not found');
    const cp = q.get("SELECT 1 x FROM event_participants WHERE event_id=? AND kind='COMPANY' AND ref_id=? AND status='APPROVED'", i.event_id, company.id);
    const bp = q.get("SELECT 1 x FROM event_participants WHERE event_id=? AND kind='BUYER' AND ref_id=? AND status='APPROVED'", i.event_id, i.buyer_id);
    if (!cp) throw U.forbidden('Your company is not an approved participant of this event. Apply to the program first.', 'NOT_PARTICIPANT');
    if (!bp) throw U.forbidden('This buyer is not an approved participant of the event', 'BUYER_NOT_PARTICIPANT');
    const dup = q.get("SELECT id,status,initiator FROM match_requests WHERE event_id=? AND company_id=? AND buyer_id=? AND status IN ('REQUESTED','ACCEPTED','SCHEDULED')", i.event_id, company.id, i.buyer_id);
    if (dup) throw U.conflict(dup.initiator === 'BUYER' && dup.status === 'REQUESTED' ? '이 바이어가 이미 상담을 신청했습니다. 상담/매칭에서 수락해 주세요. / This buyer already requested a meeting — accept it under Consults & matching.' : `이미 진행 중인 상담(${dup.id}, ${dup.status})이 있습니다. / A meeting (${dup.id}, ${dup.status}) is already in progress.`, 'DUPLICATE_REQUEST');
    const aid = G.requestApproval(env.ctx, { kind: 'MATCH_REQUEST', refType: 'match', refId: `${i.event_id}:${i.buyer_id}`, title: `상담 신청: ${buyer.name} @ ${ev.title_ko}`, risk: 'HIGH', approverRole: 'self', payload: { event_id: i.event_id, company_id: company.id, buyer_id: i.buyer_id, message: i.message || '' }, traceId: env.runId });
    return { approval_id: aid };
  },
  'application.submit': (env, i) => {
    const app = hyd(q.get('SELECT * FROM applications WHERE id=?', i.application_id)); if (!app) throw U.notFound('Application not found');
    if (app.company_id !== env.ctx.user.company_id && env.ctx.user.role !== 'admin') throw U.forbidden('Not your application');
    const miss = S.missingForApplication(app);
    if (miss.length) return { blocked_by_validation: true, missing: miss };
    return { approval_id: S.requestApplicationSubmit(env.ctx, app, env.runId) };
  },
  'email.send': (env, i) => {
    const aid = G.requestApproval(env.ctx, { kind: 'EMAIL_SEND', refType: 'email', refId: i.to || 'n/a', title: `외부 이메일 발송: ${i.subject}`, risk: 'HIGH', approverRole: 'self', payload: { to: i.to, subject: i.subject, body: i.body }, traceId: env.runId });
    return { approval_id: aid };
  },
  'notification.preview': (env, i) => ({ channel: i.channel || 'EMAIL', subject: i.subject, body: U.maskPII(i.body || ''), note: 'Preview only — nothing sent.' }),
  'approval.request': (env, i) => ({ approval_id: G.requestApproval(env.ctx, { kind: i.kind || 'GENERIC', refType: i.refType || 'n/a', refId: i.refId || 'n/a', title: i.title || 'Approval', risk: i.risk || 'MEDIUM', approverRole: i.approverRole || 'consultant', payload: i.payload || {}, traceId: env.runId }) }),
};

// ---------- runtime ----------
function runTool(env, toolId, input = {}) {
  const t0 = Date.now();
  const user = env.ctx.user;
  const def = hyd(q.get('SELECT * FROM tool_defs WHERE id=?', toolId));
  const runRowId = nextId('TR', 5);
  const log = (status, output, extra = {}) => {
    q.insert('tool_runs', { id: runRowId, run_id: env.runId, tool_id: toolId, user_id: user ? user.id : null, input: JSON.stringify(input).slice(0, 1500), output_summary: TRUNC(output ?? '', 500), status, risk_level: def ? def.risk_level : 'UNKNOWN', approval_id: extra.approval_id || null, latency_ms: Date.now() - t0, provenance: extra.provenance || (def && def.integration) || 'INTERNAL', created_at: U.iso() });
    return { id: runRowId, tool_id: toolId, status, risk: def ? def.risk_level : 'UNKNOWN', latency_ms: Date.now() - t0, provenance: extra.provenance || (def && def.integration) || 'INTERNAL', approval_id: extra.approval_id || null, name_ko: def?.name_ko, name_en: def?.name_en };
  };
  if (!def) return { ...log('ERROR', 'unknown tool'), error: 'UNKNOWN_TOOL' };
  if (def.risk_level === 'BLOCKED' || !def.enabled) {
    G.audit(env.ctx, 'tool.blocked', 'tool', toolId, { reason: 'BLOCKED_BY_POLICY', input: TRUNC(input, 200) });
    return { ...log('BLOCKED', 'Blocked by policy'), error: 'BLOCKED_BY_POLICY' };
  }
  const role = user ? user.role : 'anon';
  if (!def.roles.includes(role)) {
    G.audit(env.ctx, 'tool.denied', 'tool', toolId, { role });
    return { ...log('BLOCKED', `Role ${role} not allowed`), error: 'ROLE_DENIED' };
  }
  if (def.rate_limit && !A.rateLimit(`tool:${user ? user.id : 'anon'}:${toolId}`, def.rate_limit, 60000)) {
    return { ...log('BLOCKED', 'Rate limit exceeded'), error: 'RATE_LIMITED' };
  }
  try {
    const out = H[toolId](env, input);
    const needsApproval = def.requires_approval && out && out.approval_id;
    const status = needsApproval ? 'APPROVAL_REQUIRED' : 'OK';
    const meta = log(status, out && out.hits ? `${out.hits.length} hits: ${out.hits.map((h) => h.doc_id).join(', ')}` : out, { approval_id: out && out.approval_id, provenance: (out && out.provenance) || undefined });
    return { ...meta, output: out };
  } catch (e) {
    if (e instanceof U.HttpError) { const m = log(e.status === 403 ? 'BLOCKED' : 'ERROR', e.message); return { ...m, error: e.code, message: e.message, http: e.status }; }
    const m = log('ERROR', e.message); return { ...m, error: 'TOOL_ERROR', message: e.message };
  }
}

module.exports = { runTool, textToSql, assertReadOnly, contractReview, classifyText, H };
