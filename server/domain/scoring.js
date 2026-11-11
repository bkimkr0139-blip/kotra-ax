'use strict';
// Explainable scoring (no black box). Replaceable by a learned model behind the same function signature (Adapter).
const U = require('../util');
const { PRODUCTS, COUNTRIES } = require('../seed/catalog');
const PBY = Object.fromEntries(PRODUCTS.map((p) => [p.key, p]));
const CBY = Object.fromEntries(COUNTRIES.map((c) => [c.code, c]));

const GROUP_LABEL = { READY: ['수출준비', 'Export-ready'], NOVICE: ['수출초보', 'Beginner exporter'], PROMISING: ['유망기업', 'Promising exporter'], MIDCAP: ['중견기업', 'Mid-sized company'] };
const arr = (v) => (Array.isArray(v) ? v : v ? [v] : []);

// Match Score = 품목 30 + 국가 20 + 거래조건 15 + 관심도 10 + 상담가능시간 10 + 과거성과 10 + 기타 5   (SFR-043 / 지시서 §15.4)
function scoreBuyer(company, buyer, ctx = {}) {
  const cProducts = arr(company.products_keys || company.product_keys);
  const bProducts = arr(buyer.products);
  const cHs = String(company.hs_code || '').slice(0, 4);
  let product = 0;
  if (cProducts.some((k) => bProducts.includes(k))) product = 30;
  else if (arr(buyer.hs_codes).some((h) => cHs && String(h).startsWith(cHs))) product = 27;
  else {
    const cCat = new Set(cProducts.map((k) => PBY[k]?.cat_en));
    if (bProducts.some((k) => cCat.has(PBY[k]?.cat_en))) product = 14;
  }
  const targets = arr(company.target_markets);
  const country = targets.includes(buyer.country) ? 20 : (CBY[buyer.country] && targets.some((t) => CBY[t]?.region_en === CBY[buyer.country].region_en)) ? 10 : 3;
  const cond = buyer.conditions || {};
  let conditions = 8;
  if (cond.moq === 'low') conditions += 4; else if (cond.moq === 'high') conditions -= 2;
  if (arr(cond.payment).includes('T/T') || arr(cond.payment).includes('Advance')) conditions += 3;
  conditions = U.clamp(conditions, 0, 15);
  const interest = ctx.favorite ? 10 : ctx.requestedByBuyer ? 10 : bProducts.length >= 2 ? 6 : 5;
  const time = ctx.availabilityOverlap != null ? Math.round(10 * U.clamp(ctx.availabilityOverlap, 0, 1)) : 7;
  const past = Math.round(10 * U.clamp((buyer.past_success || 50) / 100, 0, 1));
  const other = (buyer.verified ? 3 : 1) + (buyer.trust >= 85 ? 2 : buyer.trust >= 70 ? 1 : 0);
  const parts = { product, country, conditions, interest, time, past, other: Math.min(5, other) };
  const total = Object.values(parts).reduce((a, b) => a + b, 0);
  const reasons = [];
  if (product >= 27) reasons.push({ ko: `품목 적합도 ${Math.round(product / 30 * 100)} — 관심품목이 귀사 제품과 일치`, en: `Product fit ${Math.round(product / 30 * 100)} — buyer interest matches your product` });
  else if (product >= 14) reasons.push({ ko: '같은 산업군의 관련 품목에 관심', en: 'Interested in related items in the same sector' });
  if (country >= 20) reasons.push({ ko: '귀사의 목표 시장 국가', en: 'Located in your target market' });
  else if (country >= 10) reasons.push({ ko: '목표 시장과 같은 권역', en: 'Same region as your target market' });
  if (conditions >= 12) reasons.push({ ko: '거래조건(소량 주문·결제방식)이 초기 거래에 적합', en: 'Trade terms (low MOQ, payment) suit first deals' });
  if (past >= 8) reasons.push({ ko: '과거 한국 기업과의 상담 성과가 높음', en: 'Strong track record with Korean suppliers' });
  if (buyer.verified) reasons.push({ ko: 'KOTRA 검증 완료 바이어', en: 'KOTRA-verified buyer' });
  if (ctx.favorite) reasons.push({ ko: '관심 바이어로 저장됨', en: 'Saved as a favourite' });
  return { total, parts, reasons, max: { product: 30, country: 20, conditions: 15, interest: 10, time: 10, past: 10, other: 5 } };
}

