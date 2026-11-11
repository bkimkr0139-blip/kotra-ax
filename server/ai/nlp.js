'use strict';
// Lightweight KO/EN NLP: tokenization, concept expansion, entity + intent extraction, safety screening.
const { COUNTRIES, PRODUCTS, CONCEPTS, STOP_EN, STOP_KO } = require('../seed/catalog');

const PARTICLES = ['으로서', '으로써', '에서는', '에서의', '에게서', '으로는', '이라는', '이라고', '에서', '에게', '까지', '부터', '처럼', '보다', '으로', '이나', '이란', '라는', '하는', '하고', '이며', '에는', '에도', '과의', '와의', '은', '는', '이', '가', '을', '를', '의', '에', '와', '과', '도', '만', '로', '나', '고'];
const HANGUL = /[가-힣]/;

const VERB_ENDINGS = ['하려는데', '하려고', '하고싶은데', '하고싶어요', '하는데', '하나요', '해야', '합니까', '하면', '하려', '할까요', '인가요', '있나요', '싶어요', '하세요', '해주세요', '해줘', '하는'];
function stripParticle(w) {
  if (!HANGUL.test(w) || w.length < 3) return w;
  for (const e of VERB_ENDINGS) if (w.length > e.length + 1 && w.endsWith(e)) return w.slice(0, -e.length);
  for (const p of PARTICLES) if (w.length > p.length + 1 && w.endsWith(p)) return w.slice(0, -p.length);
  return w;
}

// concept lookup: token -> concept ids
const CONCEPT_INDEX = new Map();
for (const [id, words] of CONCEPTS) for (const w of words) { const k = w.toLowerCase(); if (!CONCEPT_INDEX.has(k)) CONCEPT_INDEX.set(k, []); CONCEPT_INDEX.get(k).push(id); }
const CONCEPT_WORDS = new Map(CONCEPTS.map(([id, words]) => [id, words]));

function rawWords(text) {
  return String(text || '').toLowerCase().replace(/[^0-9a-z가-힣+\-\/.]+/g, ' ').split(/\s+/).filter(Boolean);
}
const FILLER_RE = /(니다|세요|해요|어요|아요|은데|는데|할까|나요|까요|가요|해야|줘요|드려요|주세요|싶은|싶어|싶다|있을|없을)$/;
function isStop(w) { return STOP_EN.has(w) || STOP_KO.has(w) || w.length < 2 && !/\d/.test(w); }

function stemEn(w) { return /^[a-z]+$/.test(w) && w.length > 4 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w; }

// word-level tokens (with particle stripping) — used for lexical match and coverage
function words(text) {
  const out = [];
  for (let w of rawWords(text)) {
    w = w.replace(/^[-.\/+]+|[-.\/+]+$/g, '');
    if (!w) continue;
    w = stripParticle(w);
    w = stemEn(w);
    if (isStop(w)) continue;
    if (HANGUL.test(w) && w.length <= 6 && FILLER_RE.test(w)) continue;
    out.push(w);
  }
  return out;
}
// lexical tokens = words + Hangul bigrams (morphology-tolerant)
function lexTokens(text) {
  const out = [];
  for (const w of words(text)) {
    out.push(w);
    if (HANGUL.test(w) && w.length >= 3) for (let i = 0; i < w.length - 1; i++) out.push('#' + w.slice(i, i + 2));
  }
  return out;
}
// concept ids present in text (substring-aware for Hangul compounds)
function conceptsOf(text) {
  const found = new Map();
  const t = String(text || '').toLowerCase();
  const ws = new Set(words(text));
  for (const [k, ids] of CONCEPT_INDEX) {
    const hit = HANGUL.test(k) ? t.includes(k) : (ws.has(stemEn(k)) || ws.has(k) || (k.includes(' ') && t.includes(k)));
    if (hit) for (const id of ids) found.set(id, (found.get(id) || 0) + 1);
  }
  return found;
}
// hashed character trigrams for fuzzy "semantic" similarity
function trigrams(text) {
  const s = ' ' + String(text || '').toLowerCase().replace(/[^0-9a-z가-힣]+/g, ' ').trim() + ' ';
  const m = new Map();
  for (let i = 0; i < s.length - 2; i++) { const g = s.slice(i, i + 3); m.set(g, (m.get(g) || 0) + 1); }
  return m;
}
function detectLang(text) {
  const h = (String(text).match(/[가-힣]/g) || []).length;
  const l = (String(text).match(/[A-Za-z]/g) || []).length;
  return h >= l ? 'ko' : 'en';
}
function expandQuery(text) {
  // Query rewrite / HyDE-lite: append translations & synonyms of detected concepts
  const cs = conceptsOf(text);
  const extra = [];
  for (const id of cs.keys()) { const ws = CONCEPT_WORDS.get(id) || []; extra.push(...ws.slice(0, 5)); }
  return { rewritten: (text + ' ' + extra.join(' ')).trim(), concepts: [...cs.keys()] };
}

