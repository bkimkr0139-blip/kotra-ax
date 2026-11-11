'use strict';
// Companies, users, buyers, events, consultations, research — deterministic synthetic demo data.
const { COUNTRIES, PRODUCTS } = require('./catalog');
const CBY = Object.fromEntries(COUNTRIES.map((c) => [c.code, c]));
const PBY = Object.fromEntries(PRODUCTS.map((p) => [p.key, p]));

function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const R = rng(20261109);
const pick = (arr) => arr[Math.floor(R() * arr.length)];
const pickN = (arr, n) => { const a = [...arr]; const o = []; while (o.length < n && a.length) o.push(a.splice(Math.floor(R() * a.length), 1)[0]); return o; };
const ri = (a, b) => a + Math.floor(R() * (b - a + 1));

// ---------- Companies ----------
// [id, ko, en, industry_ko, industry_en, keys[], product_ko, product_en, hs, size, employees, stage, experience, targets[], region, hashtags, desc_ko, desc_en]
const COMPANIES = [
  ['CMP-001', 'K-Beauty Labs', 'K-Beauty Labs', '화장품 제조', 'Cosmetics manufacturing', ['cosmetics'], '기능성 화장품(미백·주름개선 세럼)', 'Functional cosmetics (brightening / anti-wrinkle serums)', '3304.99', '소기업', 28, 'NOVICE', '없음', ['VN', 'US', 'JP'], '서울', ['K-Beauty', '기능성', '스킨케어'], '더마 기반 기능성 스킨케어를 개발하는 서울 소재 소기업. 해외 수출 경험이 없으며 6개월 내 첫 바이어 상담을 목표로 한다.', 'A Seoul-based small company developing derma-based functional skincare. No export experience yet; aims for a first buyer meeting within six months.'],
  ['CMP-002', 'Seoul Skin Co.', 'Seoul Skin Co.', '화장품 제조', 'Cosmetics manufacturing', ['cosmetics', 'haircare'], '스킨케어·헤어케어', 'Skincare and haircare', '3304.10', '중기업', 85, 'PROMISING', '3회 이상', ['JP', 'CN', 'TH'], '서울', ['스킨케어', '헤어케어'], '해외 3개국 거래 경험이 있는 중기업. 일본·중국 유통망 확대를 추진한다.', 'A mid-sized firm with trading experience in three countries, expanding distribution in Japan and China.'],
  ['CMP-003', 'HanFood Global', 'HanFood Global', '식품 제조', 'Food manufacturing', ['kimchi', 'ramen'], '김치·라면', 'Kimchi and instant noodles', '2005.99', '중기업', 120, 'PROMISING', '3회 이상', ['US', 'VN', 'JP'], '경기', ['김치', '라면', '발효식품'], '냉장 김치와 라면을 생산하며 북미·동남아 대형마트 입점을 확대 중이다.', 'Produces chilled kimchi and instant noodles; expanding to supermarkets in North America and Southeast Asia.'],
  ['CMP-004', 'MediCore Korea', 'MediCore Korea', '의료기기', 'Medical devices', ['medical_device', 'diagnostic'], '체외진단·의료기기', 'In-vitro diagnostics and medical devices', '9018.90', '중기업', 64, 'PROMISING', '1~2회', ['US', 'JP', 'AE'], '충북', ['의료기기', '진단'], '체외진단 키트와 소형 의료기기를 제조하며 해외 인허가 취득을 준비한다.', 'Makes diagnostic kits and compact devices, preparing overseas approvals.'],
  ['CMP-005', 'GreenCell Energy', 'GreenCell Energy', '2차전지 소재', 'Battery materials', ['ev_battery', 'nano_material'], '배터리 양극 소재', 'Battery cathode materials', '8507.60', '중견기업', 320, 'MIDCAP', '3회 이상', ['US', 'DE', 'PL'], '충남', ['배터리', '소재'], '2차전지 소재 중견기업으로 북미·유럽 현지 공급망 진입을 추진한다.', 'A mid-sized battery-materials company targeting North American and European supply chains.'],
  ['CMP-006', 'Pixel Games Studio', 'Pixel Games Studio', '게임 콘텐츠', 'Game content', ['game'], '모바일 게임', 'Mobile games', '4902.90', '소기업', 35, 'NOVICE', '1~2회', ['JP', 'US', 'SG'], '경기', ['게임', '콘텐츠'], '모바일 캐주얼 게임 스튜디오로 일본·북미 퍼블리싱 파트너를 찾는다.', 'A casual mobile game studio seeking publishing partners in Japan and North America.'],
  ['CMP-007', 'NanoTech Materials', 'NanoTech Materials', '신소재', 'Advanced materials', ['nano_material', 'semicon_equip'], '나노 코팅 소재', 'Nano coating materials', '3824.99', '중기업', 72, 'PROMISING', '1~2회', ['IN', 'MY', 'DE'], '대전', ['소부장', '나노'], '반도체·디스플레이용 나노 코팅 소재를 개발한다.', 'Develops nano-coating materials for semiconductors and displays.'],
  ['CMP-008', 'SmartHome Dynamics', 'SmartHome Dynamics', '스마트홈', 'Smart home', ['smart_home'], 'IoT 스마트 조명·센서', 'IoT smart lighting and sensors', '8517.62', '소기업', 22, 'READY', '없음', ['SG', 'AU', 'GB'], '서울', ['IoT', '스마트홈'], 'IoT 기반 스마트 조명 제품을 개발한 스타트업.', 'A startup that built IoT-based smart lighting products.'],
  ['CMP-009', 'Daon Fashion', 'Daon Fashion', '패션', 'Fashion', ['fashion', 'accessory'], '여성 의류·액세서리', 'Women\'s apparel and accessories', '6110.20', '소기업', 18, 'NOVICE', '1~2회', ['JP', 'FR', 'AE'], '서울', ['패션', '의류'], '온라인 중심 여성 패션 브랜드로 해외 편집숍 입점을 희망한다.', 'An online-first women\'s fashion brand seeking overseas boutique listings.'],
  ['CMP-010', 'BioHeal Pharma', 'BioHeal Pharma', '바이오·제약', 'Bio and pharma', ['pharma', 'supplement'], '건강기능식품·바이오', 'Health supplements and bio', '2106.90', '중기업', 95, 'PROMISING', '3회 이상', ['VN', 'SA', 'US'], '인천', ['건기식', '바이오'], '건강기능식품과 바이오 소재를 수출한다.', 'Exports health supplements and bio materials.'],
  ['CMP-011', 'EcoPack Solutions', 'EcoPack Solutions', '친환경 포장', 'Eco packaging', ['packaging'], '생분해 포장재', 'Biodegradable packaging', '3923.29', '소기업', 30, 'READY', '없음', ['DE', 'FR', 'VN'], '경남', ['친환경', '포장'], '생분해 필름 포장재를 개발한다.', 'Develops biodegradable film packaging.'],
  ['CMP-012', 'AgroTech Korea', 'AgroTech Korea', '농기계', 'Agricultural machinery', ['agri_machine', 'water'], '스마트 농기계', 'Smart agricultural machinery', '8432.80', '중기업', 110, 'PROMISING', '3회 이상', ['BR', 'IN', 'TR'], '전북', ['농기계'], '스마트 농기계와 관개 설비를 수출한다.', 'Exports smart farm machinery and irrigation equipment.'],
  ['CMP-013', 'FitPet Co.', 'FitPet Co.', '반려동물', 'Pet products', ['petfood'], '반려동물 기능성 사료', 'Functional pet food', '2309.90', '소기업', 26, 'NOVICE', '1~2회', ['JP', 'US', 'VN'], '경기', ['펫푸드'], '기능성 반려동물 사료 브랜드.', 'A functional pet-food brand.'],
  ['CMP-014', 'Hanbit Machinery', 'Hanbit Machinery', '산업기계', 'Industrial machinery', ['machinery', 'steel'], '정밀 산업기계', 'Precision industrial machinery', '8479.89', '중견기업', 410, 'MIDCAP', '3회 이상', ['MX', 'PL', 'TR'], '경북', ['기계'], '정밀 산업기계 중견기업.', 'A mid-sized precision machinery company.'],
  ['CMP-015', 'ABC Korea', 'ABC Korea Ltd.', '생활용품 유통', 'Consumer goods trading', ['kitchenware', 'lighting'], '주방용품·LED 조명', 'Kitchenware and LED lighting', '7323.93', '소기업', 15, 'READY', '없음', ['VN', 'TH'], '부산', ['주방', '조명'], '생활용품 유통 소기업.', 'A small consumer-goods trader.'],
];

