'use strict';
// Market insights + regulations. Hand-written "hero" entries cover the flagship scenario (K-Beauty → Vietnam/US/Japan);
// the rest are generated from structured country/product facts. Everything is marked is_synthetic=1 (demo summary — verify against original sources).
const { COUNTRIES, PRODUCTS } = require('./catalog');
const C = Object.fromEntries(COUNTRIES.map((c) => [c.code, c]));
const P = Object.fromEntries(PRODUCTS.map((p) => [p.key, p]));
const KOTRA = 'https://www.kotra.or.kr/index.do';

// [id, type, country, industry, title_ko, title_en, body_ko, body_en, source_name, source_url, dateOffsetDays, tags]
const HERO_MARKET = [
  ['MC-001', 'strategy', 'VN', 'cosmetics', '베트남 화장품 시장 진출전략 요약', 'Vietnam cosmetics market entry strategy — summary',
    '베트남 화장품 시장은 젊은 인구와 중산층 확대에 힘입어 스킨케어 중심으로 성장하고 있다. 한국산 제품은 품질 대비 합리적 가격과 K-뷰티 이미지로 선호도가 높다. 진출 초기에는 현지 유통업체(디스트리뷰터)를 통한 소량 시범 판매와 온라인 채널 병행이 효과적이다. 제품 공고(notification)와 베트남어 라벨 등 규제 요건을 먼저 확인해야 하며, 한-베트남 FTA 활용 시 관세 혜택을 검토할 수 있다. 초기 6개월 목표는 규제 확인, 후보 바이어 5~8곳 접촉, 샘플 발송 및 첫 상담 성사로 설정하는 것을 권장한다.',
    'Vietnam\'s cosmetics market is growing, led by skincare, supported by a young population and an expanding middle class. Korean products are valued for quality relative to price and the K-beauty image. In the early stage, small pilot sales through a local distributor combined with online channels are effective. Check regulatory requirements first, including product notification and Vietnamese-language labels, and review tariff benefits under the Korea–Vietnam FTA. A practical six-month target is: confirm regulations, contact 5–8 candidate buyers, ship samples and secure a first meeting.',
    'KOTRA 하노이·호치민 무역관(시연 요약)', KOTRA + '#vn-cosmetics-strategy', -40, ['베트남', '화장품', '진출전략']],
  ['MC-002', 'news', 'VN', 'cosmetics', '베트남 뷰티 이커머스 비중 확대, 라이브커머스가 판매 견인', 'Vietnam beauty e-commerce gains share as live commerce drives sales',
    '베트남에서 뷰티 제품의 온라인 구매 비중이 꾸준히 늘고 있다. Shopee, Lazada, TikTok Shop 등 플랫폼의 라이브커머스가 신규 브랜드 인지도 확보의 주요 통로로 활용된다. 다만 플랫폼 입점 전에 현지 제품 공고와 라벨 요건을 충족해야 하며, 가짜 상품 단속 강화로 정식 유통 증빙이 중요해지고 있다.',
    'The online share of beauty purchases in Vietnam keeps rising. Live commerce on platforms such as Shopee, Lazada and TikTok Shop has become a main route to brand awareness for new entrants. Before listing, sellers must satisfy local product notification and labelling rules, and proof of authorised distribution matters more as counterfeit enforcement tightens.',
    'KOTRA 호치민 무역관(시연 요약)', KOTRA + '#vn-beauty-ecommerce', -12, ['베트남', '이커머스', '라이브커머스']],
  ['MC-003', 'report', 'VN', 'cosmetics', '베트남 소비자 스킨케어 구매행태 분석', 'Vietnam consumer skincare purchasing behaviour',
    '베트남 20~30대 소비자는 성분과 기능(미백·보습·자외선 차단)을 비교하고 SNS 리뷰를 구매 결정에 크게 반영한다. 고온다습한 기후로 가벼운 질감과 자외선 차단 기능에 대한 수요가 높다. 가격대는 중저가 대중 프리미엄 구간이 가장 넓으며, 샘플·미니어처 제공이 구매 전환에 효과적이다.',
    'Vietnamese consumers in their 20s and 30s compare ingredients and benefits (brightening, hydration, sun protection) and weigh social-media reviews heavily. The hot, humid climate raises demand for light textures and UV protection. The mass-premium price band is widest, and samples or minis help conversion.',
    'KOTRA 하노이 무역관(시연 요약)', KOTRA + '#vn-skincare-behaviour', -75, ['베트남', '소비자', '스킨케어']],
  ['MC-004', 'trend', 'VN', 'cosmetics', 'K-뷰티 베트남 유통채널 비교: 드럭스토어·백화점·온라인', 'K-beauty distribution channels in Vietnam: drugstores, department stores, online',
    '드럭스토어와 H&B 매장은 접근성이 높아 중소 브랜드의 초기 진입에 유리하다. 백화점은 프리미엄 포지셔닝에 적합하지만 입점 조건이 까다롭다. 온라인은 마케팅 비용 대비 도달 범위가 넓으나 가격 경쟁이 심하다. 유통업체를 통한 복합 채널(Retail + Online) 전략이 가장 널리 활용된다.',
    'Drugstores and health & beauty stores offer accessibility and suit early entry for small brands. Department stores fit premium positioning but have strict listing conditions. Online reaches wide audiences at modest marketing cost, though price competition is intense. A combined Retail + Online approach through a distributor is the most common.',
    'KOTRA 호치민 무역관(시연 요약)', KOTRA + '#vn-channels', -25, ['베트남', '유통채널']],
  ['MC-005', 'strategy', 'US', 'cosmetics', '미국 K-뷰티 시장 진입전략 요약', 'US market entry for K-beauty — summary',
    '미국은 세계 최대 규모의 화장품 소비시장으로 K-뷰티 인지도가 높고 Amazon, Sephora, Ulta 등 다양한 채널이 있다. 화장품 규제현대화법(MoCRA) 시행으로 시설 등록, 제품 목록 제출, 안전성 입증 및 유해사례 보고 체계가 요구되므로 사전 준비가 필요하다. 자외선 차단제 등 일부 기능성 제품은 OTC 의약품 규정이 적용될 수 있다.',
    'The US is the world\'s largest cosmetics consumer market with strong K-beauty awareness and varied channels such as Amazon, Sephora and Ulta. Under the Modernization of Cosmetics Regulation Act (MoCRA), facility registration, product listing, safety substantiation and adverse-event reporting must be prepared in advance. Some functional products such as sunscreens may fall under OTC drug rules.',
    'KOTRA 뉴욕·LA 무역관(시연 요약)', KOTRA + '#us-kbeauty', -50, ['미국', '화장품', 'MoCRA']],
  ['MC-006', 'news', 'US', 'cosmetics', '미국 MoCRA 시행에 따른 화장품 수출기업 체크포인트', 'MoCRA checkpoints for cosmetics exporters to the US',
    'MoCRA는 화장품 제조·가공 시설 등록과 제품 목록 제출, 책임자(Responsible Person) 지정, 표시사항 정비를 요구한다. 수출기업은 미국 내 유해사례 접수 연락처를 라벨에 표기하고 안전성 입증 자료를 보관해야 한다. 미국 바이어는 이러한 준수 여부를 거래 전 확인하는 경우가 많다.',
    'MoCRA requires facility registration, product listing, designation of a Responsible Person and updated labelling. Exporters should print a US adverse-event contact on the label and retain safety substantiation records. US buyers often verify this compliance before trading.',
    'KOTRA LA 무역관(시연 요약)', 'https://www.fda.gov/cosmetics', -20, ['미국', '규제', 'MoCRA']],
  ['MC-007', 'strategy', 'JP', 'cosmetics', '일본 화장품 시장 진출전략 요약', 'Japan cosmetics market entry strategy — summary',
    '일본은 품질과 안전에 대한 요구가 높은 성숙 시장이며 K-뷰티는 젊은 층을 중심으로 재조명되고 있다. 수입 화장품은 화장품제조판매업 허가를 가진 업체를 통해 유통해야 하며, 미백·주름개선 등 효능 표방 제품은 의약부외품 승인이 필요할 수 있다. Amazon Japan, Qoo10, @cosme 등 온라인 채널과 드럭스토어 유통 병행이 일반적이다.',
    'Japan is a mature market with high quality and safety expectations, and K-beauty is regaining attention among younger consumers. Imported cosmetics must be distributed through a company holding a cosmetics marketing authorisation, and products claiming effects such as brightening or wrinkle improvement may require quasi-drug approval. Online channels such as Amazon Japan, Qoo10 and @cosme are combined with drugstore distribution.',
    'KOTRA 도쿄 무역관(시연 요약)', KOTRA + '#jp-cosmetics', -60, ['일본', '화장품']],
  ['MC-008', 'trend', 'ID', 'cosmetics', '인도네시아 할랄 인증 화장품 수요 확대', 'Rising demand for halal-certified cosmetics in Indonesia',
    '인도네시아는 세계 최대 무슬림 인구를 보유해 할랄 인증 화장품 수요가 커지고 있다. 할랄 제품 보증 제도가 단계적으로 의무화되고 있으므로 수출 전 대상 품목과 일정을 확인해야 한다. 인증 획득에는 원료와 제조공정 검토가 필요하여 준비 기간을 충분히 두는 것이 좋다.',
    'Indonesia has the world\'s largest Muslim population and demand for halal-certified cosmetics is rising. The halal product assurance regime is being made mandatory in phases, so exporters should confirm covered items and timelines. Certification requires reviewing ingredients and manufacturing processes, so allow ample preparation time.',
    'KOTRA 자카르타 무역관(시연 요약)', KOTRA + '#id-halal', -33, ['인도네시아', '할랄', '화장품']],
  ['MC-009', 'news', 'SG', 'cosmetics', '싱가포르, 동남아 뷰티 유통 허브로 부상', 'Singapore emerges as a beauty distribution hub for Southeast Asia',
    '싱가포르는 높은 구매력과 투명한 규제 환경을 바탕으로 동남아 진출의 테스트 베드 및 지역 본부 역할을 한다. ASEAN 화장품 지침 체계를 따르는 제품 신고 제도가 운영되어 다른 아세안 국가 진출의 준비 단계로 활용할 수 있다.',
    'Backed by strong purchasing power and a transparent regulatory environment, Singapore serves as a test bed and regional base for Southeast Asia. Its product notification regime follows the ASEAN cosmetics directive framework and can be used as preparation for other ASEAN markets.',
    'KOTRA 싱가포르 무역관(시연 요약)', KOTRA + '#sg-hub', -18, ['싱가포르', '허브']],
  ['MC-010', 'trend', 'AE', 'cosmetics', 'UAE 뷰티 시장: 프리미엄과 이커머스 동반 성장', 'UAE beauty market: premium and e-commerce growing together',
    'UAE는 관광·재수출 허브로서 프리미엄 뷰티 수요가 견조하며 현지 이커머스 플랫폼이 빠르게 성장하고 있다. 할랄 표기 여부와 아랍어 라벨이 구매 결정에 영향을 줄 수 있어 제품 표시 준비가 필요하다.',
    'As a tourism and re-export hub, the UAE sustains premium beauty demand while local e-commerce platforms grow quickly. Halal indication and Arabic labels can influence purchases, so labelling should be prepared.',
    'KOTRA 두바이 무역관(시연 요약)', KOTRA + '#ae-beauty', -29, ['UAE', '이커머스']],
  ['MC-011', 'news', 'VN', 'kimchi', '베트남 한국 식품 편의점·대형마트 입점 확대', 'Korean food listings expand in Vietnamese convenience stores and supermarkets',
    '베트남 내 한국 식품 수요가 늘면서 편의점과 대형마트의 한국 식품 코너가 확대되고 있다. 수입 식품은 수입 신고와 식품안전 검사, 베트남어 라벨 요건을 충족해야 한다. 냉장 유통이 필요한 발효식품은 콜드체인 확보가 핵심이다.',
    'Demand for Korean food in Vietnam is expanding Korean sections in convenience stores and supermarkets. Imported food must meet import notification, food-safety inspection and Vietnamese labelling requirements. For fermented foods needing refrigeration, securing a cold chain is key.',
    'KOTRA 하노이 무역관(시연 요약)', KOTRA + '#vn-food', -22, ['베트남', '식품']],
  ['MC-012', 'report', 'JP', 'medical_device', '일본 의료기기 인허가·시장 접근 개요', 'Japan medical devices: approval and market access overview',
    '일본 의료기기는 위험도에 따라 분류되며 외국 제조업자는 현지 선임제조판매업자를 통해 인허가 절차를 진행한다. 인증기관 심사 또는 PMDA 승인 경로가 있으며 소요 기간은 등급별로 상이하다. 사전 상담으로 분류와 필요 임상자료를 확인하는 것이 좋다.',
    'Japanese medical devices are classified by risk, and foreign manufacturers proceed through a designated marketing authorisation holder. Routes include third-party certification or PMDA approval, with timelines varying by class. Consult early to confirm classification and clinical data needs.',
    'KOTRA 도쿄 무역관(시연 요약)', KOTRA + '#jp-meddev', -45, ['일본', '의료기기']],
  ['MC-013', 'strategy', 'US', 'ev_battery', '미국 2차전지 소재 공급망 재편과 한국기업 기회', 'US battery materials supply-chain realignment and opportunities for Korean firms',
    '미국의 공급망 재편 정책으로 북미 현지 생산과 우호국 조달 요건이 강화되고 있다. 한국 소재 기업은 현지 합작·공급 계약을 통해 기회를 모색할 수 있으며, 원산지 및 탄소발자국 데이터 준비가 요구된다.',
    'US supply-chain policy is tightening requirements for North American production and procurement from partner countries. Korean materials companies can seek opportunities through local joint ventures and supply contracts, and should prepare origin and carbon-footprint data.',
    'KOTRA 뉴욕 무역관(시연 요약)', KOTRA + '#us-battery', -35, ['미국', '배터리']],
];

