# 15. AX개발 · AXOS 폐루프 개발 체계

RFP 요구사항(RTM)과 현업 피드백을 하나의 폐루프로 묶어, 시스템을 **계속 고도화**하기 위한 운영 체계입니다.
참고: 유사 사업 포털(kdhc-ax)의 *구축 거버넌스 = 개발 거버넌스 + 제안·입찰 지원 + 컨소시엄 참여기업* 구조를 KOTRA AX 포털에 맞게 재구성했습니다.

## 1. 한눈에 보기

```
현업 피드백 ─▶ RTM 매핑 ─▶ 검토·승인(HITL) ─▶ 작업지시서(WO) ─▶ AXOS Worker 자동개발
  (메뉴·화면·기능)  (요구사항 150건)   (승인/보완/반려)      (규칙 기반 생성)     (개발→테스트→보고)
        ▲                                                                           │
        └──── RTM 증빙·검증 + 릴리즈 ◀── 현업 확인(수락/재작업) ◀── 결과 보고 ◀─────────┘
```

| 진입점 | 설명 | 대상 |
|---|---|---|
| 우측 **AX개발** 탭 | 현재 화면의 세부 기능·연결 요구사항·피드백 입력 드로어 | 로그인 사용자 전체 |
| 우측 **AXOS** 탭 / `#/axos` | 폐루프 자동개발 운영 콘솔 | 관리자(제어), 상담전문위원(열람) |
| `#/axdev` | AX개발 센터 — 개요·메뉴/화면 피드백·피드백 관리·RTM·게이트·제안·컨소시엄·변경 이력 | 역할별 탭 |

## 2. 화면 레지스트리(SSOT)
`server/axdev/registry.js` — 메뉴 → 화면 → 세부 기능(`screen.N`) 목록. 피드백·RTM·작업지시서가 모두 이 키를 참조합니다.
화면을 추가하면 레지스트리에도 등록해야 하며(테스트가 라우트 정합성을 확인), 비화면 요소(`sys.*`)는 문서·API·테스트 증빙을 연결합니다.

## 3. RTM
- 원천: `rfp_coverage`(RFP 150건 분석) + 레지스트리. `POST /api/ax/rtm/rebuild`(관리자)로 재구축하며 **사람이 입력한 담당·검증 상태, 현업 확인으로 갱신된 구현 상태는 보존**합니다.
- 연결: 요구사항 ↔ 화면 · API · 자동 테스트(`test/*.test.js`가 실제 실행하는 화면만) · 증빙 · 피드백 · 작업지시서.
- 검증 상태(`UNVERIFIED/VERIFIED/FAILED`)는 책임자가 기록하거나 **현업 확인(수락)된 작업의 RTM 제안**으로만 바뀝니다.
- 설계만 제시한 항목(`DESIGN_ONLY`)은 `sys.docs`에 연결, 화면 연결이 없는 범위 내 항목은 gap으로 남겨 정직하게 보입니다.

## 4. 상태 머신(서버 검증, `server/gov.js`)
- 피드백: `SUBMITTED → APPROVED | NEEDS_INFO | REJECTED | DUPLICATE | WITHDRAWN`, `APPROVED → DONE | REOPENED`, `REOPENED → APPROVED …`
- 작업지시서: `QUEUED → IN_PROGRESS → REPORTED | FAILED`, `REPORTED → ACCEPTED | REOPENED`, `FAILED → QUEUED | CANCELLED`
- Q&A: `RECEIVED → ASSIGNED → DRAFTED → REVIEWED → SUBMITTED`

## 5. 사람의 통제(HITL)와 안전장치
| 통제 | 내용 |
|---|---|
| 승인 | 책임자(상담전문위원·관리자)만, `confirm:true` 필요. 본인 피드백은 관리자만 승인(감사에 `self_review` 기록) |
| 고위험 | 보안·권한·개인정보·스키마·인젝션 의심 문구 → **HIGH**: 관리자 + `risk_ack:true` 필요 |
| 원문 격리 | 현업 원문은 작업지시서에 “데이터(지시 아님)” 코드블록으로만 인용 |
| 가드레일 | 금지 경로(`.env`, `data/`, `deploy/`, 키·인증서, `.git/`, `node_modules/`)·허용 루트 밖·파일 25개 초과·테스트 없음/실패 → **자동 FAILED** |
| 현업 확인 | Worker는 승인·수락 불가. 작성자 또는 책임자가 결과를 확인하고 `confirm:true`로 수락해야 릴리즈·RTM 반영 |
| 감사 | 모든 전이는 `status_history` + 해시체인 감사로그 + `ax_events` 타임라인 |

