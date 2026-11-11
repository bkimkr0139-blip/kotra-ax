// Information architecture (지시서 §5): customer GNB, Invest channel, staff/admin menus. Single source for header, mobile drawer, sitemap.
// [ko, en, href, desc_ko, desc_en]
const I = (ko, en, href, dko = '', den = '') => ({ ko, en, href, dko, den });
export const GNB = [
  { id: 'markets', ko: '해외시장', en: 'Markets', base: '/markets', dko: '국가·산업별 시장정보, 진출전략, 규제·인증, 무역통계를 한곳에서 찾아보세요.', den: 'Find market intelligence, entry strategies, regulations and trade statistics in one place.', items: [
    I('국가/지역', 'Countries & regions', '#/markets/countries', '20개국 시장 현황', '20 country profiles'), I('산업/품목', 'Industries & items', '#/markets/content?group=1', '품목별 시장 콘텐츠', 'Content by industry'),
    I('시장뉴스', 'Market news', '#/markets/content?type=news', '현지 무역관 뉴스', 'News from KBCs'), I('진출전략', 'Entry strategies', '#/markets/content?type=strategy', '국별 진출전략', 'Country entry strategies'),
    I('규제·인증', 'Regulation & certification', '#/markets/regulations', '체크리스트로 확인', 'Checklists'), I('무역통계', 'Trade statistics', '#/markets/stats', '교역 규모·증감(시연 지표)', 'Trade volume (demo indicators)'),
    I('전시회·상담회', 'Exhibitions & meetings', '#/events', '행사 일정과 참가', 'Schedules and participation'), I('무역자료실', 'Trade library', '#/library', '가이드·용어·체크리스트', 'Guides, glossary, checklists'),
  ] },
  { id: 'buyers', ko: '바이어·파트너', en: 'Buyers', base: '/buyers', dko: '품목·국가에 맞는 바이어를 찾고 추천 근거를 확인하세요.', den: 'Find well-matched buyers and see exactly why they were recommended.', items: [
    I('바이어 찾기', 'Find buyers', '#/buyers', '조건별 검색', 'Search by criteria'), I('AI 바이어 추천', 'AI buyer recommendation', '#/buyers/recommend', 'Match Score와 추천 근거', 'Match score with reasons'),
    I('관심 바이어', 'Saved buyers', '#/buyers/favorites', '저장한 바이어', 'Your shortlist'), I('바이어 검증', 'Buyer verification', '#/buyers?verified=1', '검증 완료 바이어', 'Verified buyers'), I('상담 신청', 'Request a meeting', '#/events', '행사에서 1:1 상담', '1:1 meetings at events'),
  ] },
  { id: 'programs', ko: '지원사업', en: 'Programs', base: '/programs', dko: '기업 상황에 맞는 지원사업을 추천받고 바로 신청하세요.', den: 'Get tailored program recommendations and apply right away.', items: [
    I('맞춤 사업추천', 'Tailored recommendations', '#/programs/recommend', '추천도와 이유', 'Fit score with reasons'), I('사업 전체보기', 'All programs', '#/programs', '필터로 탐색', 'Browse with filters'),
    I('전시회·상담회', 'Exhibitions & meetings', '#/programs?type=MEETING', '', ''), I('시장조사', 'Market research', '#/programs?type=RESEARCH', '', ''), I('수출바우처·지사화', 'Voucher & branch office', '#/programs?type=VOUCHER', '', ''), I('신청현황', 'My applications', '#/mykotra/applications', '진행 상태', 'Progress'),
  ] },
  { id: 'consult', ko: '상담·애로', en: 'Consulting', base: '/consult', dko: 'AI가 이해하고 전문가와 연결합니다. 상담 이력은 다음 서비스로 이어집니다.', den: 'AI understands your issue and connects you to experts; history carries into follow-up services.', items: [
    I('AI 상담', 'AI consulting', '#/assistant', '24시간 즉시 답변', 'Instant, 24/7'), I('전문가 상담', 'Expert consulting', '#/consult/new', '수출전문위원 연결', 'Connect to specialists'), I('상담 채널 안내', 'Consulting channels', '#/consult', '온라인·전화·방문·이동KOTRA', 'Online, phone, visit, mobile'),
    I('상담이력', 'My consultations', '#/mykotra/consults', '', ''), I('애로 접수', 'Report a difficulty', '#/consult/new?channel=GRIEVANCE', '통상애로·규제 신고', 'Trade barriers & regulation'), I('FAQ', 'FAQ', '#/consult/faq', '자주 묻는 질문', 'Frequently asked'),
  ] },
  { id: 'assistant', ko: 'AI 수출비서', en: 'AI Assistant', base: '/assistant', dko: '수출 목표를 말하면 시장·규제·바이어·지원사업까지 한 대화로 연결합니다.', den: 'State your export goal; the assistant connects markets, regulation, buyers and programs in one conversation.', items: [
    I('새 대화', 'New chat', '#/assistant', '', ''), I('수출전략', 'Export strategy', '#/assistant?agent=strategy', '', ''), I('시장분석', 'Market analysis', '#/assistant?agent=market', '', ''), I('바이어 찾기', 'Find buyers', '#/assistant?agent=buyer', '', ''),
    I('규제·인증', 'Regulation', '#/assistant?agent=regulation', '', ''), I('지원사업', 'Programs', '#/assistant?agent=program', '', ''), I('계약·문서', 'Contracts & documents', '#/assistant?agent=contract', '', ''), I('내 수출 프로젝트', 'My export projects', '#/mykotra/project', '', ''),
  ] },
  { id: 'mykotra', ko: 'MyKOTRA', en: 'MyKOTRA', base: '/mykotra', dko: '수출 여정과 다음 행동을 한눈에 보는 기업 Digital Cockpit.', den: 'Your export Digital Cockpit: journey and next best actions at a glance.', items: [
    I('Cockpit', 'Cockpit', '#/mykotra', '', ''), I('기업 프로필', 'Company profile', '#/mykotra/profile', '', ''), I('수출 목표', 'Export goal', '#/mykotra/project', '', ''), I('신청 사업', 'My applications', '#/mykotra/applications', '', ''),
    I('상담/매칭', 'Consults & matching', '#/mykotra/matching', '', ''), I('저장 콘텐츠', 'Saved items', '#/mykotra/saved', '', ''), I('생성 문서', 'Generated documents', '#/mykotra/documents', '', ''), I('알림', 'Notifications', '#/mykotra/notifications', '', ''),
  ] },
];
export const FAMILY = [
  ['무역투자24', 'Trade-Investment 24', '#/'], ['Invest KOREA', 'Invest KOREA', '#/invest'], ['외국인투자 옴부즈만', 'Foreign Investment Ombudsman', '#/invest?tab=ombudsman'], ['무역자료실', 'Trade Library', '#/library'], ['TriBIG (통계·바이어 분석)', 'TriBIG (stats & buyer analytics)', '#/markets/stats'],
  ['글로벌 전시 포털 GEP', 'Global Exhibition Portal (GEP)', '#/events'], ['Kodits 방산교역', 'Kodits Defense Trade', '#/programs/PG-027'], ['Global Talent Center', 'Global Talent Center', '#/programs/PG-023'], ['BuyKOREA', 'BuyKOREA', '#/buyers'],
];
// 6+2 integrated services (RFP SFR-002/005/007)
export const SERVICES = [
  { id: 'trade24', ko: '무역투자24', en: 'Trade-Investment 24', dko: '해외정보·문의상담·사업신청의 대표 채널', den: 'Flagship channel for information, consulting and applications', href: '#/', ic: 'home', rfp: 'SFR-003' },
  { id: 'library', ko: '무역자료실', en: 'Trade Library', dko: '간행물·리포지터리·가이드', den: 'Publications, repository and guides', href: '#/library', ic: 'book', rfp: 'SFR-005' },
  { id: 'tribig', ko: 'TriBIG', en: 'TriBIG', dko: '무역투자통계·바이어·유망시장 추천', den: 'Trade statistics, buyer and market recommendations', href: '#/markets/stats', ic: 'chart', rfp: 'SFR-005' },
  { id: 'gep', ko: '글로벌 전시 포털(GEP)', en: 'Global Exhibition Portal', dko: '전시회 정보·지원·참가신청', den: 'Exhibition info, support and application', href: '#/events', ic: 'calendar', rfp: 'SFR-005' },
  { id: 'kodits', ko: 'Kodits 방산교역', en: 'Kodits Defense Trade', dko: '방산수출상담회·교역지원', den: 'Defense export meetings and trade support', href: '#/programs/PG-027', ic: 'shield', rfp: 'SFR-005' },
  { id: 'gtc', ko: 'Global Talent Center', en: 'Global Talent Center', dko: '글로벌 인재발굴·K-Tech Pass', den: 'Global talent sourcing, K-Tech Pass', href: '#/programs/PG-023', ic: 'users', rfp: 'SFR-005' },
  { id: 'ik', ko: 'Invest KOREA', en: 'Invest KOREA', dko: 'Why Korea·인센티브·투자가이드', den: 'Why Korea, incentives, investment guide', href: '#/invest', ic: 'building', rfp: 'SFR-007' },
  { id: 'ombud', ko: '외국인투자 옴부즈만', en: 'Foreign Investment Ombudsman', dko: '고충상담·규제정보', den: 'Grievance consulting and regulatory information', href: '#/invest?tab=ombudsman', ic: 'flag', rfp: 'SFR-007' },
];
export const STAFF_NAV = [
  { g: ['상담 업무', 'Consulting desk'], items: [['#/staff/consult', '상담 Single View', 'Consultation Single View', 'users', ['consultant', 'admin', 'office']], ['#/staff/stt', 'STT·상담일지', 'STT & journal', 'mic', ['consultant', 'admin', 'office']]] },
  { g: ['해외정보', 'Overseas information'], items: [['#/staff/research', '지시조사 워크플로우', 'Research workflow', 'compass', ['consultant', 'admin', 'office']], ['#/staff/news', '해외시장뉴스 AI 교정', 'Market-news AI editor', 'edit', ['consultant', 'admin', 'office']]] },
];
export const ADMIN_NAV = [
  { g: ['개요', 'Overview'], items: [['#/admin', 'Dashboard', 'Dashboard', 'grid'], ['#/admin/approvals', '승인(HITL) 큐', 'Approval queue', 'check', null, 'approvals']] },
  { g: ['업무 관리', 'Operations'], items: [['#/admin/companies', '고객/기업', 'Customers & companies', 'building'], ['#/admin/programs', '지원사업', 'Programs', 'briefcase'], ['#/admin/content', '콘텐츠/CMS', 'Content / CMS', 'file'], ['#/staff/consult', '상담', 'Consulting', 'users'], ['#/admin/matching', '상담매칭', 'Matching', 'handshake'], ['#/staff/research', '해외정보', 'Overseas info', 'compass']] },
  { g: ['데이터 통합·MDM', 'Data integration · MDM'], items: [['#/admin/data-integration', '통합 스튜디오 홈', 'Studio home', 'grid'], ['#/admin/data-integration/sources', '원천 연결', 'Connection Lab', 'db'], ['#/admin/data-integration/discovery', '스키마 발견', 'Schema discovery', 'search'], ['#/admin/data-integration/erd', 'ERD Studio', 'ERD Studio', 'layers'], ['#/admin/data-integration/mapping', '매핑 워크벤치', 'Mapping workbench', 'route'], ['#/admin/data-integration/identity', '고객 식별·중복', 'Identity resolution', 'users'], ['#/admin/data-integration/golden-records', '정본(Golden Record)', 'Golden records', 'award'], ['#/admin/data-integration/quality', '데이터 품질', 'Data quality', 'check'], ['#/admin/data-integration/pipelines', '파이프라인', 'Pipeline control', 'refresh'], ['#/admin/data-integration/lineage', '계보·영향', 'Lineage & impact', 'compass'], ['#/admin/data-integration/evolution', '자기진화 엔진', 'Evolution engine', 'ai'], ['#/admin/data-integration/approvals', '변경 승인함', 'Change approvals', 'handshake'], ['#/admin/data-integration/audit', '감사', 'Audit', 'shield'], ['#/admin/data-integration/evidence', '증적(Evidence)', 'Evidence center', 'file']] },
  { g: ['AI 운영', 'AI operations'], items: [['#/admin/ai', 'AI Operations', 'AI Operations', 'ai'], ['#/admin/rag', 'RAG Manager', 'RAG Manager', 'layers']] },
  { g: ['데이터', 'Data'], items: [['#/admin/data', 'Catalog · Pipeline', 'Catalog · Pipeline', 'db'], ['#/admin/mdm', '고객 MDM', 'Customer MDM', 'users']] },
  { g: ['시스템', 'System'], items: [['#/admin/users', '사용자/권한', 'Users & roles', 'user'], ['#/admin/audit', '감사로그', 'Audit log', 'shield'], ['#/admin/system', '모니터링·연계', 'Monitoring', 'gear']] },
  { g: ['AX개발', 'AX Dev'], items: [['#/axdev', 'AX개발 센터', 'AX Dev centre', 'layers'], ['#/axos', 'AXOS 폐루프', 'AXOS closed loop', 'ai', ['admin', 'consultant']]] },
  { g: ['검수·시연', 'Acceptance & demo'], items: [['#/admin/rfp', 'RFP Coverage', 'RFP Coverage', 'flag'], ['#/admin/demo', 'Demo Director', 'Demo Director', 'play']] },
];