// ---------- Users (30) ----------
const PERSONAS = {
  company: { email: 'beauty@kbeautylabs.example', ko: 'K-Beauty Labs 담당자 (수출기업)', en: 'K-Beauty Labs (exporter)' },
  buyer: { email: 'sales@vietbeauty.example', ko: 'VietBeauty Trading (해외 바이어)', en: 'VietBeauty Trading (overseas buyer)' },
  consultant: { email: 'consultant@kotra.example', ko: 'KOTRA 상담 전문위원', en: 'KOTRA consultation specialist' },
  office: { email: 'hanoi@kotra.example', ko: '하노이 무역관 담당자', en: 'Hanoi KBC officer' },
  admin: { email: 'admin@kotra.example', ko: '플랫폼 관리자', en: 'Platform administrator' },
};
const FIRST = ['민준', '서연', '지훈', '유진', '도윤', '하은', '시우', '지민', '예준', '수아'];
const LAST = ['김', '이', '박', '최', '정', '강', '조', '윤', '장', '임'];
const FIRST_EN = ['Minjun', 'Seoyeon', 'Jihoon', 'Yujin', 'Doyun', 'Haeun', 'Siwoo', 'Jimin', 'Yejun', 'Sua'];
const LAST_EN = ['Kim', 'Lee', 'Park', 'Choi', 'Jung', 'Kang', 'Cho', 'Yoon', 'Jang', 'Lim'];