// ---------- Entities ----------
function extractEntities(text) {
  const t = String(text || '').toLowerCase();
  const countries = [];
  for (const c of COUNTRIES) {
    const names = [c.ko.toLowerCase(), c.en.toLowerCase(), ...c.aliases];
    if (names.some((n) => (HANGUL.test(n) ? t.includes(n) : new RegExp(`(^|[^a-z])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`).test(t)))) countries.push(c.code);
  }
  const products = [];
  for (const p of PRODUCTS) {
    if (p.keywords.some((k) => (HANGUL.test(k) ? t.includes(k.toLowerCase()) : new RegExp(`(^|[^a-z])${k.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`).test(t)))) products.push(p.key);
  }
  const hs = (t.match(/\b\d{4}(?:\.\d{2}(?:\.\d{2})?)?\b/g) || []).filter((x) => /^(0[1-9]|[1-9]\d)/.test(x) && !/^(19|20)\d{2}$/.test(x));
  return { countries: [...new Set(countries)], products: [...new Set(products)], hs: [...new Set(hs)] };
}

// ---------- Intents ----------
const INTENT_RULES = {
  market: ['시장', '유망', '동향', '트렌드', '시장성', '진출전략', '진출 전략', '경쟁', '수요', 'market', 'trend', 'demand', 'potential', 'competitor', '진출', 'entry'],
  regulation: ['규제', '인증', '허가', '등록', '필수서류', '필수 서류', '라벨', '표시사항', '금지', 'regulation', 'certification', 'permit', 'registration', 'requirement', 'label', 'compliance', 'fda', '규제 체크리스트', '인증 체크리스트'],
  buyer: ['바이어', '유통', '수입상', '수입업체', '파트너', '거래처', 'buyer', 'distributor', 'importer', 'partner'],
  program: ['지원사업', '지원 사업', '지원금', '바우처', '사업 신청', '지원제도', '사업추천', 'program', 'voucher', 'subsidy', 'grant', 'support program'],
  exhibition: ['전시', '상담회', '박람회', '행사', '파트너링', 'exhibition', 'expo', 'trade show', 'fair', 'partnering'],
  contract: ['계약', '인코텀즈', '결제조건', '결제 조건', '계약서', '조항', '신용장', 'contract', 'incoterms', 'payment term', 'clause', 'l/c'],
  logistics: ['물류', '운송', '선적', '관세', '통관', '운임', '리드타임', 'logistics', 'shipping', 'customs', 'freight', 'tariff', 'duty', 'lead time'],
  marketing: ['카탈로그', '이메일', '메일 초안', '브로슈어', '제안서', '영업', '소개서', 'catalog', 'catalogue', 'email', 'brochure', 'pitch', 'proposal'],
  consultation: ['전문가', '상담 연결', '상담 신청', '애로', '문의', 'consult', 'expert', 'help desk', 'talk to'],
  report: ['보고서', '리포트', '진출전략 보고', 'report'],
  invest: ['투자', '인센티브', '입지', '외국인투자', '옴부즈만', '고충', 'invest', 'incentive', 'fdi', 'ombudsman', 'greenfield'],
  application: ['신청서', '신청 초안', '지원서', '신청해', '신청할', '신청하고', 'application draft', 'apply'],
  stats: ['통계', '수출액', '수입액', '규모', '몇 달러', '얼마나', 'statistics', 'export value', 'import value', 'how much'],
  glossary: ['뜻', '의미', '무엇인가요', '란 무엇', '용어', 'what is', 'meaning of', 'define'],
};
function detectIntents(text) {
  const t = String(text || '').toLowerCase();
  const scores = {};
  for (const [intent, kws] of Object.entries(INTENT_RULES)) {
    let s = 0;
    for (const k of kws) if (t.includes(k)) s += k.length >= 3 ? 1.2 : 1;
    if (s > 0) scores[intent] = s;
  }
  return Object.entries(scores).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ intent: k, score: v }));
}

