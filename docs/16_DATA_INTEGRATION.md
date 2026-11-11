# 16. 데이터 통합·MDM — Intelligent Data Integration Studio

「KOTRA AXOS 지능형 고객·데이터 통합 스튜디오 추가개발 지시서 v1.0」을 현재 시스템(제로-의존성 Node, SQLite, 기존 RBAC·HITL·감사 해시체인·상태머신·AX개발 루프)의 **관리체계에 맞춰** 증분 구현한 모듈입니다. 기존 화면·API·권한·데이터는 삭제·초기화·대체하지 않았습니다.

> **한계 고지(중요)** CRM·BuyKOREA 원천 스키마, ID, 수치는 **제안용 합성 예시**입니다(`SYNTHETIC`). 실제 KOTRA 운영 DB의 확인된 구조나 기존 연동 완료를 뜻하지 않습니다. `CRM_LIVE`·`BUYKOREA_LIVE`·`KOTRA_SSO_LIVE` 는 `PLANNED`/비활성이며, 운영계 쓰기·자동 DDL·CDC 는 지원하지 않습니다.

## 1. 진입점 · 기능 플래그
- 관리자 콘솔 사이드바 **데이터 통합·MDM** 그룹 → `#/admin/data-integration[/탭]` (14개 화면, 스펙 §2 IA 와 동일).
- `DATA_INTEGRATION_STUDIO_ENABLED` (기본: 시연 환경 true, `DEMO_MODE=false` 환경 false). 비활성이면 라우트·메뉴·API(404) 모두 숨겨집니다.
- 선택: `DI_STRICT_SOD=true`(요청자·승인자·배포자 3자 분리), `DI_HASH_SALT`(이메일 해시 솔트).

## 2. 화면(탭) ↔ 스펙
| 탭 | 구현 |
|---|---|
| 통합 스튜디오 홈 | 연계 상태(LIVE/MOCK/DEMO/SYNTHETIC/PLANNED), KPI 6종(**계산식·분모·기준 시각·출처 툴팁**, 하드코딩 없음), 데이터 흐름, 오늘 처리할 일, 품질 추세·중복 현황·스키마 변동·최근 Trace, 시연 가이드 |
| 원천 연결(Connection Lab) | 원천 등록(FILE_UPLOAD만)·읽기 전용 연결 테스트·마스킹 미리보기·Connector 계약(`discoverSchema/previewRead/snapshot/incremental/health/watermark/capabilities`) |
| 스키마 발견 | 실측 테이블/컬럼/PK/FK, 프로파일(Null·Distinct·무효·분포), 선언/추론 관계(신뢰도·포함관계 검증), CRM↔BK 표준 개념 후보 자동 계산 |
| ERD Studio | CRM AS-IS · BK AS-IS · 공통 개념 · Target MDM · 변경 비교. Pan/Zoom/Fit/접기·펼치기/Auto layout, 인스펙터, DDL 미리보기·Mermaid·표준 점검·영향 분석, **SVG/PNG/JSON/Mermaid/DDL 내보내기(동일 모델에서 생성)** |
| 매핑 워크벤치 | 버전별 매핑, 필수 매핑 커버리지(분모 0 → N/A), **안전한 Rule DSL 13종**, 규칙 테스트(실제 200행 마스킹 미리보기), 표준 사전·코드표 |
| 고객 식별·중복 | 후보(AUTO_LINK_CANDIDATE / REVIEW_REQUIRED / DO_NOT_LINK), **MDM Review 2단 비교**, 병합 승인 Diff(예상 변경 건수·영향·추천 변화), 연계만·별도 유지·보완 요청, 신규 가입 중복 방지 시뮬레이터 |
| 정본(Golden Record) | 법인/담당자 구분, 속성별 출처·신뢰도·규칙·대안(Survivorship), SCD2 버전, Crosswalk, 동의, 활동, **Unmerge** |
| 데이터 품질 | 6대 차원 실측(계산식 표시), 가중 종합점수·rule_version, 추세, 정비 워크플로우 `DETECTED→…→CLOSED` |
| 파이프라인 | 10단계, 전체 적재·증분·**오류 주입·복구(재시도)·정합성 검증**, 원천 변경 주입(정정·동의 철회·신규 컬럼), 워터마크, 실행 이력 |
| 계보·영향 | 원천 레코드 → 매핑·표준 필드 → 정본 → ODS → 서비스(MyKOTRA·바이어 추천·지원사업·상담) |
| 자기진화 엔진 | 드리프트 → AI Data Architect 제안(JSON) → 샌드박스 → 승인(요청자≠승인자) → Demo 배포 → 모니터링 → 롤백 |
| 변경 승인함 · 감사 · 증적 | 병합·정비·진화 대기 통합, DI 감사 이벤트+해시체인, Evidence Center(10종 문서·자체 점검) |