function buildUsers() {
  const users = [];
  let n = 0;
  const id = () => 'U-' + String(++n).padStart(3, '0');
  COMPANIES.forEach((c, i) => {
    const email = i === 0 ? PERSONAS.company.email : `user${i + 1}@${c[2].toLowerCase().replace(/[^a-z0-9]+/g, '')}.example`;
    users.push({ id: id(), email, name: i === 0 ? '김지안' : `${LAST[i % 10]}${FIRST[(i * 3) % 10]}`, name_en: i === 0 ? 'Jian Kim' : `${LAST_EN[i % 10]} ${FIRST_EN[(i * 3) % 10]}`, role: 'customer', company_id: c[0], persona: i === 0 ? 'company' : null, title: '수출 담당' });
  });
  const buyerUsers = [['B-001', 'sales@vietbeauty.example', 'Nguyen Thi Lan', 'buyer'], ['B-002', 'buyer2@saigonglow.example', 'Tran Minh Quan', null], ['B-003', 'buyer3@hanoiskin.example', 'Le Thu Ha', null], ['B-011', 'buyer4@globalfoods.example', 'John Miller', null], ['B-020', 'buyer5@tokyoretail.example', 'Sato Aya', null]];
  buyerUsers.forEach(([bid, email, nm, persona]) => users.push({ id: id(), email, name: nm, name_en: nm, role: 'buyer', buyer_id: bid, persona, title: 'Buyer' }));
  [['consultant@kotra.example', '박서준', 'Seojun Park', 'consultant'], ['consultant2@kotra.example', '이하린', 'Harin Lee', null], ['consultant3@kotra.example', '정도현', 'Dohyun Jung', null]].forEach(([e, n1, n2, p]) => users.push({ id: id(), email: e, name: n1, name_en: n2, role: 'consultant', office: '수출상담센터', persona: p, title: '상담 전문위원' }));
  [['hanoi@kotra.example', '최민호', 'Minho Choi', '하노이 무역관', 'office'], ['la@kotra.example', '강수빈', 'Subin Kang', 'LA 무역관', null], ['tokyo@kotra.example', '윤태양', 'Taeyang Yoon', '도쿄 무역관', null], ['dubai@kotra.example', '임나래', 'Narae Lim', '두바이 무역관', null]].forEach(([e, n1, n2, off, p]) => users.push({ id: id(), email: e, name: n1, name_en: n2, role: 'office', office: off, persona: p, title: '무역관 담당' }));
  [['admin@kotra.example', '한지수', 'Jisu Han', 'admin'], ['ops@kotra.example', '오세훈', 'Sehun Oh', null], ['auditor@kotra.example', '문가영', 'Gayoung Moon', null]].forEach(([e, n1, n2, p]) => users.push({ id: id(), email: e, name: n1, name_en: n2, role: 'admin', office: 'AI전략팀', persona: p, title: '플랫폼 관리' }));
  return users;
}

