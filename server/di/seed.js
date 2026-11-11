'use strict';
// Data Integration Studio 시드: CRM_DEMO·BUYKOREA_DEMO 합성 원천(100+ 레코드, 고정 seed), C01~C10 케이스, 표준사전·코드표·매핑 v1·DQ 규칙·모델,
// 최초 스키마 발견 + 전체 적재. 모든 데이터는 SYNTHETIC 이며 실제 KOTRA 운영 DB 구조가 아니다.
const { q } = require('../db');
const U = require('../util');
const DDL = require('./ddl');
const S = require('./schema');
const M = require('./mapping');
const DQ = require('./quality');
const PL = require('./pipeline');
const { J } = require('./core');

function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const regKR = (n) => { // 체크섬이 맞는 합성 사업자번호
  const d = String(n).padStart(9, '0').slice(0, 9).split('').map(Number); const w = [1, 3, 7, 1, 3, 7, 1, 3, 5]; let s = 0; for (let i = 0; i < 9; i++) s += d[i] * w[i]; s += Math.floor((d[8] * 5) / 10);
  const c = (10 - (s % 10)) % 10; const t = [...d, c].join(''); return `${t.slice(0, 3)}-${t.slice(3, 5)}-${t.slice(5)}`;
};
const PRE = ['Aurora', 'Bluewave', 'Cedar', 'Daon', 'Ecovia', 'Fuji', 'Greenfield', 'Hanbit', 'Iris', 'Jade', 'Kyoto', 'Lumina', 'Mirae', 'Nova', 'Orion', 'Pinecrest', 'Quanta', 'Riseon', 'Sunrise', 'Terra', 'Urban', 'Vertex', 'Willow', 'Xenon', 'Yonder', 'Zenith', 'Alpha', 'Boreal', 'Coral', 'Delta'];
const SUF = ['Beauty', 'Foods', 'Tech', 'Medical', 'Machinery', 'Fashion', 'Pack', 'Energy', 'Games', 'Materials', 'Home', 'Bio'];
const HS = ['3304.99', '2005.99', '9018.90', '8507.60', '4902.90', '8517.62', '3923.21', '6110.20', '8479.89', '8543.70', '2106.90', '3004.90'];
const PROG = ['PG-001', 'PG-003', 'PG-005', 'PG-007', 'PG-012', 'PG-020'];
const FC = ['VN', 'US', 'JP', 'AE', 'DE', 'SG', 'TH', 'ID']; const FCITY = { VN: 'Ho Chi Minh City', US: 'Los Angeles', JP: 'Tokyo', AE: 'Dubai', DE: 'Berlin', SG: 'Singapore', TH: 'Bangkok', ID: 'Jakarta' };
const day = (base, n) => U.addDays(base, n);