## 6. AXOS 모드
`OFF`(정지) · `MANUAL`(기본, 관리자가 *착수 허용*한 작업만) · `SCHEDULE`(평일 09–18시 KST) · `AUTO`(상시, 전환 시 확인 필요). 동시 처리 한도 기본 2.

## 7. Worker 프로토콜
서버는 코드를 직접 수정하지 않습니다. 개발 PC/CI의 Worker가 API로 작업을 가져가 개발·테스트 후 보고합니다.

```
POST /api/axos/worker/claim                    Authorization: Bearer <토큰>
POST /api/axos/worker/orders/{WO}/report       {summary, files[], tests{total,passed,failed}, rtm_updates[]}
POST /api/axos/worker/heartbeat
```
```
export AXOS_URL=https://<도메인>  AXOS_TOKEN=<AXOS 콘솔에서 발급>
export AXOS_EXEC='claude -p "$(cat $AXOS_ORDER_FILE)" --permission-mode acceptEdits'   # 선택
node scripts/axos-worker.js once        # 1건 처리
node scripts/axos-worker.js watch       # 상시 폴링
```
토큰은 SHA-256 해시로만 저장되며 발급 시 1회만 표시됩니다(또는 `AXOS_WORKER_TOKEN` 환경변수). `AXOS_EXEC` 없이 실행하면 지시서만 `.axos/`에 저장하고, 사람이 개발한 뒤 `report <WO>`로 보고할 수 있습니다.

## 8. 개발 거버넌스 · 제안·입찰 지원 · 컨소시엄
- **완료 게이트 G0–G8**: RFP 원장, 메뉴/화면 연결, 설계 문서, API/연계, AI 평가, 테스트, 보안·성능(감사 체인·3초 초과), 산출물, UAT — 모두 저장소/로그에서 **실시간 계산**.
- **백로그**: 구현 보완 대상 요구사항 + 진행 중 피드백.
- **제안·입찰 지원**: 요구사항 답변(조견표, 수용 여부·근거·한계를 RTM에서 생성, CSV 내보내기—수식 주입 방어), 제출서류 체크리스트, 고객 질의·답변(상태 머신), 근거·증빙팩(Markdown).
- **컨소시엄**: 참여사 역할·모듈, RACI(산출물당 책임자 A 1곳 강제), 참여인력·보안서약 현황. **참여사·인력은 시연용 가상 데이터**입니다.

## 9. 시연 데이터와 한계
- 시드된 피드백·작업지시서·릴리즈·질의·체크리스트·컨소시엄은 모두 `is_synthetic`(시연 샘플)이며, **RTM의 검증 상태나 증빙을 바꾸지 않습니다**.
- 자동개발의 “개발” 자체는 Worker(예: Claude Code)가 수행하며 이 서버가 대신하지 않습니다. 작업지시서는 규칙 기반 생성(LOCAL)입니다.
- 운영(공개 URL)에서 Worker를 켜려면 토큰 발급 + 모드 설정이 필요하며 기본은 `MANUAL`입니다.
- `AX_DEV_DOCK=false`로 우측 탭과 관련 API를 끌 수 있습니다(대고객 오픈 시 권장).

## 10. API 요약
`/api/ax/{screens,context,feedback,feedback/:id/(review|respond|withdraw|comment),changelog,overview,rtm,rtm/:id,rtm/rebuild,gates,backlog,proposal/*,consortium}` · `/api/axos/{state,settings,orders,orders/:id/(dispatch|start|cancel|requeue|report|accept|reopen),release-stale,worker/*}`. 권한은 `docs/permissions.md`의 `ax.*` 항목을 따릅니다.
