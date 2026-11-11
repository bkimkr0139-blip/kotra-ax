# 02. 아키텍처
```
Browser (SPA, ES modules, no build)  ──HTTPS──▶  Caddy/nginx/cloudflared  ──▶  Node http server (server/index.js)
                                                                              ├─ router.js (RBAC, rate limit, api_logs)
                                                                              ├─ routes/*  → domain/services.js → gov.js (state machines, approvals, audit chain)
                                                                              ├─ ai/agents.js (orchestrator) → ai/tools.js (risk policy) → ai/rag.js (hybrid retrieval)
                                                                              └─ SQLite (node:sqlite, WAL)  ◀─ seed (deterministic, synthetic)
```
- **플랫폼 중립 계약**: 엔터티·상태전이·Tool 계약·AI 응답 형식·Seed·시나리오가 문서/코드에 분리되어 있어 Base44 등 다른 구현체가 동일 계약을 따를 수 있습니다 (`docs/04,05,06`, `seed/*.json`).
- **Adapter 경계**: LLM(`ai/llm.js`), 임베딩(`ai/rag.js` 개념벡터), STT(`routes/staff.js` + `domain/stt_samples.js`), CRM/BuyKOREA(`crm_customers` Mock), 메일/SMS(`outbox`), 사업관리 연계(`integration_events`).
- **의존성 0**: Node ≥ 22.5 만 필요. 프레임워크/번들러/외부 CDN 없음 → 폐쇄망·공공 환경에서 재현 가능, CSP `script-src 'self'`.
- **RFP 스택 차이**: RFP는 JAVA/전자정부 표준프레임워크를 요구합니다. 이 MVP는 계약 검증용 Node 구현이며 본사업에서 표준프레임워크로 이식해야 합니다 (`12_LIMITATIONS.md`).

## 데이터 흐름 (Data Flywheel)
고객 행동 → 상담·신청·매칭 → 해외무역관 조사 → 완료 시 **RAG-MARKET 자동 색인** → AI 수출비서가 즉시 근거로 사용 → 개인화 추천 → 더 나은 행동. 시나리오 C 테스트가 이 순환을 자동 검증합니다.
