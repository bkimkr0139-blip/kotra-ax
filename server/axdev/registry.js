'use strict';
// AX개발 화면 레지스트리 — KOTRA AX 포털의 "메뉴 → 화면 → 세부 기능" 단일 원천(SSOT).
// 피드백·RTM·작업지시서(WO)가 모두 이 키(screen_key / feature_id)를 참조한다.
// route 는 클라이언트 해시 라우터 패턴과 동일(public/js/app.js). kind: 'screen' | 'system'(화면이 아닌 시스템/문서/테스트).
const F = (id, ko, en) => ({ id, ko, en });
const S = (key, route, group, ko, en, file, api, feats, extra = {}) => ({ key, route, group, ko, en, file, api, features: feats.map((f, i) => F(`${key}.${i + 1}`, f[0], f[1])), kind: 'screen', ...extra });

const GROUPS = {
  site: ['공통·홈', 'Home & common'], markets: ['해외시장', 'Overseas markets'], buyers: ['바이어·파트너', 'Buyers & partners'], programs: ['지원사업', 'Support programs'],
  consult: ['상담·애로', 'Consulting & help'], assistant: ['AI 수출비서', 'AI Export Assistant'], invest: ['Invest KOREA', 'Invest KOREA'], mykotra: ['MyKOTRA', 'MyKOTRA'],
  staff: ['직원 업무', 'Staff desk'], admin: ['관리자 콘솔', 'Admin console'], ax: ['AX개발·AXOS', 'AX Dev · AXOS'], system: ['시스템·문서(비화면)', 'System & docs (non-UI)'],
};