const TRENDS = [
  ['온라인 채널 비중 확대', 'online channels are gaining share', '온라인 직구와 플랫폼 입점을 병행하는 것이 효과적이다', 'combining cross-border online sales with platform listings works well'],
  ['현지 유통 파트너십 수요 증가', 'demand for local distribution partnerships is rising', '검증된 현지 유통업체를 통한 소량 시범 거래부터 시작하는 것이 안전하다', 'starting with small pilot orders through a vetted local distributor is safer'],
  ['프리미엄 제품 선호 강화', 'preference for premium products is strengthening', '품질 인증과 브랜드 스토리를 강조한 포지셔닝이 유효하다', 'positioning built on quality certification and brand story is effective'],
  ['인증·표시 요건 강화 움직임', 'certification and labelling rules are tightening', '진출 전 인증 및 라벨 요건을 먼저 확인해야 한다', 'certification and labelling requirements should be confirmed before entry'],
  ['한국산 제품 인지도 상승', 'recognition of Korean products is rising', '한류 콘텐츠와 연계한 마케팅이 인지도 확보에 도움이 된다', 'marketing linked to Korean-wave content helps build awareness'],
];
const GEN_COMBOS = [
  ['TH', 'cosmetics'], ['ID', 'kimchi'], ['MY', 'cosmetics'], ['PH', 'snack'], ['IN', 'cosmetics'], ['SA', 'supplement'], ['DE', 'cosmetics'], ['FR', 'cosmetics'], ['GB', 'cosmetics'], ['AU', 'cosmetics'],
  ['US', 'kimchi'], ['JP', 'ramen'], ['CN', 'cosmetics'], ['VN', 'ramen'], ['TH', 'beverage'], ['MX', 'auto_parts'], ['BR', 'cosmetics'], ['PL', 'ev_battery'], ['TR', 'machinery'], ['DE', 'ev_battery'],
  ['US', 'medical_device'], ['VN', 'medical_device'], ['IN', 'semicon_equip'], ['SG', 'game'], ['JP', 'game'], ['US', 'game'], ['ID', 'fashion'], ['VN', 'fashion'], ['AE', 'supplement'], ['US', 'petfood'],
  ['JP', 'petfood'], ['TH', 'ebike'], ['IN', 'solar'], ['SA', 'water'], ['AU', 'solar'], ['MX', 'display'], ['PL', 'machinery'], ['TR', 'steel'], ['MY', 'semicon_equip'], ['VN', 'packaging'],
  ['DE', 'packaging'], ['FR', 'fashion'], ['GB', 'game'], ['CN', 'beauty_device'], ['US', 'beauty_device'], ['AE', 'cosmetics'], ['SG', 'supplement'], ['PH', 'cosmetics'],
];
const TYPES = ['news', 'trend', 'report', 'strategy', 'news'];