function build() {
  const R = rng(20261109); const pick = (a) => a[Math.floor(R() * a.length)]; const today = '2026-11-09'; const crm = []; const bk = []; const part = []; const voc = []; const prod = []; const inq = [];
  const crmRow = (o) => ({ crm_customer_id: o.id, customer_type: o.type || 'ORGANIZATION', organization_name: o.org ?? null, contact_name: o.contact ?? null, contact_email: o.email ?? null, country_code: o.country ?? 'KR', business_reg_no: o.reg ?? null, address_line: o.addr ?? null, website: o.web ?? null, main_hs_code: o.hs ?? null,
    consent_purpose: o.purpose ?? 'DATA_INTEGRATION', consent_at: o.cat ?? `${day('2024-01-15', Math.floor(R() * 600))}T09:00:00`, consent_until: o.cuntil ?? `${day(today, 400 + Math.floor(R() * 800))}T09:00:00`, consent_revoked_at: o.revoked ?? null, updated_at: o.upd ?? `${day('2026-10-01', Math.floor(R() * 36))}T0${Math.floor(R() * 9)}:30:00` });
  const bkRow = (o) => ({ bk_member_id: o.id, business_name_en: o.name ?? null, manager_name: o.mgr ?? null, manager_email: o.email ?? null, residence_country: o.country ?? null, company_reg_no: o.reg ?? null, registered_address: o.addr ?? null, website_url: o.web ?? null, account_status: o.status ?? 'ACTIVE',
    permission_granted_at: o.gat ?? `${day('2023-06-01', Math.floor(R() * 800))}T10:00:00`, permission_expires_at: o.exp ?? `${day(today, 300 + Math.floor(R() * 700))}T10:00:00`, modified_at: o.upd ?? `${day('2026-10-01', Math.floor(R() * 36))}T1${Math.floor(R() * 9)}:15:00` });

  // ── 케이스 C01~C10 (Golden Test Dataset) ──
  const R1 = regKR(110812345); const R2 = regKR(220334455); const R3 = regKR(330556677); const R5 = regKR(440778899); const R7 = regKR(550990011); const R8 = regKR(660112233);
  crm.push(crmRow({ id: 'CRM-C0001', org: 'K-Beauty Labs', contact: '김지안', email: 'beauty@kbeautylabs.example', country: 'KR', reg: R1, addr: '12 Teheran-ro, Gangnam-gu, Seoul', web: 'https://www.kbeautylabs.example', hs: '3304.99', upd: '2026-10-20T09:30:00' }));
  bk.push(bkRow({ id: 'BK-M0001', name: 'K BEAUTY LABS LTD', mgr: 'Jian Kim', email: 'beauty@kbeautylabs.example', country: 'KR', reg: R1, addr: '12 Teheran-ro Gangnam-gu Seoul', web: 'kbeautylabs.example', upd: '2026-10-22T11:00:00' }));
  crm.push(crmRow({ id: 'CRM-C0002', org: 'Seoul Skin Co.', contact: '이유진', email: 'yujin@seoulskin.example', country: 'KR', addr: '88 Banpo-daero, Seocho-gu, Seoul', web: 'seoulskin.example', hs: '3304.10' }));
  bk.push(bkRow({ id: 'BK-M0002', name: 'Seoul Skin Company Ltd', mgr: 'D. Han', email: 'export@seoulskin-global.example', country: 'KR', addr: '5 Sinsa-dong, Gangnam-gu, Seoul', web: 'seoulskin-global.example' }));
  crm.push(crmRow({ id: 'CRM-C0003', org: 'Global Foods Korea', contact: 'Park Minho', email: 'sales@sharedtrade.example', country: 'KR', reg: R2, addr: '21 Jungang-ro, Busan', web: 'globalfoods.example', hs: '2005.99' }));
  crm.push(crmRow({ id: 'CRM-C0004', org: 'Pacific Trading Co', contact: 'Lee Soyeon', email: 'sales@sharedtrade.example', country: 'KR', reg: R3, addr: '9 Daehak-ro, Incheon', web: 'pacifictrading.example', hs: '8479.89' }));
  bk.push(bkRow({ id: 'BK-M0003', name: 'Global Foods Vietnam', mgr: 'Nguyen Van A', email: 'sales@sharedtrade.example', country: 'VN', reg: 'VN-0309876543', addr: '120 Nguyen Hue, Ho Chi Minh City', web: 'globalfoods-vn.example' }));
  crm.push(crmRow({ id: 'CRM-C0005', org: 'Han Food Global', contact: '정지훈', email: 'jh@hanfood.example', country: 'KR', reg: R5, addr: '3 Gwanggyo-ro, Suwon', web: 'hanfood.example', hs: '2005.99' }));
  bk.push(bkRow({ id: 'BK-M0004', name: 'HanFood Global', mgr: 'Tran Minh', email: 'minh@hanfood-vn.example', country: 'VN', reg: 'VN-0301234567', addr: '55 Le Loi, Hanoi', web: 'hanfood-vn.example' }));
  crm.push(crmRow({ id: 'CRM-C0006', org: 'MediCore Korea', contact: '최수아', email: 'sua@medicore.example', country: 'KR', reg: R7, addr: '77 Pangyo-ro, Seongnam', web: 'medicore.example', hs: '9018.90', revoked: '2026-09-15T00:00:00', upd: '2026-09-15T08:00:00' })); // C05 동의 철회
  bk.push(bkRow({ id: 'BK-M0005', name: 'MediCore Korea Co', mgr: 'S. Choi', email: 'export@medicore.example', country: 'KR', reg: R7, addr: '77 Pangyo-ro Seongnam', web: 'medicore.example' }));
  crm.push(crmRow({ id: 'CRM-C0007', org: 'Nano Materials Inc', contact: '조예준', email: 'yj@nanomat.example', country: 'KR', addr: '10 Songdo-gwahak-ro, Incheon', web: 'nanomat.example', hs: '3824.99', cuntil: '2026-06-30T00:00:00' })); // C06 기한 경과
  bk.push(bkRow({ id: 'BK-M0006', name: 'Lotus Retail Group', mgr: 'A. Sato', email: null, country: 'JP', addr: '1-2-3 Shibuya, Tokyo', web: 'lotusretail.example' })); // C07 연락처 결측
  bk.push(bkRow({ id: 'BK-M0007', name: 'Desert Gate Trading', mgr: 'K. Rahman', email: 'not-an-email', country: 'AE', addr: 'Business Bay, Dubai', web: 'desertgate.example' })); // C07 형식 오류
  crm.push(crmRow({ id: 'CRM-C0008', org: 'SmartHome Dynamics', contact: '윤서연', email: 'sy@smarthome.example', country: 'KR', reg: R8, addr: '45 Digital-ro, Guro-gu, Seoul', web: 'smarthome.example', hs: '8517.62' }));
  bk.push(bkRow({ id: 'BK-M0008', name: 'SmartHome Dynamics Ltd', mgr: 'S. Yoon', email: 'export@smarthome.example', country: 'KOR', reg: R8, addr: '45 Digital-ro Guro-gu Seoul', web: 'smarthome.example' })); // C08 KOR↔KR
  crm.push(crmRow({ id: 'CRM-C0009', org: 'Daon Fashion', contact: '장도윤', email: 'dy@daonfashion.example', country: 'KR', reg: regKR(771223344), addr: '8 Dongdaemun-gu, Seoul', web: 'daonfashion.example', hs: '6110.20', upd: '2026-10-05T09:00:00' })); // C10 정정 대상
  crm.push(crmRow({ id: 'CRM-C0010', org: 'Hanbit Machinery', contact: '임지민', email: 'jm@hanbitmach.example', country: 'KR', reg: regKR(881334455), addr: '2 Changwon-daero, Changwon', web: 'hanbitmach.example', hs: '8479.89' }));
  crm.push(crmRow({ id: 'CRM-C0011', type: 'INDIVIDUAL', contact: '한가을', email: 'gaeul.han@mailbox.example', country: 'KR' })); crm.push(crmRow({ id: 'CRM-C0012', type: 'INDIVIDUAL', contact: 'Oh Sehun', email: 'sehun@mailbox.example', country: 'KR' }));
  // 5년 초과 동의(RFP 5개년 필터)
  crm.push(crmRow({ id: 'CRM-C0013', org: 'Old Consent Co', contact: '문가영', email: 'gy@oldconsent.example', country: 'KR', reg: regKR(991445566), addr: '1 Old-ro, Daegu', web: 'oldconsent.example', cat: '2020-03-10T09:00:00', cuntil: '2030-03-10T09:00:00' }));

  // ── 무작위(고정 seed) 레코드 ──
  let ci = 14; let bi = 9; const used = new Set();
  const name = () => { let n; do { n = `${pick(PRE)} ${pick(SUF)}`; } while (used.has(n)); used.add(n); return n; };
  for (let i = 0; i < 38; i++) { // CRM 국내 기업
    const n = name(); const id = `CRM-C${String(ci++).padStart(4, '0')}`; const slug = n.toLowerCase().replace(/[^a-z]+/g, '');
    crm.push(crmRow({ id, org: n, contact: pick(['김민준', '이서연', '박지훈', '최유진', '정도윤', '강하은', '조시우']), email: `${pick(['sales', 'info', 'export', 'biz'])}@${slug}.example`, country: 'KR', reg: regKR(100000000 + Math.floor(R() * 800000000)), addr: `${1 + Math.floor(R() * 99)} ${pick(['Teheran-ro', 'Sejong-daero', 'Jungang-ro', 'Digital-ro'])}, ${pick(['Seoul', 'Busan', 'Incheon', 'Daegu', 'Suwon'])}`, web: `${slug}.example`, hs: pick(HS) }));
    if (i < 14) { // 일부는 BK 에도 다른 표기로 존재(동일 법인 후보)
      const reg = crm[crm.length - 1].business_reg_no; const varname = pick([`${n.toUpperCase()} LTD`, `${n} Co., Ltd.`, `${n.replace(' ', '')} Corp`, `${n} Company Limited`]);
      bk.push(bkRow({ id: `BK-M${String(bi++).padStart(4, '0')}`, name: varname, mgr: pick(['H. Kim', 'J. Lee', 'S. Park']), email: i % 3 === 0 ? `${pick(['sales', 'info'])}@${slug}.example` : `export-${i}@${slug}-global.example`, country: 'KR', reg, addr: crm[crm.length - 1].address_line.replace(',', ''), web: i % 2 ? crm[crm.length - 1].website : `www.${slug}.example` }));
    }
  }
  for (let i = 0; i < 26; i++) { // BK 해외 바이어/기타
    const n = `${pick(PRE)} ${pick(['Trading', 'Retail', 'Distribution', 'Imports', 'Group'])} ${pick(['Ltd', 'LLC', 'GmbH', 'Pte'])}`; const cc = pick(FC); const slug = n.toLowerCase().replace(/[^a-z]+/g, '');
    bk.push(bkRow({ id: `BK-M${String(bi++).padStart(4, '0')}`, name: n, mgr: pick(['A. Nguyen', 'B. Miller', 'C. Sato', 'D. Rahman', 'E. Tan']), email: `${pick(['buy', 'sourcing', 'contact'])}@${slug}.example`, country: cc, reg: `${cc}-${String(100000 + Math.floor(R() * 899999)).padStart(8, '0')}`, addr: `${1 + Math.floor(R() * 99)} Main St, ${FCITY[cc]}`, web: `${slug}.example`, status: i === 3 ? 'DORMANT' : 'ACTIVE' }));
  }
  // 동명이법인 추가(해외) — 블록 대상
  const dn = crm[20].organization_name; bk.push(bkRow({ id: `BK-M${String(bi++).padStart(4, '0')}`, name: dn, mgr: 'X. Foreign', email: 'office@samename-foreign.example', country: 'TH', reg: 'TH-00998877', addr: '9 Sukhumvit, Bangkok', web: 'samename-foreign.example' }));

  const cids = crm.filter((c) => c.customer_type === 'ORGANIZATION').map((c) => c.crm_customer_id); let pi = 1; let vi = 1;
  for (const c of cids) { for (let k = 0; k < Math.floor(R() * 3); k++) part.push({ participation_id: `PRT-${String(pi++).padStart(4, '0')}`, crm_customer_id: c, program_code: pick(PROG), participated_at: `${day('2024-02-01', Math.floor(R() * 600))}T09:00:00` }); if (R() < 0.45) voc.push({ voc_id: `VOC-${String(vi++).padStart(4, '0')}`, crm_customer_id: c, subject: pick(['수출 인증 문의', '지원사업 자격 문의', '바이어 매칭 요청', '서류 보완 문의']), created_at: `${day('2025-01-01', Math.floor(R() * 600))}T11:00:00` }); }
  let pri = 1; for (const b of bk) { for (let k = 0; k < 1 + Math.floor(R() * 2); k++) prod.push({ bk_product_id: `BKP-${String(pri++).padStart(4, '0')}`, bk_member_id: b.bk_member_id, hs_code: pick(HS), product_name_en: pick(['Serum', 'Instant noodles', 'Diagnostic kit', 'Battery cell', 'LED panel', 'Packaging film']) }); }
  // C01: K-Beauty Labs 는 BK 에 뷰티 디바이스(8543) 상품을 보유 → 병합 시 추천 변화 시연
  prod.push({ bk_product_id: 'BKP-9001', bk_member_id: 'BK-M0001', hs_code: '8543.70', product_name_en: 'LED beauty mask' }); prod.push({ bk_product_id: 'BKP-9002', bk_member_id: 'BK-M0001', hs_code: '3304.99', product_name_en: 'Functional serum' });
  let ii = 1; for (let k = 0; k < 40; k++) { const a = pick(bk).bk_member_id; const b2 = pick(bk).bk_member_id; if (a !== b2) inq.push({ inquiry_id: `INQ-${String(ii++).padStart(4, '0')}`, buyer_member_id: a, seller_member_id: b2, created_at: `${day('2026-01-01', Math.floor(R() * 300))}T10:00:00`, inquiry_status: pick(['OPEN', 'ANSWERED', 'CLOSED']) }); }
  return { crm, bk, part, voc, prod, inq };
}
const ins = (t, rows) => { for (const r of rows) q.insert(t, r); };