// ---------- Buyers (60, synthetic) ----------
const HERO_BUYERS = [
  ['B-001', 'VietBeauty Trading', 'VN', 'Distributor', ['cosmetics', 'haircare'], ['Retail', 'Online'], 'medium', 91, 88, { moq: 'low', payment: ['T/T', 'L/C'], exclusive: true }, 'K-Beauty 스킨케어 전문 유통사. 베트남 전역 H&B 매장과 온라인 몰을 운영한다.', 'Skincare-focused K-beauty distributor operating H&B stores and online malls across Vietnam.'],
  ['B-002', 'Saigon Glow Distribution', 'VN', 'Distributor', ['cosmetics'], ['Retail', 'Online'], 'medium', 84, 76, { moq: 'low', payment: ['T/T'], exclusive: false }, '호치민 기반 뷰티 유통사로 신규 한국 브랜드 발굴에 적극적이다.', 'HCMC-based beauty distributor actively scouting new Korean brands.'],
  ['B-003', 'Hanoi Skin Lab Co.', 'VN', 'Retailer', ['cosmetics', 'beauty_device'], ['Retail'], 'small', 78, 70, { moq: 'low', payment: ['T/T', 'Advance'], exclusive: false }, '하노이의 스킨케어 편집숍 체인.', 'A Hanoi skincare boutique chain.'],
  ['B-004', 'Lotus Beauty Retail', 'VN', 'Retailer', ['cosmetics', 'haircare'], ['Retail', 'Department'], 'large', 88, 82, { moq: 'medium', payment: ['L/C', 'T/T'], exclusive: true }, '백화점과 대형 쇼핑몰에 입점한 프리미엄 뷰티 리테일러.', 'A premium beauty retailer in department stores and malls.'],
  ['B-005', 'Mekong Cosmetics Import', 'VN', 'Importer', ['cosmetics'], ['Wholesale'], 'medium', 72, 64, { moq: 'high', payment: ['L/C'], exclusive: false }, '메콩 지역 도매 중심 화장품 수입사.', 'Wholesale-focused cosmetics importer for the Mekong region.'],
  ['B-006', 'Pho Online Mall', 'VN', 'E-commerce', ['cosmetics', 'supplement'], ['Online'], 'medium', 75, 68, { moq: 'low', payment: ['T/T'], exclusive: false }, '이커머스 플랫폼 기반 뷰티·건강 상품 판매.', 'E-commerce seller of beauty and wellness products.'],
  ['B-007', 'Dalat Natural Care', 'VN', 'Distributor', ['haircare', 'cosmetics'], ['Retail'], 'small', 66, 58, { moq: 'low', payment: ['Advance', 'T/T'], exclusive: false }, '천연 성분 케어 제품 전문 유통사.', 'A distributor of natural-ingredient care products.'],
  ['B-008', 'Viet K-Food Mart', 'VN', 'Retailer', ['kimchi', 'ramen', 'snack'], ['Retail'], 'large', 83, 79, { moq: 'medium', payment: ['T/T'], exclusive: false }, '한국 식품 전문 슈퍼마켓 체인.', 'A Korean-food supermarket chain.'],
  ['B-009', 'Hanoi Med Supply', 'VN', 'Distributor', ['medical_device', 'diagnostic'], ['Hospital'], 'medium', 80, 72, { moq: 'medium', payment: ['L/C'], exclusive: true }, '병원 대상 의료기기 유통사.', 'A distributor of medical devices to hospitals.'],
  ['B-010', 'Da Nang Pet House', 'VN', 'Retailer', ['petfood'], ['Retail', 'Online'], 'small', 70, 60, { moq: 'low', payment: ['T/T'], exclusive: false }, '반려동물 용품 매장 체인.', 'A pet-supplies store chain.'],
];
const NAME_ADJ = ['Golden', 'Blue', 'Prime', 'Urban', 'Global', 'Bright', 'Pacific', 'Royal', 'Nova', 'Summit', 'Harbor', 'Evergreen', 'Silk', 'Atlas', 'Orchid'];
const NAME_NOUN = ['Trading', 'Imports', 'Distribution', 'Retail Group', 'Partners', 'Wholesale', 'Commerce', 'Supply', 'Brands', 'Market'];
const FOCUS = {
  beauty: ['cosmetics', 'haircare', 'beauty_device'], food: ['kimchi', 'ramen', 'snack', 'beverage', 'supplement'], health: ['medical_device', 'diagnostic', 'pharma', 'supplement'],
  tech: ['ev_battery', 'semicon_equip', 'display', 'machinery', 'solar', 'smart_home', 'nano_material'], lifestyle: ['fashion', 'accessory', 'petfood', 'kitchenware', 'lighting', 'packaging', 'toys', 'game'],
};
function buildBuyers() {
  const out = HERO_BUYERS.map((b, i) => ({ id: b[0], name: b[1], name_en: b[1], country: b[2], type: b[3], products: b[4], channels: b[5], size: b[6], trust: b[7], past_success: b[8], conditions: b[9], description: b[10], description_en: b[11], verified: 1 }));
  const countries = ['US', 'JP', 'ID', 'TH', 'SG', 'MY', 'PH', 'AE', 'SA', 'DE', 'FR', 'GB', 'AU', 'IN', 'MX', 'PL', 'TR', 'CN', 'BR'];
  const types = ['Distributor', 'Importer', 'Retailer', 'E-commerce', 'Wholesaler', 'Trading company'];
  const focusKeys = Object.keys(FOCUS);
  for (let i = out.length + 1; i <= 60; i++) {
    const cc = countries[(i * 7) % countries.length];
    const focus = focusKeys[(i * 3 + (i > 30 ? 1 : 0)) % focusKeys.length];
    const prods = pickN(FOCUS[focus], ri(1, 3));
    const trust = ri(58, 92);
    const name = `${pick(NAME_ADJ)} ${pick(NAME_NOUN)} ${CBY[cc].en.split(' ')[0].slice(0, 3).toUpperCase()}`;
    out.push({
      id: 'B-' + String(i).padStart(3, '0'), name, name_en: name, country: cc, type: pick(types), products: prods, channels: pickN(['Retail', 'Online', 'Wholesale', 'Department', 'Hospital'], ri(1, 2)), size: pick(['small', 'medium', 'large']),
      trust, past_success: ri(45, 95), conditions: { moq: pick(['low', 'medium', 'high']), payment: pickN(['T/T', 'L/C', 'Advance', 'D/P'], ri(1, 2)), exclusive: R() > 0.6 },
      description: `${CBY[cc].ko} 소재 ${focus === 'beauty' ? '뷰티' : focus === 'food' ? '식품' : focus === 'health' ? '헬스케어' : focus === 'tech' ? '산업·기술' : '라이프스타일'} 분야 ${pick(['유통사', '수입사', '리테일러'])}. 한국 공급사 탐색 중. (시연용 합성 데이터)`,
      description_en: `A ${focus} ${pick(['distributor', 'importer', 'retailer'])} based in ${CBY[cc].en}, looking for Korean suppliers. (synthetic demo data)`, verified: trust >= 75 ? 1 : 0,
    });
  }
  const CN = ['Anh', 'Mai', 'Linh', 'Hana', 'Yuki', 'Rina', 'Emma', 'Noah', 'Omar', 'Sara', 'Lukas', 'Maria'];
  out.forEach((b, i) => {
    b.contact_name = `${CN[i % CN.length]} ${['Nguyen', 'Tanaka', 'Smith', 'Chen', 'Garcia', 'Khan'][i % 6]}`;
    b.contact_email = `contact${i + 1}@${b.name_en.toLowerCase().replace(/[^a-z0-9]+/g, '')}.example`;
    b.contact_phone = `+${CBY[b.country].tz > 0 ? 8 : 1}${ri(10, 99)}-${ri(100, 999)}-${ri(1000, 9999)}`;
    b.hs_codes = b.products.map((k) => PBY[k].hs);
    b.hashtags = [CBY[b.country].ko, ...b.products.map((k) => PBY[k].ko)];
  });
  return out;
}

