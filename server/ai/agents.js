'use strict';
// AI Export Assistant orchestrator:
// Screen → Intent/Entity → Planner → Agent Router (Multi-RAG / SQL / Tools) → Evidence Validator → Composer → Risk Policy → HITL
const { q, nextId, hyd, hydAll, getSetting } = require('../db');
const U = require('../util');
const G = require('../gov');
const A = require('../auth');
const NLP = require('./nlp');
const RAG = require('./rag');
const REG = require('./registry');
const LLM = require('./llm');
const { runTool, contractReview } = require('./tools');
const S = require('../domain/services');
const { COUNTRIES, PRODUCTS } = require('../seed/catalog');
const CBY = Object.fromEntries(COUNTRIES.map((c) => [c.code, c]));
const PBY = Object.fromEntries(PRODUCTS.map((p) => [p.key, p]));

const TITLES = {
  conclusion: ['결론', 'Conclusion'], evidence: ['핵심 근거', 'Key evidence'], actions: ['추천 행동', 'Recommended actions'],
  services: ['KOTRA 연계 서비스', 'Related KOTRA services'], cautions: ['주의·확인 필요', 'Cautions & items to verify'], sources: ['출처', 'Sources'],
};

// ---------- helpers ----------
const docRow = (id) => q.get('SELECT * FROM documents WHERE id=?', id);
function docText(id, lang) { const d = docRow(id); if (!d) return ''; return (lang === 'en' ? d.text_en || d.text : d.text || d.text_en) || ''; }
function bestSentences(text, qwords, n = 2, maxLen = 170) {
  const sents = String(text).replace(/\s+/g, ' ').split(/(?<=[.!?。])\s+/).map((s) => s.trim()).filter((s) => s.length > 12);
  const qs = new Set(qwords);
  const qc = NLP.conceptsOf(qwords.join(' '));
  const scored = sents.map((s, i) => {
    const w = new Set(NLP.words(s));
    let sc = 0; for (const x of qs) if (w.has(x)) sc += 1;
    const c = NLP.conceptsOf(s); for (const k of qc.keys()) if (c.has(k)) sc += 0.6;
    if (i === 0) sc += 0.4;
    if (s.length > maxLen * 1.4) sc -= 0.5;
    return { s, i, sc };
  });
  return scored.sort((a, b) => b.sc - a.sc).slice(0, n).sort((a, b) => a.i - b.i).map((x) => (x.s.length > maxLen * 1.6 ? x.s.slice(0, maxLen * 1.6) + '…' : x.s));
}
const pctRel = (r) => Math.round(Math.min(1, r) * 100);
function filterHits(hits, floor = 0.5) { if (!hits.length) return []; const top = hits[0].relevance; return hits.filter((h) => h.relevance >= Math.max(floor, top * 0.78)); }
function scoped(hits, cc, hs) {
  return hits.filter((h) => (!cc || !h.country || h.country === cc || h.country === 'KR') && (!hs || !h.hs || String(h.hs).slice(0, 2) === String(hs).slice(0, 2)));
}
const MISS_LABEL = { agree_privacy: ['개인정보 수집·이용 동의', 'Privacy consent'], company_name: ['회사명', 'Company name'], biz_no: ['사업자등록번호', 'Business registration no.'], purpose: ['신청 목적', 'Purpose'], expected_outcome: ['기대 성과', 'Expected outcome'] };
const missingLabel = (m, L) => (m.startsWith('doc:') ? (L === 'en' ? 'Attachment: ' : '첨부서류: ') + m.slice(4) : (MISS_LABEL[m] ? MISS_LABEL[m][L === 'en' ? 1 : 0] : m));
const mentions = (text, list) => list.find((x) => text.toLowerCase().includes(String(x.name).toLowerCase()));