const STANDARDS = [
  ['organization_name', 'legal_entity_name', 'Legal Entity Name', 'string', 200, 1, '-', 'INTERNAL', '법인 정식 명칭'], ['normalized_name', 'normalized_name', 'Normalized Name', 'string', 200, 0, '-', 'INTERNAL', 'NFKC·법인 접미부 제거·공백 정규화된 비교용 이름'],
  ['country_code', 'country_code', 'Country Code', 'string', 2, 0, 'ISO3166-1 alpha-2', 'PUBLIC', 'ISO 국가코드'], ['organization_identifier', 'organization_identifier', 'Organization Identifier', 'string', 40, 1, '발급국가별 등록번호', 'SENSITIVE', '검증된 법인 식별번호(UI 마스킹)'],
  ['address', 'registered_address', 'Registered Address', 'string', 200, 1, '-', 'INTERNAL', '등록 주소'], ['website', 'website_domain', 'Website Domain', 'string', 200, 1, '-', 'PUBLIC', '웹 도메인'],
  ['email_hash', 'email_hash', 'Email Hash', 'string', 64, 1, 'SHA-256 해시', 'SENSITIVE', '이메일 정책 기반 해시 — 단독 병합 근거 금지'], ['display_name', 'person_display_name', 'Person Display Name', 'string', 100, 1, '-', 'SENSITIVE', '담당자 이름'],
  ['granted_at', 'consent_granted_at', 'Consent Granted At', 'datetime', null, 0, '-', 'INTERNAL', '동의 시작 시각'], ['expires_at', 'consent_expires_at', 'Consent Expires At', 'datetime', null, 1, '-', 'INTERNAL', '동의 만료 시각'], ['revoked_at', 'consent_revoked_at', 'Consent Revoked At', 'datetime', null, 1, '-', 'INTERNAL', '동의 철회 시각'],
  ['source_pk', 'source_pk', 'Source Primary Key', 'string', 60, 0, '-', 'INTERNAL', '원천 시스템 PK(네임스페이스 분리)'], ['hs_code', 'hs_code', 'HS Code', 'string', 12, 1, 'HS 6자리 이상', 'PUBLIC', '품목 분류'],
];
const COUNTRY_LOOKUP = { KR: 'KR', KOR: 'KR', KOREA: 'KR', 'SOUTH KOREA': 'KR', US: 'US', USA: 'US', JP: 'JP', JPN: 'JP', VN: 'VN', VNM: 'VN', AE: 'AE', ARE: 'AE', DE: 'DE', DEU: 'DE', SG: 'SG', SGP: 'SG', TH: 'TH', THA: 'TH', ID: 'ID', IDN: 'ID', CN: 'CN', CHN: 'CN', GB: 'GB', GBR: 'GB' };
const ORG_NAME_RULES = [{ type: 'NFKC' }, { type: 'REGEX_REPLACE_ALLOWLIST', pattern: 'STRIP_PUNCT' }, { type: 'LOWER' }, { type: 'REGEX_REPLACE_ALLOWLIST', pattern: 'LEGAL_SUFFIX' }, { type: 'REGEX_REPLACE_ALLOWLIST', pattern: 'COLLAPSE_SPACE' }, { type: 'TRIM' }];
const COUNTRY_RULES = [{ type: 'TRIM' }, { type: 'UPPER' }, { type: 'LOOKUP_MAP', lookup_set: 'COUNTRY_ISO2', lookup_version: 'v1', on_unknown: 'FLAG_FOR_REVIEW' }];
const MAPS = [ // [system, table, field, entity, target, rules, required]
  ['CRM', 'demo_crm_customer', 'crm_customer_id', 'SOURCE_CROSSWALK', 'source_pk', [{ type: 'TRIM' }], 1], ['CRM', 'demo_crm_customer', 'organization_name', 'LEGAL_ENTITY', 'normalized_name', ORG_NAME_RULES, 1], ['CRM', 'demo_crm_customer', 'country_code', 'LEGAL_ENTITY', 'country_code', COUNTRY_RULES, 1],
  ['CRM', 'demo_crm_customer', 'business_reg_no', 'LEGAL_ENTITY', 'organization_identifier', [{ type: 'TRIM' }, { type: 'UPPER' }], 0], ['CRM', 'demo_crm_customer', 'address_line', 'LEGAL_ENTITY', 'address', [{ type: 'NFKC' }, { type: 'TRIM' }], 0], ['CRM', 'demo_crm_customer', 'website', 'LEGAL_ENTITY', 'website', [{ type: 'TRIM' }, { type: 'LOWER' }], 0],
  ['CRM', 'demo_crm_customer', 'contact_email', 'PARTY_IDENTIFIER', 'email_hash', [{ type: 'TRIM' }, { type: 'LOWER' }, { type: 'HASH_IDENTIFIER' }], 1], ['CRM', 'demo_crm_customer', 'contact_name', 'PERSON', 'display_name', [{ type: 'TRIM' }], 0],
  ['CRM', 'demo_crm_customer', 'consent_at', 'CONSENT_GRANT', 'granted_at', [{ type: 'DATE_PARSE' }], 1], ['CRM', 'demo_crm_customer', 'consent_until', 'CONSENT_GRANT', 'expires_at', [{ type: 'DATE_PARSE' }], 1], ['CRM', 'demo_crm_customer', 'consent_revoked_at', 'CONSENT_GRANT', 'revoked_at', [{ type: 'DATE_PARSE' }], 0],
  ['CRM', 'demo_crm_customer', 'main_hs_code', 'PARTY_PROFILE', 'hs_code', [{ type: 'TRIM' }], 0],
  ['BUYKOREA', 'demo_bk_member', 'bk_member_id', 'SOURCE_CROSSWALK', 'source_pk', [{ type: 'TRIM' }], 1], ['BUYKOREA', 'demo_bk_member', 'business_name_en', 'LEGAL_ENTITY', 'normalized_name', ORG_NAME_RULES, 1], ['BUYKOREA', 'demo_bk_member', 'residence_country', 'LEGAL_ENTITY', 'country_code', COUNTRY_RULES, 1],
  ['BUYKOREA', 'demo_bk_member', 'company_reg_no', 'LEGAL_ENTITY', 'organization_identifier', [{ type: 'TRIM' }, { type: 'UPPER' }], 0], ['BUYKOREA', 'demo_bk_member', 'registered_address', 'LEGAL_ENTITY', 'address', [{ type: 'NFKC' }, { type: 'TRIM' }], 0], ['BUYKOREA', 'demo_bk_member', 'website_url', 'LEGAL_ENTITY', 'website', [{ type: 'TRIM' }, { type: 'LOWER' }], 0],
  ['BUYKOREA', 'demo_bk_member', 'manager_email', 'PARTY_IDENTIFIER', 'email_hash', [{ type: 'TRIM' }, { type: 'LOWER' }, { type: 'HASH_IDENTIFIER' }], 1], ['BUYKOREA', 'demo_bk_member', 'manager_name', 'PERSON', 'display_name', [{ type: 'TRIM' }], 0],
  ['BUYKOREA', 'demo_bk_member', 'permission_granted_at', 'CONSENT_GRANT', 'granted_at', [{ type: 'DATE_PARSE' }], 1], ['BUYKOREA', 'demo_bk_member', 'permission_expires_at', 'CONSENT_GRANT', 'expires_at', [{ type: 'DATE_PARSE' }], 1],
];

