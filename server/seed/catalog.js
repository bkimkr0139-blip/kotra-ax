'use strict';
// Shared static catalog: used by seed generation AND NLP entity extraction (single source of truth).
// Indicators are rounded, illustrative DEMO values (is_synthetic=1) — not official statistics.

// code, ko, en, region_ko, region_en, pop(M), gdp($B), growth(%), office_ko, office_en, tz(min), aliases
const COUNTRIES = [
  ['VN', '베트남', 'Vietnam', '동남아', 'Southeast Asia', 100, 430, 6.0, '하노이·호치민 무역관', 'Hanoi / Ho Chi Minh KBC', 420, ['vietnam', 'viet nam', '하노이', '호치민', 'hanoi', 'saigon']],
  ['US', '미국', 'United States', '북미', 'North America', 335, 28000, 2.5, '뉴욕·LA 무역관', 'New York / Los Angeles KBC', -300, ['usa', 'america', 'united states', 'u.s.', '미합중국', 'fda', 'mocra']],
  ['JP', '일본', 'Japan', '동북아', 'Northeast Asia', 124, 4200, 1.0, '도쿄·오사카 무역관', 'Tokyo / Osaka KBC', 540, ['japan', '도쿄', 'tokyo', '오사카']],
  ['CN', '중국', 'China', '동북아', 'Northeast Asia', 1410, 18000, 4.8, '베이징·상하이 무역관', 'Beijing / Shanghai KBC', 480, ['china', '베이징', '상하이', 'shanghai']],
  ['ID', '인도네시아', 'Indonesia', '동남아', 'Southeast Asia', 278, 1400, 5.0, '자카르타 무역관', 'Jakarta KBC', 420, ['indonesia', '자카르타', 'jakarta']],
  ['TH', '태국', 'Thailand', '동남아', 'Southeast Asia', 71, 510, 2.5, '방콕 무역관', 'Bangkok KBC', 420, ['thailand', '방콕', 'bangkok']],
  ['SG', '싱가포르', 'Singapore', '동남아', 'Southeast Asia', 6, 500, 3.0, '싱가포르 무역관', 'Singapore KBC', 480, ['singapore']],
  ['MY', '말레이시아', 'Malaysia', '동남아', 'Southeast Asia', 34, 400, 4.5, '쿠알라룸푸르 무역관', 'Kuala Lumpur KBC', 480, ['malaysia', '쿠알라룸푸르']],
  ['PH', '필리핀', 'Philippines', '동남아', 'Southeast Asia', 115, 430, 5.5, '마닐라 무역관', 'Manila KBC', 480, ['philippines', '마닐라', 'manila']],
  ['IN', '인도', 'India', '서남아', 'South Asia', 1430, 3500, 6.5, '뉴델리 무역관', 'New Delhi KBC', 330, ['india', '뉴델리']],
  ['AE', 'UAE', 'United Arab Emirates', '중동', 'Middle East', 10, 510, 4.0, '두바이 무역관', 'Dubai KBC', 240, ['uae', '아랍에미리트', '두바이', 'dubai', 'emirates']],
  ['SA', '사우디아라비아', 'Saudi Arabia', '중동', 'Middle East', 36, 1100, 2.0, '리야드 무역관', 'Riyadh KBC', 180, ['saudi', '사우디', '리야드', 'riyadh']],
  ['DE', '독일', 'Germany', '유럽', 'Europe', 84, 4500, 0.3, '프랑크푸르트 무역관', 'Frankfurt KBC', 60, ['germany', '프랑크푸르트', 'frankfurt']],
  ['FR', '프랑스', 'France', '유럽', 'Europe', 68, 3100, 0.8, '파리 무역관', 'Paris KBC', 60, ['france', '파리', 'paris']],
  ['GB', '영국', 'United Kingdom', '유럽', 'Europe', 68, 3300, 1.0, '런던 무역관', 'London KBC', 0, ['uk', 'britain', 'england', '런던', 'london']],
  ['MX', '멕시코', 'Mexico', '중남미', 'Latin America', 129, 1800, 2.5, '멕시코시티 무역관', 'Mexico City KBC', -360, ['mexico', '멕시코시티']],
  ['BR', '브라질', 'Brazil', '중남미', 'Latin America', 216, 2200, 2.5, '상파울루 무역관', 'São Paulo KBC', -180, ['brazil', '상파울루', 'sao paulo']],
  ['AU', '호주', 'Australia', '대양주', 'Oceania', 27, 1700, 2.0, '시드니 무역관', 'Sydney KBC', 600, ['australia', '시드니', 'sydney']],
  ['PL', '폴란드', 'Poland', '유럽', 'Europe', 37, 810, 3.0, '바르샤바 무역관', 'Warsaw KBC', 60, ['poland', '바르샤바', 'warsaw']],
  ['TR', '튀르키예', 'Türkiye', '중동', 'Middle East', 85, 1100, 3.5, '이스탄불 무역관', 'Istanbul KBC', 180, ['turkey', 'turkiye', '터키', '이스탄불', 'istanbul']],
].map(([code, ko, en, rk, re, pop, gdp, gr, ok, oe, tz, al]) => ({ code, ko, en, region_ko: rk, region_en: re, pop, gdp, growth: gr, office_ko: ok, office_en: oe, tz, aliases: al }));