function genMarket() {
  return GEN_COMBOS.map(([cc, pk], i) => {
    const c = C[cc], p = P[pk], t = TRENDS[i % TRENDS.length], type = TYPES[i % TYPES.length];
    const size = c.gdp > 3000 ? '매우 크며' : c.gdp > 1000 ? '상당하며' : '성장 중이며';
    const sizeEn = c.gdp > 3000 ? 'very large' : c.gdp > 1000 ? 'substantial' : 'growing';
    const id = 'MC-' + String(14 + i).padStart(3, '0');
    return [id, type, cc, pk,
      `${c.ko} ${p.ko} 시장, ${t[0]}`, `${c.en} ${p.en} market: ${t[1]}`,
      `${c.ko} ${p.ko} 시장에서 ${t[0]} 흐름이 나타나고 있다. ${c.ko}의 인구는 약 ${c.pop}백만 명, GDP는 약 ${c.gdp}십억 달러 수준(시연용 지표)으로 시장 규모가 ${size} 연평균 성장률은 ${c.growth}% 내외로 추정된다. 진출을 준비하는 기업은 ${t[2]}. 세부 규제와 관세는 별도 확인이 필요하다.`,
      `In the ${c.en} ${p.en} market, ${t[1]}. With a population of about ${c.pop} million and GDP around USD ${c.gdp} billion (demo indicators), the market is ${sizeEn}, with growth estimated near ${c.growth}%. Companies preparing to enter should note that ${t[3]}. Detailed regulations and tariffs must be verified separately.`,
      `${c.office_ko}(시연 합성 콘텐츠)`, KOTRA + `#${cc.toLowerCase()}-${pk}`, -(8 + i * 5), [c.ko, p.ko],
    ];
  });
}