## 3. 데이터 모델 (`server/di/ddl.js`)
메타 엔터티 `di_*` 약 30개(스펙 §5 와 1:1: DataSource, SourceSchemaSnapshot, ModelVersion, DataStandard, FieldMapping, DataProfile, DQRule/DQIssue, IdentityCandidate, MatchDecision, PartyMaster, SourceCrosswalk, GoldenRecordVersion, ConsentGrant, PipelineRun, DataLineageEdge, SchemaDriftEvent, EvolutionProposal, SandboxTestRun, ChangeRelease …).
원천 합성 테이블 `demo_crm_*`(3) · `demo_bk_*`(3)는 스펙 §6 DDL을 따르되, 식별·매칭에 필요한 컬럼을 보강했습니다(`business_reg_no`, `address_line`, `website`, `main_hs_code`, `consent_revoked_at`, BK `manager_name`, `company_reg_no`, `registered_address`, `website_url`).

**서버측 제약(물리 FK 대체)**: `UNIQUE(source_system, source_table, source_pk) WHERE status='ACTIVE'`, `UNIQUE(model scope,version)`, `UNIQUE(left_ref,right_ref)`, 트랜잭션·재처리 검사, 자체 점검(INV-01~03 등).

## 4. 안전 설계
- **읽기 전용 · 허용 목록**: 커넥터는 허용된 테이블 식별자만 읽고, 샘플은 기본 마스킹(이메일·식별번호·주소·이름). 브라우저→원천 직접 연결·LLM→임의 SQL/DDL 없음.
- **Rule DSL**: `TRIM, NFKC, UPPER, LOWER, LOOKUP_MAP, DATE_PARSE, SAFE_CAST, NULL_COALESCE, SPLIT, CONCAT, REGEX_REPLACE_ALLOWLIST(허용 패턴만), HASH_IDENTIFIER, VALIDATE_ENUM`. 임의 SQL·eval·무검증 정규식·외부 호출 거부.
- **동의**: 철회·만료·5개년 밖·목적 불일치 레코드는 정본을 만들지 않고 ODS·서빙에서 제외(재평가). 단순 “5년 이내”만으로 허용하지 않음.
- **식별**: 법인≠담당자≠계정. 검증 ID +45, 국가 +10, 법인명 +20, 주소 +10, 도메인 +10, 제품 +5. **하드 블록**: 상이한 검증 ID·국가 불일치(검증 ID 없음)·이메일만 일치 → 95점이어도 `DO_NOT_LINK`. **자동 병합 없음**.
- **병합 승인**: MDM 승인자(관리자) + `confirm` + `diff_ack` + 사유 + 낙관적 동시성(`expected_version`) + `Idempotency-Key`(중복 클릭 방지) + 검토자≠승인자. 원천 Crosswalk 보존, Golden 신규 버전, Unmerge 가능.
- **정비**: AI/규칙은 제안만, 승인된 값만 **표준화 계층 오버레이**로 적용(원천 불변).
- **파이프라인**: 단일 트랜잭션, 실패 시 전체 롤백·워터마크 비전진, 멱등 적재(원천 PK+지문), 격리(QUARANTINE)는 PARTIAL(성공으로 보고 안 함).
- **자기진화**: `auto_apply:false` 강제, JSON 검증+Allowlist, 샌드박스 게이트 6종 미달 시 자동 반려, 승인 전 매핑·모델·서빙 불변, 요청자 자가 승인 차단, 롤백은 설정 복구+보상 재처리(정본 삭제 없음).
- **서비스 반영**: 승인된 병합/릴리스만 ODS 서빙 키를 확장하고(`recommendBuyers` 가 이를 사용), 롤백하면 복원됩니다.