function goldenDataset() {
  return { generated_at: U.iso(), seed: 20261109, note: '합성 예시 — 실제 KOTRA 운영 DB 구조가 아님. 기대값은 자동 테스트(test/di.test.js)가 검증한다.', cases: [
    { id: 'C01', title: '확실한 법인 매칭', records: ['CRM:demo_crm_customer:CRM-C0001', 'BUYKOREA:demo_bk_member:BK-M0001'], ExpectedMatch: { band: 'AUTO_LINK_CANDIDATE', min_score: 70, auto_merge: false }, ExpectedConsent: { both: 'VALID' }, ExpectedQualityIssue: [], ExpectedGoldenFields: { display_name: 'K-Beauty Labs', country_code: 'KR', hs_codes_after_merge_include: '8543.70' } },
    { id: 'C02', title: '후보만 발생(법인명 유사·국가 동일·연락처 다름)', records: ['CRM:demo_crm_customer:CRM-C0002', 'BUYKOREA:demo_bk_member:BK-M0002'], ExpectedMatch: { band: 'REVIEW_REQUIRED', max_score: 69, auto_merge: false }, ExpectedConsent: { both: 'VALID' }, ExpectedQualityIssue: ['DQ-C01 아님'], ExpectedGoldenFields: {} },
    { id: 'C03', title: '동일 이메일 다른 담당자(공유 메일)', records: ['CRM:demo_crm_customer:CRM-C0003', 'CRM:demo_crm_customer:CRM-C0004', 'BUYKOREA:demo_bk_member:BK-M0003'], ExpectedMatch: { band: 'DO_NOT_LINK', block: 'SHARED_EMAIL_ONLY|COUNTRY_MISMATCH_NO_VERIFIED_ID' }, ExpectedConsent: { all: 'VALID' }, ExpectedQualityIssue: [], ExpectedGoldenFields: { persons_remain_separate: true } },
    { id: 'C04', title: '동일 이름 다른 국가(동명이법인)', records: ['CRM:demo_crm_customer:CRM-C0005', 'BUYKOREA:demo_bk_member:BK-M0004'], ExpectedMatch: { band: 'DO_NOT_LINK', block: 'CONFLICTING_VERIFIED_ID' }, ExpectedConsent: { both: 'VALID' }, ExpectedQualityIssue: [], ExpectedGoldenFields: {} },
    { id: 'C05', title: '동의 철회', records: ['CRM:demo_crm_customer:CRM-C0006'], ExpectedMatch: { consent_blocked: true }, ExpectedConsent: { CRM: 'REVOKED' }, ExpectedQualityIssue: [], ExpectedGoldenFields: { master_created: false, served: false } },
    { id: 'C06', title: '기한 지난 동의', records: ['CRM:demo_crm_customer:CRM-C0007'], ExpectedMatch: {}, ExpectedConsent: { CRM: 'EXPIRED' }, ExpectedQualityIssue: ['동의 만료 → 통합 대상 제외'], ExpectedGoldenFields: { master_created: false } },
    { id: 'C07', title: '해외 바이어 연락처 결측/형식 오류', records: ['BUYKOREA:demo_bk_member:BK-M0006', 'BUYKOREA:demo_bk_member:BK-M0007'], ExpectedMatch: {}, ExpectedConsent: { BUYKOREA: 'VALID' }, ExpectedQualityIssue: ['DQ-C04', 'DQ-V02'], ExpectedGoldenFields: {} },
    { id: 'C08', title: '국가코드 불일치 KOR↔KR', records: ['CRM:demo_crm_customer:CRM-C0008', 'BUYKOREA:demo_bk_member:BK-M0008'], ExpectedMatch: { band: 'AUTO_LINK_CANDIDATE' }, ExpectedConsent: { both: 'VALID' }, ExpectedQualityIssue: ['DQ-V04 (KOR) → 정규화 제안 KR'], ExpectedGoldenFields: { country_code: 'KR' } },
    { id: 'C09', title: '신규 속성 발견(BK export_interest_category)', records: ['BUYKOREA:demo_bk_member'], ExpectedMatch: {}, ExpectedConsent: {}, ExpectedQualityIssue: [], ExpectedGoldenFields: { drift: 'NEW_COLUMN', requires_approval: true } },
    { id: 'C10', title: '삭제/정정 이벤트(CRM-C0009 정정 후 증분 반영)', records: ['CRM:demo_crm_customer:CRM-C0009'], ExpectedMatch: {}, ExpectedConsent: { CRM: 'VALID' }, ExpectedQualityIssue: [], ExpectedGoldenFields: { golden_version_increments: true, crosswalk_preserved: true } },
  ] };
}

