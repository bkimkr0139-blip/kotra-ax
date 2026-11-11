'use strict';
// RFP → MVP traceability. Statuses are deliberately conservative:
// IMPLEMENTED = working end-to-end in this MVP | PARTIAL = subset working | MOCK = flow works, external system mocked
// DESIGN_ONLY = documented architecture/adapter only | OUT_OF_MVP = full-program scope (not claimed)
const I = 'IMPLEMENTED', P = 'PARTIAL', M = 'MOCK', D = 'DESIGN_ONLY', O = 'OUT_OF_MVP';
const R = 'READY', PA = 'PARTIAL', NA = 'N/A';
// id: [task, module, screen, impl, demo, evidence, notes]
const SFR = {
  'SFR-001': ['공통', '플랫폼 공통', '전역', P, PA, 'GET /api/health · Open API · 멀티브라우저(Chrome/Edge/Safari/Firefox) 표준 HTML/CSS/JS', 'RFP는 JAVA·전자정부 표준프레임워크 기준이나 MVP는 지시서의 플랫폼 중립 계약(API/엔터티/상태전이)으로 구현. 본사업에서 표준프레임워크 이식 필요'],
  'SFR-002': ['홈페이지 통합', '통합 채널(무투24 + IK&옴부즈만)', '#/ · #/services', I, R, '#/services 에서 6+2 통합 서비스 허브 제공, GNB 단일화', '실제 SSO·기존 시스템 연동은 Mock'],
  'SFR-003': ['홈페이지 통합', '고객 중심 메뉴 구조', 'GNB 6메뉴 · 메가메뉴 · #/sitemap', I, R, '메뉴 구조도(#/sitemap), 6개 사이트 기능 재배치', '콘텐츠·기능 통폐합 분석 문서는 docs/03_IA.md'],
  'SFR-004': ['홈페이지 통합', 'UI/UX 디자인', 'Header · Quick menu · 반응형', P, R, 'Header/Quick menu/사이트맵, 반응형, 디자인 토큰(public/css/tokens.css)', '디자인 시안 3종 요건: 홈 레이아웃 3종(?v=a|b|c) 제공 — 정식 시안 제출은 본사업'],
  'SFR-005': ['홈페이지 통합', '무투24 메인', '#/ · #/mykotra · #/programs', P, R, '고객그룹별(준비·초보·유망·중견) 사업 필터, 로그인 후 기업정보·신청현황·상담이력·관심정보, 상담/FAQ/민원, 홍보·알림', '무역자료실 PG 결제(도서구매)·TriBIG 분석서비스 신청은 범위 외'],
  'SFR-006': ['홈페이지 통합', '무투24 관리자', '#/admin/content · #/admin/users · #/admin/audit', P, R, '콘텐츠 등록/게시/미리보기, 배너, 공지, 사용자·권한, 감사로그, 통계', '멀티사이트/게시판 유형/SNS 간편로그인/콘텐츠 배포 승인은 본사업'],
  'SFR-007': ['홈페이지 통합', 'IK & 옴부즈만 메인', '#/invest', P, R, 'Why Korea·인센티브·가이드·규제·투자상담·고충상담·AI 투자도우미', '국문·영문 제공(중·일문은 i18n 확장 구조만), IKMP·국내복귀 신청은 범위 외'],
  'SFR-008': ['홈페이지 통합', 'IK & 옴부즈만 관리자', '#/staff/consult · #/admin/audit', P, PA, '투자/고충 상담 접수·배정·처리·이력', '홈닥터 배정, IKMP, 투자초기비용 도구 등은 본사업'],
  'SFR-009': ['고객데이터 통합', 'MDM 개요', '#/admin/data-integration · #/admin/data-integration/:tab · #/admin/mdm', M, R, '합성 CRM_DEMO·BUYKOREA_DEMO 2계통 원천 연결(Connector 계약)·스키마 발견·ERD·MDM 정본·ODS·계보(실측), 기존 Mock MDM 화면 병행', '실제 CRM·BuyKOREA 연계 없음 — LIVE 커넥터는 PLANNED/비활성(보안 심의·읽기 전용 계정·Gateway 승인 필요)'],
  'SFR-010': ['고객데이터 통합', 'MDM 구축', '#/admin/data-integration/:tab · #/admin/data', M, R, '정본·Crosswalk·활동 이벤트, 스냅샷/증분 파이프라인, 장애(오류 주입)·재시도·정합성 검증·워터마크, 계보', '합성 데이터 기준. 이기종 EAI/ESB·CDC·대용량 성능은 본사업 실측(CDC는 지원한다고 표시하지 않음)'],
  'SFR-011': ['고객데이터 통합', '고객데이터 정비', '#/admin/data-integration/:tab · #/admin/mdm', P, R, '중복 후보(블로킹·점수·하드블록)·MDM Review·승인형 병합/Unmerge, 품질 6차원 실측, 정비 워크플로우(승인 값만 적용), 5개년 동의 필터', '실제 5년 이내 동의 고객 데이터 범위·대량 이관은 본사업. 병합은 항상 승인형(자동 병합 없음)'],
  'SFR-012': ['고객데이터 통합', 'CRM·BuyKorea 개선', '#/admin/data-integration/:tab', P, PA, '신규 가입 중복 방지 시뮬레이터(DEMO 저장소, 계정 존재 노출 방지)', '실제 CRM·BuyKOREA 소스 기능 변경·API Adapter 연동은 본사업(승인·테스트 필요)'],
  'SFR-013': ['고객상담 데이터', '상담 목표·개요', '#/staff/consult', I, R, 'Single View 한 화면 구성', ''],
  'SFR-014': ['고객상담 데이터', '일반 공통', '#/staff/consult', P, R, 'Single View, 역할 기반 접근, 조회 이력(감사), 민감정보(EXTRA CARE) 접근 제한', 'CTI/IVR 연계는 Mock'],
  'SFR-015': ['고객상담 데이터', '상담 요약', '#/staff/consult', P, R, '화자 구분 대화 → 항목 자동 추출 → 상담원 수정·확정(HITL), 신뢰도 낮으면 수동 작성 안내, 처리 지연 표시', '10초 이내·만족도 8점 목표는 실측 후 보고(규칙 기반 요약기, sLLM 어댑터 교체 가능)'],
  'SFR-016': ['고객상담 데이터', '상담 기본', '#/staff/consult', I, R, '기본정보·이력·사업참여·EXTRA CARE', '시연 데이터'],
  'SFR-017': ['고객상담 데이터', '상담 관리', '#/staff/consult', I, R, '이관(대상·사유), 콜백 예약, 상태·변경 이력', ''],
  'SFR-018': ['고객상담 데이터', 'STT', '#/staff/stt', M, R, '업로드→STT→화자구분→개인정보 마스킹→요약→검토 파이프라인, 브라우저 음성인식(Web Speech)', 'STT 엔진은 샘플 대본 Mock, CER 5% 이하는 미측정(평가 데이터셋 필요)'],
  'SFR-019': ['고객상담 데이터', 'sLLM 요약', '#/staff/consult', P, PA, '요약기 Adapter(개인정보 제외 요약)', 'sLLM 모델 미탑재, 규칙 기반'],
  'SFR-020': ['AI 수출비서', '목표 서비스(1·2단계)', '#/assistant', I, R, '1단계 큐레이터(Multi-RAG) + 2단계 Tool 실행/HITL', 'HITL 원칙·위험도 차등 승인 구현'],
  'SFR-021': ['AI 수출비서', '에이전트', '#/assistant · #/admin/ai', P, R, 'Supervisor + 시장·규제·바이어·사업·전시·마케팅·계약·상담·보고서·투자 Agent', '물류/보험/금융 외부 연계, 통관 컴플라이언스 점검, Deep Research 수준 보고서는 범위 외'],
  'SFR-022': ['AI 수출비서', 'LLMOps', '#/admin/ai', P, R, '프롬프트 버전·테스트·롤백, 모델 레지스트리, 자동 평가(50문항), 모니터링', '오픈소스 LLMOps 솔루션·GPU·미세조정·폐쇄망 모델 교체는 본사업'],
  'SFR-023': ['AI 수출비서', 'LLM 기능', '#/admin/ai (모델)', P, PA, 'Model Gateway 어댑터(키 설정 시 LIVE), 멀티 모델 레지스트리', '27B+ 모델 2식·16~65K 컨텍스트는 본사업 인프라'],
  'SFR-024': ['AI 수출비서', 'LLM 아키텍처', 'docs/02_ARCHITECTURE.md', D, NA, '어댑터 구조 문서', '클러스터/GPU/폐쇄망 구성은 설계만'],
  'SFR-025': ['AI 수출비서', 'Multi-RAG', '#/admin/rag · #/assistant', P, R, '10개 도메인 컬렉션, 하이브리드(BM25+개념벡터)·RRF·Rerank·질의분해·Multi-Hop(HS)·Text-to-SQL·권한별 지식 제한, 16개 옵션 ON/OFF, Lexical/Semantic/Hybrid 시뮬레이터, A/B', '외부 임베딩/벡터DB·Graph RAG(선택, 기본 OFF)·CSV/PDF 질의는 범위 외'],
  'SFR-026': ['AI 수출비서', 'Agentic AI', '#/assistant · #/admin/ai (Tool)', P, R, 'Tool Registry(위험도·권한·유량제한), 4종 Memory(세션/케이스/고객/지식), HITL, 외부 API 로깅·모니터링', 'MCP/위젯형·URL스키마형 외부 서비스 임베딩은 Mock 수준'],
  'SFR-027': ['AI 수출비서', '사용자 UI', '#/assistant', P, R, '스트리밍, 출처·원문, 아티팩트 패널, 별점·오류신고, 프롬프트 라이브러리, 대화 관리·내보내기(txt/json/html), 첨부 Q&A(txt/csv/md/json), 개인정보 차단, 범위 밖 질의 대응, 모바일 반응형', 'PDF/HWP/이미지 파싱·푸시 알림·Excel 내보내기는 범위 외'],
  'SFR-028': ['AI 수출비서', 'AX Playground', '#/playground', P, PA, '앱스토어 카탈로그·Fork·좋아요', '노코드 빌더(Agent/Chatflow/Workflow)는 Coming in Full Program'],
  'SFR-029': ['AI 수출비서', '챗봇 관리자', '#/admin/ai', P, R, '대화 로그·Trace, 응답시간/오류율 지표, 보안 룰 위반 탐지, 오류 신고 관리, 첨부 용량·질의횟수·반복질의 제한', 'SSO/MFA·모델 서빙 Health는 일부(상태 표시)'],
  'SFR-030': ['상담매칭', '목표·개요', '#/events', I, R, '행사→참가→신청→매칭→상담→일지→만족도→후속지원 전주기', ''],
  'SFR-031': ['상담매칭', '국내기업 기능', '#/events/:id · #/mykotra/matching', I, R, '참가신청→승인, 바이어 검색(해시태그 포함)·관심 설정, 30분 타임테이블, 상담 신청/수락·반려, 현황, 만족도', ''],
  'SFR-032': ['상담매칭', '해외바이어 기능', '#/events/:id (바이어 로그인)', I, R, '기업 조회·관심·타임테이블(행사 현지시간+바이어 현지시간), 신청·수락/반려, 만족도', ''],
  'SFR-033': ['상담매칭', '행사운영 관리', '#/admin/matching', P, R, '참가자 승인, 현황 개요', '행사 신규 개설 폼은 시드 데이터로 대체'],
  'SFR-034': ['상담매칭', '부가정보 관리', '#/admin/matching', P, PA, '상담장(Hall)·통역사 관리', ''],
  'SFR-035': ['상담매칭', '참가 바이어 관리', '#/admin/matching', P, R, '바이어 참가 승인/반려', ''],
  'SFR-036': ['상담매칭', '상담매칭 관리', '#/admin/matching', I, R, '자동매칭 조건(상호신청 우선·일방·주선불가·기업별 최소/최대·그룹별 상담장), 수동 조정, 현장매칭, 알림(Mock 메일), 엑셀(CSV) 다운로드', ''],
  'SFR-037': ['상담매칭', '현장운영 관리', '#/admin/matching', P, R, '충돌 검증, 현장매칭, 상태 관리', '현장 체크인/QR은 범위 외'],
  'SFR-038': ['상담매칭', '결과·통계', '#/admin/matching', P, R, '상태별·활용률·만족도 통계, CSV', ''],
  'SFR-039': ['상담매칭', '통역사 지원', '#/admin/matching', P, PA, '통역사 배정·출석 등록', '통역사 전용 임시 로그인·일지 작성은 범위 외'],
  'SFR-040': ['상담매칭', '상시상담 지원', '-', O, NA, '-', '본사업 범위'],
  'SFR-041': ['상담매칭', '공통·연계 데이터', '#/admin/system', M, PA, 'CRM 연계 이벤트(Mock)', ''],
  'SFR-042': ['상담매칭', 'AI 상담일지 자동 작성', '#/staff/stt · #/admin/matching', M, PA, '녹음 업로드→STT(Mock)→요약→일지 저장, 키워드', '음성인식/화자분리 서버 운영관리·부하분산·시간동기 재생은 범위 외'],
  'SFR-043': ['상담매칭', '맞춤형 서비스', '#/events/:id · #/admin/matching', I, R, '설명 가능한 Match Score(품목30·국가20·거래조건15·관심10·시간10·성과10·기타5), 수동/자동 단계 AI 추천, 연관 사업 추천', ''],
  'SFR-044': ['해외정보', '목표·개요', '#/staff/research', I, R, '업무 상태가 흐르는 워크플로우', ''],
  'SFR-045': ['해외정보', 'GMR 작성 관리', '#/staff/research', P, PA, 'GMR 유형 요청·보고서 작성·평가 흐름', '주제 공모/심의위원 심의는 범위 외'],
  'SFR-046': ['해외정보', 'GIM 작성 관리', '#/staff/research', P, PA, 'GIM 유형 요청 흐름', '이슈 모니터링 자동화는 범위 외'],
  'SFR-047': ['해외정보', '지시조사 요청 관리', '#/staff/research · #/admin/approvals', I, R, '요청→총괄 승인(HITL)→무역관 배정', '사용자 정의 조사양식 편집기는 범위 외'],
  'SFR-048': ['해외정보', '지시조사 수행', '#/staff/research', I, R, '접수·조율의견·결과 제출·보완 제출, AI 초안 지원', ''],
  'SFR-049': ['해외정보', '보고서 확인·평가', '#/staff/research', I, R, '보완요청→재제출→완료→평가', ''],
  'SFR-050': ['해외정보', '조사 통합 현황 대시보드', '#/staff/research', I, R, '무역관별 진행·지연·평균 회신일·평가', ''],
  'SFR-051': ['해외정보', '공통 기능·연계', '#/staff/research', P, PA, '한/영 UI, 앱 내 알림, 보안 등급별 접근, 검색', '워드→한글 변환·메신저 연계는 범위 외'],
  'SFR-052': ['해외정보', '해외시장뉴스 작성 Agent', '#/staff/news · #/staff/research', P, PA, '조사 보고서 AI 초안(기존 자료 요약), 제목 추천·요약', '유형별(10종) 템플릿 Agent·썸네일 생성·설정 관리는 범위 외'],
  'SFR-053': ['해외정보', '교정교열 Agent', '#/staff/news', P, R, '전/후 비교 하이라이트, 맞춤법·표기·금칙어·개인정보 검사, 팩트체크(KOTRA DB 근거), 피드백, 성과 통계, 담당자 승인 후 게시', '외국어 원고 번역 우선은 Mock, 국립국어원/언론 표기 DB 학습은 본사업'],
  'SFR-054': ['통합 데이터 저장소', '목표·개요', '#/admin/data', P, R, 'Data Catalog·Pipeline·Lineage·Quality UI와 데이터 환류(Flywheel)', '실제 Lakehouse 구축은 본사업'],
  'SFR-055': ['통합 데이터 저장소', '국가 공유데이터 플랫폼 연계', '-', O, NA, '-', '본사업 범위'],
  'SFR-056': ['통합 데이터 저장소', '데이터 수집', '#/admin/data (Pipeline)', M, R, '수집 단계 실행(Mock 원천 포함), 장애 시 알림·재실행', ''],
  'SFR-057': ['통합 데이터 저장소', '전처리', '#/admin/data', P, R, '검증 규칙·품질 점수, PII 필드 가명처리 대상 표시, 리니지', '실제 가명처리·동적 비식별화 엔진은 본사업'],
  'SFR-058': ['통합 데이터 저장소', '저장', '-', D, NA, 'SQLite 저장(MVP)', 'Lakehouse(객체저장소·카탈로그) 아키텍처는 문서화'],
  'SFR-059': ['통합 데이터 저장소', '모니터링', '#/admin/data', P, R, '접근제어, SQL 조회(GUI), Data Drift(PSI) 알림, 시각화 리니지', '다양한 DB 커넥터·드래그앤드롭 분석은 범위 외'],
  'SFR-060': ['통합 데이터 저장소', '저장소 연계', '#/admin/system', M, PA, '연계 이벤트(Mock)', ''],
  'SFR-061': ['통합 데이터 저장소', '오픈 API', '/open-api/v1/*', P, R, 'REST JSON/XML 동시 제공, API Key, 유량 제한, 접근 로그', 'NIA 게이트웨이 인증모듈은 범위 외'],
};
const OTHER = {
  'CNR-006': ['컨설팅', 'CRM·BuyKOREA 고객 식별·구조·중복·계보 분석', '#/admin/data-integration · #/admin/data-integration/:tab', P, PA, '합성 2계통 스키마 자동 발견·프로파일·As-Is ERD(선언/추론 관계 구분)·중복/품질 진단·인벤토리 증적 문서(Evidence Center)', '운영 DB·인터뷰·현행 데이터 진단은 본사업 컨설팅. 합성 예시이며 실제 구조가 아님'],
  'CNR-007': ['컨설팅', 'CRM 확장 MDM 논리/물리 모델·표준·식별·병합 정책', '#/admin/data-integration/:tab', P, PA, 'To-Be MDM 모델 v1(ERD·DDL 미리보기·표준 점검)·데이터 사전·매핑 정의서·식별/병합 정책·영향 분석', 'KOTRA 승인된 물리 모델·코드 기준 확정 필요. DDL은 검토용이며 자동 실행하지 않음'],
  // [task, module, screen, impl, demo, evidence, notes]
  'DAR-004': ['데이터', '데이터 모델·벡터 스키마', 'docs/04_DATA_MODEL.md · #/admin/rag', P, PA, 'ERD 및 chunks/documents 스키마', ''],
  'DAR-005': ['데이터', '데이터 값 검증', '#/admin/data', I, R, '품질 규칙 엔진(not_null/unique)', ''],
  'DAR-010': ['데이터', '데이터 품질', '#/admin/data', I, R, '데이터셋별 품질 점수·이슈', ''],
  'DAR-014': ['데이터', '데이터 개방·메타데이터', '/open-api/v1/* · #/admin/data', P, R, 'Open API + Catalog 메타', ''],
  'SER-007': ['개인정보보호', '개인정보보호 및 보안대책', 'AI 응답 필터 · 로그 마스킹', P, R, '이메일·전화·주민번호 마스킹, 질의 차단, 로그 PII 최소화, 접근범위 5단계', '암호화·가명처리 엔진은 본사업'],
  'SER-009': ['보안', '보안 및 감사 기능', '#/admin/audit', I, R, '해시체인 감사로그(변조 검증), 역할 기반 접근 통제, 관리자 Action 감사', ''],
  'SER-008': ['보안', '시큐어 코딩', 'server/*', P, PA, '파라미터 바인딩 SQL, 입력 검증, CSP·보안 헤더, 세션 쿠키 HttpOnly', '정적/동적 분석 도구 점검은 본사업'],
  'SER-011': ['보안', '시스템 보안 기능', '서버 전역', P, PA, '세션·RBAC·레이트리밋', 'MFA·SSO는 본사업'],
  'SER-013': ['보안', 'DB 암호화', '-', O, NA, '-', '본사업(운영 DB 암호화)'],
  'PER-002': ['성능', '처리 속도 확보(3초)', '#/admin/system', P, R, 'API p50/p95/3초 초과 건수 모니터링', '부하 테스트 증적은 본사업 TER-004'],
  'PER-005': ['성능', '느린 작업 사전 경고', '전역 UI(slow-op 알림)', I, R, '3초 초과 예상 작업 사전 안내 및 진행 표시', ''],
  'PER-006': ['성능', '가용성', '/api/health', P, PA, 'Health 엔드포인트', '24/365 이중화는 본사업'],
  'SIR-001': ['인터페이스', '사용자 친화적 UI', '전역', P, R, '직관적 GNB·빵부스러기·상태 표시', ''],
  'SIR-002': ['인터페이스', 'UI 호환성', '전역', P, R, '표준 웹 기술, 반응형, 다중 브라우저', ''],
  'COR-006': ['준수사항', '웹표준·호환성', '전역', P, R, 'HTML5 표준 마크업', ''],
  'COR-007': ['준수사항', '웹접근성', '전역', P, R, '건너뛰기 링크, ARIA, 키보드 포커스, 글자 크기·고대비 모드', '인증 심사는 본사업'],
  'QUR-005': ['품질', 'AI 품질', '#/admin/ai (평가)', P, R, 'Citation·Groundedness·Helpfulness·Safety·NDCG@5 자동 평가, Tool 성공률, 지표 대시보드', 'F1/벤치마크 확장·외부 인증(TTA CAT)은 본사업'],
  'QUR-004': ['품질', '가용성 보장', '/api/health', P, PA, 'Health 체크', ''],
  'TER-001': ['테스트', '테스트 준수사항', 'test/', P, R, '시나리오 기반 자동 테스트', ''],
  'TER-003': ['테스트', '통합테스트', 'test/scenarios.test.js', P, R, '시나리오 A~D 자동화', ''],
  'PMR-002': ['프로젝트관리', '요구사항 관리', '#/admin/rfp', I, R, '요구사항 150건 추적 매트릭스', ''],
};
const DEFAULT_BY_PREFIX = {
  CCR: [O, NA, '클라우드', '운영 인프라 요건은 본사업(MVP는 단일 노드)'], CNR: [O, NA, '컨설팅', '컨설팅 산출물은 본사업(MVP는 시연 목적)'], DAR: [D, NA, '데이터', '데이터 표준/이관/코드체계는 본사업'],
  SER: [D, NA, '보안', '운영 보안 통제는 본사업'], PER: [D, NA, '성능', '성능 시험은 본사업'], SIR: [P, PA, '인터페이스', ''], TER: [D, NA, '테스트', '정식 테스트 단계는 본사업'], QUR: [D, NA, '품질', '품질 보증 체계는 본사업'],
  PMR: [O, NA, '프로젝트관리', '사업 수행 관리 요건(MVP 범위 외)'], PSR: [O, NA, '프로젝트지원', '사업 수행 지원 요건(MVP 범위 외)'], COR: [D, NA, '준수사항', '준수 증빙은 본사업'],
};
function buildCoverage(reqs) {
  return reqs.map((r) => {
    const pre = r.id.split('-')[0];
    const m = SFR[r.id] || OTHER[r.id];
    if (m) return { id: r.id, category: pre, name: r.name, task: m[0], module: m[1], screen: m[2], impl_status: m[3], demo_status: m[4], evidence: m[5], notes: m[6], detail: r.detail || '' };
    const d = DEFAULT_BY_PREFIX[pre] || [O, NA, '기타', ''];
    return { id: r.id, category: pre, name: r.name, task: d[2], module: r.name, screen: '-', impl_status: d[0], demo_status: d[1], evidence: '-', notes: d[3], detail: r.detail || '' };
  });
}
module.exports = { buildCoverage };