// ---------- Safety screening ----------
const INJECTION_PATTERNS = [
  /ignore (all |the )?(previous|prior|above) (instructions|prompts?|rules)/i,
  /disregard (all |the )?(previous|prior|above)/i,
  /(이전|위|기존)\s*(지시|명령|지침|프롬프트)(를|을|은|는)?\s*(모두\s*)?(무시|잊)/,
  /(시스템|system)\s*(프롬프트|prompt)(를|을)?\s*(출력|공개|보여|알려|reveal|print|show)/i,
  /you are now (dan|jailbroken|an? unrestricted)/i,
  /(관리자|admin)\s*(권한|모드)(으로|를)?\s*(전환|활성|부여)/,
  /do anything now|developer mode|jailbreak/i,
  /(모든|전체)\s*(사용자|고객|기업)\s*(정보|데이터|개인정보)(를|을)?\s*(출력|덤프|내보내)/,
  /<\s*(system|assistant)\s*>/i,
];
function scanInjection(text) {
  const hits = [];
  for (const re of INJECTION_PATTERNS) if (re.test(String(text || ''))) hits.push(re.source.slice(0, 60));
  return hits;
}
const PROFANITY = ['씨발', '시발', '병신', '개새끼', '좆', 'fuck', 'shit', 'bitch', 'asshole'];
const RE_RRN = /\b\d{6}-?[1-4]\d{6}\b/;
const RE_CARD = /\b(?:\d{4}[- ]?){3}\d{4}\b/;
function screenQuery(text) {
  const t = String(text || '');
  const flags = [];
  if (PROFANITY.some((p) => t.toLowerCase().includes(p))) flags.push('PROFANITY');
  if (RE_RRN.test(t)) flags.push('PII_RRN');
  if (RE_CARD.test(t)) flags.push('PII_CARD');
  const inj = scanInjection(t);
  if (inj.length) flags.push('PROMPT_INJECTION');
  return { flags, injection: inj };
}
// Requests to disclose other parties' personal / confidential data
function detectDataExfil(text, ownCompanyName, companyNames) {
  const t = String(text || '').toLowerCase();
  const wantsPersonal = /(연락처|전화번호|휴대폰|이메일|e-?mail|주소|주민|담당자 정보|상담\s*이력|상담\s*내역|신청\s*내역|개인정보|계좌|사업자\s*번호|contact|phone number|personal data|consultation history|private)/i.test(t);
  const wantsOthers = /(다른\s*(기업|회사|고객)|타\s*(기업|사)|경쟁사|모든\s*(기업|고객)|전체\s*(고객|사용자)|other compan|competitor|all (customers|users))/i.test(t);
  let named = null;
  for (const n of companyNames || []) {
    if (!n) continue;
    if (ownCompanyName && n.toLowerCase() === ownCompanyName.toLowerCase()) continue;
    if (t.includes(n.toLowerCase())) { named = n; break; }
  }
  const adminAsk = /(관리자|admin|감사\s*로그|audit log|시스템\s*설정|api\s*key|비밀키|토큰)/i.test(t) && /(보여|알려|출력|조회|show|dump|give|list)/i.test(t);
  if ((wantsPersonal && (wantsOthers || named)) || adminAsk) return { blocked: true, reason: adminAsk ? 'ADMIN_SCOPE' : 'OTHER_PARTY_PII', named };
  return { blocked: false };
}
// Domain-relevance (out-of-scope handling for SFR-027)
const TRADE_VOCAB = /(원산지|fta|인코텀즈|incoterms|신용장|결제조건|무역보험|수출보험|바우처|증명서|선적|견적|마케팅|카탈로그|수출|수입|무역|바이어|시장|규제|인증|관세|통관|물류|지원|사업|전시|상담|계약|투자|kotra|코트라|해외|진출|export|import|trade|buyer|market|regulation|customs|tariff|logistics|program|invest|exhibition|contract|hs)/i;
function inDomain(text, ent, intents) {
  return TRADE_VOCAB.test(String(text || '')) || ent.countries.length || ent.products.length || intents.length > 0;
}

module.exports = { words, lexTokens, conceptsOf, trigrams, detectLang, expandQuery, extractEntities, detectIntents, scanInjection, screenQuery, detectDataExfil, inDomain, CONCEPT_WORDS, HANGUL };