// ---------- Events (8) ----------
// [id, ko, en, type, country, city, venue, tz, startOffset, days, applyStart, applyEnd, groups, halls, status, desc_ko, desc_en]
const EVENTS = [
  ['EV-001', '2027 KOTRA Global Beauty Partnering', '2027 KOTRA Global Beauty Partnering', 'OFFLINE', 'KR', 'Seoul', 'COEX', 540, 138, 2, -8, 83, ['Skincare', 'Makeup', 'Hair/Body', 'Devices'], ['A Hall', 'B Hall'], 'RECRUITING', '해외 뷰티 바이어와 국내 기업이 30분 단위로 만나는 1:1 사전매칭 상담회.', '1:1 pre-matched 30-minute meetings between overseas beauty buyers and Korean companies.'],
  ['EV-002', '2027 K-Food Partnering', '2027 K-Food Partnering', 'OFFLINE', 'KR', 'Busan', 'BEXCO', 540, 120, 2, 10, 60, ['Fresh/Chilled', 'Processed', 'Beverage'], ['Hall 1'], 'UPCOMING', '식품 분야 해외 바이어 1:1 상담회.', '1:1 meetings with overseas food buyers.'],
  ['EV-003', 'Medical Korea Matching 2027', 'Medical Korea Matching 2027', 'OFFLINE', 'KR', 'Seoul', 'KINTEX', 540, 150, 3, 20, 90, ['Devices', 'Diagnostics', 'Digital Health'], ['Hall A', 'Hall B'], 'UPCOMING', '의료기기·헬스케어 글로벌 바이어 매칭.', 'Global buyer matching for medical devices and healthcare.'],
  ['EV-004', '일본 소비재 상담회 (도쿄)', 'Japan Consumer Goods Meeting (Tokyo)', 'OFFLINE', 'JP', 'Tokyo', 'Tokyo Big Sight', 540, 60, 2, -12, 6, ['Beauty', 'Food', 'Fashion'], ['Room 1'], 'RECRUITING', '일본 현지 개최 소비재 상담회.', 'Consumer goods meeting held in Japan.'],
  ['EV-005', '2027 EV & Battery Partnering', '2027 EV & Battery Partnering', 'OFFLINE', 'KR', 'Incheon', 'Songdo Convensia', 540, 175, 2, 30, 100, ['Materials', 'Cells', 'Equipment'], ['Hall 1'], 'UPCOMING', '전기차·배터리 소재 부품 상담회.', 'Meeting for EV and battery materials and parts.'],
  ['EV-006', '2026 KOTRA Global Sourcing Fair', '2026 KOTRA Global Sourcing Fair', 'OFFLINE', 'KR', 'Seoul', 'COEX', 540, -40, 2, -120, -60, ['Consumer', 'Industrial'], ['A Hall', 'B Hall'], 'COMPLETED', '2026년 개최된 글로벌 소싱 상담회 (종료).', 'Global sourcing meeting held in 2026 (completed).'],
  ['EV-007', '동남아·베트남 K-뷰티 온라인 상담회', 'Southeast Asia / Vietnam K-Beauty Online Meeting', 'ONLINE', 'VN', 'Online', 'KOTRA Video Platform', 420, 40, 2, -3, 17, ['Skincare', 'Makeup'], ['Room 1'], 'RECRUITING', '베트남·동남아 뷰티 바이어와의 화상 상담회.', 'Video meeting with Vietnamese and Southeast Asian beauty buyers.'],
  ['EV-008', '하노이 뷰티 엑스포 한국관', 'Hanoi Beauty Expo Korea Pavilion', 'OFFLINE', 'VN', 'Hanoi', 'ICE Hanoi', 420, 200, 3, 60, 130, ['Skincare', 'Makeup', 'Devices'], ['Hall 1'], 'UPCOMING', '하노이 뷰티 엑스포 한국관 참가 및 현장 상담.', 'Korea Pavilion at the Hanoi beauty expo with on-site meetings.'],
];

