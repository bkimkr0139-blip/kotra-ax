# 07. Multi-RAG
- **컬렉션 10개** (RFP SFR-025 도메인 + 전시·투자·일반): MARKET, REGULATION, BUYER, MARKETING, LOGISTICS, PROGRAM, EXHIBITION, CONSULTATION, INVEST, GENERAL. 문서·청크는 모두 DB 행에서 생성(시장콘텐츠·규제·사업·FAQ·바이어·행사·가이드·조사보고서).
- **검색**: BM25(한국어 조사/어미 처리 + 음절 bigram) + 개념벡터/3-gram 의미 점수 → **RRF** → **Rerank**(커버리지·메타데이터·최신성) → **증거 검증**(임계값·커버리지·미지 용어 가드) → 근거 부족이면 **유보**.
- **메타데이터 필터/가중**: 국가·HS·문서유형, 불일치 감점. **Multi-Hop**: 규제 결과의 HS를 후속 검색에 전달. **Query rewrite/HyDE-lite**: 개념 동의어 확장(KO↔EN).
- **권한별 지식 제한**: `access_scope` PUBLIC/MEMBER/INTERNAL/SENSITIVE/CONFIDENTIAL × 사용자 clearance. 내부 문서는 고객 질의에 노출되지 않음.
- **Prompt Injection 격리**: 문서 업로드/색인 시 패턴 탐지 → `QUARANTINED`(검색 제외, 감사 기록). 첨부 파일은 문장 단위로 지시문을 제거하고 데이터로만 사용.
- **Text-to-SQL**: 화이트리스트 테이블 읽기전용 SELECT, 실행 SQL을 Trace/Artifact에 공개.
- **관리자 도구**: 옵션 16종 ON/OFF, Lexical/Semantic/Hybrid 시뮬레이터, A/B(Rerank·RRF 유/무), Top-K/임계값/재색인.
- **평가**: 50문항(근거·유보·차단·Tool) — Citation, Groundedness, Helpfulness, Safety, NDCG@5, 통과율 (`관리자 > AI Operations > 품질평가`).
- 임베딩은 로컬 개념벡터 어댑터입니다. 외부 임베딩/벡터DB는 `ai/rag.js` 의 점수 함수를 교체하면 됩니다.
