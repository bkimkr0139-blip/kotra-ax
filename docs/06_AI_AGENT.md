# 06. AI Agent · Tool · Memory (자동 생성)

## Agent Registry
| ID | Agent | 역할 | RAG | Tools | RFP |
|---|---|---|---|---|---|
| supervisor | Supervisor Agent | 요청을 분해하고 하위 Agent를 선택·통합 |  | approval.request | SFR-021, SFR-026 |
| market | Market Agent | 국가·산업·품목 시장분석 및 진출전략 요약 | MARKET | market.search, stats.query | SFR-021 |
| market_reco | Market Recommendation Agent | 기업 특성 기반 유망시장 추천 | MARKET | market.search, stats.query | SFR-021 |
| regulation | Regulation Agent | HS·규제·인증·필수서류 체크리스트 | REGULATION | regulation.search | SFR-021, SFR-025 |
| buyer | Buyer Discovery Agent | 후보 바이어 발굴 및 추천 근거 | BUYER | buyer.search, buyer.recommend | SFR-021 |
| buyer_verify | Buyer Verification Agent | 신뢰도·거래 가능성 검토 | BUYER | buyer.detail, buyer.verify | SFR-021 |
| program | Program Agent | KOTRA·공공 지원사업 추천과 신청 초안 | PROGRAM | program.search, program.recommend, document.generate | SFR-021 |
| exhibition | Exhibition Agent | 전시회·상담회 추천 | EXHIBITION, PROGRAM | event.search | SFR-021 |
| marketing | Marketing Agent | 카탈로그·이메일·미팅 준비 | MARKETING | document.generate, notification.preview | SFR-021 |
| contract | Contract Agent | 계약 조항 리스크 검토 (HITL) | LOGISTICS | contract.review | SFR-021 |
| logistics | Logistics Agent | 물류·통관·결제 절차 정리 | LOGISTICS, REGULATION |  | SFR-021 |
| consultation | Consultation Agent | 애로 분류·담당조직 제안·상담 등록 | CONSULTATION, GENERAL | consultation.create, consultation.route | SFR-017 |
| report | Report Agent | 시장진출 보고서 생성(출처 포함) | MARKET, REGULATION, PROGRAM | report.create | SFR-021 |
| followup | Follow-up Agent | 상담 후속조치·알림 | PROGRAM | notification.preview, matching.request | SFR-043 |
| invest | Invest KOREA Agent | 외국인 투자 안내(인센티브·절차·옴부즈만) | INVEST |  | SFR-007 |

## Tool Registry
| Tool | 위험도 | HITL | 연계 | 허용 역할 | 제한/분 |
|---|---|---|---|---|---|
| knowledge.search | LOW | - | INTERNAL | customer, buyer, consultant, office, admin, anon | 40 |
| market.search | LOW | - | INTERNAL | customer, buyer, consultant, office, admin, anon | 30 |
| regulation.search | LOW | - | INTERNAL | customer, buyer, consultant, office, admin, anon | 30 |
| stats.query | LOW | - | INTERNAL | customer, consultant, office, admin | 20 |
| buyer.search | LOW | - | INTERNAL | customer, consultant, admin | 30 |
| buyer.detail | LOW | - | INTERNAL | customer, consultant, admin | 30 |
| buyer.recommend | LOW | - | INTERNAL | customer, consultant, admin | 20 |
| buyer.verify | LOW | - | MOCK | customer, consultant, admin | 20 |
| program.search | LOW | - | INTERNAL | customer, buyer, consultant, office, admin, anon | 30 |
| program.detail | LOW | - | INTERNAL | customer, buyer, consultant, office, admin, anon | 30 |
| program.recommend | LOW | - | INTERNAL | customer, consultant, admin | 20 |
| event.search | LOW | - | INTERNAL | customer, buyer, consultant, office, admin, anon | 30 |
| contract.review | LOW | - | INTERNAL | customer, consultant, admin | 10 |
| report.create | MEDIUM | - | INTERNAL | customer, consultant, admin | 10 |
| document.generate | MEDIUM | - | INTERNAL | customer, consultant, admin | 10 |
| consultation.create | MEDIUM | - | INTERNAL | customer, consultant, admin | 10 |
| consultation.route | LOW | - | INTERNAL | customer, consultant, admin | 20 |
| matching.request | HIGH | Y | INTERNAL | customer, admin | 10 |
| application.submit | HIGH | Y | MOCK_EXTERNAL | customer, admin | 5 |
| email.send | HIGH | Y | MOCK_EXTERNAL | customer, admin | 5 |
| notification.preview | LOW | - | INTERNAL | customer, consultant, admin | 20 |
| approval.request | LOW | - | INTERNAL | customer, consultant, office, admin | 20 |
| customer.lookup_other | BLOCKED | - | BLOCKED | - | 0 |
| admin.export_data | BLOCKED | - | BLOCKED | admin | 0 |

위험도 정책: LOW 자동 · MEDIUM 실행 후 확인 · HIGH 반드시 HITL(승인 해제 불가) · BLOCKED 차단.

## Orchestration
User → Screen(PII/Injection/Profanity) → Exfil/Scope check → Intent·Entity(+Memory) → Planner(+Direct-hit retrieval) → Agent Router(RAG/SQL/Tool) → Evidence Validator(abstain) → Answer Composer(local | LLM adapter) → PII mask → Risk Policy → HITL → Response/Action.

## Memory
- Session: chat_sessions/chat_messages (이전 턴의 국가·품목 상속)
- Case: export_projects.memory + journey (상태 단방향 진행)
- Customer: companies 프로필 (타 기업 접근 차단)
- Knowledge: documents/chunks (access_scope 로 권한별 제한)
