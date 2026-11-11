# Implementation Parity Matrix
이 저장소는 **Claude Code 구현체**입니다. Base44 구현체는 포함하지 않으므로 Base44 열은 평가 시 채워 넣으세요. 동일 계약: `04_DATA_MODEL`, `05_API_CONTRACT`, `06_AI_AGENT`, `seed/*.json`, `09_DEMO_SCENARIOS`.
| 평가영역 | Base44 | Claude Code (본 저장소) |
|---|---|---|
| 로그인/권한 | | Pass (RBAC·소유권·감사) |
| MyKOTRA Cockpit | | Pass |
| AI 수출비서 (스트리밍·출처·Artifact·Tool) | | Pass (LOCAL 엔진; LLM 어댑터) |
| 바이어/사업 추천 설명 | | Pass |
| 상담등록 · Single View · STT(Mock) | | Pass / STT Mock |
| 상담매칭 (30분 타임테이블·자동매칭) | | Pass |
| 해외정보 Workflow · 뉴스 AI | | Pass |
| HITL | | Pass (서버 강제) |
| 관리자 · RAG · AI Trace · Audit | | Pass |
| 모바일 · 한/영 | | Pass |
| 반복 시연 안정성 | | Pass (Seed Reset · Demo Clock) |
