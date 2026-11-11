# 11. RFP 추적 (자동 생성)

원문(제안요청서 2026.10) 요구사항 150건 → MVP 모듈/화면/구현 상태. 실시간 화면: **관리자 > RFP Coverage**.

합계: DESIGN_ONLY: 39 · IMPLEMENTED: 21 · MOCK: 7 · OUT_OF_MVP: 31 · PARTIAL: 52

| 구분 | 합계 | 구현 | 부분 | Mock | 설계만 | 본사업 |
|---|---|---|---|---|---|---|
| CCR | 6 | 0 | 0 | 0 | 0 | 6 |
| CNR | 7 | 0 | 2 | 0 | 0 | 5 |
| COR | 12 | 0 | 2 | 0 | 10 | 0 |
| DAR | 14 | 2 | 2 | 0 | 10 | 0 |
| PER | 6 | 1 | 2 | 0 | 3 | 0 |
| PMR | 8 | 1 | 0 | 0 | 0 | 7 |
| PSR | 10 | 0 | 0 | 0 | 0 | 10 |
| QUR | 5 | 0 | 2 | 0 | 3 | 0 |
| SER | 13 | 1 | 3 | 0 | 8 | 1 |
| SFR | 61 | 16 | 34 | 7 | 2 | 2 |
| SIR | 3 | 0 | 3 | 0 | 0 | 0 |
| TER | 5 | 0 | 2 | 0 | 3 | 0 |