const P = 'public/js/pages/';
const SCREENS = [
  // ── 공통·홈
  S('home', '/', 'site', '홈', 'Home', P + 'home.js#home', ['/api/home', '/api/notices'], [['고객 상황별 진입(수출준비·초보·유망·중견) 카드', 'Entry cards by customer group'], ['AI 수출비서 검색창과 추천 질문', 'AI assistant search box and starter questions'], ['공지·행사·지원사업 하이라이트', 'Notice, event and program highlights']]),
  S('search', '/search', 'site', '통합검색', 'Integrated search', P + 'misc.js#search', ['/api/search'], [['시장·규제·사업·바이어·FAQ 통합 결과', 'Unified results across content types'], ['유형 필터와 AI에게 물어보기 연결', 'Type filters and “ask AI” hand-off']]),
  S('services', '/services', 'site', '통합 서비스 허브', 'Service hub', P + 'misc.js#services', [], [['6+2 통합 서비스 카드(무투24·무역자료실·TriBIG·GEP·Kodits·GTC·IK·옴부즈만)', '6+2 integrated service cards'], ['서비스별 바로가기', 'Per-service shortcuts']]),
  S('sitemap', '/sitemap', 'site', '사이트맵', 'Sitemap', P + 'misc.js#sitemap', [], [['전체 메뉴 구조 한눈에 보기', 'Whole menu structure at a glance'], ['직원·관리자 메뉴 구분 표시', 'Staff/admin menus marked']]),
  S('about', '/about', 'site', '공사안내', 'About KOTRA', P + 'misc.js#about', ['/api/notices'], [['기관 소개와 공지사항', 'Organisation overview and notices'], ['FAQ·민원 안내', 'FAQ and complaint guidance']]),
  S('accessibility', '/accessibility', 'site', '접근성 안내', 'Accessibility', P + 'misc.js#accessibility', [], [['글자 크기·고대비·키보드 이용 안내', 'Text size, contrast, keyboard guidance']]),
  S('architecture', '/architecture', 'site', 'To-Be 아키텍처', 'To-Be architecture', P + 'misc.js#architecture', [], [['플랫폼 계층·AI·데이터 구조도', 'Platform, AI and data layers'], ['MVP 범위와 본사업 범위 구분', 'MVP vs full-programme scope']]),
  S('login', '/login', 'site', '로그인', 'Login', P + 'misc.js#login', ['/api/auth/login', '/api/auth/demo-login'], [['계정 로그인', 'Account login'], ['시연 페르소나(접근 코드)', 'Demo personas (access code)']]),
  S('playground', '/playground', 'site', 'AX Playground', 'AX Playground', P + 'misc.js#playground', [], [['앱스토어형 Agent·Workflow 카탈로그', 'App-store style agent catalogue'], ['Fork·좋아요', 'Fork and like']]),
  // ── 해외시장
  S('markets', '/markets', 'markets', '해외시장 허브', 'Markets hub', P + 'markets.js#hub', ['/api/countries', '/api/market-content'], [['국가·산업 진입 카드', 'Country and industry entry'], ['최신 시장뉴스·진출전략', 'Latest news and strategies']]),
  S('markets.countries', '/markets/countries', 'markets', '국가/지역', 'Countries & regions', P + 'markets.js#countries', ['/api/countries'], [['20개국 비교 목록', '20-country list'], ['권역 필터', 'Region filter']]),
  S('markets.country', '/markets/country/:code', 'markets', '국가 정보', 'Country profile', P + 'markets.js#country', ['/api/countries/:code'], [['경제 지표·교역 현황', 'Economic and trade indicators'], ['규제·바이어·사업 연결', 'Linked regulation, buyers, programs'], ['출처·기준일 표시', 'Source and as-of date']]),
  S('markets.content', '/markets/content', 'markets', '시장 콘텐츠', 'Market content', P + 'markets.js#contentList', ['/api/market-content'], [['뉴스·전략·보고서 필터', 'Filter news/strategy/reports'], ['저장·공유', 'Save and share']]),
  S('markets.content.detail', '/markets/content/:id', 'markets', '시장 콘텐츠 상세', 'Content detail', P + 'markets.js#contentDetail', ['/api/market-content/:id'], [['본문·출처·관련 콘텐츠', 'Body, source, related'], ['AI 요약 질문', 'Ask AI about this']]),
  S('markets.regulations', '/markets/regulations', 'markets', '규제·인증', 'Regulation', P + 'markets.js#regList', ['/api/regulations'], [['국가×품목 규제 검색', 'Search by country × item'], ['체크리스트 보기', 'Checklist view']]),
  S('markets.regulations.detail', '/markets/regulations/:id', 'markets', '규제·인증 상세', 'Regulation detail', P + 'markets.js#regDetail', ['/api/regulations/:id'], [['요건·기관·근거 문서', 'Requirements, agency, source'], ['준비 체크리스트 저장', 'Save checklist']]),
  S('markets.stats', '/markets/stats', 'markets', '무역통계', 'Trade statistics', P + 'markets.js#stats', ['/api/stats'], [['국가·HS 기준 교역 규모', 'Trade by country and HS'], ['증감률 차트', 'YoY charts'], ['합성 지표 표기', 'Synthetic-data labelling']]),
  S('library', '/library', 'markets', '무역자료실', 'Trade library', P + 'markets.js#library', ['/api/library'], [['가이드·용어·체크리스트 검색', 'Guides, glossary, checklists'], ['분류 필터', 'Category filters']]),
  S('library.doc', '/library/:id', 'markets', '무역자료 상세', 'Library document', P + 'markets.js#libraryDoc', ['/api/library/:id'], [['본문 열람', 'Read the document'], ['관련 자료', 'Related documents']]),
  S('events', '/events', 'markets', '전시회·상담회', 'Events', P + 'events.js#list', ['/api/events'], [['행사 캘린더·필터', 'Calendar and filters'], ['신청 마감 D-day', 'Application D-day']]),
  S('events.detail', '/events/:id', 'markets', '행사 상세·상담매칭', 'Event & matching', P + 'events.js#detail', ['/api/events/:id', '/api/matches/request', '/api/events/:id/schedule'], [['참가 신청', 'Apply to participate'], ['바이어 검색·Match Score', 'Buyer search and match score'], ['30분 타임테이블(현지시간 병기)', '30-min timetable with local time'], ['상담 신청·수락·반려', 'Request, accept, reject']]),
  // ── 바이어
  S('buyers', '/buyers', 'buyers', '바이어 찾기', 'Find buyers', P + 'buyers.js#list', ['/api/buyers'], [['품목·국가·해시태그 검색', 'Search by item, country, hashtag'], ['검증 바이어 필터', 'Verified-only filter'], ['관심 바이어 저장', 'Save to shortlist']]),
  S('buyers.recommend', '/buyers/recommend', 'buyers', 'AI 바이어 추천', 'AI buyer recommendation', P + 'buyers.js#recommend', ['/api/buyers/recommend'], [['Match Score와 구성요소', 'Score and components'], ['추천 근거 설명', 'Reason explanations'], ['상담 신청 연결', 'Request a meeting']]),
  S('buyers.favorites', '/buyers/favorites', 'buyers', '관심 바이어', 'Saved buyers', P + 'buyers.js#favorites', ['/api/buyers/favorites'], [['저장 목록 관리', 'Manage shortlist']]),
  S('buyers.detail', '/buyers/:id', 'buyers', '바이어 상세', 'Buyer detail', P + 'buyers.js#detail', ['/api/buyers/:id'], [['프로필·신뢰도·거래이력', 'Profile, trust, history'], ['연락 전 개인정보 보호 안내', 'Privacy guidance']]),
  // ── 지원사업
  S('programs', '/programs', 'programs', '지원사업 목록', 'Programs', P + 'programs.js#list', ['/api/programs'], [['고객그룹·유형·국가 필터', 'Filters by group, type, country'], ['마감 D-day 정렬', 'D-day sorting'], ['관심 사업 저장', 'Save programs']]),
  S('programs.recommend', '/programs/recommend', 'programs', '맞춤 사업 추천', 'Tailored programs', P + 'programs.js#recommend', ['/api/programs/recommended'], [['추천도와 이유', 'Fit score with reasons'], ['신청 자격 사전 점검', 'Eligibility pre-check']]),
  S('programs.detail', '/programs/:id', 'programs', '지원사업 상세·신청', 'Program detail & apply', P + 'programs.js#detail', ['/api/programs/:id', '/api/applications'], [['자격·서류·일정', 'Eligibility, documents, schedule'], ['AI 신청서 초안', 'AI application draft'], ['제출 전 본인 승인(HITL)', 'Self-approval before submit (HITL)']]),
  // ── 상담
  S('consult', '/consult', 'consult', '상담 채널 안내', 'Consulting channels', P + 'consult.js#channels', [], [['온라인·전화·방문·이동KOTRA 채널', 'Online, phone, visit, mobile'], ['AI 분류 미리보기', 'AI triage preview']]),
  S('consult.new', '/consult/new', 'consult', '전문가 상담 신청', 'Expert consulting', P + 'consult.js#newConsult', ['/api/consultations', '/api/consultations/classify-preview'], [['상담 유형·긴급도 입력', 'Topic and urgency'], ['AI 자동 분류·담당 배정', 'AI triage and assignment'], ['첨부·개인정보 마스킹 안내', 'Attachments and PII masking']]),
  S('consult.faq', '/consult/faq', 'consult', 'FAQ', 'FAQ', P + 'consult.js#faq', ['/api/faqs'], [['카테고리·검색', 'Category and search']]),
  // ── AI 수출비서 / Invest
  S('assistant', '/assistant', 'assistant', 'AI 수출비서', 'AI Export Assistant', P + 'assistant.js#assistant', ['/api/ai/chat', '/api/ai/sessions', '/api/ai/action'], [['스트리밍 답변과 출처 표시', 'Streaming answers with citations'], ['Tool 실행·위험도별 승인(HITL)', 'Tools with risk-tiered approval'], ['아티팩트 패널·내보내기', 'Artifact panel and export'], ['첨부 Q&A·개인정보 차단', 'Attachment Q&A and PII blocking'], ['평점·오류 신고', 'Rating and error report']]),
  S('invest', '/invest', 'invest', 'Invest KOREA', 'Invest KOREA', P + 'invest.js#invest', ['/api/invest', '/api/invest/inquiries'], [['Why Korea·인센티브·가이드', 'Why Korea, incentives, guide'], ['투자·고충 상담 접수', 'Investment/grievance inquiry'], ['AI 투자 도우미', 'AI investment helper']]),
  // ── MyKOTRA
  S('mykotra', '/mykotra', 'mykotra', 'MyKOTRA Cockpit', 'MyKOTRA cockpit', P + 'mykotra.js#cockpit', ['/api/dashboard'], [['수출 여정 단계 표시', 'Export journey stages'], ['Next Best Action 추천', 'Next best actions'], ['신청·상담·알림 요약', 'Applications, consults, notifications']]),
  S('mykotra.profile', '/mykotra/profile', 'mykotra', '기업 프로필', 'Company profile', P + 'mykotra.js#profile', ['/api/company'], [['기업 정보 수정', 'Edit company info'], ['관심 품목·국가', 'Interest items and countries']]),
  S('mykotra.project', '/mykotra/project', 'mykotra', '수출 목표(프로젝트)', 'Export goal', P + 'mykotra.js#project', ['/api/projects'], [['수출 목표·여정 메모리', 'Goal and journey memory'], ['AI 비서 연결', 'Link to AI assistant']]),
  S('mykotra.applications', '/mykotra/applications', 'mykotra', '신청 사업', 'My applications', P + 'mykotra.js#applications', ['/api/applications'], [['신청 상태 추적', 'Status tracking'], ['서류 체크', 'Document checklist']]),
  S('mykotra.application', '/mykotra/applications/:id', 'mykotra', '신청서 상세', 'Application detail', P + 'mykotra.js#application', ['/api/applications/:id', '/api/applications/:id/submit'], [['신청서 편집', 'Edit form'], ['AI 보완 제안', 'AI suggestions'], ['제출(HITL)', 'Submit (HITL)']]),
  S('mykotra.matching', '/mykotra/matching', 'mykotra', '상담/매칭', 'Consults & matching', P + 'mykotra.js#matching', ['/api/matches'], [['상담 신청·수락 현황', 'Meeting requests'], ['만족도 평가', 'Satisfaction rating']]),
  S('mykotra.consults', '/mykotra/consults', 'mykotra', '상담이력', 'Consultations', P + 'mykotra.js#consults', ['/api/consultations'], [['상담 목록·상태', 'List and status']]),
  S('mykotra.consult', '/mykotra/consults/:id', 'mykotra', '상담 상세', 'Consultation detail', P + 'mykotra.js#consultDetail', ['/api/consultations/:id'], [['메시지 스레드', 'Message thread'], ['요약 확인', 'Summary view']]),
  S('mykotra.saved', '/mykotra/saved', 'mykotra', '저장 콘텐츠', 'Saved items', P + 'mykotra.js#saved', ['/api/saved'], [['저장한 콘텐츠·검색 결과', 'Saved content']]),
  S('mykotra.documents', '/mykotra/documents', 'mykotra', '생성 문서', 'Generated documents', P + 'mykotra.js#documents', ['/api/documents'], [['AI 생성 문서 목록', 'AI-generated documents']]),
  S('mykotra.document', '/mykotra/documents/:id', 'mykotra', '문서 보기', 'Document view', P + 'mykotra.js#documentView', ['/api/documents/:id'], [['문서 열람·내보내기', 'View and export']]),
  S('mykotra.notifications', '/mykotra/notifications', 'mykotra', '알림', 'Notifications', P + 'mykotra.js#notifications', ['/api/notifications'], [['읽음 처리', 'Mark as read'], ['관련 화면 이동', 'Deep links']]),
  S('mykotra.approvals', '/mykotra/approvals', 'mykotra', '내 승인 대기(HITL)', 'My approvals', P + 'mykotra.js#approvals', ['/api/approvals'], [['본인 최종 승인 대기 목록', 'Self-approval queue']]),
  // ── 직원 업무
  S('staff.consult', '/staff/consult', 'staff', '상담 Single View', 'Consultation Single View', P + 'staff.js#consult', ['/api/staff/consultations'], [['고객 360° 한 화면', 'Customer 360° view'], ['AI 상담 요약(HITL 확정)', 'AI summary with human confirmation'], ['이관·콜백 예약', 'Transfer and callback'], ['EXTRA CARE 민감정보 접근 통제', 'Sensitive-access control']]),
  S('staff.stt', '/staff/stt', 'staff', 'STT·상담일지', 'STT & journal', P + 'staff.js#stt', ['/api/stt'], [['업로드→STT→화자구분→마스킹→요약', 'Upload → STT → diarise → mask → summarise'], ['브라우저 음성인식', 'Browser speech recognition']]),
  S('staff.research', '/staff/research', 'staff', '지시조사 워크플로우', 'Research workflow', P + 'staff.js#research', ['/api/research'], [['요청→총괄 승인→배정', 'Request → approval → assign'], ['결과 제출·보완·평가', 'Submit, revise, evaluate'], ['AI 초안 지원', 'AI draft assist']]),
  S('staff.news', '/staff/news', 'staff', '해외시장뉴스 AI 교정', 'Market-news AI editor', P + 'staff.js#news', ['/api/news'], [['전/후 비교 하이라이트', 'Before/after diff'], ['맞춤법·금칙어·개인정보·팩트 점검', 'Style, banned terms, PII, fact-check'], ['담당자 승인 후 게시', 'Publish after approval']]),
  // ── 관리자
  S('admin', '/admin', 'admin', 'Dashboard', 'Dashboard', P + 'admin.js#dashboard', ['/api/admin/dashboard'], [['운영 KPI', 'Operations KPIs'], ['승인 대기·상태 분포', 'Pending approvals, distributions']]),
  S('admin.approvals', '/admin/approvals', 'admin', '승인(HITL) 큐', 'Approval queue', P + 'admin.js#approvals', ['/api/admin/approvals'], [['위험도별 승인 큐', 'Risk-tiered queue'], ['승인 사유·감사 기록', 'Reason and audit trail']]),
  S('admin.companies', '/admin/companies', 'admin', '고객/기업', 'Customers & companies', P + 'admin.js#companies', ['/api/admin/companies'], [['기업 목록·상세', 'Company list and detail']]),
  S('admin.programs', '/admin/programs', 'admin', '지원사업 관리', 'Programs admin', P + 'admin.js#programs', ['/api/admin/programs'], [['사업 등록·수정·상태', 'Create, edit, status']]),
  S('admin.content', '/admin/content', 'admin', '콘텐츠/CMS', 'Content / CMS', P + 'admin.js#content', ['/api/admin/content', '/api/admin/banners', '/api/admin/notices'], [['콘텐츠 게시 워크플로우', 'Publishing workflow'], ['배너·공지 관리', 'Banners and notices']]),
  S('admin.matching', '/admin/matching', 'admin', '상담매칭 관리', 'Matching admin', P + 'admin.js#matching', ['/api/admin/events/:id/auto-match/preview'], [['참가자 승인', 'Approve participants'], ['자동매칭 조건·충돌 검증', 'Auto-match and conflict check'], ['현장 운영·CSV', 'On-site ops and CSV']]),
  S('admin.ai', '/admin/ai', 'admin', 'AI Operations', 'AI Operations', P + 'admin_ai.js#ai', ['/api/admin/ai/metrics', '/api/admin/ai/eval'], [['프롬프트 버전·롤백', 'Prompt versions and rollback'], ['50문항 자동 평가', '50-question auto-evaluation'], ['Tool Registry·한도', 'Tool registry and limits'], ['Trace·오류 신고', 'Traces and error reports']]),
  S('admin.rag', '/admin/rag', 'admin', 'RAG Manager', 'RAG Manager', P + 'admin_ai.js#rag', ['/api/admin/rag/collections'], [['10개 컬렉션 관리', '10 collections'], ['검색 시뮬레이터', 'Retrieval simulator'], ['16개 옵션 ON/OFF', '16 options']]),
  S('admin.data', '/admin/data', 'admin', '데이터 카탈로그·파이프라인', 'Catalog · Pipeline', P + 'admin_ai.js#data', ['/api/admin/data/catalog'], [['카탈로그·리니지', 'Catalog and lineage'], ['파이프라인 실행·품질', 'Pipelines and quality'], ['Drift(PSI)', 'Drift (PSI)']]),
  S('admin.mdm', '/admin/mdm', 'admin', '고객 MDM', 'Customer MDM', P + 'admin_ai.js#mdm', ['/api/admin/mdm/candidates'], [['중복 후보·병합 결정', 'Duplicate candidates and merge'], ['정비 이력', 'Cleansing history']]),
  S('admin.users', '/admin/users', 'admin', '사용자/권한', 'Users & roles', P + 'admin.js#users', ['/api/admin/users'], [['사용자 목록·역할', 'Users and roles']]),
  S('admin.audit', '/admin/audit', 'admin', '감사로그', 'Audit log', P + 'admin.js#audit', ['/api/admin/audit', '/api/admin/audit/verify'], [['해시체인 무결성 검증', 'Hash-chain verification'], ['행위·대상 필터', 'Filters']]),
  S('admin.system', '/admin/system', 'admin', '모니터링·연계', 'Monitoring', P + 'admin.js#system', ['/api/admin/api-logs', '/api/admin/integration-events'], [['API 지연·오류', 'API latency and errors'], ['연계 이벤트(Mock)', 'Integration events (mock)']]),
  S('admin.rfp', '/admin/rfp', 'admin', 'RFP Coverage', 'RFP Coverage', P + 'admin.js#rfp', ['/api/admin/rfp'], [['요구사항 150건 구현 상태', '150 requirements status'], ['증빙·한계 표기', 'Evidence and limits']]),
  S('admin.di', '/admin/data-integration', 'admin', '데이터 통합 스튜디오 홈', 'Data integration studio', P + 'di.js#di', ['/api/v1/data-integration/overview', '/api/v1/data-integration/sources'], [['연계 상태·KPI(계산식·기준 시각 표시)', 'Connection status and KPIs with formulas'], ['데이터 흐름·승인 대기·최근 Trace', 'Data flow, approvals, recent runs'], ['시연 시나리오 가이드', 'Demo scenario guide']]),
  S('admin.di.tab', '/admin/data-integration/:tab', 'admin', '데이터 통합·MDM 세부 화면', 'Data integration sub-screens', P + 'di.js · di_model.js · di_ops.js', ['/api/v1/data-integration/*'], [['원천 연결·스키마 발견·프로파일링', 'Connection Lab, discovery and profiling'], ['ERD Studio(As-Is/개념/Target/Diff, SVG·PNG·DDL·Mermaid)', 'ERD Studio with exports'], ['매핑 워크벤치·안전한 Rule DSL', 'Mapping workbench and safe rule DSL'], ['고객 식별·MDM Review·병합 승인·Unmerge', 'Identity, MDM review, merge, unmerge'], ['데이터 품질 센터·정비 워크플로우', 'Quality centre and remediation workflow'], ['파이프라인 관제·오류 주입·재시도·정합성', 'Pipeline control, error injection, retry, reconciliation'], ['계보·영향 분석', 'Lineage and impact'], ['자기진화 엔진(드리프트→AI 제안→샌드박스→승인→배포→롤백)', 'Self-evolving engine'], ['변경 승인함·감사·Evidence Center', 'Approvals, audit and Evidence Center']]),
  S('admin.demo', '/admin/demo', 'admin', 'Demo Director', 'Demo Director', P + 'admin.js#demo', ['/api/admin/demo'], [['시나리오 A–D 안내', 'Scenarios A–D'], ['시드 초기화·시연 시계', 'Seed reset and demo clock']]),
  // ── AX개발
  S('axdev', '/axdev', 'ax', 'AX개발 센터', 'AX Dev centre', P + 'axdev.js#axdev', ['/api/ax/overview', '/api/ax/screens', '/api/ax/rtm'], [['메뉴·화면별 피드백 입력', 'Menu/screen feedback'], ['요구사항 추적(RTM)', 'Requirements traceability (RTM)'], ['완료 게이트·백로그·변경 이력', 'Gates, backlog, changelog'], ['제안·입찰 지원/컨소시엄 관리', 'Proposal support and consortium']]),
  S('axos', '/axos', 'ax', 'AXOS 폐루프 콘솔', 'AXOS closed-loop console', P + 'axos.js#axos', ['/api/axos/state', '/api/axos/orders'], [['폐루프 파이프라인 현황', 'Closed-loop pipeline'], ['작업지시서 큐·자동개발 Worker', 'Work-order queue and auto-dev worker'], ['자동개발 모드·가드레일', 'Auto-dev mode and guardrails'], ['검증·현업 확인·릴리즈', 'Verification, acceptance, release']]),
  // ── 시스템(비화면)
  S('sys.global', '#global', 'system', '전역 UI 셸(헤더·GNB·푸터·접근성)', 'Global UI shell', 'public/js/shell.js', [], [['GNB·메가메뉴·모바일 메뉴', 'GNB, mega menu, mobile menu'], ['한/영 전환·글자 크기·고대비', 'Locale, text size, contrast']], { kind: 'system' }),
  S('sys.api', '#api', 'system', '공통 API·Open API·보안 헤더', 'Common API · Open API', 'server/routes/*.js', ['/open-api/v1/:dataset', '/api/health'], [['REST/JSON·XML Open API', 'REST JSON/XML Open API'], ['RBAC·레이트리밋·감사', 'RBAC, rate-limit, audit']], { kind: 'system' }),
  S('sys.docs', '#docs', 'system', '설계·운영 문서', 'Design & ops docs', 'docs/*.md', [], [['아키텍처·API·보안·운영 문서', 'Architecture, API, security, ops docs']], { kind: 'system' }),
  S('sys.tests', '#tests', 'system', '자동 테스트', 'Automated tests', 'test/*.test.js', [], [['시나리오 A–D 통합 테스트', 'Scenario A–D integration tests']], { kind: 'system' }),
];