// Program eligibility / recommendation score with explicit reasons and missing-info prompts
function scoreProgram(company, program, todayStr) {
  const reasons = [], missing = [];
  let score = 40;
  const groups = arr(program.customer_groups);
  const grp = company.export_stage;
  if (!groups.length || groups.includes(grp)) { score += 18; reasons.push({ ko: `${GROUP_LABEL[grp]?.[0] || grp} 단계 기업이 신청 가능한 사업`, en: `Open to ${GROUP_LABEL[grp]?.[1] || grp} companies` }); }
  else { score -= 20; reasons.push({ ko: `대상 단계(${groups.map((g) => GROUP_LABEL[g]?.[0] || g).join('·')})와 다름`, en: `Target stage differs (${groups.map((g) => GROUP_LABEL[g]?.[1] || g).join(', ')})`, neg: true }); }
  const inds = arr(program.industries);
  const pk = arr(company.product_keys);
  if (inds.includes('ALL')) score += 6;
  else if (pk.some((k) => inds.includes(k))) { score += 18; reasons.push({ ko: `귀사 업종(${company.industry})에 특화된 사업`, en: `Specialised for your sector (${company.industry_en || company.industry})`}); }
  else { score -= 18; reasons.push({ ko: '업종이 사업 대상과 다름', en: 'Sector is outside the program focus', neg: true }); }
  const cs = arr(program.countries);
  const tm = arr(company.target_markets);
  if (cs.includes('ALL')) score += 4;
  else if (tm.some((t) => cs.includes(t))) { score += 14; reasons.push({ ko: `목표시장(${tm.filter((t) => cs.includes(t)).map((t) => CBY[t]?.ko).join('·')})이 사업 대상국에 포함`, en: `Your target market (${tm.filter((t) => cs.includes(t)).map((t) => CBY[t]?.en).join(', ')}) is covered` }); }
  else { score -= 10; reasons.push({ ko: '목표시장이 사업 대상국에 없음', en: 'Target market not covered', neg: true }); }
  const stage = (company.journey_focus || [2, 3, 4]);
  if (arr(program.stages).some((s) => stage.includes(s))) { score += 6; reasons.push({ ko: '현재 진행 중인 수출 여정 단계와 일치', en: 'Matches your current export-journey step' }); }
  const left = program.apply_end ? U.dday(program.apply_end) : null;
  const started = program.apply_start ? U.dday(program.apply_start) : null;
  let status = 'OPEN';
  if (left != null && left < 0) status = 'CLOSED'; else if (started != null && started > 0) status = 'UPCOMING';
  if (status === 'CLOSED') { score = Math.min(score, 25); reasons.push({ ko: '모집이 종료됨', en: 'Recruitment has closed', neg: true }); }
  else if (status === 'OPEN' && left != null && left <= 7) { score += 4; reasons.push({ ko: `마감 임박 (D-${left})`, en: `Closing soon (D-${left})` }); }
  if (!company.hs_code) missing.push({ ko: 'HS코드', en: 'HS code' });
  if (!company.website) missing.push({ ko: '회사 웹사이트', en: 'Company website' });
  if (!company.employees) missing.push({ ko: '종업원 수', en: 'Employee count' });
  return { score: U.clamp(Math.round(score), 5, 99), status, reasons, missing, d_day: left };
}

// Export readiness 0-100 from profile completeness and journey progress
function readiness(company, journey) {
  const done = journey ? Object.values(journey).filter((s) => s === 'DONE').length : 0;
  const prog = journey ? Object.values(journey).filter((s) => s === 'IN_PROGRESS').length : 0;
  const profile = ['name', 'industry', 'product', 'hs_code', 'website', 'employees', 'description'].filter((k) => company[k]).length;
  return U.clamp(Math.round(profile / 7 * 40 + (done * 60 / 7) + prog * 4), 0, 100);
}

// slot helpers (30-minute timetable in the event's local time)
function genSlots(event) {
  const days = [];
  for (let d = event.start_date; d <= event.end_date; d = U.addDays(d, 1)) days.push(d);
  const [sh, sm] = (event.day_start || '09:00').split(':').map(Number);
  const [eh, em] = (event.day_end || '17:00').split(':').map(Number);
  const out = [];
  for (const d of days) for (let m = sh * 60 + sm; m < eh * 60 + em; m += event.slot_minutes || 30) out.push(`${d}T${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
  return out;
}
function toLocal(slot, fromOffsetMin, toOffsetMin) {
  const [d, t] = slot.split('T'); const [h, m] = t.split(':').map(Number);
  const dt = new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10), h, m) + (toOffsetMin - fromOffsetMin) * 60000);
  return dt.toISOString().slice(0, 16);
}

module.exports = { scoreBuyer, scoreProgram, readiness, genSlots, toLocal, GROUP_LABEL, PBY, CBY };