## SFR 상세
| ID | 요구사항 | 모듈 | 화면 | 구현 | 시연 | 비고 |
|---|---|---|---|---|---|---|
| SFR-001 | 기능 기본 요건 | 플랫폼 공통 | 전역 | PARTIAL | PARTIAL | RFP는 JAVA·전자정부 표준프레임워크 기준이나 MVP는 지시서의 플랫폼 중립 계약(API/엔터티/상태전이)으로 구현. 본사업에서 표준프레임워크 이식 필요 |
| SFR-002 | (공통) 지능형 무역투자 통합 채널 목표 서비스 개요 | 통합 채널(무투24 + IK&옴부즈만) | #/ · #/services | IMPLEMENTED | READY | 실제 SSO·기존 시스템 연동은 Mock |
| SFR-003 | (무역투자24) 기본 요구사항 | 고객 중심 메뉴 구조 | GNB 6메뉴 · 메가메뉴 · #/sitemap | IMPLEMENTED | READY | 콘텐츠·기능 통폐합 분석 문서는 docs/03_IA.md |
| SFR-004 | (무역투자24) UI/UX 디자인 | UI/UX 디자인 | Header · Quick menu · 반응형 | PARTIAL | READY | 디자인 시안 3종 요건: 홈 레이아웃 3종(?v=a/b/c) 제공 — 정식 시안 제출은 본사업 |
| SFR-005 | (무역투자24) 홈페이지 메인 페이지 | 무투24 메인 | #/ · #/mykotra · #/programs | PARTIAL | READY | 무역자료실 PG 결제(도서구매)·TriBIG 분석서비스 신청은 범위 외 |
| SFR-006 | (무역투자24) 홈페이지 관리자 페이지 | 무투24 관리자 | #/admin/content · #/admin/users · #/admin/audit | PARTIAL | READY | 멀티사이트/게시판 유형/SNS 간편로그인/콘텐츠 배포 승인은 본사업 |
| SFR-007 | (Invest KOREA & OMBUDSMAN) 홈페이지 메인 페이지 | IK & 옴부즈만 메인 | #/invest | PARTIAL | READY | 국문·영문 제공(중·일문은 i18n 확장 구조만), IKMP·국내복귀 신청은 범위 외 |
| SFR-008 | (Invest KOREA & OMBUDSMAN) 홈페이지 관리자 페이지 | IK & 옴부즈만 관리자 | #/staff/consult · #/admin/audit | PARTIAL | PARTIAL | 홈닥터 배정, IKMP, 투자초기비용 도구 등은 본사업 |
| SFR-009 | (고객데이터 통합) 고객데이터 통합 개요 | MDM 개요 | #/admin/data-integration · #/admin/data-integration/:tab · #/admin/mdm | MOCK | READY | 실제 CRM·BuyKOREA 연계 없음 — LIVE 커넥터는 PLANNED/비활성(보안 심의·읽기 전용 계정·Gateway 승인 필요) |
| SFR-010 | (고객데이터 통합) 고객정보 MDM 구축 | MDM 구축 | #/admin/data-integration/:tab · #/admin/data | MOCK | READY | 합성 데이터 기준. 이기종 EAI/ESB·CDC·대용량 성능은 본사업 실측(CDC는 지원한다고 표시하지 않음) |
| SFR-011 | (고객데이터 통합) 고객데이터 정비 | 고객데이터 정비 | #/admin/data-integration/:tab · #/admin/mdm | PARTIAL | READY | 실제 5년 이내 동의 고객 데이터 범위·대량 이관은 본사업. 병합은 항상 승인형(자동 병합 없음) |
| SFR-012 | (고객데이터 통합) CRM BuyKorea 기능개선 | CRM·BuyKorea 개선 | #/admin/data-integration/:tab | PARTIAL | PARTIAL | 실제 CRM·BuyKOREA 소스 기능 변경·API Adapter 연동은 본사업(승인·테스트 필요) |
| SFR-013 | (고객상담 데이터 관리) 목표 및 서비스 개요 | 상담 목표·개요 | #/staff/consult | IMPLEMENTED | READY |  |
| SFR-014 | (고객상담 데이터 관리) 일반 공통 | 일반 공통 | #/staff/consult | PARTIAL | READY | CTI/IVR 연계는 Mock |
| SFR-015 | (고객상담 데이터 관리) 상담 요약 | 상담 요약 | #/staff/consult | PARTIAL | READY | 10초 이내·만족도 8점 목표는 실측 후 보고(규칙 기반 요약기, sLLM 어댑터 교체 가능) |
| SFR-016 | (고객상담 데이터 관리) 상담 기본 | 상담 기본 | #/staff/consult | IMPLEMENTED | READY | 시연 데이터 |
| SFR-017 | (고객상담 데이터 관리) 상담 관리 | 상담 관리 | #/staff/consult | IMPLEMENTED | READY |  |
| SFR-018 | (고객상담 데이터 관리) AI 서비스 - STT | STT | #/staff/stt | MOCK | READY | STT 엔진은 샘플 대본 Mock, CER 5% 이하는 미측정(평가 데이터셋 필요) |
| SFR-019 | (고객상담 데이터 관리) AI 서비스 - sLLM | sLLM 요약 | #/staff/consult | PARTIAL | PARTIAL | sLLM 모델 미탑재, 규칙 기반 |
| SFR-020 | (AI) AI 수출비서 목표 서비스 | 목표 서비스(1·2단계) | #/assistant | IMPLEMENTED | READY | HITL 원칙·위험도 차등 승인 구현 |
| SFR-021 | (AI) AI 수출비서 에이전트 | 에이전트 | #/assistant · #/admin/ai | PARTIAL | READY | 물류/보험/금융 외부 연계, 통관 컴플라이언스 점검, Deep Research 수준 보고서는 범위 외 |
| SFR-022 | (AI) AI수출비서 LLMOps | LLMOps | #/admin/ai | PARTIAL | READY | 오픈소스 LLMOps 솔루션·GPU·미세조정·폐쇄망 모델 교체는 본사업 |
| SFR-023 | (AI) LLM 기능 요구사항 | LLM 기능 | #/admin/ai (모델) | PARTIAL | PARTIAL | 27B+ 모델 2식·16~65K 컨텍스트는 본사업 인프라 |
| SFR-024 | (AI) LLM 아키텍처 구성 | LLM 아키텍처 | docs/02_ARCHITECTURE.md | DESIGN_ONLY | N/A | 클러스터/GPU/폐쇄망 구성은 설계만 |
| SFR-025 | (AI) AI 수출비서 Multi-RAG 아키텍처 | Multi-RAG | #/admin/rag · #/assistant | PARTIAL | READY | 외부 임베딩/벡터DB·Graph RAG(선택, 기본 OFF)·CSV/PDF 질의는 범위 외 |
| SFR-026 | (AI) AI 수출비서 Agentic AI | Agentic AI | #/assistant · #/admin/ai (Tool) | PARTIAL | READY | MCP/위젯형·URL스키마형 외부 서비스 임베딩은 Mock 수준 |
| SFR-027 | (AI) AI 수출비서 - 사용자 | 사용자 UI | #/assistant | PARTIAL | READY | PDF/HWP/이미지 파싱·푸시 알림·Excel 내보내기는 범위 외 |
| SFR-028 | (AI) AX Playground - 사용자 | AX Playground | #/playground | PARTIAL | PARTIAL | 노코드 빌더(Agent/Chatflow/Workflow)는 Coming in Full Program |
| SFR-029 | (AI) AI 챗봇 관리자 기능 | 챗봇 관리자 | #/admin/ai | PARTIAL | READY | SSO/MFA·모델 서빙 Health는 일부(상태 표시) |
| SFR-030 | (상담매칭) 지능형 상담매칭 시스템 목표 서비스 개요 | 목표·개요 | #/events | IMPLEMENTED | READY |  |
| SFR-031 | (상담매칭) 행사운영 페이지 - 국내기업 기능 | 국내기업 기능 | #/events/:id · #/mykotra/matching | IMPLEMENTED | READY |  |
| SFR-032 | (상담매칭) 행사운영 페이지 – 해외바이어 기능 | 해외바이어 기능 | #/events/:id (바이어 로그인) | IMPLEMENTED | READY |  |
| SFR-033 | (상담매칭) 관리자 페이지 – 행사운영 페이지 관리 | 행사운영 관리 | #/admin/matching | PARTIAL | READY | 행사 신규 개설 폼은 시드 데이터로 대체 |
| SFR-034 | (상담매칭) 관리자 페이지 – 행사운영 부가정보 관리 | 부가정보 관리 | #/admin/matching | PARTIAL | PARTIAL |  |
| SFR-035 | (상담매칭) 관리자 페이지 – 행사참가 바이어정보 관리 | 참가 바이어 관리 | #/admin/matching | PARTIAL | READY |  |
| SFR-036 | (상담매칭) 관리자 페이지 - 상담매칭 관리 | 상담매칭 관리 | #/admin/matching | IMPLEMENTED | READY |  |
| SFR-037 | (상담매칭) 관리자 페이지 - 현장운영 관리 | 현장운영 관리 | #/admin/matching | PARTIAL | READY | 현장 체크인/QR은 범위 외 |
| SFR-038 | (상담매칭) 관리자 페이지 – 상담결과 및 통계관리 | 결과·통계 | #/admin/matching | PARTIAL | READY |  |
| SFR-039 | (상담매칭) 관리자 페이지 – 통역사 지원 | 통역사 지원 | #/admin/matching | PARTIAL | PARTIAL | 통역사 전용 임시 로그인·일지 작성은 범위 외 |
| SFR-040 | (상담매칭) 관리자 페이지 – 상시상담 지원 | 상시상담 지원 | - | OUT_OF_MVP | N/A | 본사업 범위 |
| SFR-041 | (상담매칭) 공통 기능 및 연계 데이터 | 공통·연계 데이터 | #/admin/system | MOCK | PARTIAL |  |
| SFR-042 | (상담매칭) AI 기반 상담일지 자동 작성 | AI 상담일지 자동 작성 | #/staff/stt · #/admin/matching | MOCK | PARTIAL | 음성인식/화자분리 서버 운영관리·부하분산·시간동기 재생은 범위 외 |
| SFR-043 | (상담매칭) 맞춤형 서비스 제공 | 맞춤형 서비스 | #/events/:id · #/admin/matching | IMPLEMENTED | READY |  |
| SFR-044 | (해외정보) 해외정보 관리 시스템 목표 서비스 개요 | 목표·개요 | #/staff/research | IMPLEMENTED | READY |  |
| SFR-045 | (해외정보) GMR 작성 업무 관리 | GMR 작성 관리 | #/staff/research | PARTIAL | PARTIAL | 주제 공모/심의위원 심의는 범위 외 |
| SFR-046 | (해외정보) GIM 작성 업무 관리 | GIM 작성 관리 | #/staff/research | PARTIAL | PARTIAL | 이슈 모니터링 자동화는 범위 외 |
| SFR-047 | (해외정보) 지시조사 요청 등 관리자 기능 | 지시조사 요청 관리 | #/staff/research · #/admin/approvals | IMPLEMENTED | READY | 사용자 정의 조사양식 편집기는 범위 외 |
| SFR-048 | (해외정보) 지시조사 수행 | 지시조사 수행 | #/staff/research | IMPLEMENTED | READY |  |
| SFR-049 | (해외정보) 조사보고서 확인 및 평가 | 보고서 확인·평가 | #/staff/research | IMPLEMENTED | READY |  |
| SFR-050 | (해외정보) 조사 통합 현황 대시보드 | 조사 통합 현황 대시보드 | #/staff/research | IMPLEMENTED | READY |  |
| SFR-051 | (해외정보) 공통 기능 및 연계 데이터 | 공통 기능·연계 | #/staff/research | PARTIAL | PARTIAL | 워드→한글 변환·메신저 연계는 범위 외 |
| SFR-052 | (해외정보) 해외시장뉴스 작성 Agent (해시뉴스Agent) | 해외시장뉴스 작성 Agent | #/staff/news · #/staff/research | PARTIAL | PARTIAL | 유형별(10종) 템플릿 Agent·썸네일 생성·설정 관리는 범위 외 |
| SFR-053 | (해외정보) 해외시장뉴스 교정교열 Agent (교정교열Agent) | 교정교열 Agent | #/staff/news | PARTIAL | READY | 외국어 원고 번역 우선은 Mock, 국립국어원/언론 표기 DB 학습은 본사업 |
| SFR-054 | (통합저장소) 통합 데이터 저장소 목표 서비스 개요 | 목표·개요 | #/admin/data | PARTIAL | READY | 실제 Lakehouse 구축은 본사업 |
| SFR-055 | (통합저장소) 국가 공유데이터 플랫폼 연계 기반 구축 | 국가 공유데이터 플랫폼 연계 | - | OUT_OF_MVP | N/A | 본사업 범위 |
| SFR-056 | (통합저장소) 데이터 수집 기능 | 데이터 수집 | #/admin/data (Pipeline) | MOCK | READY |  |
| SFR-057 | (통합저장소) 데이터 전처리 기능 | 전처리 | #/admin/data | PARTIAL | READY | 실제 가명처리·동적 비식별화 엔진은 본사업 |
| SFR-058 | (통합저장소) 데이터 저장 기능 | 저장 | - | DESIGN_ONLY | N/A | Lakehouse(객체저장소·카탈로그) 아키텍처는 문서화 |
| SFR-059 | (통합저장소) 데이터 모니터링 기능 | 모니터링 | #/admin/data | PARTIAL | READY | 다양한 DB 커넥터·드래그앤드롭 분석은 범위 외 |
| SFR-060 | (통합저장소) 통합 데이터 저장소 연계 | 저장소 연계 | #/admin/system | MOCK | PARTIAL |  |
| SFR-061 | (통합저장소) 오픈 API 기반 공공 데이터 개방 체계 구축 | 오픈 API | /open-api/v1/* | PARTIAL | READY | NIA 게이트웨이 인증모듈은 범위 외 |
