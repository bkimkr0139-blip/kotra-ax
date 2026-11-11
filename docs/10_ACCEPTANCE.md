# 10. 검수 결과 (실측)
| 항목 | 결과 | 증적 |
|---|---|---|
| 통합 시나리오 A~D · 권한 · SQL 가드 · Open API | **7/7 통과** | `npm test` |
| 브라우저 전 화면 순회 (대고객 44 + 직원/관리자/바이어/무역관 49) | **JS 오류 0 · 위험 경고 0** | Playwright 스윕 |
| AI 자동평가 50문항 (근거·유보·차단·Tool) | **통과율 100%** (최초 74% → 직접검색·사업명 인식·문장분할 개선) | 관리자 > AI Operations > 품질평가 |
| AI 보안 (인젝션·타 기업 정보·PII·첨부 인젝션·문서 격리) | 전부 차단/격리, 감사 기록, 해시체인 정상 | Scenario D 테스트 |
| 성능 (로컬, 동시 20~25) | `/api/programs` p95 40ms · `/api/dashboard` p95 53ms · `/api/search` p95 99ms · AI 답변(RAG) 약 60~110ms | 부하 스크립트 |
| 모바일 (390px) | 가로 스크롤 0 (홈·사업·시장·AI·바이어·행사·로그인) | Playwright |
| 한/영 | 전 화면 전환, `lang` 속성 갱신 | Playwright |
| 공개 모드 보안 | Host 검증 421, Secure+HSTS, 스태프 원클릭 403, 기본 비밀번호 폐기 | 수동 curl 검증 |
**Acceptance Matrix**(지시서 §35): 로그인/권한 · MyKOTRA · AI 수출비서 · 출처 · 바이어/사업 추천 · 상담등록 · 상담매칭 · 해외정보 Workflow · HITL · 관리자 · RAG 관리 · AI Trace · Audit · 모바일 · 접근권한 차단 · 오류복구 → 구현체 기준 Pass. 반복 시연 안정성은 Demo Director Seed Reset 으로 보장. **Base44 구현체는 이 저장소에 없으므로 비교 열은 공란입니다** (`IMPLEMENTATION_PARITY_MATRIX.md`).
**미검증(정직한 공개)**: 동시 100+ 사용자 부하, 실제 LLM 연결 시 품질, 접근성 심사, 장시간 안정성, 다중 노드 구성.
