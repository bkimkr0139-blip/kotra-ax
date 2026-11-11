'use strict';
const norm = (s) => String(s || '').toLowerCase().replace(/(co\.?,?\s*ltd\.?|ltd\.?|inc\.?|corp\.?|주식회사|\(주\)|㈜|co\.)/g, '').replace(/[^a-z0-9가-힣]+/g, ' ').trim();
function tokens(s) { return new Set(norm(s).split(' ').filter(Boolean)); }
function jaccard(a, b) { const A = tokens(a), B = tokens(b); if (!A.size || !B.size) return 0; let i = 0; for (const x of A) if (B.has(x)) i++; return i / (A.size + B.size - i); }
// Rule-based duplicate score (0-100) with human-readable reasons
function dupScore(a, b) {
  let s = 0; const reasons = [];
  const nm = jaccard(a.name, b.name);
  if (nm >= 0.99) { s += 40; reasons.push({ ko: '회사명 정규화 후 동일', en: 'Name identical after normalisation' }); }
  else if (nm >= 0.5) { s += Math.round(nm * 40); reasons.push({ ko: `회사명 유사도 ${Math.round(nm * 100)}%`, en: `Name similarity ${Math.round(nm * 100)}%` }); }
  if (a.email && a.email.toLowerCase() === (b.email || '').toLowerCase()) { s += 35; reasons.push({ ko: '이메일 일치', en: 'Email match' }); }
  if (a.biz_no && a.biz_no === b.biz_no) { s += 25; reasons.push({ ko: '사업자번호 일치', en: 'Business number match' }); }
  if (a.mobile && a.mobile === b.mobile) { s += 10; reasons.push({ ko: '휴대폰 일치', en: 'Mobile match' }); }
  return { score: Math.min(100, s), reasons };
}
module.exports = { dupScore, norm };
