'use strict';
// Identity Resolution / MDM: 동의 판정, 후보 탐지(블로킹·정확/퍼지·하드블록), Golden Record(Survivorship),
// 승인형 병합·연계·분리 유지, Unmerge, 영향 분석, 신규 가입 중복 방지 시뮬레이터.
const { q } = require('../db');
const U = require('../util');
const G = require('../gov');
const { PRODUCTS } = require('../seed/catalog');
const S = require('./schema');
const M = require('./mapping');
const { J, P, nid, ev, audit, err, checkVersion, strictSod } = require('./core');

const POLICY_VERSION = 'identity-policy-v1';
const RULE_VERSION = 'survivorship-v1';
const FREE_MAIL = /(gmail|naver|daum|hanmail|yahoo|outlook|hotmail)\./i;

// ───────── 동의 판정 (RFP: 최근 5개년 이내 동의 데이터 + 목적/철회/만료 별도 검증) ─────────
function evalConsent(system, rec) {
  const today = U.today(); const fiveYearsAgo = U.addDays(today, -365 * 5);
  const o = system === 'CRM'
    ? { granted: rec.consent_at, until: rec.consent_until, revoked: rec.consent_revoked_at, purpose: rec.consent_purpose, basis: 'CONSENT' }
    : { granted: rec.permission_granted_at, until: rec.permission_expires_at, revoked: rec.account_status === 'CONSENT_REVOKED' ? (rec.modified_at || today) : null, purpose: 'DATA_INTEGRATION', basis: 'MEMBER_TERMS' };
  let status = 'VALID'; let reason = null;
  if (o.revoked) { status = 'REVOKED'; reason = '목적별 동의 철회'; }
  else if (!o.granted) { status = 'MISSING'; reason = '동의 근거 없음'; }
  else if (o.until && String(o.until).slice(0, 10) < today) { status = 'EXPIRED'; reason = '동의 유효기간 경과'; }
  else if (String(o.granted).slice(0, 10) < fiveYearsAgo) { status = 'OUT_OF_RANGE'; reason = '최근 5개년 범위 밖(RFP 정책 필터)'; }
  else if (o.purpose && !['DATA_INTEGRATION', 'SERVICE_RECOMMENDATION'].includes(o.purpose)) { status = 'PURPOSE_MISMATCH'; reason = `목적 불일치(${o.purpose})`; }
  return { eligible: status === 'VALID', status, reason, ...o };
}

