'use strict';
// Consultation summarisation (extractive + rules). Deterministic, PII-excluded (SFR-015/019). An sLLM adapter can replace it.
const U = require('../util');
const NLP = require('../ai/nlp');

const ACTION_RE = /(하겠습니다|드리겠습니다|보내드리|연락드리|확인해|이관|안내해|접수하겠)/;
const TRANSFER_RE = /(무역관|현지|이관|담당 전문위원|전문가 상담)/;
const STOP = new Set(['네', '안녕하세요', '감사합니다', '말씀하세요', '도와드릴까요']);

function summarize(lines, opts = {}) {
  const clean = lines.map((l) => ({ ...l, text: U.maskPII(l.text).replace(/\d{3}-\d{2}-\d{5}/g, '***-**-*****') }));
  const cust = clean.filter((l) => l.speaker === 'customer');
  const agent = clean.filter((l) => l.speaker === 'agent');
  const longest = (arr) => arr.slice().sort((a, b) => b.text.length - a.text.length)[0];
  const inquiry = (cust.filter((l) => /(궁금|문의|싶|알려|\?|어떻게|있을까)/.test(l.text) && l.text.length > 14)[0] || longest(cust) || { text: '' }).text;
  const answerLines = agent.filter((l) => l.text.length > 28 && !/(도와드릴까요|말씀하세요)/.test(l.text) && !ACTION_RE.test(l.text.slice(0, 6)));
  const answer = answerLines.slice(0, 3).map((l) => l.text).join(' ');
  const actions = agent.filter((l) => ACTION_RE.test(l.text)).map((l) => l.text.split(/[.]/).filter((s) => ACTION_RE.test(s))[0] || l.text).map((s) => s.trim()).slice(0, 4);
  const allText = clean.map((l) => l.text).join(' ');
  const ent = NLP.extractEntities(allText);
  const words = NLP.words(allText).filter((w) => w.length >= 2 && !STOP.has(w) && !/^\d+$/.test(w) && !/(니다|세요|이메일|현지)$/.test(w));
  const freq = new Map(); words.forEach((w) => freq.set(w, (freq.get(w) || 0) + 1));
  const kw = [...freq.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length).map(([w]) => w).filter((w) => !['있는', '하는', '수출'].includes(w)).slice(0, 7);
  const topicMap = [['인증·규제', /(등록|인증|규제|라벨|서류)/], ['바이어', /(바이어|유통)/], ['결제·계약', /(결제|계약|신용장|보험)/], ['물류·통관', /(통관|샘플|운송|발송|관세)/], ['지원사업', /(바우처|지원사업|신청)/]];
  const topics = topicMap.filter(([, re]) => re.test(allText)).map(([t]) => t);
  const transfer = TRANSFER_RE.test(agent.map((l) => l.text).join(' ')) && /(이관|무역관으로)/.test(allText);
  const recs = [];
  if (/바이어/.test(allText)) recs.push('PG-003');
  if (/바우처/.test(allText)) recs.push('PG-001');
  if (/(시장조사)/.test(allText)) recs.push('PG-004');
  if (/(인증|등록|라벨)/.test(allText) && ent.products.includes('cosmetics')) recs.push('PG-007');
  const fields = { topic: topics.length, inquiry: !!inquiry, answer: !!answer, kw: kw.length > 2, actions: actions.length };
  const confidence = U.round((Object.values(fields).filter(Boolean).length) / 5 * 0.7 + Math.min(0.3, lines.length / 30), 2);
  return {
    topic: topics.join(' / ') || '일반 문의',
    inquiry, answer, keywords: kw, actions,
    handling: transfer ? '해외무역관 이관 요청' : '상담원 직접 답변',
    followup: actions.length ? actions.slice(-2) : [],
    transfer_needed: transfer,
    recommended_services: [...new Set(recs)],
    entities: { countries: ent.countries, products: ent.products },
    pii_masked: true,
    confidence,
    low_confidence: confidence < 0.55,
  };
}
module.exports = { summarize };