const BY_KEY = new Map(SCREENS.map((s) => [s.key, s]));
const toRe = (route) => new RegExp('^' + route.replace(/:[a-zA-Z_]+/g, '[^/]+') + '/?$');
const MATCHERS = SCREENS.filter((s) => s.kind === 'screen').map((s) => ({ s, re: toRe(s.route), dyn: (s.route.match(/:/g) || []).length })).sort((a, b) => a.dyn - b.dyn || b.s.route.length - a.s.route.length);

function matchRoute(route) {
  const p = String(route || '/').replace(/^#/, '').split('?')[0] || '/';
  const hit = MATCHERS.find((m) => m.re.test(p));
  return hit ? hit.s : null;
}
const norm = (route) => String(route).replace(/^#/, '').replace(/:[a-zA-Z_]+/g, ':p').replace(/\/$/, '') || '/';

// 커버리지 문서의 screen 필드(예: '#/admin/matching · #/events/:id')에서 화면 키를 추출.
function screensFor(screenText) {
  const text = String(screenText || '');
  const keys = new Set();
  const tokens = text.match(/#\/[A-Za-z0-9/_:\-.]*/g) || [];
  for (const t of tokens) {
    const n = norm(t);
    for (const s of SCREENS) if (s.kind === 'screen' && norm(s.route) === n) keys.add(s.key);
  }
  if (/전역|Header|Quick menu|GNB|반응형/.test(text) && !tokens.length) keys.add('sys.global');
  if (/전역/.test(text) && tokens.length === 0) keys.add('sys.global');
  if (/open-api|\/api\/health|server\/|서버 전역|AI 응답 필터|로그 마스킹/.test(text)) keys.add('sys.api');
  if (/docs\//.test(text)) keys.add('sys.docs');
  if (/test\//.test(text)) keys.add('sys.tests');
  return [...keys];
}

module.exports = { SCREENS, GROUPS, BY_KEY, matchRoute, screensFor };