// ---------- Consultations ----------
const TOPICS = [
  ['인증·규제', '베트남 화장품 등록 절차 문의', 'Vietnam cosmetics registration inquiry', '베트남에 기능성 화장품을 수출하려는데 제품 등록 절차와 필요 서류가 궁금합니다.'],
  ['바이어', '바이어 발굴 지원 문의', 'Buyer discovery inquiry', '베트남 유통 바이어를 찾고 싶은데 지원사업 방법이 궁금합니다.'],
  ['지원사업', '수출바우처 자격 문의', 'Export voucher eligibility', '수출바우처 신청 자격과 한도를 알고 싶습니다.'],
  ['물류·통관', '샘플 발송 통관 문의', 'Sample shipment customs inquiry', '해외 바이어에게 샘플을 보낼 때 필요한 서류가 무엇인가요?'],
  ['계약·결제', '결제조건 협상 문의', 'Payment terms negotiation', '신규 바이어가 후불 결제를 요구합니다. 위험을 줄이는 방법이 있을까요?'],
  ['전시·상담회', '상담회 참가 절차 문의', 'Meeting event participation', '글로벌 파트너링 상담회 참가 절차와 비용이 궁금합니다.'],
  ['시장정보', '일본 시장 진출 전략 문의', 'Japan market entry inquiry', '일본 시장 진출 시 유통 구조와 인허가를 알려주세요.'],
  ['무역사기', '의심스러운 바이어 확인', 'Suspicious buyer check', '낯선 해외 바이어가 선결제를 요구하는데 사기 여부를 확인하고 싶습니다.'],
];