// key, ko, en, hs(prefix), category_ko, category_en, keywords(ko/en)
const PRODUCTS = [
  ['cosmetics', '기능성 화장품', 'Functional cosmetics', '3304', '뷰티', 'Beauty', ['화장품', '기능성화장품', '스킨케어', '코스메틱', 'cosmetic', 'cosmetics', 'skincare', 'k-beauty', 'kbeauty', '뷰티', 'beauty', '미백', '주름개선']],
  ['haircare', '헤어·바디케어', 'Hair & body care', '3305', '뷰티', 'Beauty', ['헤어케어', '샴푸', '바디케어', 'haircare', 'shampoo', 'body care']],
  ['beauty_device', '뷰티 디바이스', 'Beauty devices', '8543', '뷰티', 'Beauty', ['뷰티디바이스', '미용기기', 'beauty device', 'led mask']],
  ['kimchi', '김치·발효식품', 'Kimchi & fermented food', '2005', '식품', 'Food', ['김치', '발효식품', 'kimchi', 'fermented', '식품', 'food']],
  ['ramen', '라면·면류', 'Instant noodles', '1902', '식품', 'Food', ['라면', '면류', 'ramen', 'noodle', 'noodles']],
  ['snack', '과자·스낵', 'Snacks & confectionery', '1905', '식품', 'Food', ['과자', '스낵', 'snack', 'confectionery', '제과']],
  ['beverage', '음료', 'Beverages', '2202', '식품', 'Food', ['음료', '음료수', 'beverage', 'drink']],
  ['supplement', '건강기능식품', 'Health supplements', '2106', '식품', 'Food', ['건강기능식품', '건기식', 'supplement', 'health functional', '영양제']],
  ['petfood', '반려동물 사료·용품', 'Pet food & supplies', '2309', '생활', 'Lifestyle', ['반려동물', '펫푸드', '사료', 'pet food', 'petfood', 'pet']],
  ['medical_device', '의료기기', 'Medical devices', '9018', '바이오·헬스', 'Bio & Health', ['의료기기', '의료장비', 'medical device', 'medical devices']],
  ['pharma', '의약품·바이오', 'Pharma & bio', '3004', '바이오·헬스', 'Bio & Health', ['의약품', '바이오', '제약', 'pharma', 'pharmaceutical', 'biotech']],
  ['diagnostic', '진단키트', 'Diagnostic kits', '3822', '바이오·헬스', 'Bio & Health', ['진단키트', '진단', 'diagnostic', 'test kit']],
  ['ev_battery', '2차전지·배터리 소재', 'EV battery & materials', '8507', '모빌리티·에너지', 'Mobility & Energy', ['배터리', '2차전지', '이차전지', 'battery', 'ev battery', 'cathode', '양극재']],
  ['auto_parts', '자동차 부품', 'Auto parts', '8708', '모빌리티·에너지', 'Mobility & Energy', ['자동차부품', '자동차 부품', 'auto parts', 'automotive']],
  ['ebike', '전기자전거·모빌리티', 'E-bikes & micro-mobility', '8711', '모빌리티·에너지', 'Mobility & Energy', ['전기자전거', '이모빌리티', 'e-bike', 'ebike', 'scooter']],
  ['solar', '태양광 모듈·부품', 'Solar modules', '8541', '모빌리티·에너지', 'Mobility & Energy', ['태양광', 'solar', 'pv module']],
  ['semicon_equip', '반도체 장비·소재', 'Semiconductor equipment', '8486', '소부장', 'Materials/Parts/Equipment', ['반도체', '반도체장비', 'semiconductor', 'wafer']],
  ['display', '디스플레이 부품', 'Display components', '8524', '소부장', 'Materials/Parts/Equipment', ['디스플레이', 'display', 'oled']],
  ['machinery', '산업기계', 'Industrial machinery', '8479', '소부장', 'Materials/Parts/Equipment', ['산업기계', '기계', 'machinery', 'machine tool']],
  ['agri_machine', '농기계', 'Agricultural machinery', '8432', '소부장', 'Materials/Parts/Equipment', ['농기계', 'agricultural machinery', 'tractor']],
  ['water', '수처리 설비', 'Water treatment', '8421', '소부장', 'Materials/Parts/Equipment', ['수처리', '정수', 'water treatment', 'filtration']],
  ['nano_material', '신소재·화학소재', 'Advanced materials', '3824', '소부장', 'Materials/Parts/Equipment', ['신소재', '화학소재', '나노', 'nano', 'advanced material', 'chemical']],
  ['packaging', '친환경 포장재', 'Eco packaging', '3923', '생활', 'Lifestyle', ['포장재', '친환경포장', 'packaging', 'eco packaging']],
  ['fashion', '의류·패션', 'Apparel & fashion', '6110', '패션', 'Fashion', ['의류', '패션', 'apparel', 'fashion', 'clothing']],
  ['footwear', '신발', 'Footwear', '6403', '패션', 'Fashion', ['신발', 'footwear', 'shoes']],
  ['accessory', '패션 액세서리', 'Fashion accessories', '7117', '패션', 'Fashion', ['액세서리', 'accessory', 'accessories', 'jewelry']],
  ['toys', '완구·캐릭터', 'Toys & characters', '9503', '콘텐츠', 'Content', ['완구', '캐릭터', 'toys', 'toy', 'character']],
  ['game', '게임·콘텐츠', 'Games & content', '4902', '콘텐츠', 'Content', ['게임', '콘텐츠', 'game', 'games', 'content', 'webtoon', '웹툰']],
  ['smart_home', '스마트홈·IoT', 'Smart home & IoT', '8517', '디지털', 'Digital', ['스마트홈', 'iot', 'smart home', '사물인터넷']],
  ['lighting', 'LED 조명', 'LED lighting', '9405', '생활', 'Lifestyle', ['led', '조명', 'lighting']],
  ['kitchenware', '주방용품', 'Kitchenware', '7323', '생활', 'Lifestyle', ['주방용품', 'kitchenware', 'cookware']],
  ['steel', '철강·알루미늄 제품', 'Steel & aluminium products', '7208', '소부장', 'Materials/Parts/Equipment', ['철강', '알루미늄', 'steel', 'aluminium', 'aluminum']],
].map(([key, ko, en, hs, cat_ko, cat_en, kw]) => ({ key, ko, en, hs, cat_ko, cat_en, keywords: kw }));

