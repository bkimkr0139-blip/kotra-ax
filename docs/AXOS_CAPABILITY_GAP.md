# AXOS 기능 호환성 / Capability Gap (지시서 v1.0 §17.3)

이 구현체는 AXOS 플랫폼 위가 아니라 **제로-의존성 Node(Claude Code 구현체)** 이므로, 지시서의 “AXOS 내장 기능 실측표”를 이 구현체 기준으로 기록하고 미지원 항목은 서버측 교체형 Connector/Worker 로 처리했습니다. AXOS 제품 자체의 지원 범위는 **미확인**이며 본 문서가 확인했다고 주장하지 않습니다.

| 필요 기능 | 이 구현체에서의 처리 | 상태 | 대체/후속 |
|---|---|---|---|
| 엔터티 인덱스·유일성·트랜잭션 | SQLite 부분 유니크 인덱스, 재진입 트랜잭션(`q.tx`), 서버 중복 검사 | 구현·테스트 | 본사업: 외부 트랜잭션 DB |
| 통합 ERD(전 테이블) | 실 DB 메타(PRAGMA)+큐레이션 논리관계(포함관계 실측 검증)로 모델 생성, 클라이언트 SVG 렌더(ERwin/DA# 두 표기) | 구현(115 엔터티) | 운영 DB 메타 수집은 승인된 Gateway 후 |
| 동적 ERD / SVG Export | 서버가 모델 JSON 에서 SVG·Mermaid·DDL 생성, 클라이언트 Pan/Zoom·PNG 래스터화 | 구현(수 엔터티~수십 엔터티) | 30 엔터티 이상은 React Flow/Mermaid 등 UI 라이브러리 검토 |
| 백엔드 비동기 Job | 요청 내 동기 실행(트랜잭션) — 단건 수 초 이내 | 부분 | 대량은 외부 Queue/Worker(`run`/`retry` 계약은 job 형태로 이식 가능) |
| 외부 DB Read-only | **데모 테이블만** 허용 목록으로 읽기. LIVE 커넥터는 PLANNED·비활성 | 의도적 제한 | 보안심의 후 승인된 Gateway |
| CDC / 증분 | `incremental_by_updated_at` 구현, **CDC 미지원(표시 그대로)** | 부분 | CDC 는 교체형 어댑터 |
| LLM 구조화 JSON | 규칙 기반 AI Data Architect + 자체 JSON 검증/Allowlist(LLM 미사용) | 부분 | 모델 Gateway + Schema Validator 로 교체 가능 |
| 권한·분류·감사 | 서버 RBAC(역할 매핑), 해시체인 감사, 마스킹, 서버측 부정 테스트 | 구현·테스트 | MFA/SSO 는 본사업 |
| 데이터·코드 내보내기 | ERD(SVG/PNG/JSON/Mermaid/DDL), 증적 문서(MD/CSV), 골든 데이터셋 JSON, 소스 저장소 | 구현 | 백업/복구는 `docs/14_OPERATIONS.md` |

## 미구현/범위 밖 (정직한 목록)
- 실제 CRM·BuyKOREA·KOTRA SSO 연동, 운영 DB 메타 수집, 대용량·성능 수치.
- 통합 ERD 의 수동 배치는 브라우저(localStorage)에만 저장되며 서버·팀 공유·ERD 버전 관리는 없음. 다중 사용자 협업 편집·Forward/Reverse Engineering 적용(DDL 실행)은 범위 밖.
- DB 방언별 DDL(ANSI/SQLite 2종만), API DTO·OpenAPI 자동 생성(문서는 `docs/05_API_CONTRACT.md` 자동 생성으로 대체).
- 자동 정합성 수식의 1:N 개체별 Reconciliation 은 Crosswalk·ODS·활동 3종까지(상품·계정은 문서화).