// ───────── 뷰(식별용 표준 레코드) ─────────
const domainOf = (u) => { if (!u) return null; const d = String(u).toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0]; return d || null; };
const tok = (s) => new Set(String(s || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((x) => x.length > 1 && !['street', 'road', 'ro', 'gu', 'dong', 'floor', 'unit', 'no'].includes(x)));
const overlap = (a, b) => { if (!a.size || !b.size) return 0; let n = 0; a.forEach((x) => { if (b.has(x)) n++; }); return n / Math.min(a.size, b.size); };
const hsOf = (v) => String(v || '').replace(/\D/g, '');
function viewOf(row) {
  const p = U.parse(row.payload, {}); const s = U.parse(row.std_json, {}); const std = s.std || {};
  const system = row.source_id === 'CRM_DEMO' ? 'CRM' : 'BUYKOREA';
  const get = (k) => (std[k] === undefined ? null : std[k]);
  return { ref: `${system}:${row.source_table}:${row.source_pk}`, system, table: row.source_table, pk: row.source_pk, raw_id: row.id, eligible: !!row.eligible, reason: row.reason, status: row.status,
    kind: system === 'CRM' ? (p.customer_type === 'INDIVIDUAL' ? 'PERSON' : 'ORG') : 'ORG',
    name: get('LEGAL_ENTITY.normalized_name'), name_raw: p.organization_name || p.business_name_en || null, country: get('LEGAL_ENTITY.country_code'), reg: get('LEGAL_ENTITY.organization_identifier'),
    address: tok(get('LEGAL_ENTITY.address')), address_raw: get('LEGAL_ENTITY.address'), domain: domainOf(get('LEGAL_ENTITY.website')), email_hash: get('PARTY_IDENTIFIER.email_hash'), contact: p.contact_name || p.manager_name || null,
    hs: [hsOf(get('PARTY_PROFILE.hs_code'))].filter(Boolean), interest: get('PARTY_PROFILE.interest_industry_code'), updated: p.updated_at || p.modified_at || null, payload: p, std };
}
function currentRaw() { // 원천 PK 별 최신 fingerprint
  return q.all(`SELECT r.* FROM di_raw r WHERE r.source_table IN ('demo_crm_customer','demo_bk_member') AND r.status<>'SUPERSEDED' AND r.status<>'QUARANTINED'`);
}
function bkProductHs(pk) { try { return q.all('SELECT hs_code FROM demo_bk_product WHERE bk_member_id=?', pk).map((r) => hsOf(r.hs_code)); } catch { return []; } }

// ───────── 쌍 점수(스펙 §10.3: 설명용 가중치 모델) ─────────
function scorePair(a, b) {
  const signals = []; const blocks = []; let score = 0; const add = (code, pts, text) => { score += pts; signals.push({ code, points: pts, text }); };
  const idMatch = a.reg && b.reg && a.reg === b.reg;
  if (a.reg && b.reg) { if (idMatch) add('ID_MATCH', 45, '검증된 법인 식별자 일치'); else blocks.push({ code: 'CONFLICTING_VERIFIED_ID', text: '서로 다른 검증 법인 ID — 하드 블록' }); }
  if (a.country && b.country) { if (a.country === b.country) add('COUNTRY_MATCH', 10, '국가 일치'); else if (!idMatch) blocks.push({ code: 'COUNTRY_MISMATCH_NO_VERIFIED_ID', text: '국가가 다르고 검증된 동일 식별자가 없음 — 동명이법인 가능' }); else signals.push({ code: 'COUNTRY_DIFF', points: 0, text: '국가 표기가 다름(식별자는 일치)' }); }
  const sim = a.name && b.name ? Math.max(S.similarity(a.name, b.name), overlap(new Set(a.name.split(' ')), new Set(b.name.split(' ')))) : 0;
  const compact = (x) => String(x || '').replace(/\s+/g, ''); const csim = a.name && b.name ? (compact(a.name) === compact(b.name) ? 1 : sim) : 0;
  const best = Math.max(sim, csim);
  if (best >= 0.9) add('NAME_STRONG', 20, `법인명 유사(${Math.round(best * 100)}%)`); else if (best >= 0.75) add('NAME_SIMILAR', 14, `법인명 유사(${Math.round(best * 100)}%)`); else if (best >= 0.55) add('NAME_WEAK', 8, `법인명 약한 유사(${Math.round(best * 100)}%)`);
  const ao = overlap(a.address, b.address); if (ao >= 0.7) add('ADDRESS_MATCH', 10, '등록 주소 일치');
  if (a.domain && b.domain && a.domain === b.domain && !FREE_MAIL.test(a.domain)) add('DOMAIN_MATCH', 10, '검증된 웹 도메인 일치');
  const aHs = new Set(a.hs.map((x) => x.slice(0, 2))); const bHs = new Set(b.hs.map((x) => x.slice(0, 2))); if ([...aHs].some((x) => bHs.has(x))) add('PRODUCT_COMPAT', 5, '활동·제품 호환(HS 류 일치)');
  if (a.email_hash && b.email_hash && a.email_hash === b.email_hash) {
    signals.push({ code: 'SHARED_EMAIL', points: 0, text: '동일 이메일(해시) — 단독 병합 근거 불가' });
    if (!idMatch && best < 0.75) blocks.push({ code: 'SHARED_EMAIL_ONLY', text: '이메일만 일치 — 공유 메일/다른 담당자 가능, 병합 금지' });
  }
  score = Math.min(100, score);
  const band = blocks.length ? 'DO_NOT_LINK' : score >= 70 ? 'AUTO_LINK_CANDIDATE' : score >= 30 ? 'REVIEW_REQUIRED' : null;
  return { score, signals, blocks, band, name_similarity: U.round(best, 2) };
}

// ───────── 후보 생성 (블로킹 → 비교 → 분류) ─────────
function resolveCandidates(ctx, runId = null) {
  const views = currentRaw().map(viewOf).filter((v) => v.kind === 'ORG');
  const crm = views.filter((v) => v.system === 'CRM'); const bk = views.filter((v) => v.system === 'BUYKOREA');
  bk.forEach((v) => { v.hs = [...new Set([...v.hs, ...bkProductHs(v.pk)])]; });
  const idx = { reg: new Map(), dom: new Map(), email: new Map(), tok: new Map(), pre: new Map() };
  const prefix = (n) => String(n || '').replace(/\s+/g, '').slice(0, 6);
  const put = (m, k, v) => { if (!k) return; (m.get(k) || m.set(k, []).get(k)).push(v); };
  bk.forEach((v) => { put(idx.reg, v.reg, v); put(idx.dom, v.domain, v); put(idx.email, v.email_hash, v); put(idx.pre, prefix(v.name), v); (v.name || '').split(' ').filter((t) => t.length > 2).slice(0, 2).forEach((t) => put(idx.tok, `${t}`, v)); });
  let compared = 0; const out = [];
  for (const a of crm) {
    const cand = new Set([...(idx.reg.get(a.reg) || []), ...(idx.dom.get(a.domain) || []), ...(idx.email.get(a.email_hash) || []), ...(idx.pre.get(prefix(a.name)) || []), ...(a.name || '').split(' ').filter((t) => t.length > 2).slice(0, 2).flatMap((t) => idx.tok.get(t) || [])]);
    for (const b of cand) {
      compared++; const r = scorePair(a, b); if (!r.band) continue;
      if (r.band === 'DO_NOT_LINK' && r.score < 20 && !r.signals.some((x) => x.code === 'SHARED_EMAIL')) continue; // 의미 없는 차단 쌍은 저장하지 않음
      const consentBlocked = !a.eligible || !b.eligible; out.push({ a, b, r, consentBlocked });
    }
  }
  let created = 0; let updated = 0;
  q.tx(() => {
    for (const { a, b, r, consentBlocked } of out) {
      const ex = q.get('SELECT * FROM di_candidate WHERE left_ref=? AND right_ref=?', a.ref, b.ref);
      const signals = J(consentBlocked ? [...r.signals, { code: 'CONSENT_INELIGIBLE', points: 0, text: `동의 부적합: ${!a.eligible ? `CRM(${a.reason})` : ''} ${!b.eligible ? `BK(${b.reason})` : ''}`.trim() }] : r.signals);
      if (ex) {
        if (['PENDING', 'BLOCKED', 'NEEDS_INFO'].includes(ex.status)) { q.update('di_candidate', ex.id, { score: r.score, band: r.band, signals, blocks: J(r.blocks), status: r.band === 'DO_NOT_LINK' ? 'BLOCKED' : (ex.status === 'BLOCKED' ? 'PENDING' : ex.status), updated_at: U.iso(), run_id: runId }); updated++; }
      } else {
        q.insert('di_candidate', { id: nid('IDC'), entity_type: 'LEGAL_ENTITY', left_ref: a.ref, right_ref: b.ref, left_party: partyOfRef(a.ref), right_party: partyOfRef(b.ref), score: r.score, band: r.band, signals, blocks: J(r.blocks), model_version: POLICY_VERSION, status: r.band === 'DO_NOT_LINK' ? 'BLOCKED' : 'PENDING', reviewer: null, run_id: runId, created_at: U.iso(), updated_at: U.iso(), version: 1 }); created++;
      }
    }
  });
  const total = crm.length * bk.length;
  return { created, updated, compared, total_pairs: total, reduction_pct: total ? U.round((1 - compared / total) * 100, 1) : null, candidates: q.count('di_candidate') };
}
function partyOfRef(ref) { const [system, table, pk] = ref.split(':'); const r = q.get("SELECT party_id FROM di_crosswalk WHERE source_system=? AND source_table=? AND source_pk=? AND status='ACTIVE'", system, table, pk); return r ? r.party_id : null; }

// ───────── 정본(Golden Record) ─────────
const productKeysOfHs = (hs) => { const d = hsOf(hs); const p = PRODUCTS.find((x) => x.hs && d.startsWith(x.hs)); return p ? p.key : null; };
function latestRaw(system, table, pk) { const r = q.get("SELECT * FROM di_raw WHERE source_id=? AND source_table=? AND source_pk=? AND status<>'SUPERSEDED' ORDER BY collected_at DESC, rowid DESC LIMIT 1", system === 'CRM' ? 'CRM_DEMO' : 'BUYKOREA_DEMO', table, pk); return r ? viewOf(r) : null; }
function computeGolden(partyId) {
  const party = q.get('SELECT * FROM di_party WHERE party_id=?', partyId);
  const cws = q.all("SELECT * FROM di_crosswalk WHERE party_id=? AND status='ACTIVE' ORDER BY source_system", partyId);
  const views = cws.map((c) => latestRaw(c.source_system, c.source_table.replace('#contact', ''), c.source_pk)).filter(Boolean);
  const crm = views.find((v) => v.system === 'CRM'); const bk = views.find((v) => v.system === 'BUYKOREA'); const attrs = {}; const prov = {}; const conflicts = [];
  const pick = (field, cands, rule, opts = {}) => { // cands: [{v, view}] in priority order
    const present = cands.filter((c) => c.v != null && c.v !== '');
    if (!present.length) return; const sel = present[0];
    const distinct = new Set(present.map((c) => JSON.stringify(c.v))); if (distinct.size > 1 && opts.conflictOn !== false) conflicts.push({ field, values: present.map((c) => ({ source: c.view.ref, value: opts.mask ? S.mask(field, c.v) : c.v })), resolution: rule });
    attrs[field] = sel.v; prov[field] = { value: opts.mask ? S.mask(field, sel.v) : sel.v, selected_source: sel.view.ref, confidence: distinct.size > 1 ? 0.7 : 0.95, rule_version: RULE_VERSION, rule, valid_from: U.iso(), last_verified_at: sel.view.updated || U.iso(), alternatives: present.slice(1).map((c) => ({ source: c.view.ref, value: opts.mask ? S.mask(field, c.v) : c.v })) };
  };
  const order = party.party_type === 'PERSON' ? views : [crm, bk].filter(Boolean);
  const byPri = (fn) => order.map((v) => ({ v: fn(v), view: v }));
  if (party.party_type === 'PERSON') {
    pick('display_name', byPri((v) => v.contact), 'CRM 우선'); pick('email_hash', byPri((v) => v.email_hash), '동일 이메일은 단독 근거 불가', { conflictOn: false });
  } else {
    pick('display_name', byPri((v) => v.name_raw), 'CRM 기준 정본 우선(CRM 확장 MDM)'); pick('normalized_name', byPri((v) => v.name), 'CRM 우선', { conflictOn: false });
    const valid = (v) => (S.ISO2.has(v.country) ? v.country : null); pick('country_code', byPri(valid), 'ISO 검증된 코드 우선(CRM→BK)');
    pick('organization_identifier', byPri((v) => v.reg), '동일 식별자만 병합 대상', { mask: true });
    const newest = [...order].sort((x, y) => String(y.updated).localeCompare(String(x.updated))); const byNew = (fn) => newest.map((v) => ({ v: fn(v), view: v }));
    pick('address', byNew((v) => v.address_raw), '최종 갱신 우선'); pick('website_domain', byNew((v) => v.domain), '최종 갱신 우선');
    const hs = [...new Set(order.flatMap((v) => (v.system === 'BUYKOREA' ? [...v.hs, ...bkProductHs(v.pk)] : v.hs)))]; if (hs.length) { attrs.hs_codes = hs; prov.hs_codes = { value: hs, selected_source: order.map((v) => v.ref).join(' ∪ '), confidence: 0.9, rule_version: RULE_VERSION, rule: '합집합(출처 보존)', valid_from: U.iso() }; }
    const interest = order.map((v) => v.interest).filter(Boolean)[0]; if (interest) { attrs.interest_industry_code = interest; prov.interest_industry_code = { value: interest, selected_source: (bk || order[0]).ref, confidence: 0.85, rule_version: RULE_VERSION, rule: 'BK 신규 속성(승인된 매핑 v2)', valid_from: U.iso() }; }
  }
  const consents = views.map((v) => evalConsent(v.system, v.payload)); const worst = consents.find((c) => !c.eligible) || consents[0];
  attrs.consent_status = worst ? worst.status : 'MISSING'; prov.consent_status = { value: attrs.consent_status, selected_source: 'ALL_SOURCES', confidence: 1, rule_version: RULE_VERSION, rule: '가장 보수적인 판단' };
  return { attributes: attrs, provenance: prov, conflicts, sources: views.map((v) => v.ref) };
}
function newGolden(ctx, partyId, reason, approvedBy = null) {
  const g = computeGolden(partyId); const last = q.get('SELECT version_no n, attributes a FROM di_golden WHERE party_id=? ORDER BY version_no DESC LIMIT 1', partyId);
  if (last && J(U.parse(last.a, {})) === J(g.attributes) && !approvedBy) return { golden_id: null, unchanged: true, ...g };
  const id = nid('GRV'); q.insert('di_golden', { id, party_id: partyId, version_no: (last ? last.n : 0) + 1, attributes: J(g.attributes), provenance: J({ fields: g.provenance, conflicts: g.conflicts, sources: g.sources }), rule_version: RULE_VERSION, reason, effective_at: U.iso(), approved_by: approvedBy });
  const attrs = g.attributes; q.run('UPDATE di_party SET golden_version_id=?, display_name=?, country_code=?, consent_status=?, updated_at=?, version=version+1 WHERE party_id=?', id, attrs.display_name || null, attrs.country_code || null, attrs.consent_status || null, U.iso(), partyId);
  return { golden_id: id, version_no: (last ? last.n : 0) + 1, ...g };
}
const goldenHistory = (partyId) => q.all('SELECT * FROM di_golden WHERE party_id=? ORDER BY version_no DESC', partyId).map((g) => ({ ...g, attributes: U.parse(g.attributes, {}), provenance: U.parse(g.provenance, {}) }));

function companyLinkFor(name) {
  if (!name) return null; const n = M.normalizeOrgName(name);
  const rows = q.all('SELECT id,name,name_en FROM companies'); const hit = rows.find((c) => M.normalizeOrgName(c.name) === n || M.normalizeOrgName(c.name_en) === n); return hit ? hit.id : null;
}

// ───────── ODS / 서빙 ─────────
function refreshOds(partyId) {
  const p = q.get('SELECT * FROM di_party WHERE party_id=?', partyId); if (!p || p.lifecycle_status !== 'ACTIVE' || p.party_type !== 'ORGANIZATION') { q.run('DELETE FROM di_ods WHERE party_id=?', partyId); return null; }
  const g = q.get('SELECT * FROM di_golden WHERE id=?', p.golden_version_id); const a = g ? U.parse(g.attributes, {}) : {};
  const consentOk = a.consent_status === 'VALID' ? 1 : 0;
  if (!consentOk) { q.run('DELETE FROM di_ods WHERE party_id=?', partyId); return null; } // 철회·만료 → 서빙 제외(재평가)
  const cws = q.all("SELECT source_system FROM di_crosswalk WHERE party_id=? AND status='ACTIVE'", partyId); const merged = new Set(cws.map((c) => c.source_system)).size > 1;
  const hsKeys = (a.hs_codes || []).map(productKeysOfHs).filter(Boolean);
  const interestKeys = a.interest_industry_code && PRODUCTS.some((p) => p.key === a.interest_industry_code) ? [a.interest_industry_code] : []; // 표준 코드(=서비스 품목 키)로 이미 변환된 값
  const keys = [...new Set([...(merged ? hsKeys : []), ...interestKeys])]; // 승인된 병합/승인된 신규 속성에서만 서빙 키 확장
  const attrs = { display_name: a.display_name, country_code: a.country_code, website_domain: a.website_domain, hs_codes: a.hs_codes || [], interest_industry_code: a.interest_industry_code || null, organization_identifier: a.organization_identifier ? S.mask('reg_no', a.organization_identifier) : null };
  q.run('INSERT OR REPLACE INTO di_ods(party_id,attributes,product_keys,consent_ok,golden_version_id,mapping_version,updated_at) VALUES(?,?,?,?,?,?,?)', partyId, J(attrs), J(keys), 1, p.golden_version_id, M.activeVersion(), U.iso());
  return { party_id: partyId, product_keys: keys };
}
function servingKeysFor(companyId) {
  const p = q.get("SELECT party_id FROM di_party WHERE company_id=? AND lifecycle_status='ACTIVE' AND party_type='ORGANIZATION' LIMIT 1", companyId); if (!p) return null;
  const o = q.get('SELECT * FROM di_ods WHERE party_id=? AND consent_ok=1', p.party_id); if (!o) return null;
  const keys = U.parse(o.product_keys, []); return keys.length ? { party_id: p.party_id, golden_version_id: o.golden_version_id, mapping_version: o.mapping_version, extra_product_keys: keys } : null;
}

// ───────── 영향 분석 ─────────
function impactOf(partyIds) {
  const parties = partyIds.map((id) => q.get('SELECT * FROM di_party WHERE party_id=?', id)).filter(Boolean); const companyIds = [...new Set(parties.map((p) => p.company_id).filter(Boolean))];
  const consumers = [];
  for (const cid of companyIds) {
    const c = q.get('SELECT id,name FROM companies WHERE id=?', cid);
    consumers.push({ type: 'MyKOTRA', ref: cid, label: `${c.name} 프로필·Cockpit`, count: 1 });
    consumers.push({ type: 'BuyerRecommendation', ref: cid, label: '바이어 추천 순위/근거', count: 1 });
    consumers.push({ type: 'ProgramRecommendation', ref: cid, label: '맞춤 지원사업 추천', count: 1 });
    const n = q.count('consultations', 'WHERE company_id=?', cid); consumers.push({ type: 'ConsultationSingleView', ref: cid, label: '상담 Single View 연결 이력', count: n });
    const a = q.count('applications', 'WHERE company_id=?', cid); consumers.push({ type: 'Application', ref: cid, label: '지원사업 신청', count: a });
  }
  const ods = partyIds.filter((id) => q.get('SELECT 1 x FROM di_ods WHERE party_id=?', id)).length; consumers.push({ type: 'ODS_ServingView', label: 'ODS 통합 프로필', count: ods });
  return { parties: partyIds, companies: companyIds, consumers, estimated_changes: consumers.reduce((s, c) => s + (c.count || 0), 0) };
}
function recommendationSnapshot(companyId, extraKeys = []) {
  const SV = require('../domain/services'); const company = SV.getCompany ? SV.getCompany(companyId) : null; if (!company) return null;
  const keys = [...new Set([...(company.product_keys || []), ...extraKeys])];
  return SV.recommendBuyers(company, { productKeys: keys, limit: 8 }).map((b, i) => ({ rank: i + 1, id: b.id, name: b.name, score: b.score }));
}

// ───────── 병합 미리보기 · 결정 ─────────
const hydCand = (c) => c && ({ ...c, signals: U.parse(c.signals, []), blocks: U.parse(c.blocks, []) });
function candidateDetail(id) {
  const c = hydCand(q.get('SELECT * FROM di_candidate WHERE id=?', id)); if (!c) return null;
  const lv = c.left_ref.split(':'), rv = c.right_ref.split(':');
  const left = latestRaw(lv[0], lv[1], lv[2]); const right = latestRaw(rv[0], rv[1], rv[2]);
  const side = (v) => v && { ref: v.ref, system: v.system, name: v.name_raw, country: v.country, reg: S.mask('reg_no', v.reg), address: S.mask('address', v.address_raw), website: v.domain, email: v.email_hash ? `hash:${String(v.email_hash).slice(0, 8)}…` : null, contact: S.mask('name', v.contact), hs: v.hs, consent: evalConsent(v.system, v.payload) };
  const L = side(left), R = side(right);
  const fields = L && R ? [['name', '법인명'], ['country', '국가'], ['reg', '식별번호'], ['address', '주소'], ['website', '웹 도메인'], ['email', '이메일(해시)']].map(([k, label]) => ({ field: k, label, left: L[k], right: R[k], state: !L[k] || !R[k] ? 'MISSING' : String(L[k]).toLowerCase() === String(R[k]).toLowerCase() ? 'SAME' : 'CONFLICT' })) : [];
  return { ...c, left: L, right: R, fields };
}
function previewMerge(id) {
  const c = hydCand(q.get('SELECT * FROM di_candidate WHERE id=?', id)); if (!c) throw U.notFound('Candidate not found');
  const lp = partyOfRef(c.left_ref), rp = partyOfRef(c.right_ref); if (!lp || !rp) throw err('PARTIES_NOT_MASTERED', '정본(Party)이 아직 생성되지 않았습니다. 파이프라인을 먼저 실행하세요', 409);
  const before = { left: goldenHistory(lp)[0], right: goldenHistory(rp)[0] };
  // 시뮬레이션: 병합 후 정본 (crosswalk 를 일시적으로 합친 것으로 계산)
  const views = [c.left_ref, c.right_ref].map((r) => { const [s, t, pk] = r.split(':'); return latestRaw(s, t, pk); });
  const sim = simulateGolden(views);
  const impact = impactOf([lp, rp]); const companyId = (q.get('SELECT company_id c FROM di_party WHERE party_id=?', lp) || {}).c;
  let rec = null; if (companyId) { const extra = [...new Set((sim.attributes.hs_codes || []).map(productKeysOfHs).filter(Boolean))]; rec = { company_id: companyId, before: recommendationSnapshot(companyId, []), after: recommendationSnapshot(companyId, extra) }; if (rec.before && rec.after) rec.changed = rec.after.map((x) => x.id).join() !== rec.before.map((x) => x.id).join(); }
  return { candidate_id: id, survivor_party: lp, absorbed_party: rp, golden_before: before, golden_after: { attributes: sim.attributes, conflicts: sim.conflicts }, crosswalk_changes: q.count('di_crosswalk', "WHERE party_id=? AND status='ACTIVE'", rp), impact, recommendation_impact: rec, expected_changes: impact.estimated_changes };
}
function simulateGolden(views) {
  const tmpId = '__SIM__'; q.run("DELETE FROM di_party WHERE party_id=?", tmpId);
  const o = { attributes: {}, conflicts: [] }; const crm = views.find((v) => v.system === 'CRM'); const bk = views.find((v) => v.system === 'BUYKOREA');
  const order = [crm, bk].filter(Boolean); const hs = [...new Set(order.flatMap((v) => (v.system === 'BUYKOREA' ? [...v.hs, ...bkProductHs(v.pk)] : v.hs)))];
  o.attributes = { display_name: crm ? crm.name_raw : bk.name_raw, country_code: order.map((v) => v.country).find((c) => S.ISO2.has(c)) || null, organization_identifier: S.mask('reg_no', order.map((v) => v.reg).filter(Boolean)[0] || ''), address: [...order].sort((x, y) => String(y.updated).localeCompare(String(x.updated))).map((v) => v.address_raw).filter(Boolean)[0] || null, hs_codes: hs, website_domain: order.map((v) => v.domain).filter(Boolean)[0] || null };
  const names = new Set(order.map((v) => v.name)); if (names.size > 1) o.conflicts.push({ field: 'normalized_name', values: order.map((v) => v.name), resolution: 'CRM 우선' });
  const countries = new Set(order.map((v) => v.country)); if (countries.size > 1) o.conflicts.push({ field: 'country_code', values: order.map((v) => v.country), resolution: 'ISO 검증 우선' });
  return o;
}

function decide(ctx, id, b) {
  const c = hydCand(q.get('SELECT * FROM di_candidate WHERE id=?', id)); if (!c) throw U.notFound('Candidate not found');
  const decision = String(b.decision || '').toUpperCase(); const reason = String(b.reason || '').trim().slice(0, 500);
  if (!['MERGE', 'LINK_ONLY', 'KEEP_SEPARATE', 'REQUEST_INFO'].includes(decision)) throw err('BAD_DECISION', 'decision 은 MERGE / LINK_ONLY / KEEP_SEPARATE / REQUEST_INFO 중 하나입니다', 400);
  const needsApprover = ['MERGE', 'LINK_ONLY'].includes(decision);
  if (needsApprover && ctx.user.role !== 'admin') throw err('MDM_APPROVAL_REQUIRED', '병합·연계는 MDM 승인자(관리자)만 승인할 수 있습니다', 403);
  checkVersion(c, b.expected_version, '후보');
  if (c.status === 'BLOCKED' && needsApprover) throw err('MDM_BLOCKED', `하드 블록된 후보입니다: ${c.blocks.map((x) => x.text).join(' / ')}`, 422);
  if (!['PENDING', 'NEEDS_INFO', 'BLOCKED'].includes(c.status)) throw err('ALREADY_DECIDED', `이미 처리된 후보입니다(${c.status})`, 409);
  if (needsApprover) {
    if (b.confirm !== true) throw err('CONFIRM_REQUIRED', '승인에는 confirm:true(최종 확인)가 필요합니다', 400);
    if (reason.length < 4) throw err('REASON_REQUIRED', '승인 사유(4자 이상)를 입력하세요', 400);
    if (b.diff_ack !== true) throw err('DIFF_ACK_REQUIRED', '병합 전후 Diff를 확인했다는 diff_ack:true 가 필요합니다', 400);
    if (c.reviewer && c.reviewer === ctx.user.id && (strictSod() || ctx.user.role !== 'admin')) throw err('SOD_VIOLATION', '검토자와 승인자는 분리되어야 합니다(직무 분리)', 403);
    const sig = c.signals.find((s) => s.code === 'CONSENT_INELIGIBLE'); if (sig) throw err('CONSENT_BLOCKED', `동의 부적합 레코드는 병합할 수 없습니다: ${sig.text}`, 422);
  } else if (!['admin', 'consultant'].includes(ctx.user.role)) throw err('FORBIDDEN', '권한이 없습니다', 403);
  if (decision !== 'MERGE' && decision !== 'LINK_ONLY' && reason.length < 2) throw err('REASON_REQUIRED', '사유를 입력하세요', 400);

  return q.tx(() => {
    const did = nid('MDD'); let survivor = null; let absorbed = null; let impact = null; let after = null; let before = null;
    if (decision === 'MERGE') {
      const lp = partyOfRef(c.left_ref); const rp = partyOfRef(c.right_ref); if (!lp || !rp) throw err('PARTIES_NOT_MASTERED', '정본(Party)이 아직 생성되지 않았습니다', 409);
      if (lp === rp) throw err('ALREADY_MERGED', '이미 같은 정본입니다', 409);
      const lpRow = q.get('SELECT * FROM di_party WHERE party_id=?', lp); const rpRow = q.get('SELECT * FROM di_party WHERE party_id=?', rp);
      if (lpRow.lifecycle_status !== 'ACTIVE' || rpRow.lifecycle_status !== 'ACTIVE') throw err('PARTY_NOT_ACTIVE', '활성 정본이 아닙니다', 409);
      survivor = lp; absorbed = rp; before = { survivor: goldenHistory(lp)[0], absorbed: goldenHistory(rp)[0], crosswalks: q.all("SELECT * FROM di_crosswalk WHERE party_id IN (?,?) AND status='ACTIVE'", lp, rp) };
      impact = impactOf([lp, rp]); const now = U.iso();
      for (const cw of q.all("SELECT * FROM di_crosswalk WHERE party_id=? AND status='ACTIVE'", rp)) {
        q.run("UPDATE di_crosswalk SET status='RETIRED', valid_to=? WHERE id=?", now, cw.id);
        q.insert('di_crosswalk', { id: nid('XWK'), party_id: lp, source_system: cw.source_system, source_table: cw.source_table, source_pk: cw.source_pk, status: 'ACTIVE', valid_from: now, valid_to: null, version: cw.version + 1, decision_id: did });
      }
      q.run('UPDATE di_activity SET party_id=? WHERE party_id=?', lp, rp); q.run('UPDATE di_consent SET party_id=? WHERE party_id=?', lp, rp);
      q.run("UPDATE di_party SET lifecycle_status='MERGED', merged_into=?, updated_at=?, version=version+1 WHERE party_id=?", lp, now, rp);
      const g = newGolden(ctx, lp, `병합 승인 ${did}`, ctx.user.id); after = { golden: g.attributes, conflicts: g.conflicts, version_no: g.version_no };
      refreshOds(rp); refreshOds(lp);
      q.run("INSERT OR IGNORE INTO di_lineage(from_node,to_node,kind,ref,version,created_at) VALUES(?,?,?,?,?,?)", `party:${rp}`, `party:${lp}`, 'MERGED_INTO', did, POLICY_VERSION, now);
    } else if (decision === 'LINK_ONLY') {
      const lp = partyOfRef(c.left_ref); const rp = partyOfRef(c.right_ref); q.insert('di_link', { id: nid('LNK'), party_a: lp, party_b: rp, kind: 'SAME_AS', decision_id: did, status: 'ACTIVE', created_at: U.iso() }); survivor = lp; absorbed = rp;
    }
    q.insert('di_decision', { id: did, candidate_id: id, decision, reviewer: c.reviewer, approver: needsApprover ? ctx.user.id : null, reason, policy_version: POLICY_VERSION, survivor_party: survivor, absorbed_party: absorbed, before_json: J(before), after_json: J(after), impact_json: J(impact), reversed_by: null, created_at: U.iso() });
    const to = { MERGE: 'MERGED', LINK_ONLY: 'LINKED', KEEP_SEPARATE: 'SEPARATE', REQUEST_INFO: 'NEEDS_INFO' }[decision];
    G.transition(ctx, 'di_candidate', id, to, `${decision}: ${reason}`, { version: c.version + 1 });
    ev(ctx, `identity.${decision.toLowerCase()}`, id, { decision: did, survivor, absorbed }); audit(ctx, `identity.${decision.toLowerCase()}`, 'di_candidate', id, { decision: did, reason, survivor, absorbed });
    return { decision_id: did, candidate_id: id, decision, status: to, survivor_party: survivor, absorbed_party: absorbed, golden_after: after, impact, undo: decision === 'MERGE' ? { endpoint: `/api/v1/data-integration/masters/${survivor}/unmerge`, decision_id: did } : null };
  });
}
function recommend(ctx, id, b) { // 스튜어드 의견(검토자 기록) — 승인과 분리
  const c = q.get('SELECT * FROM di_candidate WHERE id=?', id); if (!c) throw U.notFound('Candidate not found');
  q.update('di_candidate', id, { reviewer: ctx.user.id, updated_at: U.iso(), version: c.version + 1 }); ev(ctx, 'identity.recommend', id, { recommendation: String(b.recommendation || '').slice(0, 20), reason: String(b.reason || '').slice(0, 300) }); audit(ctx, 'identity.recommend', 'di_candidate', id, { recommendation: b.recommendation });
  return { candidate_id: id, reviewer: ctx.user.id, version: c.version + 1 };
}
function unmerge(ctx, survivorId, b) {
  if (ctx.user.role !== 'admin') throw err('MDM_APPROVAL_REQUIRED', 'Unmerge 는 MDM 승인자(관리자)만 수행합니다', 403);
  if (b.confirm !== true) throw err('CONFIRM_REQUIRED', 'confirm:true 가 필요합니다', 400);
  const reason = String(b.reason || '').trim(); if (reason.length < 4) throw err('REASON_REQUIRED', 'Unmerge 사유(4자 이상)가 필요합니다', 400);
  const d = q.get("SELECT * FROM di_decision WHERE survivor_party=? AND decision='MERGE' AND reversed_by IS NULL ORDER BY created_at DESC LIMIT 1", survivorId); if (!d) throw err('NO_MERGE', '되돌릴 병합 결정이 없습니다', 404);
  return q.tx(() => {
    const now = U.iso(); const rp = d.absorbed_party; const did = nid('MDD'); const moved = q.all("SELECT * FROM di_crosswalk WHERE decision_id=? AND status='ACTIVE'", d.id);
    for (const cw of moved) {
      q.run("UPDATE di_crosswalk SET status='RETIRED', valid_to=? WHERE id=?", now, cw.id);
      q.insert('di_crosswalk', { id: nid('XWK'), party_id: rp, source_system: cw.source_system, source_table: cw.source_table, source_pk: cw.source_pk, status: 'ACTIVE', valid_from: now, valid_to: null, version: cw.version + 1, decision_id: did });
    }
    q.run("UPDATE di_party SET lifecycle_status='ACTIVE', merged_into=NULL, updated_at=?, version=version+1 WHERE party_id=?", now, rp);
    const g1 = newGolden(ctx, survivorId, `Unmerge ${did}`, ctx.user.id); const g2 = newGolden(ctx, rp, `Unmerge ${did}`, ctx.user.id); refreshOds(survivorId); refreshOds(rp);
    const impact = impactOf([survivorId, rp]);
    q.insert('di_decision', { id: did, candidate_id: d.candidate_id, decision: 'UNMERGE', reviewer: null, approver: ctx.user.id, reason, policy_version: POLICY_VERSION, survivor_party: survivorId, absorbed_party: rp, before_json: J({ reversed: d.id }), after_json: J({ survivor_golden: g1.attributes, restored_golden: g2.attributes }), impact_json: J(impact), reversed_by: null, created_at: now });
    q.run('UPDATE di_decision SET reversed_by=? WHERE id=?', did, d.id);
    G.transition(ctx, 'di_candidate', d.candidate_id, 'PENDING', `unmerge: ${reason}`, { version: (q.get('SELECT version v FROM di_candidate WHERE id=?', d.candidate_id).v || 1) + 1 });
    ev(ctx, 'identity.unmerge', survivorId, { decision: did, restored: rp }); audit(ctx, 'identity.unmerge', 'di_party', survivorId, { decision: did, restored: rp, reason });
    return { decision_id: did, reversed: d.id, survivor_party: survivorId, restored_party: rp, survivor_golden_version: g1.version_no, restored_golden_version: g2.version_no, impact };
  });
}

// ───────── 신규 가입 중복 방지 시뮬레이터 (계정 존재 탐지 방지) ─────────
function simulateSignup(ctx, b) {
  const system = b.system === 'BUYKOREA' ? 'BUYKOREA' : 'CRM';
  const name = String(b.org_name || '').trim().slice(0, 200); if (name.length < 2) throw err('VALIDATION', '기업명을 입력하세요', 400);
  const std = { name: M.normalizeOrgName(name), country: String(b.country || '').trim().toUpperCase().slice(0, 3), reg: String(b.reg_no || '').trim() || null, domain: domainOf(b.website), email_hash: b.email ? M.hashId(String(b.email).toLowerCase()) : null, address: tok(b.address) };
  std.country = ({ KOR: 'KR', USA: 'US', JPN: 'JP', VNM: 'VN' })[std.country] || std.country;
  const a = { name: std.name, country: std.country || null, reg: std.reg, address: std.address, domain: std.domain, email_hash: std.email_hash, hs: [] };
  let best = null; let comparisons = 0;
  for (const p of q.all("SELECT * FROM di_party WHERE party_type='ORGANIZATION' AND lifecycle_status='ACTIVE'")) {
    const g = q.get('SELECT * FROM di_golden WHERE id=?', p.golden_version_id); if (!g) continue; const at = U.parse(g.attributes, {}); comparisons++;
    const cws = q.all("SELECT * FROM di_crosswalk WHERE party_id=? AND status='ACTIVE'", p.party_id); const rawView = cws.map((c) => latestRaw(c.source_system, c.source_table.replace('#contact', ''), c.source_pk)).filter(Boolean);
    const reg = rawView.map((v) => v.reg).find(Boolean) || null; const em = rawView.map((v) => v.email_hash).find(Boolean) || null;
    const bView = { name: at.normalized_name || M.normalizeOrgName(at.display_name), country: at.country_code || null, reg, address: tok(at.address), domain: at.website_domain || null, email_hash: em, hs: (at.hs_codes || []).map(hsOf) };
    const r = scorePair(a, bView); if (!best || r.score > best.r.score || (r.blocks.length === 0 && best.r.blocks.length > 0 && r.score >= best.r.score - 5)) best = { p, r };
  }
  let outcome = 'NEW'; if (best && !best.r.blocks.length && best.r.score >= 70) outcome = 'STRONG_DUPLICATE'; else if (best && !best.r.blocks.length && best.r.score >= 30) outcome = 'REVIEW'; else if (best && best.r.blocks.some((x) => x.code === 'CONFLICTING_VERIFIED_ID' || x.code === 'COUNTRY_MISMATCH_NO_VERIFIED_ID')) outcome = 'NEW';
  const steward = ['admin', 'consultant'].includes(ctx.user.role);
  const general = { STRONG_DUPLICATE: '입력하신 정보를 확인하기 위해 담당자 검토가 필요합니다. 접수 후 별도로 안내드립니다.', REVIEW: '입력하신 정보를 확인하기 위해 담당자 검토가 필요합니다. 접수 후 별도로 안내드립니다.', NEW: '가입 정보가 접수되었습니다.' }[outcome];
  const action = { STRONG_DUPLICATE: '기존 계정 안내(정보 최소화) 또는 신규 가입 보류', REVIEW: '담당자 확인 후 진행', NEW: '신규 가입 진행' }[outcome];
  const id = nid('SIM'); q.insert('di_signup_sim', { id, system, input_masked: J({ name: S.mask('name', name), country: std.country, email: b.email ? S.mask('email', b.email) : null, reg: std.reg ? S.mask('reg_no', std.reg) : null }), outcome, matched_party: best && outcome !== 'NEW' ? best.p.party_id : null, action, by_user: ctx.user.id, at: U.iso() });
  ev(ctx, 'signup.simulated', id, { system, outcome }); audit(ctx, 'signup.simulated', 'di_signup_sim', id, { system, outcome });
  const base = { simulation_id: id, system, outcome_public: outcome === 'NEW' ? 'ACCEPTED' : 'PENDING_REVIEW', message: general, stored_in: 'DEMO 저장소(실계정 미생성)', comparisons };
  if (!steward) return base; // 무권한/조회 전용 사용자에게는 일반화 메시지만 — 계정 존재 노출 금지
  return { ...base, outcome, recommended_action: action, matched_party: best && outcome !== 'NEW' ? { party_id: best.p.party_id, name: best.p.display_name, score: best.r.score, signals: best.r.signals, blocks: best.r.blocks } : null, block_notes: best ? best.r.blocks : [] };
}

module.exports = { POLICY_VERSION, RULE_VERSION, evalConsent, viewOf, currentRaw, scorePair, resolveCandidates, partyOfRef, computeGolden, newGolden, goldenHistory, companyLinkFor, refreshOds, servingKeysFor, impactOf, recommendationSnapshot,
  candidateDetail, previewMerge, decide, recommend, unmerge, simulateSignup, productKeysOfHs, latestRaw, domainOf, hydCand, bkProductHs };