// ---------- the run ----------
async function chat({ ctx, message, locale = 'ko', sessionId = null, projectId = null, attachments = [], emit = () => {}, ephemeral = false, mode = 'chat' }) {
  const t0 = Date.now();
  const user = ctx.user;
  const L = locale === 'en' ? 'en' : 'ko';
  const T = (ko, en) => (L === 'en' ? en : ko);
  const runId = nextId('RUN', 4);
  const env = { ctx, runId, lang: L, shared: {}, ragOpts: RAG.getOptions() };
  const steps = []; const toolRuns = []; const ragTraces = [];
  const step = (s) => { const st = { ...s, t: Date.now() - t0 }; steps.push(st); emit({ type: 'step', ...st }); };
  const tool = (id, input, label) => {
    const r = runTool(env, id, input);
    const meta = { id: r.id, tool_id: id, name: L === 'en' ? r.name_en : r.name_ko, status: r.status, risk: r.risk, latency_ms: r.latency_ms, provenance: r.provenance, approval_id: r.approval_id };
    toolRuns.push(meta);
    step({ kind: 'tool', tool: id, status: r.status, risk: r.risk, label: label || (L === 'en' ? r.name_en : r.name_ko), latency_ms: r.latency_ms, provenance: r.provenance });
    return r;
  };

  // session
  let session = sessionId ? q.get('SELECT * FROM chat_sessions WHERE id=? AND user_id=?', sessionId, user ? user.id : '') : null;
  const company = S.companyOf(user);
  if (!session && user && !ephemeral) {
    const sid = nextId('CHT', 4);
    const prj = projectId || (company ? (S.primaryProject(company.id) || {}).id : null);
    q.insert('chat_sessions', { id: sid, user_id: user.id, project_id: prj, title: message.slice(0, 40), starred: 0, summary: null, created_at: U.iso(), updated_at: U.iso() });
    session = q.get('SELECT * FROM chat_sessions WHERE id=?', sid);
  }
  if (session) q.insert('chat_messages', { id: nextId('MSG', 5), session_id: session.id, role: 'user', content: U.maskPII(message), payload: null, trace_id: runId, rating: null, created_at: U.iso() });

  const finish = (resp, extra = {}) => {
    const latency = Date.now() - t0;
    const full = { trace_id: runId, session_id: session ? session.id : null, latency_ms: latency, provenance: extra.provenance || 'LOCAL', ...resp };
    const mid = nextId('MSG', 5);
    if (session) {
      q.insert('chat_messages', { id: mid, session_id: session.id, role: 'assistant', content: full.answer, payload: JSON.stringify({ sections: full.sections, sources: full.sources, suggested_actions: full.suggested_actions, artifact: full.artifact, abstained: full.abstained, blocked: full.blocked || null, entities: full.entities, follow_ups: full.follow_ups, tool_runs: full.tool_runs }), trace_id: runId, rating: null, created_at: U.iso() });
      q.update('chat_sessions', session.id, { updated_at: U.iso() });
    }
    full.message_id = mid;
    const tin = Math.ceil(message.length / 2), tout = Math.ceil((full.answer || '').length / 2);
    q.insert('agent_runs', { id: runId, session_id: session ? session.id : null, user_id: user ? user.id : null, role: user ? user.role : 'anon', question: U.maskPII(message).slice(0, 1000), mode, plan: JSON.stringify(extra.plan || []), entities: JSON.stringify(full.entities || {}), rag: JSON.stringify(extra.rag || []), sources: JSON.stringify((full.sources || []).map((s) => ({ n: s.n, doc_id: s.doc_id, title: s.title, relevance: s.relevance }))), tool_calls: JSON.stringify(toolRuns), approval_id: extra.approval_id || null, response: JSON.stringify({ answer: full.answer.slice(0, 4000), sections: full.sections }), abstained: full.abstained ? 1 : 0, blocked: full.blocked ? JSON.stringify(full.blocked) : null, flags: JSON.stringify(extra.flags || []), latency_ms: latency, tokens_in: tin, tokens_out: tout, cost_usd: extra.cost ?? null, model: extra.model || 'local-evidence-engine', provenance: full.provenance, status: full.blocked ? 'BLOCKED' : full.abstained ? 'ABSTAINED' : 'OK', created_at: U.iso() });
    if (full.blocked) G.audit(ctx, 'ai.blocked', 'agent_run', runId, { reason: full.blocked.reason, question: U.maskPII(message).slice(0, 200) });
    return full;
  };
  const refuse = (kind, reason, text_ko, text_en, flags = []) => {
    const text = T(text_ko, text_en);
    return finish({ answer: text, sections: [{ key: 'conclusion', title: T(...TITLES.conclusion), body: text, cite: [] }], sources: [], suggested_actions: kind === 'blocked' ? [] : [{ type: 'consult_expert', label: T('전문가 상담으로 연결', 'Connect to an expert'), prefill: message }], tool_runs: toolRuns, artifact: null, abstained: kind === 'abstain', blocked: kind === 'blocked' ? { reason } : null, entities: {}, follow_ups: [] }, { flags, plan: [kind] });
  };

  step({ kind: 'received', label: T('질문 접수', 'Question received') });

  // ---- 1. Screening (PII / injection / profanity)
  const scr = NLP.screenQuery(message);
  if (scr.flags.includes('PII_RRN') || scr.flags.includes('PII_CARD')) {
    step({ kind: 'policy', label: T('개인정보 포함 질의 차단', 'Blocked: query contains personal identifiers') });
    return refuse('blocked', 'PII_IN_QUERY', '질문에 주민등록번호·카드번호 등 개인정보가 포함되어 있어 처리할 수 없습니다. 해당 정보를 제외하고 다시 질문해 주세요.', 'Your message contains personal identifiers (national ID / card number), so it cannot be processed. Please remove them and ask again.', scr.flags);
  }
  if (scr.flags.includes('PROMPT_INJECTION')) {
    step({ kind: 'policy', label: T('프롬프트 인젝션 탐지 → 지시 무시', 'Prompt injection detected → instruction ignored') });
    return refuse('blocked', 'PROMPT_INJECTION', '시스템 지침을 변경하거나 내부 정보를 출력하라는 요청은 수행하지 않습니다. 무역·투자 관련 질문을 도와드리겠습니다.', 'I will not follow requests to change system rules or reveal internal information. I can help with trade and investment questions.', scr.flags);
  }
  if (scr.flags.includes('PROFANITY')) return refuse('abstain', 'PROFANITY', '부적절한 표현이 포함되어 답변을 드리기 어렵습니다. 수출·투자와 관련해 궁금한 점을 정중히 질문해 주세요.', 'I cannot answer messages containing inappropriate language. Please ask your trade or investment question politely.', scr.flags);

  // ---- 2. Data-exfiltration / scope check
  const names = hydAll(q.all('SELECT name, name_en FROM companies')).flatMap((c) => [c.name, c.name_en]);
  const ex = NLP.detectDataExfil(message, company && company.name, names);
  if (ex.blocked) {
    step({ kind: 'policy', label: T('권한 밖 정보 요청 → 접근 차단', 'Out-of-scope data request → access denied') });
    runTool(env, ex.reason === 'ADMIN_SCOPE' ? 'admin.export_data' : 'customer.lookup_other', { query: U.maskPII(message).slice(0, 200), target: ex.named });
    toolRuns.push({ tool_id: ex.reason === 'ADMIN_SCOPE' ? 'admin.export_data' : 'customer.lookup_other', name: T('권한 밖 정보 조회', 'Out-of-scope lookup'), status: 'BLOCKED', risk: 'BLOCKED', latency_ms: 0, provenance: 'BLOCKED' });
    return refuse('blocked', ex.reason, ex.reason === 'ADMIN_SCOPE' ? '관리자 기능과 감사 정보는 AI 수출비서를 통해 제공되지 않습니다. 권한이 있는 관리자 콘솔을 이용해 주세요.' : '다른 기업·개인의 연락처, 상담이력 등 개인정보 및 비공개 정보는 제공할 수 없습니다. 이 시도는 보안 감사 로그에 기록되었습니다.', ex.reason === 'ADMIN_SCOPE' ? 'Admin functions and audit data are not available through the assistant. Please use the admin console with proper authority.' : 'I cannot provide contact details, consultation history or other personal or non-public information about other companies or individuals. This attempt has been recorded in the security audit log.', ['EXFIL_ATTEMPT']);
  }

  // ---- 2b. Attachments: treat as DATA only. Instruction-like lines are removed and logged (prompt-injection defence)
  const att = (attachments || []).filter((a) => a.text);
  const injectedAtt = [];
  for (const a of att) {
    const hits = NLP.scanInjection(a.text);
    if (hits.length) { injectedAtt.push(a.name); a.text = a.text.split(/(?<=[.!?。\n])\s*/).filter((l) => !NLP.scanInjection(l).length).join(' '); }
    a.text = a.text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  }
  if (injectedAtt.length) {
    step({ kind: 'policy', label: T('첨부 문서 내 지시문 감지 → 명령으로 실행하지 않고 제거', 'Instruction-like text found in attachment → removed, not executed') });
    G.audit(ctx, 'ai.attachment_injection', 'agent_run', runId, { files: injectedAtt });
  }

  // ---- 3. Entities, intents, memory
  const prevPayload = session ? hyd(q.get("SELECT payload FROM chat_messages WHERE session_id=? AND role='assistant' ORDER BY created_at DESC, id DESC LIMIT 1", session.id)) : null;
  const prevEnt = prevPayload && prevPayload.payload && (typeof prevPayload.payload === 'string' ? JSON.parse(prevPayload.payload) : prevPayload.payload).entities || {};
  const ent = NLP.extractEntities(message);
  const explicitEnt = { countries: [...ent.countries], products: [...ent.products] };
  let inherited = [];
  if (!ent.countries.length && prevEnt.countries && prevEnt.countries.length) { ent.countries = prevEnt.countries; inherited.push('countries'); }
  if (!ent.products.length && prevEnt.products && prevEnt.products.length) { ent.products = prevEnt.products; inherited.push('products'); }
  const unkInfo = RAG.unknownTerms(message);
  const firstPerson = /(우리|저희|내\s|귀사|제\s*(품목|제품)|our |my )/i.test(message);
  const groundingGuard = message.length < 200 && !(attachments && attachments.length) && unkInfo.unknown.length >= 2 && unkInfo.share >= 0.3;
  if (groundingGuard) {
    for (const k of ['countries', 'products']) if (inherited.includes(k)) { ent[k] = []; }
    inherited = inherited.filter((k) => !['countries', 'products'].includes(k));
    if (!NLP.inDomain(message, ent, NLP.detectIntents(message).map((i) => i.intent))) {
      step({ kind: 'policy', label: T('도메인 범위 밖 질의', 'Out-of-domain question') });
      return refuse('abstain', 'OUT_OF_SCOPE', '이 질문은 무역·투자 서비스 범위를 벗어나 있어 답변을 드리기 어렵습니다. 수출 시장, 규제·인증, 바이어, 지원사업, 상담 등에 대해 질문해 주세요.', 'This question is outside the scope of trade and investment services. Please ask about export markets, regulations, buyers, support programs or consulting.', ['OUT_OF_SCOPE']);
    }
    step({ kind: 'validate', label: T(`지식베이스에 없는 용어 ${unkInfo.unknown.length}개 → 근거 부족`, `${unkInfo.unknown.length} terms absent from the knowledge base → insufficient evidence`), detail: { unknown: unkInfo.unknown } });
    return refuse('abstain', 'NO_EVIDENCE', '근거 부족\n현재 연결된 KOTRA/공공 데이터만으로는 확인할 수 없습니다. 확인되지 않은 내용을 단정하지 않기 위해 답변을 유보합니다. 전문가 상담으로 연결해 정확한 안내를 받으실 수 있습니다.', 'Insufficient evidence\nThis cannot be confirmed from the KOTRA/public data currently connected. To avoid asserting unverified content, I am withholding an answer. You can be connected to an expert for accurate guidance.', ['NO_EVIDENCE']);
  }
  const project = company ? S.primaryProject(company.id) : null;
  const profileCountry = project && project.country;
  const intentsRaw = NLP.detectIntents(message);
  let intents = intentsRaw.map((i) => i.intent);
  const wantsStarter = /(무엇부터|뭐부터|처음|시작|어떻게 해야|where (do|should) i start|what should i do first|get started)/i.test(message);
  const wantsSubmit = /(제출|submit)/i.test(message) && /(신청|application)/i.test(message);
  const wantsDraftApp = /(신청서?\s*(초안|작성)|지원서|application draft|draft (the |an? )?application|신청해)/i.test(message) || intents.includes('application');
  const wantsEmail = /(이메일|메일|email|e-mail)/i.test(message) && /(초안|작성|써|draft|write)/i.test(message);
  const hasContractText = (attachments || []).some((a) => a.text && a.text.length > 60) || message.length > 260;
  step({ kind: 'understand', label: T('의도·개체 추출', 'Intent & entity extraction'), detail: { intents, entities: ent, inherited } });
  if (!ent.countries.length && company && (intents.includes('buyer') || intents.includes('program') || intents.includes('exhibition'))) { if (profileCountry) { ent.countries = [profileCountry]; inherited.push('profile.country'); } }
  if (!ent.products.length && company && (intents.includes('buyer') || intents.includes('program') || intents.includes('exhibition') || ((intents.includes('market') || intents.includes('regulation')) && (firstPerson || ent.countries.length)))) { ent.products = [company.product_keys[0]]; inherited.push('profile.product'); }

  // ---- 4. Planner
  const inDomain = NLP.inDomain(message, ent, intents) || (unkInfo.total >= 2 && unkInfo.share <= 0.34);
  let plan = [];
  const ORDER = ['market', 'regulation', 'buyer', 'program', 'exhibition', 'logistics', 'contract', 'marketing', 'application', 'stats', 'invest', 'glossary', 'consultation', 'report'];
  if (intents.includes('report')) intents = [...new Set([...intents, 'market', 'regulation', 'buyer', 'program'])];
  if (wantsDraftApp || wantsSubmit) intents = [...new Set([...intents.filter((i) => i !== 'program'), 'application'])];
  if (wantsEmail) intents = [...new Set([...intents, 'marketing'])];
  if (hasContractText && !intents.includes('contract') && /(계약|contract|agreement|조항|clause)/i.test(message + (attachments[0]?.text || ''))) intents.push('contract');
  plan = ORDER.filter((s) => intents.includes(s));
  if (!plan.length && inDomain && (ent.countries.length || ent.products.length || wantsStarter)) plan = ['market', 'regulation', 'buyer', 'program'];
  if (!plan.length && inDomain && /(kotra|코트라|무역투자|서비스|이용)/i.test(message)) plan = ['consultation'];
  if (!plan.length && inDomain) plan = ['general'];
  if (!plan.length && att.length) plan = ['attachment'];
  if (!plan.length) {
    step({ kind: 'policy', label: T('도메인 범위 밖 질의', 'Out-of-domain question') });
    return refuse('abstain', 'OUT_OF_SCOPE', '이 질문은 무역·투자 서비스 범위를 벗어나 있어 답변을 드리기 어렵습니다. 수출 시장, 규제·인증, 바이어, 지원사업, 상담 등에 대해 질문해 주세요.', 'This question is outside the scope of trade and investment services. Please ask about export markets, regulations, buyers, support programs or consulting.', ['OUT_OF_SCOPE']);
  }
  // ---- Direct hit: a guide / FAQ / glossary / regulation doc that matches the question very strongly is retrieved first (Multi-RAG across all non-buyer domains)
  let directHits = [];
  if (plan.length && !att.length && !plan.some((x) => ['application', 'report', 'contract'].includes(x)) && intents.length < 3) {
    const allCols = REG.COLLECTIONS.map((c) => c[0]).filter((c) => c !== 'BUYER');
    const dr = tool('knowledge.search', { query: message, collections: allCols, k: 4, filters: { country: explicitEnt.countries[0] || null, hs: explicitEnt.products[0] ? PBY[explicitEnt.products[0]].hs : null } }, T('Multi-RAG 직접 검색', 'Multi-RAG direct retrieval'));
    const hits = dr.output ? dr.output.hits : [];
    if (dr.output) ragTraces.push({ domain: 'ALL', query: message, top_k: 4, hits: hits.map((h) => ({ doc_id: h.doc_id, rel: h.relevance, lex: h.lexical, sem: h.semantic, cov: h.coverage })), trace: dr.output.trace });
    if (hits[0] && hits[0].relevance >= 0.72 && hits[0].coverage >= 0.5) {
      directHits = scoped(hits.filter((h) => h.relevance >= Math.max(0.55, hits[0].relevance * 0.8)), explicitEnt.countries[0], explicitEnt.products[0] ? PBY[explicitEnt.products[0]].hs : null);
      if (directHits.length) {
        const strongIds = new Set(intentsRaw.filter((i) => i.score >= 2).map((i) => i.intent));
        const asksReco = /(추천|찾아|recommend|find me)/i.test(message);
        if (hits[0].relevance >= 0.85) plan = plan.filter((x) => strongIds.has(x) || (asksReco && ['buyer', 'program', 'exhibition'].includes(x)));
        plan = ['direct', ...plan.filter((x) => x !== 'direct' && x !== 'general')];
      }
    }
  }
  if (att.length && !plan.includes('contract')) plan = ['attachment', ...plan.filter((x) => x !== 'general')];
  step({ kind: 'plan', label: T('실행 계획 수립 (Supervisor)', 'Plan created (Supervisor)'), detail: { agents: plan.map((p) => (REG.AGENTS.find((a) => a[0] === (p === 'application' ? 'program' : p === 'general' ? 'consultation' : p === 'attachment' ? 'supervisor' : p)) || [p])[1]) } });

  // ---- 5. Execute agents
  const cc = ent.countries[0] || null;
  const pk = ent.products[0] || null;
  const hsFromProduct = pk ? PBY[pk].hs : null;
  const cNameL = cc ? (L === 'en' ? CBY[cc].en : CBY[cc].ko) : '';
  const pNameL = pk ? (L === 'en' ? PBY[pk].en : PBY[pk].ko) : '';
  const sources = []; const cmap = new Map();
  const cite = (docId, rel) => {
    if (cmap.has(docId)) return cmap.get(docId);
    const d = docRow(docId); if (!d) return null;
    const n = sources.length + 1;
    sources.push({ n, doc_id: d.id, title: L === 'en' ? d.title_en || d.title : d.title, org: d.org, url: d.url, date: d.published_at, relevance: pctRel(rel ?? 0.6), collection: d.collection_id, scope: d.access_scope, synthetic: !!d.is_synthetic, snippet: bestSentences(docText(d.id, L), NLP.words(message), 1, 140)[0] || '' });
    cmap.set(docId, n); return n;
  };
  const findings = []; const actions = []; const artifacts = []; const services = []; const cautions = []; const followUps = [];
  const qWords = NLP.words(message);
  let anyApproval = null; let hadEvidence = false;
  const lookups = { buyers: hydAll(q.all('SELECT id,name FROM buyers')), programs: hydAll(q.all('SELECT id,title_ko AS name FROM programs')).concat(hydAll(q.all('SELECT id,title_en AS name FROM programs'))) };

  for (const s of plan) {
    const f = { step: s, bullets: [], ok: false };
    if (s === 'attachment') {
      step({ kind: 'agent', agent: 'supervisor', label: T('첨부 문서 분석 (사용자 업로드)', 'Analysing uploaded document') });
      for (const a of att) {
        const key = 'ATT:' + a.name; const n = sources.length + 1;
        sources.push({ n, doc_id: key, title: a.name, org: T('사용자 첨부 문서', 'User attachment'), url: null, date: U.today(), relevance: 90, collection: 'ATTACHMENT', scope: 'MEMBER', synthetic: false, snippet: '' });
        cmap.set(key, n);
        const wantsSummary = /(요약|summar|정리)/i.test(message);
        const sents = wantsSummary ? (a.text.replace(/\s+/g, ' ').match(/[^.!?。\n]+[.!?。]?/g) || []).map((x) => x.trim()).filter((x) => x.length > 12).slice(0, 4) : bestSentences(a.text, qWords, 3);
        sents.forEach((x) => f.bullets.push({ text: x.length > 260 ? x.slice(0, 260) + '…' : x, cite: [n] }));
        if (sents.length) { f.ok = true; hadEvidence = true; }
      }
      if (f.ok) { f.summary = T(`첨부 문서 ${att.length}건을 분석했습니다.`, `Analysed ${att.length} attachment(s).`); if (injectedAtt.length) cautions.push(T(`첨부 문서(${injectedAtt.join(', ')})에 포함된 지시문(예: "이전 지시를 무시")은 명령이 아닌 데이터로만 취급하여 제거했으며 실행하지 않았습니다. 이 사실은 감사 로그에 기록되었습니다.`, `Instruction-like text in the attachment(s) (${injectedAtt.join(', ')}) was treated as data only, removed and not executed. It was recorded in the audit log.`)); }
    }

    if (s === 'direct') {
      step({ kind: 'agent', agent: 'supervisor', label: T('Supervisor · 질문과 직접 일치하는 지식 확인', 'Supervisor · direct knowledge match') });
      directHits.slice(0, 3).forEach((h2) => { const n = cite(h2.doc_id, h2.relevance); bestSentences(docText(h2.doc_id, L), qWords, 2).forEach((sent) => f.bullets.push({ text: sent, cite: [n] })); });
      if (f.bullets.length) { f.ok = true; hadEvidence = true; f.summary = f.bullets[0].text; step({ kind: 'rag', domain: 'ALL', label: T(`직접 일치 근거 ${directHits.length}건`, `${directHits.length} direct matches`) }); }
    }

    if (s === 'market') {
      step({ kind: 'agent', agent: 'market', label: T('Market Agent · 시장 정보 검색', 'Market Agent · searching market info') });
      const query = `${cNameL} ${pNameL} ${T('시장 진출 동향', 'market entry trends')} ${message}`;
      const r = tool('market.search', { query, filters: { country: cc, hs: hsFromProduct }, k: 5 }, T('RAG-MARKET 검색', 'RAG-MARKET search'));
      const hits = r.output ? scoped(filterHits(r.output.hits), cc, hsFromProduct) : [];
      if (r.output) ragTraces.push({ domain: 'MARKET', query, top_k: 5, hits: r.output.hits.map((h) => ({ doc_id: h.doc_id, rel: h.relevance, lex: h.lexical, sem: h.semantic, cov: h.coverage })), trace: r.output.trace });
      step({ kind: 'rag', domain: 'MARKET', label: T(`근거 ${hits.length}건 검증 통과`, `${hits.length} evidence items validated`), detail: { query, kept: hits.length } });
      hits.slice(0, 3).forEach((h) => { const n = cite(h.doc_id, h.relevance); const sent = bestSentences(docText(h.doc_id, L), qWords, 1)[0]; if (n && sent) f.bullets.push({ text: sent, cite: [n] }); });
      if (hits.length) {
        f.ok = true; hadEvidence = true;
        artifacts.push({ type: 'market_table', title: T('시장 근거 비교표', 'Market evidence comparison'), data: { rows: hits.map((h) => ({ n: cmap.get(h.doc_id), title: L === 'en' ? h.title_en || h.title : h.title, org: h.org, date: h.published_at, country: h.country, relevance: pctRel(h.relevance), type: h.doc_type })) } });
        f.summary = f.bullets[0] && f.bullets[0].text;
        if (company) S.advanceJourney(company.id, 2, 'DONE', `${cNameL || ''} 시장 요약 확인`);
        followUps.push(T('이 시장의 규제·인증 체크리스트를 만들어줘', 'Create a regulation & certification checklist for this market'));
      }
      if (cc && pk) {
        const st = tool('stats.query', { question: message, entities: { countries: [cc], products: [pk], hs: [] } }, T('무역통계 조회 (Text-to-SQL, 읽기전용)', 'Trade statistics (read-only Text-to-SQL)'));
        if (st.output && st.output.rows && st.output.rows.length) {
          artifacts.push({ type: 'chart', title: st.output.desc, data: { sql: st.output.sql, params: st.output.params, rows: st.output.rows, synthetic: true } });
          const last = st.output.rows[st.output.rows.length - 1];
          f.bullets.push({ text: T(`${cNameL} ${pNameL} 관련 교역 규모는 ${last.year}년 약 ${last.export_usd_m}백만 달러, 전년 대비 ${last.yoy}% 변화(시연 합성 지표).`, `Trade in ${pNameL} for ${cNameL} was about USD ${last.export_usd_m}M in ${last.year}, ${last.yoy}% vs prior year (synthetic demo indicator).`), cite: [], badge: 'SYNTHETIC' });
        }
      }
    }

    if (s === 'regulation') {
      step({ kind: 'agent', agent: 'regulation', label: T('Regulation Agent · 규제·인증 검색', 'Regulation Agent · searching regulations') });
      const query = `${cNameL} ${pNameL} ${T('규제 인증 필수서류 라벨 등록', 'regulation certification required documents label registration')} ${hsFromProduct || ''} ${message}`;
      const r = tool('regulation.search', { query, filters: { country: cc, hs: hsFromProduct }, k: 5 }, T('RAG-REGULATION 검색', 'RAG-REGULATION search'));
      const hits = r.output ? scoped(filterHits(r.output.hits), cc, hsFromProduct) : [];
      if (r.output) ragTraces.push({ domain: 'REGULATION', query, top_k: 5, hits: r.output.hits.map((h) => ({ doc_id: h.doc_id, rel: h.relevance, lex: h.lexical, sem: h.semantic, cov: h.coverage })), trace: r.output.trace });
      step({ kind: 'rag', domain: 'REGULATION', label: T(`근거 ${hits.length}건 검증 통과`, `${hits.length} evidence items validated`), detail: { query, kept: hits.length } });
      if (hits.length) {
        f.ok = true; hadEvidence = true;
        const top = hits[0];
        env.shared.hs = top.hs || hsFromProduct; // multi-hop: carry HS prefix to following steps
        if (env.shared.hs) step({ kind: 'multihop', label: T(`Multi-Hop: HS ${env.shared.hs} 를 다음 검색에 전달`, `Multi-hop: carrying HS ${env.shared.hs} to the next retrieval`) });
        hits.slice(0, 2).forEach((h) => { const n = cite(h.doc_id, h.relevance); const sents = bestSentences(docText(h.doc_id, L), qWords, 2); sents.forEach((sent) => f.bullets.push({ text: sent, cite: [n] })); });
        const reg = hyd(q.get('SELECT * FROM regulations WHERE id=?', top.doc_id.replace(/^D-/, '')));
        if (reg) {
          const items = (reg.requirements || []).map((x, i) => ({ id: `r${i + 1}`, text: L === 'en' ? x.en : x.ko, done: false }));
          artifacts.push({ type: 'checklist', title: T(`${CBY[reg.country]?.ko || ''} 규제·인증 체크리스트`, `${CBY[reg.country]?.en || ''} regulation & certification checklist`), data: { items, country: reg.country, hs: reg.hs_prefix, risk: reg.risk, agency: reg.agency, source_n: cmap.get(top.doc_id), source_url: reg.source_url } });
          f.summary = T(`필수 절차 ${items.length}건(위험도 ${reg.risk})`, `${items.length} required steps (risk ${reg.risk})`);
          if (reg.risk === 'HIGH') cautions.push(T('고위험 품목입니다. 사전 인허가·현지 대리인이 필요할 수 있으니 전문가 상담을 권장합니다.', 'High-risk category. Prior approval and a local agent may be required; expert consulting is recommended.'));
          actions.push({ type: 'save_checklist', label: T('체크리스트를 내 프로젝트에 저장', 'Save checklist to my project'), data: { items, country: reg.country, title: reg.title_ko } });
          followUps.push(T('후보 바이어를 추천해줘', 'Recommend candidate buyers'));
        }
        if (company) S.advanceJourney(company.id, 3, 'IN_PROGRESS', '규제·인증 체크리스트 생성');
      }
    }

    if (s === 'buyer') {
      step({ kind: 'agent', agent: 'buyer', label: T('Buyer Discovery Agent · 후보 바이어 탐색', 'Buyer Discovery Agent · finding candidate buyers') });
      const openEvent = company ? q.get("SELECT e.* FROM events e JOIN event_participants p ON p.event_id=e.id AND p.kind='COMPANY' AND p.ref_id=? AND p.status='APPROVED' WHERE e.status IN ('RECRUITING','UPCOMING') ORDER BY e.start_date LIMIT 1", company.id) : null;
      const r = company ? tool('buyer.recommend', { country: cc, productKeys: pk ? [pk] : null, limit: 5, eventId: openEvent && openEvent.id }, T('AI 바이어 추천', 'AI buyer recommendation')) : tool('buyer.search', { country: cc, product: pk, limit: 5 }, T('바이어 검색', 'Buyer search'));
      const list = r.output ? (r.output.buyers || []) : [];
      if (r.error === 'ROLE_DENIED') { f.denied = true; cautions.push(T('바이어 정보는 로그인한 회원에게만 제공됩니다.', 'Buyer information is available to logged-in members only.')); }
      if (list.length) {
        f.ok = true; hadEvidence = true;
        list.slice(0, 3).forEach((b) => { const n = cite('D-' + b.id, (b.score || 70) / 100); f.bullets.push({ text: T(`${b.name} (${b.country_name.ko}, ${b.type}) — AI Match ${b.score ?? '-'}점${b.reasons && b.reasons[0] ? ': ' + b.reasons[0].ko : ''}`, `${b.name} (${b.country_name.en}, ${b.type}) — AI Match ${b.score ?? '-'}${b.reasons && b.reasons[0] ? ': ' + b.reasons[0].en : ''}`), cite: n ? [n] : [] }); });
        artifacts.push({ type: 'buyers', title: T('추천 바이어', 'Recommended buyers'), data: { buyers: list.map((b) => ({ id: b.id, name: b.name, country: b.country, country_name: b.country_name, type: b.type, score: b.score, parts: b.score_parts, max: b.score_max, reasons: b.reasons, trust: b.trust, verified: !!b.verified, synthetic: true, channels: b.channels, products: b.products, match: b.match || null })), event: openEvent ? { id: openEvent.id, title_ko: openEvent.title_ko, title_en: openEvent.title_en } : null } });
        f.summary = T(`후보 바이어 ${list.length}곳을 추천합니다`, `${list.length} candidate buyers recommended`);
        const top = list[0];
        if (company) {
          S.advanceJourney(company.id, 4, 'IN_PROGRESS', `AI 추천 바이어 ${list.length}곳 검토`);
          actions.push({ type: 'save_buyer', label: T(`${top.name} 관심 저장`, `Save ${top.name}`), buyer_id: top.id });
          if (openEvent) actions.push({ type: 'request_match', label: T(`${top.name}에 상담 신청 (승인 필요)`, `Request meeting with ${top.name} (approval required)`), buyer_id: top.id, event_id: openEvent.id });
          actions.push({ type: 'draft_email', label: T(`${top.name} 첫 접촉 이메일 초안`, `Draft first-contact email to ${top.name}`), buyer_id: top.id });
        }
        followUps.push(T('신청 가능한 지원사업을 추천해줘', 'Recommend programs I can apply to'));
        cautions.push(T('바이어는 시연용 합성 데이터입니다. 실제 거래 전에는 바이어 검증을 진행하세요.', 'Buyers are synthetic demo data. Run buyer verification before any real transaction.'));
      }
    }

    if (s === 'program') {
      step({ kind: 'agent', agent: 'program', label: T('Program Agent · 맞춤 지원사업 추천', 'Program Agent · tailored program recommendation') });
      const r = company ? tool('program.recommend', { country: cc, product: pk, limit: 5 }, T('맞춤 사업 추천', 'Tailored program recommendation')) : tool('program.search', { country: cc, product: pk, limit: 5 }, T('지원사업 검색', 'Program search'));
      let list = r.output ? (r.output.programs || []) : [];
      const norm_ = (t) => String(t).replace(/\(.*?\)/g, '').replace(/\s+/g, '');
      const msgNs = message.replace(/\s+/g, '');
      const named = list.find((p) => [p.title_ko, p.title_en].some((t) => { const c = norm_(t); return c.length >= 4 && (msgNs.includes(c) || msgNs.includes(c.replace(/^해외/, ''))); }));
      let namedProg = named;
      if (!namedProg) { const all = q.all('SELECT * FROM programs').map(S.programView); namedProg = all.find((p) => { const c = norm_(p.title_ko); return c.length >= 4 && (msgNs.includes(c) || msgNs.includes(c.replace(/^해외/, ''))); }); if (namedProg) namedProg = { ...namedProg, recommend: null, reasons: [], missing: [] }; }
      if (namedProg) list = [namedProg, ...list.filter((p) => p.id !== namedProg.id)];
      if (list.length) {
        f.ok = true; hadEvidence = true;
        list.slice(0, 3).forEach((p) => { const n = cite('D-' + p.id, (p.recommend || 70) / 100); const d = p.d_day != null ? (p.live_status === 'UPCOMING' ? T(`D-${p.days_to_start} 시작`, `starts D-${p.days_to_start}`) : T(`마감 D-${p.d_day}`, `closes D-${p.d_day}`)) : ''; f.bullets.push({ text: `${L === 'en' ? p.title_en : p.title_ko}${p.recommend ? T(` — 추천도 ${p.recommend}%`, ` — fit ${p.recommend}%`) : ''}${d ? ` (${d})` : ''}`, cite: n ? [n] : [] }); services.push({ kind: 'program', id: p.id, title: L === 'en' ? p.title_en : p.title_ko, href: `#/programs/${p.id}`, d_day: p.d_day, status: p.live_status }); });
        artifacts.push({ type: 'programs', title: T('추천 지원사업', 'Recommended programs'), data: { programs: list.map((p) => ({ id: p.id, title_ko: p.title_ko, title_en: p.title_en, type: p.type, d_day: p.d_day, live_status: p.live_status, recommend: p.recommend, reasons: p.reasons, missing: p.missing, apply_end: p.apply_end, dept_ko: p.dept_ko })) } });
        f.summary = T(`맞춤 지원사업 ${list.length}건을 추천합니다`, `${list.length} tailored programs recommended`);
        const top = list.find((p) => p.live_status === 'OPEN') || list[0];
        if (company && top) actions.push({ type: 'draft_application', label: T(`"${top.title_ko}" 신청 초안 만들기`, `Draft application: "${top.title_en}"`), program_id: top.id });
        const soon = list.find((p) => p.live_status === 'OPEN' && p.d_day != null && p.d_day <= 7);
        if (soon) cautions.push(T(`"${soon.title_ko}"은(는) 마감 D-${soon.d_day} 입니다. 서둘러 신청하세요.`, `"${soon.title_en}" closes in ${soon.d_day} days.`));
        followUps.push(T('1순위 사업 신청서 초안을 만들어줘', 'Draft the application for the top program'));
      }
    }

    if (s === 'exhibition') {
      step({ kind: 'agent', agent: 'exhibition', label: T('Exhibition Agent · 전시회·상담회 추천', 'Exhibition Agent · exhibitions & meetings') });
      const r = tool('event.search', { country: cc, product: pk }, T('행사·상담회 검색', 'Event search'));
      const progs = r.output ? r.output.programs : []; const evs = r.output ? r.output.events : [];
      if (progs.length || evs.length) {
        f.ok = true; hadEvidence = true;
        progs.slice(0, 3).forEach((p) => { const n = cite('D-' + p.id, 0.7); f.bullets.push({ text: `${L === 'en' ? p.title_en : p.title_ko} — ${p.event_start ? T(`개최 ${p.event_start}`, `event ${p.event_start}`) : ''} ${p.d_day != null ? T(`(신청 마감 D-${p.d_day})`, `(apply by D-${p.d_day})`) : ''}`, cite: n ? [n] : [] }); services.push({ kind: 'event', id: p.id, title: L === 'en' ? p.title_en : p.title_ko, href: `#/programs/${p.id}`, d_day: p.d_day, status: p.live_status }); });
        f.summary = T(`상담회·전시 ${progs.length}건`, `${progs.length} events`);
      }
    }

    if (['logistics', 'contract', 'marketing', 'invest', 'glossary', 'consultation', 'general'].includes(s)) {
      if (s === 'contract') {
        step({ kind: 'agent', agent: 'contract', label: T('Contract Agent · 계약 조항 점검', 'Contract Agent · clause review') });
        const text = (attachments || []).map((a) => a.text).filter(Boolean).join('\n') || message;
        if (text.length > 60) {
          const r = tool('contract.review', { text }, T('계약서 리스크 검토', 'Contract risk review'));
          const out = r.output;
          if (out) {
            f.ok = true; hadEvidence = true;
            out.findings.slice(0, 4).forEach((x) => f.bullets.push({ text: `[${x.severity}] ${L === 'en' ? x.en : x.ko}`, cite: [] }));
            if (!out.findings.length) f.bullets.push({ text: T('자동 점검에서 주요 위험 조항이 발견되지 않았습니다.', 'No major risk clauses were found in the automated check.'), cite: [] });
            artifacts.push({ type: 'contract', title: T('계약서 리스크 점검 결과', 'Contract risk review'), data: out });
            f.summary = T(`계약 위험도 ${out.risk_level}`, `Contract risk ${out.risk_level}`);
            cautions.push(out.disclaimer);
            if (company) S.advanceJourney(company.id, 6, 'IN_PROGRESS', '계약서 리스크 점검');
          }
        }
      }
      const agentId = s === 'general' ? 'consultation' : s;
      const cols = s === 'general' ? ['GENERAL', 'CONSULTATION', 'MARKET'] : REG.ROUTES[s] || ['GENERAL'];
      if (!(s === 'marketing' && wantsEmail) && !(s === 'consultation' && /(상담\s*(신청|등록|연결)|전문가)/.test(message))) {
        step({ kind: 'agent', agent: agentId, label: T(`${REG.AGENTS.find((a) => a[0] === agentId)?.[1] || s} · 지식 검색`, `${REG.AGENTS.find((a) => a[0] === agentId)?.[2] || s} · knowledge search`) });
        const query = `${cNameL} ${pNameL} ${message}`;
        const r0 = tool('knowledge.search', { query, collections: cols, k: 4, filters: { country: cc, hs: env.shared.hs || hsFromProduct } }, T('Multi-RAG 지식 검색', 'Multi-RAG knowledge search'));
        const r = { hits: r0.output ? r0.output.hits : [], trace: r0.output ? r0.output.trace : {} };
        ragTraces.push({ domain: cols.join('+'), query, top_k: 4, hits: r.hits.map((h) => ({ doc_id: h.doc_id, rel: h.relevance, lex: h.lexical, sem: h.semantic, cov: h.coverage })), trace: r.trace });
        const hits = scoped(filterHits(r.hits), cc, null);
        step({ kind: 'rag', domain: cols.join('+'), label: T(`근거 ${hits.length}건 검증 통과`, `${hits.length} evidence items validated`), detail: { query, kept: hits.length } });
        if (hits.length) {
          f.ok = true; hadEvidence = true;
          hits.slice(0, 3).forEach((h) => { const n = cite(h.doc_id, h.relevance); bestSentences(docText(h.doc_id, L), qWords, s === 'glossary' ? 2 : 2).forEach((sent) => f.bullets.push({ text: sent, cite: [n] })); });
          f.summary = f.bullets[0] && f.bullets[0].text;
        }
      }
      if (s === 'marketing' && wantsEmail && company) {
        step({ kind: 'agent', agent: 'marketing', label: T('Marketing Agent · 이메일 초안 작성', 'Marketing Agent · drafting email') });
        let bmention = mentions(message, lookups.buyers);
        const prevBuyers = prevPayload && prevPayload.payload ? (typeof prevPayload.payload === 'string' ? JSON.parse(prevPayload.payload) : prevPayload.payload).artifact : null;
        const bid = bmention ? bmention.id : (prevBuyers && prevBuyers.data && prevBuyers.data.buyers && prevBuyers.data.buyers[0] ? prevBuyers.data.buyers[0].id : (artifacts.find((a) => a.type === 'buyers')?.data.buyers[0]?.id || 'B-001'));
        const r = tool('document.generate', { type: 'email', buyer_id: bid }, T('이메일 초안 생성', 'Email draft generation'));
        if (r.output) {
          f.ok = true; hadEvidence = true;
          artifacts.push({ type: 'email', title: T('이메일 초안', 'Email draft'), data: { subject: r.output.subject, body: r.output.body, to: r.output.to, buyer: r.output.buyer } });
          f.bullets.push({ text: T('프로필과 바이어 정보를 바탕으로 영문 첫 접촉 이메일 초안을 작성했습니다. 발송 전 내용을 검토·수정하세요.', 'I drafted an English first-contact email from your profile and the buyer data. Review and edit before sending.'), cite: [] });
          actions.push({ type: 'send_email', label: T('이메일 발송 요청 (승인 필요, Mock 발송)', 'Request to send (approval required, mock delivery)'), data: { to: r.output.to, subject: r.output.subject, body: r.output.body } });
          f.summary = T('이메일 초안 생성', 'Email draft created');
          cautions.push(T('이메일 발송은 HITL 승인을 거치며 시연 환경에서는 실제 발송되지 않고 발송함(Mock)에 기록됩니다.', 'Sending requires HITL approval; in this demo nothing is actually sent — it is logged to the mock outbox.'));
        }
      }
      if (s === 'consultation' && /(상담\s*(신청|등록|연결)|전문가)/.test(message) && user) {
        step({ kind: 'agent', agent: 'consultation', label: T('Consultation Agent · 상담 분류·등록', 'Consultation Agent · classify & register') });
        const rr = tool('consultation.route', { text: message }, T('담당조직 제안', 'Routing suggestion'));
        if (rr.output) {
          f.ok = true; hadEvidence = true;
          f.bullets.push({ text: T(`문의 유형은 "${rr.output.category}"로 분류되며 ${rr.output.suggested_team}에서 처리하는 것이 적합합니다.`, `The inquiry is classified as "${rr.output.category}" and best handled by ${rr.output.suggested_team}.`), cite: [] });
          if (company) { actions.push({ type: 'consult_expert', label: T('이 내용으로 전문가 상담 등록', 'Register expert consultation with this content'), prefill: message }); }
        }
      }
    }

    if (s === 'stats') {
      step({ kind: 'agent', agent: 'market', label: T('Market Agent · 통계 질의 (Text-to-SQL)', 'Market Agent · statistics query (Text-to-SQL)') });
      const st = tool('stats.query', { question: message, entities: ent }, T('무역통계 조회 (Text-to-SQL, 읽기전용)', 'Trade statistics (read-only Text-to-SQL)'));
      if (st.output && st.output.rows && st.output.rows.length) {
        f.ok = true; hadEvidence = true;
        artifacts.push({ type: 'chart', title: st.output.desc, data: { sql: st.output.sql, params: st.output.params, rows: st.output.rows, synthetic: true } });
        f.bullets.push({ text: T(`${st.output.desc}: ${st.output.rows.length}행을 조회했습니다. 읽기전용 SQL이 실행되었으며 쿼리는 Trace에서 확인할 수 있습니다.`, `${st.output.desc}: ${st.output.rows.length} rows returned via read-only SQL; the query is visible in the trace.`), cite: [], badge: 'SYNTHETIC' });
        f.summary = st.output.desc;
      } else if (st.error === 'ROLE_DENIED') cautions.push(T('통계 조회는 로그인 후 이용할 수 있습니다.', 'Statistics are available after login.'));
    }

    if (s === 'application') {
      step({ kind: 'agent', agent: 'program', label: T('Program Agent · 신청 초안/제출', 'Program Agent · application draft / submission') });
      if (!company) { cautions.push(T('사업 신청은 기업 회원 로그인 후 가능합니다.', 'Applications require a company member login.')); }
      else {
        const pm = mentions(message, lookups.programs) || (message.match(/PG-\d{3}/i) ? { id: message.match(/PG-\d{3}/i)[0].toUpperCase() } : null);
        const prevProg = prevPayload && prevPayload.payload ? (typeof prevPayload.payload === 'string' ? JSON.parse(prevPayload.payload) : prevPayload.payload).artifact : null;
        const prevActions = prevPayload && prevPayload.payload ? ((typeof prevPayload.payload === 'string' ? JSON.parse(prevPayload.payload) : prevPayload.payload).suggested_actions || []) : [];
        const fromAction = prevActions.find((a) => a.type === 'draft_application');
        const pid = pm ? pm.id : (fromAction ? fromAction.program_id : (prevProg && prevProg.data && prevProg.data.programs ? prevProg.data.programs[0].id : null));
        const myApp = wantsSubmit ? q.get("SELECT * FROM applications WHERE company_id=? AND status IN ('DRAFT','READY_FOR_REVIEW') ORDER BY updated_at DESC LIMIT 1", company.id) : null;
        if (wantsSubmit && myApp) {
          const r = tool('application.submit', { application_id: myApp.id }, T('사업 신청 제출 (HIGH)', 'Submit application (HIGH)'));
          if (r.output && r.output.approval_id) { anyApproval = r.output.approval_id; f.ok = true; hadEvidence = true; f.bullets.push({ text: T('신청 제출은 대외 영향이 있는 작업이므로 사용자 최종 승인(HITL)이 필요합니다. 승인 요청을 생성했습니다.', 'Submission has external impact, so final human approval (HITL) is required. An approval request has been created.'), cite: [] }); actions.push({ type: 'open_approval', label: T('승인 창 열기', 'Open approval'), approval_id: r.output.approval_id }); f.summary = T('제출 승인 대기', 'Awaiting submission approval'); }
          else if (r.output && r.output.blocked_by_validation) { f.ok = true; hadEvidence = true; f.bullets.push({ text: T(`제출 전 보완이 필요한 항목이 ${r.output.missing.length}건 있습니다: ${r.output.missing.slice(0, 4).map((m) => missingLabel(m, 'ko')).join(', ')}`, `${r.output.missing.length} items need completion before submission: ${r.output.missing.slice(0, 4).map((m) => missingLabel(m, 'en')).join(', ')}`), cite: [] }); f.summary = T('제출 전 보완이 필요합니다', 'Needs completion before submission'); actions.push({ type: 'open_application', label: T('신청서 열어 보완하기', 'Open the application to complete it'), application_id: myApp.id }); }
        } else if (pid) {
          const r = tool('document.generate', { type: 'application', program_id: pid }, T('신청서 초안 생성 (MEDIUM)', 'Draft application (MEDIUM)'));
          if (r.output && r.output.application) {
            const app = r.output.application; const prog = hyd(q.get('SELECT * FROM programs WHERE id=?', pid));
            f.ok = true; hadEvidence = true;
            artifacts.push({ type: 'application', title: T('사업 신청 초안', 'Application draft'), data: { application_id: app.id, program_id: pid, program_title: L === 'en' ? prog.title_en : prog.title_ko, status: app.status, form: app.form, checklist: app.checklist, missing: r.output.missing } });
            f.bullets.push({ text: T(`"${prog.title_ko}" 신청서 초안을 기업정보로 자동 채워 생성했습니다(신청번호 ${app.id}). 부족한 항목 ${r.output.missing.length}건을 확인하세요.`, `I prefilled a draft for "${prog.title_en}" from your company profile (application ${app.id}). ${r.output.missing.length} items still need your input.`), cite: [] });
            actions.push({ type: 'open_application', label: T('신청서 열어 수정·제출', 'Open to edit & submit'), application_id: app.id });
            f.summary = T('신청 초안 생성', 'Application draft created');
            followUps.push(T('신청 제출해줘', 'Submit the application'));
            cautions.push(T('제출은 사용자 최종 승인(HITL) 후에만 접수되며, 시연 환경에서는 사업관리시스템 연계가 Mock 처리됩니다.', 'Submission is accepted only after your final approval (HITL); the program-management integration is mocked in this demo.'));
          }
        } else cautions.push(T('어떤 사업을 신청할지 알려주세요. (예: "수출바우처 신청 초안 만들어줘")', 'Please tell me which program to apply to (e.g. "draft an application for the export voucher").'));
      }
    }

    if (s === 'report') {
      step({ kind: 'agent', agent: 'report', label: T('Report Agent · 보고서 생성', 'Report Agent · building report') });
      const md = [`# ${T(`${cNameL} ${pNameL} 시장진출 보고서`, `${cNameL} ${pNameL} market-entry report`)}`, '', `> ${T('생성일', 'Generated')}: ${U.today()} · ${T('시연용 합성 자료 포함 — 원문 확인 필요', 'includes synthetic demo data — verify originals')}`, ''];
      const labels = { market: T('1. 시장 개요', '1. Market overview'), regulation: T('2. 규제·인증', '2. Regulation & certification'), buyer: T('3. 후보 바이어', '3. Candidate buyers'), program: T('4. 지원사업', '4. Support programs') };
      findings.filter((x) => labels[x.step] && x.ok).forEach((x) => { md.push(`## ${labels[x.step]}`); x.bullets.forEach((b) => md.push(`- ${b.text}${b.cite && b.cite.length ? ' ' + b.cite.map((n) => `[${n}]`).join('') : ''}`)); md.push(''); });
      md.push(`## ${T('출처', 'Sources')}`); sources.forEach((src) => md.push(`${src.n}. ${src.title} — ${src.org || ''} (${src.date || ''})`));
      const r = tool('report.create', { title: T(`${cNameL} ${pNameL} 시장진출 보고서`, `${cNameL} ${pNameL} market-entry report`), markdown: md.join('\n'), sources: sources.map((x) => x.doc_id) }, T('보고서 생성 (MEDIUM)', 'Create report (MEDIUM)'));
      if (r.output) { f.ok = true; hadEvidence = true; artifacts.push({ type: 'report', title: r.output.title, data: { report_id: r.output.report_id, markdown: md.join('\n') } }); f.bullets.push({ text: T('출처가 포함된 시장진출 보고서를 생성하여 "생성 문서"에 저장했습니다.', 'A market-entry report with citations was created and saved under Generated Documents.'), cite: [] }); f.summary = T('보고서 생성 완료', 'Report created'); }
    }
    findings.push(f);
  }

  // ---- 6. Evidence validation → abstain if nothing grounded
  const grounded = findings.some((f) => f.ok);
  const blockedHigh = toolRuns.some((t) => t.status === 'APPROVAL_REQUIRED');
  step({ kind: 'validate', label: grounded ? T(`근거 검증 완료 (출처 ${sources.length}건)`, `Evidence validated (${sources.length} sources)`) : T('근거 부족 → 답변 유보', 'Insufficient evidence → abstaining') });
  if (!grounded) {
    const body = T('근거 부족\n현재 연결된 KOTRA/공공 데이터만으로는 확인할 수 없습니다. 확인되지 않은 내용을 단정하지 않기 위해 답변을 유보합니다. 전문가 상담으로 연결해 정확한 안내를 받으실 수 있습니다.', 'Insufficient evidence\nThis cannot be confirmed from the KOTRA/public data currently connected. To avoid asserting unverified content, I am withholding an answer. You can be connected to an expert for accurate guidance.');
    const resp = finish({ answer: body, sections: [{ key: 'conclusion', title: T('근거 부족', 'Insufficient evidence'), body: body.split('\n').slice(1).join(' '), cite: [] }], sources: [], suggested_actions: [{ type: 'consult_expert', label: T('전문가 상담으로 연결', 'Connect to an expert'), prefill: message }], tool_runs: toolRuns, artifact: null, abstained: true, blocked: null, entities: ent, follow_ups: [] }, { plan, rag: ragTraces, flags: [], approval_id: null });
    return resp;
  }

  // ---- 7. Compose answer
  const okF = findings.filter((f) => f.ok);
  const phrase = { market: T('시장 여건 확인', 'checking market conditions'), regulation: T('규제·인증 선확인', 'confirming regulation & certification first'), buyer: T('후보 바이어 검토', 'reviewing candidate buyers'), program: T('지원사업 신청', 'applying to support programs'), exhibition: T('상담회 참가', 'joining meeting events'), contract: T('계약 조항 점검', 'reviewing contract clauses'), application: T('신청서 작성', 'preparing the application'), report: T('보고서 정리', 'compiling the report') };
  const order = okF.map((f) => phrase[f.step]).filter(Boolean);
  const subject = [cNameL, pNameL].filter(Boolean).join(' ');
  let conclusion = '';
  let skipFirstEvidence = false;
  const cited = okF.length === 1 ? okF[0].bullets.find((b) => b.cite && b.cite.length) : null;
  if (okF.length === 1 && cited) { conclusion = (['program', 'buyer', 'exhibition'].includes(okF[0].step) && okF[0].summary ? okF[0].summary + ': ' : '') + cited.text + ' ' + cited.cite.map((n) => `[${n}]`).join(''); skipFirstEvidence = cited; }
  else if (order.length >= 2) conclusion = T(`${subject ? subject + ' 수출은 ' : ''}${order.map((p, i) => `(${i + 1}) ${p}`).join(' → ')} 순서로 준비하는 것이 안전합니다.`, `${subject ? subject + ': ' : ''}a safe sequence is ${order.map((p, i) => `(${i + 1}) ${p}`).join(' → ')}.`);
  else if (okF[0] && (okF[0].summary || okF[0].bullets[0])) conclusion = okF[0].summary || okF[0].bullets[0].text;
  else conclusion = T('요청하신 내용을 확인했습니다.', 'Here is what I found.');
  const lead = okF.find((f) => f.step === 'market' && f.bullets[0]) || okF.find((f) => f.bullets[0] && f.bullets[0].cite && f.bullets[0].cite.length);
  const leadCite = lead && lead.bullets.find((b) => b.cite && b.cite.length);
  const evidenceBullets = okF.flatMap((f) => f.bullets).filter((b) => b !== skipFirstEvidence).slice(0, 9);
  let llmUsed = null;
  const llmRes = await LLM.compose({ question: message, locale: L, evidence: sources.map((s) => ({ n: s.n, title: s.title, org: s.org, date: s.date, text: docText(s.doc_id, L).slice(0, 700) })), skeleton: { conclusion, key_points: evidenceBullets.filter((b) => b.cite.length) }, systemPrompt: (q.get("SELECT body FROM prompt_versions WHERE agent_id='supervisor' AND status='ACTIVE' ORDER BY created_at DESC LIMIT 1") || {}).body || REG.BASE_RULES });
  let finalEvidence = evidenceBullets;
  if (llmRes && !llmRes.error) { llmUsed = llmRes; conclusion = llmRes.conclusion; finalEvidence = [...llmRes.key_points, ...evidenceBullets.filter((b) => !b.cite.length)]; (llmRes.cautions || []).forEach((c) => cautions.push(c)); step({ kind: 'llm', label: T(`LLM 합성 (${llmRes.model})`, `LLM composition (${llmRes.model})`) }); }
  else if (llmRes && llmRes.error) step({ kind: 'llm', label: T('LLM 호출 실패 → 로컬 엔진으로 대체', 'LLM call failed → local engine fallback'), detail: llmRes.error });

  if (sources.some((s) => s.synthetic)) cautions.push(T('일부 근거는 시연용 합성/요약 자료입니다. 실제 적용 전에 원문과 최신 법령을 확인하세요.', 'Some evidence is synthetic/summarised demo content. Verify originals and current law before acting.'));
  if (inherited.length) { const lab = { countries: ['국가', 'country'], products: ['품목', 'product'], 'profile.country': ['국가(프로필)', 'country (profile)'], 'profile.product': ['품목(프로필)', 'product (profile)'] }; cautions.push(T(`질문에 없는 정보(${inherited.map((k) => lab[k][0]).join(', ')})는 이전 대화/프로필 메모리에서 가져왔습니다.`, `Items not in your question (${inherited.map((k) => lab[k][1]).join(', ')}) were taken from conversation/profile memory.`)); }
  if (findings.some((f) => !f.ok && f.step !== 'general' && !f.denied)) cautions.push(T(`일부 항목(${findings.filter((f) => !f.ok).map((f) => f.step).join(', ')})은 근거가 부족하여 제외했습니다.`, `Some topics (${findings.filter((f) => !f.ok).map((f) => f.step).join(', ')}) were omitted for lack of evidence.`));
  if (blockedHigh) cautions.push(T('승인이 필요한 작업이 있습니다. 승인 전에는 어떤 외부 반영도 일어나지 않습니다.', 'An action awaits approval. Nothing external happens before you approve.'));
  if (!services.length) services.push({ kind: 'consult', title: T('전문가 상담 신청', 'Request expert consulting'), href: '#/consult/new' });
  else services.push({ kind: 'consult', title: T('수출 전문위원 상담 신청', 'Request an export specialist'), href: '#/consult/new' });
  actions.push({ type: 'create_report', label: T('이 내용으로 보고서 만들기', 'Create a report from this'), data: { message } });

  const mk = (key, body, extra = {}) => ({ key, title: T(...TITLES[key]), ...extra, ...(typeof body === 'string' ? { body } : { items: body }) });
  const sections = [
    mk('conclusion', conclusion, { cite: [] }),
    mk('evidence', finalEvidence.map((b) => ({ text: b.text, cite: b.cite, badge: b.badge || null }))),
    mk('actions', actions.filter((a) => a.type !== 'save_checklist' && a.type !== 'create_report').slice(0, 5).map((a) => ({ text: a.label, action: a }))),
    mk('services', services.slice(0, 5).map((s2) => ({ text: s2.title, href: s2.href, d_day: s2.d_day, status: s2.status }))),
    mk('cautions', [...new Set(cautions)].map((c) => ({ text: c }))),
    mk('sources', sources.map((s2) => ({ n: s2.n, doc_id: s2.doc_id }))),
  ].filter((sec) => (sec.items ? sec.items.length : sec.body));
  const plain = sections.filter((x) => x.key !== 'sources').map((sec) => `${sec.title}\n${sec.body || sec.items.map((i) => '- ' + i.text + ((i.cite && i.cite.length) ? ' ' + i.cite.map((n) => `[${n}]`).join('') : '')).join('\n')}`).join('\n\n');
  const answerText = U.maskPII(plain);
  const bundle = artifacts.length > 1 ? { type: 'bundle', title: T('수출 진출 브리프', 'Export entry brief'), tabs: artifacts } : (artifacts[0] || null);
  const allActions = actions.map((a, i) => ({ id: `${runId}-A${i + 1}`, ...a }));
  step({ kind: 'compose', label: T('답변 합성 · 개인정보 필터 적용', 'Answer composed · PII filter applied') });
  emit({ type: 'compose' });

  return finish({
    answer: answerText, sections, sources, suggested_actions: allActions, tool_runs: toolRuns, artifact: bundle, abstained: false, blocked: null, entities: ent, follow_ups: [...new Set(followUps)].slice(0, 3),
  }, { plan, rag: ragTraces, flags: scr.flags, approval_id: anyApproval, provenance: llmUsed ? 'LIVE' : 'LOCAL', model: llmUsed ? llmUsed.model : 'local-evidence-engine', cost: llmUsed ? null : 0 });
}

module.exports = { chat, bestSentences, docText };