// ---------- Research (20) ----------
const RESEARCH = [
  ['GMR', '2027 1분기 글로벌 마켓 리포트: 동남아 K-뷰티', 'Q1 2027 Global Market Report: SE Asia K-beauty', 'VN', '하노이', 'DRAFT'],
  ['GIM', '미국 MoCRA 시행 영향 모니터링', 'Monitoring the impact of US MoCRA', 'US', 'LA', 'DRAFT'],
  ['DIRECTED', '베트남 H&B 유통채널 현황 조사', 'Vietnam H&B channel survey', 'VN', '호치민', 'APPROVAL_REQUESTED'],
  ['DIRECTED', '일본 기능성 화장품 광고규제 조사', 'Japan functional-cosmetics advertising rules survey', 'JP', '도쿄', 'APPROVAL_REQUESTED'],
  ['DIRECTED', 'UAE 할랄 화장품 인증 현황', 'UAE halal cosmetics certification status', 'AE', '두바이', 'ASSIGNED'],
  ['GMR', '인도 소비재 시장 전망', 'India consumer goods outlook', 'IN', '뉴델리', 'ASSIGNED'],
  ['DIRECTED', '베트남 화장품 수입 통관 소요일 조사', 'Vietnam cosmetics customs clearance lead-time survey', 'VN', '하노이', 'IN_PROGRESS'],
  ['GIM', '태국 이커머스 규제 동향', 'Thailand e-commerce regulation trends', 'TH', '방콕', 'IN_PROGRESS'],
  ['DIRECTED', '미국 K-푸드 대형마트 입점 조건', 'US supermarket listing terms for K-food', 'US', 'LA', 'IN_PROGRESS'],
  ['DIRECTED', '독일 배터리 소재 조달 요건', 'Germany battery materials sourcing requirements', 'DE', '프랑크푸르트', 'IN_PROGRESS'],
  ['DIRECTED', '베트남 라이브커머스 플랫폼 수수료 구조', 'Vietnam live-commerce platform fee structure', 'VN', '호치민', 'SUBMITTED'],
  ['GMR', '일본 소비재 유통 구조 변화', 'Changes in Japan consumer goods distribution', 'JP', '도쿄', 'SUBMITTED'],
  ['DIRECTED', '말레이시아 화장품 등록 절차', 'Malaysia cosmetics registration procedure', 'MY', '쿠알라룸푸르', 'SUBMITTED'],
  ['DIRECTED', '사우디 의료기기 등록 요건', 'Saudi medical device registration requirements', 'SA', '리야드', 'REVISION_REQUESTED'],
  ['GIM', '폴란드 EV 부품 공급망 동향', 'Poland EV parts supply-chain trends', 'PL', '바르샤바', 'REVISION_REQUESTED'],
  ['DIRECTED', '베트남 화장품 소비자 선호 성분', 'Vietnam consumer preferred cosmetic ingredients', 'VN', '하노이', 'COMPLETED'],
  ['GMR', '2026 4분기 글로벌 마켓 리포트: 일본 뷰티', 'Q4 2026 Global Market Report: Japan beauty', 'JP', '도쿄', 'COMPLETED'],
  ['DIRECTED', '미국 화장품 FDA 시설등록 사례', 'US cosmetics FDA facility registration cases', 'US', 'LA', 'COMPLETED'],
  ['DIRECTED', '인도네시아 할랄 인증 소요기간', 'Indonesia halal certification lead time', 'ID', '자카르타', 'EVALUATED'],
  ['GMR', '2026 3분기 글로벌 마켓 리포트: 중동 소비재', 'Q3 2026 Global Market Report: Middle East consumer goods', 'AE', '두바이', 'EVALUATED'],
];

module.exports = { rng, R, pick, pickN, ri, COMPANIES, PERSONAS, buildUsers, buildBuyers, EVENTS, TOPICS, RESEARCH, CBY, PBY };