## 5. 역할 매핑 (스펙 §18 → 이 시스템)
| 스펙 역할 | 이 시스템 |
|---|---|
| Data Viewer / Demo Viewer | 관리자·상담전문위원·무역관 (읽기) |
| Data Steward · MDM Steward · Data Architect | 관리자·상담전문위원 |
| Connector Admin · Pipeline Operator · MDM Approver · Change Approver · Release Operator · Security Officer · Auditor | 관리자(ops/auditor 계정 포함) |
고객·바이어는 접근 불가이며, 기업 고객은 “왜 추천했나요?” 용 **요약 출처**(`/provenance/recommendation`)만 볼 수 있습니다(원천 레코드·타 기업 정보 비노출).

## 6. API (`/api/v1/data-integration`)
스펙 §16 표를 모두 구현하고 `/pipelines/runs/{id}/retry`, `/pipelines/inject`, `/identity/candidates/{id}/(preview|recommend)`, `/identity/signup-simulate`, `/masters`, `/lineage-index`, `/approvals`, `/audit`, `/selfcheck`, `/golden-dataset` 등을 추가했습니다. 오류는 `{ error: { code, message, extra: { retryable, operation_status } } }`. 전체 계약은 `docs/05_API_CONTRACT.md`(자동 생성).

## 7. 합성 원천과 Golden Test Dataset
CRM 51 + BuyKOREA 49 = 100 레코드(+ 참가·VOC·상품·문의), 고정 seed(20261109)로 재현. C01~C10 케이스는 `ExpectedMatch/Consent/QualityIssue/GoldenFields` 와 함께 `seed/di_golden_dataset.json` 및 화면 > 증적에서 내려받을 수 있고 `test/di.test.js` 가 기대값을 검증합니다.

## 8. 테스트 (스펙 §20)
`test/di.test.js` — TC-ERD-01/03 · TC-MAP-01/02 · TC-MDM-01~06 · TC-DQ-01 · TC-PRIV-01 · TC-ETL-01~03 · TC-EVO-01~04 · TC-LINEAGE-01 · TC-SEC-01 + Evidence/자체 점검. 라이브 상태 기반 **불변식 자체 점검**(관리자 > 증적)은 실행 시점의 실제 DB를 검사합니다.

## 9. 알려진 한계 / 스펙 대비 차이
- 합성 데이터·SQLite 데모 테이블 기반. 임의 외부 DB 메타 수집은 MVP 범위 밖(읽기 전용 Gateway 승인 이후).
- AI Data Architect 는 규칙 기반(provenance `LOCAL`)이며 LLM 을 사용하지 않습니다. 구조화 JSON 은 자체 최소 스키마+Allowlist 로 검증합니다.
- ERD 레이아웃은 결정적 그리드(수동 배치 저장 없음). PNG 는 브라우저에서 SVG 를 래스터화합니다.
- 단일 노드 SQLite(직렬 실행)라 동시성 한계가 있으며, 대용량·성능 수치는 본사업 실측 대상입니다. 자세한 AXOS 기능 대조는 `docs/AXOS_CAPABILITY_GAP.md`.


## 통합 ERD (KOTRA-AX 전체 데이터 구조)
`#/admin/data-integration/erd` 첫 탭 **KOTRA-AX 통합 ERD** — 앱의 모든 테이블(115 엔터티·1,200+ 컬럼)을 실제 DB 메타데이터에서 생성합니다.
- **관계**: 물리 FK(`PRAGMA foreign_key_list`)는 거의 없어 큐레이션한 논리 관계를 추가하고, 자식 값이 부모에 모두 존재하는지(포함관계) 실측 검증합니다. 검증 실패는 숨기지 않고 표시합니다. 다형 참조는 `soft`(회색 점선).
- **두 가지 표기**: ERwin(IDEF1X/IE — PK 구획, `(FK)`, 식별=실선·비식별=점선, 종속 엔터티 둥근 박스) / DA#(`#` 식별자·`*` 필수·`o` 선택, 주제영역 색상 헤더). 같은 모델을 토글로 전환.
- **개발자 기능**: 논리/물리/병기 이름, 엔터티·키·전체 속성 상세도, 주제영역 레인 + 영역 필터, 주제영역 관계도, 검색·포커스(더블클릭 1·2단계), 드래그 배치(브라우저 저장), 미니맵, 속성별 논리명·정의 보정(`PUT /glossary`, 감사 기록), 내보내기(SVG·PNG·JSON·Mermaid·DDL·테이블/컬럼 정의서 CSV·엔터티 목록 CSV).
- **API**: `GET /erd/unified`, `GET /erd/unified/export?format=ddl|mmd|json|dictionary|entities&area=`, `PUT /glossary`(DataArchitect).