function seedDi(ctxIn) {
  const ctx = ctxIn || { user: null, ip: 'seed' };
  q.exec('PRAGMA foreign_keys=OFF'); for (const t of DDL.DEMO_TABLES) q.exec(`DROP TABLE IF EXISTS ${t}`); q.exec(DDL.DEMO);
  const d = build(); ins('demo_crm_customer', d.crm); ins('demo_crm_participation', d.part); ins('demo_crm_voc', d.voc); ins('demo_bk_member', d.bk); ins('demo_bk_product', d.prod); ins('demo_bk_inquiry', d.inq);
  const SRC = [['CRM_DEMO', 'CRM Demo Connector', 'DB', 'DEMO_TABLES', 'SYNTHETIC', '고객관리 담당', 'SENSITIVE', 'HEALTHY', 1], ['BUYKOREA_DEMO', 'BuyKOREA Demo Connector', 'DB', 'DEMO_TABLES', 'SYNTHETIC', '바이어 플랫폼 담당', 'SENSITIVE', 'HEALTHY', 1], ['FILE_UPLOAD', 'CSV/JSON Upload', 'FILE', 'FILE_UPLOAD', 'SYNTHETIC', '데이터 담당', 'INTERNAL', 'READY', 1],
    ['CRM_LIVE', 'CRM (운영계)', 'DB', 'LIVE_GATEWAY', 'PLANNED', '고객관리 담당', 'CONFIDENTIAL', 'DISABLED', 0], ['BUYKOREA_LIVE', 'BuyKOREA (운영계)', 'DB', 'LIVE_GATEWAY', 'PLANNED', '바이어 플랫폼 담당', 'CONFIDENTIAL', 'DISABLED', 0], ['KOTRA_SSO_LIVE', 'KOTRA SSO (운영계)', 'API', 'LIVE_API', 'PLANNED', '정보보안 담당', 'CONFIDENTIAL', 'DISABLED', 0]];
  for (const [id, name, kind, ct, mode, owner, sc, status, en] of SRC) q.insert('di_source', { id, name, source_kind: kind, connector_type: ct, integration_mode: mode, owner, security_class: sc, status, capabilities: J(ct === 'LIVE_GATEWAY' || ct === 'LIVE_API' ? { schema_discovery: false, snapshot: false, incremental: false, cdc: false, writeback: false, note: '보안 심의·읽기 전용 계정·Gateway 승인 이전 비활성' } : S.capabilities({ connector_type: ct })), enabled: en, last_test_at: null, last_run_at: null, version: 1 });
  for (const [concept, std, en, type, len, nul, dom, sens, def] of STANDARDS) q.insert('di_standard', { id: `STD-${concept}`, concept, standard_name: std, english_name: en, data_type: type, length: len, nullable: nul, domain: dom, sensitivity: sens, definition: def, status: 'ACTIVE', version: '1.0.0' });
  for (const [k, v] of Object.entries(COUNTRY_LOOKUP)) q.run('INSERT OR REPLACE INTO di_codeset(code_set,version,source_value,standard_value) VALUES(?,?,?,?)', 'COUNTRY_ISO2', 'v1', k, v);
  MAPS.forEach(([sys, table, field, ent, tgt, rules, req], i) => q.insert('di_mapping', { id: `MAP-${String(i + 1).padStart(3, '0')}`, source_system: sys, source_table: table, source_field: field, target_entity: ent, target_field: tgt, rule_json: J(rules), mapping_version: 'v1', status: 'ACTIVE', precedence: 1, required: req, note: '시드 매핑(승인 완료)', updated_at: U.iso() }));
  DQ.seedRules();
  // 모델: CONCEPT / TOBE_MDM v1
  const mk = (scope, version, model, note) => q.insert('di_model', { id: `MDL-${scope}-${version}`, scope, version, status: 'ACTIVE', parent_id: null, schema_json: J(model), note, created_by: 'seed', created_at: U.iso(), released_at: U.iso() });
  mk('CONCEPT', '1.0.0', S.conceptModel(), '공통 개념 ERD(스펙 §4.3)'); mk('TOBE_MDM', '1.0.0', S.tobeModel(), 'CRM 기준 MDM 목표 모델 v1');
  // 최초 스키마 발견 → 전체 적재 → 품질
  for (const sid of ['CRM_DEMO', 'BUYKOREA_DEMO']) { const src = q.get('SELECT * FROM di_source WHERE id=?', sid); S.captureSnapshot(ctx, src, 'BASELINE'); q.run('UPDATE di_source SET last_test_at=? WHERE id=?', U.iso(), sid); }
  const run = PL.run(ctx, { source_id: 'ALL', mode: 'FULL' });
  return { crm: d.crm.length, bk: d.bk.length, participation: d.part.length, voc: d.voc.length, products: d.prod.length, inquiries: d.inq.length, run: run.id, run_status: run.status, parties: q.count('di_party'), candidates: q.count('di_candidate') };
}
module.exports = { seedDi, goldenDataset, build, MAPS };