// Concept groups: cross-lingual / paraphrase expansion used by the local semantic scorer and query rewrite.
const CONCEPTS = [
  ['cosmetics', ['화장품', '기능성화장품', '스킨케어', '코스메틱', 'cosmetic', 'cosmetics', 'skincare', 'k-beauty', 'kbeauty', '뷰티', 'beauty', '미용']],
  ['vietnam', ['베트남', 'vietnam', '하노이', '호치민', 'hanoi', 'vn', 'saigon']],
  ['usa', ['미국', 'usa', 'america', 'fda', 'mocra', 'united']],
  ['japan', ['일본', 'japan', '도쿄', 'tokyo', 'pmda', 'pmd']],
  ['regulation', ['규제', 'regulation', 'regulatory', '인증', 'certification', '등록', 'registration', 'notification', '공고', '신고', '요건', 'requirement', 'requirements', '허가', 'permit', 'compliance', '필수서류', '라벨', 'label', 'labeling']],
  ['buyer', ['바이어', 'buyer', 'buyers', 'distributor', 'importer', '유통', '유통업체', '수입상', '수입업체', '파트너', 'partner']],
  ['program', ['지원사업', '지원', 'program', 'support', 'subsidy', 'grant', '바우처', 'voucher', '보조', '사업신청']],
  ['exhibition', ['전시회', 'exhibition', 'expo', 'trade show', 'fair', '상담회', 'partnering', '박람회', '행사', 'event', 'meeting']],
  ['tariff', ['관세', 'tariff', 'duty', 'duties', 'fta', '원산지', 'origin', 'c/o']],
  ['logistics', ['물류', 'logistics', 'shipping', 'freight', '운송', '선적', 'shipment', '통관', 'customs', 'clearance', '배송']],
  ['contract', ['계약', 'contract', 'agreement', 'incoterms', '인코텀즈', '결제', 'payment', '조항', 'clause', '신용장', 'l/c', 't/t']],
  ['invest', ['투자', 'invest', 'investment', 'fdi', '외국인투자', '인센티브', 'incentive', '입지', 'location', 'greenfield', '그린필드']],
  ['market', ['시장', 'market', '수요', 'demand', '트렌드', 'trend', '동향', '시장성', '유망', 'potential', '성장']],
  ['ecommerce', ['이커머스', 'e-commerce', 'ecommerce', '온라인', 'online', '쇼피', 'shopee', 'lazada', '라자다', 'tiktok', '플랫폼', 'platform']],
  ['consult', ['상담', 'consult', 'consultation', '전문가', 'expert', '애로', '문의', 'helpdesk', 'inquiry']],
  ['sample', ['샘플', 'sample', 'samples', 'moq', '최소주문']],
  ['small', ['초보', 'beginner', 'novice', '중소기업', 'sme', 'first-time', '처음']],
];

const STOP_EN = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'for', 'in', 'on', 'at', 'is', 'are', 'was', 'be', 'with', 'by', 'as', 'it', 'its', 'this', 'that', 'from', 'can', 'i', 'we', 'you', 'me', 'my', 'do', 'does', 'how', 'what', 'which', 'about', 'should', 'need', 'want', 'please', 'tell', 'give', 'show', 'would', 'could', 'have', 'has', 'will', 'also', 'into', 'than', 'then', 'our', 'your']);
const STOP_KO = new Set(['그리고', '또는', '대해', '대한', '관련', '있는', '있나요', '하나요', '무엇', '어떻게', '알려줘', '알려주세요', '해주세요', '한번', '한꺼번에', '통해', '위한', '위해', '무엇이', '무엇이고', '뭐야', '뭔가요', '어떤', '수', '것', '등', '및', '좀', '더', '제가', '우리', '저희', '합니다', '입니다', '무엇부터', '어떤', '어디', '뭐']);

module.exports = { COUNTRIES, PRODUCTS, CONCEPTS, STOP_EN, STOP_KO };