// Regulations: [id, country, hs, industry, title_ko, title_en, body_ko, body_en, requirements[{ko,en}], agency, url, risk, daysAgo]
const R = (ko, en) => ({ ko, en });
const HERO_REG = [
  ['RG-001', 'VN', '3304', 'cosmetics', '베트남 화장품 수입·유통 요건 (제품 공고)', 'Vietnam cosmetics import & distribution requirements (product notification)',
    '베트남에 화장품을 수출하려면 제품 공고(notification) 절차를 거쳐 보건부 산하 의약품관리국에 제품 정보를 신고해야 한다. 수입·유통 주체인 현지 법인(책임자)이 공고를 수행하며 제품정보파일(PIF)을 보관해야 한다. 제품에는 베트남어 라벨이 필요하다. 기능을 표방하는 문구는 입증 자료가 있어야 하며 의약품 수준의 효능 표현은 제한된다. 한-베트남 FTA 활용 시 원산지증명서(C/O)로 관세 혜택을 검토할 수 있다. 본 내용은 시연용 요약이므로 실제 적용 전 현행 법령 원문을 확인해야 한다.',
    'To export cosmetics to Vietnam, product information must be notified to the Department of Drug Administration under the Ministry of Health. A local entity acting as the responsible party carries out the notification and keeps the product information file (PIF). Products need Vietnamese-language labels. Functional claims require substantiation and drug-level efficacy claims are restricted. Tariff benefits under the Korea–Vietnam FTA can be reviewed using a certificate of origin. This is a demo summary; verify current legal texts before applying.',
    [R('현지 책임자(수입·유통 법인) 확보', 'Secure a local responsible entity (importer/distributor)'), R('제품 공고(notification) 신청', 'File product notification'), R('제품정보파일(PIF) 작성·보관', 'Prepare and keep the product information file (PIF)'), R('베트남어 라벨 제작', 'Produce Vietnamese-language labels'), R('성분 표기 및 기능 표현 입증자료 준비', 'Prepare ingredient list and claim substantiation'), R('FTA 원산지증명서(C/O) 검토', 'Review FTA certificate of origin')],
    '베트남 보건부 의약품관리국 (Ministry of Health, DAV)', 'https://moh.gov.vn', 'MEDIUM', -30],
  ['RG-002', 'US', '3304', 'cosmetics', '미국 화장품 규제 (MoCRA) 수출 체크리스트', 'US cosmetics regulation (MoCRA) export checklist',
    '미국은 화장품을 시판 전 승인하지 않지만 MoCRA에 따라 제조·가공 시설 등록, 제품 목록 제출, 책임자 지정, 안전성 입증, 유해사례 보고, 표시사항 준수가 요구된다. 라벨에는 미국 내 유해사례 접수 연락처가 필요하다. 자외선 차단제 등 일부 제품은 OTC 의약품 규정이 적용된다. 시연용 요약이므로 FDA 최신 지침을 확인해야 한다.',
    'The US does not pre-approve cosmetics, but under MoCRA facility registration, product listing, designation of a responsible person, safety substantiation, adverse-event reporting and labelling are required. Labels need a US adverse-event contact. Some products such as sunscreens fall under OTC drug rules. This is a demo summary; check the latest FDA guidance.',
    [R('제조·가공 시설 FDA 등록', 'Register facility with FDA'), R('제품 목록(Product Listing) 제출', 'Submit product listing'), R('책임자(Responsible Person) 지정', 'Designate a Responsible Person'), R('안전성 입증 자료 보관', 'Keep safety substantiation'), R('유해사례 접수 연락처 라벨 표기', 'Print adverse-event contact on label'), R('자외선 차단 등 OTC 해당 여부 확인', 'Check whether OTC drug rules apply')],
    '미국 FDA', 'https://www.fda.gov/cosmetics', 'MEDIUM', -28],
  ['RG-003', 'JP', '3304', 'cosmetics', '일본 화장품 수입·표방 효능 규제', 'Japan cosmetics import and efficacy-claim rules',
    '일본에서 화장품을 수입·판매하려면 화장품제조판매업 허가를 가진 업체를 통해야 하며, 제품별 신고와 표시 규정을 준수해야 한다. 미백·주름개선 등 효능을 표방하는 제품은 의약부외품 승인 대상이 될 수 있다. 성분 규제와 일본어 표시 요건이 있으므로 현지 판매업자와 사전 협의가 필요하다. 시연용 요약이다.',
    'Importing and selling cosmetics in Japan requires working through a company holding a cosmetics marketing authorisation, with product notification and labelling compliance. Products claiming effects such as brightening or wrinkle improvement may be subject to quasi-drug approval. Ingredient restrictions and Japanese labelling apply, so consult the local seller early. Demo summary.',
    [R('화장품제조판매업 허가 보유 업체 확보', 'Engage a licensed marketing authorisation holder'), R('제품 신고', 'Product notification'), R('효능 표방 시 의약부외품 승인 여부 검토', 'Check quasi-drug approval for efficacy claims'), R('일본어 표시 및 성분 규제 확인', 'Confirm Japanese labelling and ingredient limits')],
    '일본 후생노동성 / PMDA', 'https://www.mhlw.go.jp', 'MEDIUM', -26],
  ['RG-004', 'ID', '3304', 'cosmetics', '인도네시아 화장품 등록 및 할랄 인증', 'Indonesia cosmetics registration and halal certification',
    '인도네시아에 화장품을 수출하려면 현지 식약청 등록(notification)과 현지 수입업자가 필요하다. 할랄 제품 보증 제도가 단계적으로 의무화되고 있어 대상 품목과 시행 시기를 확인해야 하며, 인증 준비에는 원료·공정 검토가 필요하다. 시연용 요약이다.',
    'Exporting cosmetics to Indonesia requires registration (notification) with the local food and drug authority and a local importer. Halal product assurance is being made mandatory in phases, so confirm covered items and timing; preparation involves ingredient and process review. Demo summary.',
    [R('현지 수입업자 확보', 'Secure a local importer'), R('현지 식약청 제품 등록', 'Register product with local authority'), R('할랄 인증 대상 여부 및 일정 확인', 'Confirm halal certification scope and timeline'), R('인도네시아어 라벨', 'Indonesian-language label')],
    '인도네시아 식약청(BPOM) / 할랄제품보증청', 'https://www.pom.go.id', 'HIGH', -24],
  ['RG-005', 'VN', '2005', 'kimchi', '베트남 수입 식품 신고 및 라벨 요건', 'Vietnam imported-food notification and labelling requirements',
    '베트남에 식품을 수출하려면 수입 식품안전 검사, 제품 자기공표(self-declaration) 또는 등록, 베트남어 라벨 부착이 필요하다. 냉장·발효식품은 콜드체인과 유통기한 표시를 철저히 해야 하며 수입자 정보가 라벨에 포함되어야 한다. 시연용 요약이다.',
    'Exporting food to Vietnam requires import food-safety inspection, product self-declaration or registration, and Vietnamese labels. Chilled and fermented foods need a reliable cold chain and clear expiry marking, and the importer\'s details must appear on the label. Demo summary.',
    [R('수입 식품안전 검사', 'Import food-safety inspection'), R('제품 자기공표/등록', 'Product self-declaration/registration'), R('베트남어 라벨(수입자 정보 포함)', 'Vietnamese label incl. importer details'), R('콜드체인 및 유통기한 관리', 'Cold chain and expiry control')],
    '베트남 보건부 식품안전청', 'https://moh.gov.vn', 'MEDIUM', -21],
  ['RG-006', 'US', '9018', 'medical_device', '미국 의료기기 FDA 등록·승인 경로', 'US medical devices: FDA registration and clearance pathways',
    '미국 의료기기는 위험도에 따라 Class I~III로 분류되며 510(k), De Novo, PMA 등 경로가 있다. 제조시설 등록과 제품 목록, 미국 대리인 지정, QMSR 준수가 필요하다. 시연용 요약이다.',
    'US medical devices are classified Class I–III with pathways such as 510(k), De Novo and PMA. Facility registration, device listing, a US agent and quality-system compliance are required. Demo summary.',
    [R('기기 분류 확인', 'Confirm device classification'), R('시설 등록·제품 목록', 'Establishment registration and device listing'), R('510(k)/De Novo/PMA 경로 선택', 'Select 510(k)/De Novo/PMA pathway'), R('미국 대리인 지정', 'Appoint a US agent')],
    '미국 FDA', 'https://www.fda.gov/medical-devices', 'HIGH', -19],
  ['RG-007', 'US', '8507', 'ev_battery', '리튬 배터리 운송 안전기준 (UN38.3) 및 미국 통관', 'Lithium battery transport safety (UN38.3) and US customs',
    '리튬 배터리를 수출하려면 UN38.3 시험 보고서와 위험물 분류에 따른 포장·표시, 운송서류가 필요하다. 미국 통관 시 원산지 및 관세 분류 확인이 중요하다. 시연용 요약이다.',
    'Exporting lithium batteries requires a UN38.3 test report plus packaging, marking and transport documents according to dangerous-goods classification. Origin and tariff classification are important at US customs. Demo summary.',
    [R('UN38.3 시험 보고서', 'UN38.3 test report'), R('위험물 포장·표시', 'Dangerous-goods packaging and marking'), R('원산지·HS 분류 확인', 'Verify origin and HS classification')],
    '미국 DOT / CBP', 'https://www.cbp.gov', 'HIGH', -15],
  ['RG-008', 'AE', '3304', 'cosmetics', 'UAE 화장품 수입 등록 및 할랄 표시', 'UAE cosmetics import registration and halal marking',
    'UAE에 화장품을 수출하려면 현지 수입업자를 통한 제품 등록과 아랍어/영어 표시가 필요하며, 할랄 표시 여부가 유통에 영향을 준다. 시연용 요약이다.',
    'Exporting cosmetics to the UAE requires product registration through a local importer and Arabic/English labelling; halal indication can affect distribution. Demo summary.',
    [R('현지 수입업자·제품 등록', 'Local importer and product registration'), R('아랍어/영어 라벨', 'Arabic/English label'), R('할랄 표시 검토', 'Consider halal indication')],
    'UAE 기후변화환경부 / 지자체', 'https://www.moccae.gov.ae', 'MEDIUM', -17],
];
const REG_TEMPL = {
  beauty: [R('현지 수입·유통 책임자 확보', 'Secure local importer/responsible party'), R('제품 등록 또는 신고', 'Product registration or notification'), R('성분 규제 확인', 'Check ingredient restrictions'), R('현지어 라벨', 'Local-language label')],
  food: [R('수입 식품 신고 및 검사', 'Import food notification and inspection'), R('위생·검역 증명서', 'Sanitary/phytosanitary certificates'), R('현지어 라벨과 유통기한', 'Local-language label and expiry'), R('원산지증명서', 'Certificate of origin')],
  health: [R('제품 등록/허가', 'Product registration/approval'), R('현지 대리인 지정', 'Appoint local agent'), R('품질관리(GMP/QMS) 증빙', 'Quality system (GMP/QMS) evidence'), R('임상·성능 자료', 'Clinical/performance data')],
  tech: [R('안전·전기 인증(CE/UL 등)', 'Safety/electrical certification (CE/UL etc.)'), R('환경 규제(RoHS/REACH 등)', 'Environmental rules (RoHS/REACH etc.)'), R('원산지·HS 분류', 'Origin and HS classification'), R('현지 대리인/수입자', 'Local agent/importer')],
  general: [R('수입자 등록·통관 서류', 'Importer registration and customs documents'), R('원산지증명서(C/O)', 'Certificate of origin'), R('표시·라벨 요건', 'Labelling requirements'), R('관세 분류(HS)와 FTA 혜택', 'HS classification and FTA benefits')],
};
const REG_GEN = [
  ['TH', 'cosmetics', 'beauty'], ['MY', 'cosmetics', 'beauty'], ['PH', 'cosmetics', 'beauty'], ['IN', 'cosmetics', 'beauty'], ['CN', 'cosmetics', 'beauty'], ['DE', 'cosmetics', 'beauty'], ['FR', 'cosmetics', 'beauty'], ['GB', 'cosmetics', 'beauty'],
  ['US', 'kimchi', 'food'], ['JP', 'ramen', 'food'], ['ID', 'kimchi', 'food'], ['TH', 'snack', 'food'], ['SA', 'supplement', 'food'], ['AU', 'beverage', 'food'], ['MY', 'ramen', 'food'], ['PH', 'snack', 'food'],
  ['VN', 'medical_device', 'health'], ['JP', 'medical_device', 'health'], ['IN', 'pharma', 'health'], ['DE', 'medical_device', 'health'], ['SA', 'medical_device', 'health'], ['TR', 'diagnostic', 'health'],
  ['DE', 'ev_battery', 'tech'], ['PL', 'ev_battery', 'tech'], ['MX', 'auto_parts', 'tech'], ['IN', 'solar', 'tech'], ['AU', 'solar', 'tech'], ['SG', 'smart_home', 'tech'], ['TH', 'ebike', 'tech'], ['VN', 'semicon_equip', 'tech'],
  ['BR', 'machinery', 'general'], ['TR', 'steel', 'general'],
];
function genRegs() {
  return REG_GEN.map(([cc, pk, tpl], i) => {
    const c = C[cc], p = P[pk];
    const reqs = REG_TEMPL[tpl];
    const id = 'RG-' + String(9 + i).padStart(3, '0');
    const risk = tpl === 'health' || tpl === 'tech' ? 'HIGH' : 'MEDIUM';
    return [id, cc, p.hs, pk, `${c.ko} ${p.ko} 수입 규제·인증 요건`, `${c.en}: import regulation and certification for ${p.en}`,
      `${c.ko}에 ${p.ko}을(를) 수출하려면 ${reqs.map((r) => r.ko).slice(0, 3).join(', ')} 등의 절차를 확인해야 한다. 품목(HS ${p.hs})에 따라 추가 인증이나 현지 대리인이 요구될 수 있으며 관세는 FTA 적용 여부에 따라 달라진다. 본 내용은 시연용 합성 요약이므로 현지 최신 규정을 반드시 확인해야 한다.`,
      `To export ${p.en} to ${c.en}, confirm steps such as ${reqs.map((r) => r.en).slice(0, 3).join(', ')}. Depending on the product (HS ${p.hs}), extra certification or a local agent may be required, and tariffs vary with FTA eligibility. This is a synthetic demo summary; always verify the latest local rules.`,
      reqs, `${c.office_ko} 확인 필요`, KOTRA + `#reg-${cc.toLowerCase()}-${pk}`, risk, -(10 + i * 6)];
  });
}

// Trade statistics (demo): export value per country × HS prefix, 2022-2025
function genStats() {
  const rows = [];
  const hsList = ['3304', '2005', '9018', '8507', '1902', '3004', '8708'];
  for (const c of COUNTRIES) {
    hsList.forEach((hs, hi) => {
      let base = Math.round((c.gdp ** 0.55) * (1 + ((hi * 7 + c.pop) % 9) / 10) * 2) / 1;
      for (let y = 2022; y <= 2025; y++) {
        const g = 1 + (c.growth / 100) * 1.8 + (((y * 13 + hi * 5) % 7) - 3) / 100;
        base = Math.round(base * g * 10) / 10;
        rows.push({ id: `TS-${c.code}-${hs}-${y}`, country: c.code, hs_prefix: hs, year: y, export_usd_m: base, import_usd_m: Math.round(base * 0.35 * 10) / 10, yoy: Math.round((g - 1) * 1000) / 10, source_type: 'demo', is_synthetic: 1 });
      }
    });
  }
  return rows;
}

module.exports = { HERO_MARKET, genMarket, HERO_REG, genRegs, genStats, KOTRA };
