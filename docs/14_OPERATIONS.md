# 14. 운영
- **헬스체크**: `GET /api/health`. 로그: 요청당 JSON 1줄(`LOG_JSON=false` 로 끔). `api_logs` 테이블에 p50/p95/3초 초과/오류율 집계(관리자 > 모니터링).
- **백업**: `data/kotra.db`(+`-wal`,`-shm`) — 서비스 중지 후 복사하거나 `sqlite3 data/kotra.db ".backup file"`. 감사 체인 검증: 관리자 > 감사로그.
- **시연 복구**: 관리자 > Demo Director > Seed Reset (세션 초기화, 관리자 재로그인). CLI: `npm run seed`.
- **Demo Clock**: 기본 2026-11-09 고정(D-Day·모집상태 계산). Demo Director 에서 변경, 해제는 빈 값 `DEMO_CLOCK=`.
- **RAG 재색인**: 관리자 > RAG Manager. 파이프라인 실행(Catalog > Pipeline)은 실제 검증·재색인을 수행합니다.
- **LLM 전환**: 서버 환경변수 `ANTHROPIC_API_KEY`, `LLM_MODEL`; Demo Director 에서 AUTO/LOCAL/LIVE fallback 선택. 응답마다 `provenance` 표기.
- **문서 갱신**: `node scripts/gen-docs.js` (데이터 모델·API·Agent/Tool·RFP 추적 재생성).
