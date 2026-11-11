# KOTRA 지능형 무역투자플랫폼 MVP — Claude Code 구현체

고객이 **로그인 → 조회 → AI 수출비서 → 업무처리(신청·상담·매칭) → 저장 → 관리자 모니터링**까지 실제 상태가 이어지는 풀서비스 MVP입니다.
지시서 v3.0 + 제안요청서 원문(`seed/rfp_requirements.json`, 150건)을 기준으로 구현했습니다. **한국어/English** 전 화면 지원.

## 빠른 시작
```bash
node -v            # >= 22.5 (내장 node:sqlite 사용, 외부 의존성 0개)
npm start          # http://localhost:4400  (첫 실행 시 시연 데이터 자동 시드)
npm test           # 통합 시나리오 A~D · 권한 · HITL · 감사 테스트
npm run seed       # 시연 데이터 초기화    npm run seed:export  # seed/*.json 내보내기
```
시연 로그인: 로그인 화면의 **페르소나 카드 5종**(P1 기업·P2 바이어·P3 상담위원·P4 무역관·P5 관리자). 계정 로그인은 `.env.example` 의 `DEMO_PASSWORD`.

## 구성
| 영역 | 위치 |
|---|---|
| 대고객 포털 (홈·해외시장·바이어·지원사업·상담매칭·상담·AI 수출비서·MyKOTRA·Invest KOREA) | `public/js/pages/*` |
| 직원 콘솔 (상담 Single View·STT·지시조사·시장뉴스 AI) / 관리자 (AI Ops·RAG·데이터·MDM·감사·RFP·Demo Director) | `public/js/pages/staff.js`, `admin*.js` |
| API · 서비스 · 상태전이 · 승인(HITL) · 감사 해시체인 | `server/routes`, `server/domain`, `server/gov.js` |
| AI (Multi-RAG · Agent · Tool · LLM 어댑터) | `server/ai/*` |
| 시연 데이터(결정적 합성) | `server/seed`, `seed/*.json` |
| 배포 (Caddy/nginx/systemd/Docker/Cloudflare Tunnel) | `deploy/`, `Dockerfile`, `docker-compose.yml` |
| 문서 | `docs/` (자동 생성 문서: 04·05·06·11) |

## 원칙 (지시서 §39)
- 구현하지 않은 기능은 동작하는 것처럼 표시하지 않습니다 → `LIVE / CACHED / MOCK / SYNTHETIC / LOCAL` 배지, `docs/12_LIMITATIONS.md`, 관리자 **RFP Coverage**.
- 대외 영향 작업(신청 제출·상담 신청·메일·조사 배정·뉴스 게시·병합)은 **서버가 HITL 승인 없이 실행하지 않습니다**.
- AI 답변은 출처 필수, 근거 없으면 유보, 개인정보는 마스킹·차단, 문서 속 지시문은 데이터로만 취급합니다.

## 외부 공개
`docs/13_DEPLOYMENT.md` 참고 (`https://kotra-ax2.wizbase.ai.kr/`). 공개 시 `PUBLIC_URL` 설정만으로 Secure 쿠키·HSTS·Host 검증·기본 비밀번호 폐기·스태프 원클릭 로그인 차단이 켜집니다.


## AX개발 · AXOS 폐루프
우측 가장자리 **AX개발** 탭(모든 화면)에서 현재 화면의 세부 기능별 피드백을 남기면 RTM 연결 → 책임자 승인(HITL) → 작업지시서 → AXOS Worker 자동개발 → 테스트·결과 보고 → 현업 확인 → RTM·릴리즈 반영으로 이어집니다. `#/axdev`(센터: RTM·게이트·제안·컨소시엄), `#/axos`(자동개발 콘솔). 상세: `docs/15_AX_DEV_LOOP.md`, Worker: `node scripts/axos-worker.js once`.

## 데이터 통합·MDM (Intelligent Data Integration Studio)
관리자 콘솔 > **데이터 통합·MDM**(`#/admin/data-integration`): CRM·BuyKOREA 합성 원천의 스키마 발견·ERD·매핑·고객 식별/MDM 병합(승인형)·품질·파이프라인(증분/오류 주입/재시도)·계보·**자기진화 엔진**(드리프트→AI 제안→샌드박스→승인→Demo 배포→롤백)·Evidence Center. 상세: `docs/16_DATA_INTEGRATION.md`, 한계: `docs/AXOS_CAPABILITY_GAP.md`.
