'use strict';
// KOTRA-AX 통합 ERD: 실제 DB 메타데이터(sqlite_master/PRAGMA)에서 전체 테이블·컬럼·관계를 읽어
// 주제영역·논리명(한글)·도메인·식별/비식별 관계를 부여한 통합 모델(JSON)을 만든다. ERwin·DA# 두 표기가 같은 모델을 그린다.
const { q } = require('../db');
const U = require('../util');
const { J, P } = require('./core');

// ───────── 주제영역(데이터 흐름 순서) ─────────
const AREAS = [
  ['DS', '원천(CRM·BuyKOREA 데모)', 'Sources (CRM / BuyKOREA demo)', '#7c3aed'], ['DR', 'Raw·표준·매핑', 'Raw · standard · mapping', '#0e7490'], ['DM', '마스터·MDM(정본)', 'Master · MDM', '#0b4ea2'],
  ['DQ', '품질·정비', 'Quality & remediation', '#b45309'], ['DP', '파이프라인·ODS·계보', 'Pipeline · ODS · lineage', '#15803d'], ['DV', '진화·모델·소스', 'Evolution · models · sources', '#be185d'],
  ['ID', '사용자·인증', 'Identity & access', '#334155'], ['CO', '기업·바이어', 'Companies & buyers', '#0369a1'], ['MK', '시장·무역정보', 'Market & trade info', '#047857'], ['PG', '지원사업·신청', 'Programs & applications', '#c2410c'],
  ['EV', '행사·상담매칭', 'Events & matching', '#a21caf'], ['CS', '상담·VOC', 'Consulting & VOC', '#4d7c0f'], ['RS', '해외정보·뉴스', 'Research & news', '#1d4ed8'], ['KN', '지식·RAG', 'Knowledge · RAG', '#0f766e'],
  ['CH', 'AI 수출비서 대화', 'AI assistant chat', '#6d28d9'], ['AI', 'AI 운영(Agent·Tool·평가)', 'AI operations', '#9333ea'], ['GV', '거버넌스·감사·연계', 'Governance & audit', '#475569'], ['LG', '레거시 데이터 플랫폼(MDM 모의)', 'Legacy data platform', '#64748b'], ['AX', 'AX개발·AXOS', 'AX dev · AXOS', '#dc2626'],
].map(([key, ko, en, color], order) => ({ key, ko, en, color, order }));

const BY_AREA = {
  DS: ['demo_crm_customer', 'demo_crm_participation', 'demo_crm_voc', 'demo_bk_member', 'demo_bk_product', 'demo_bk_inquiry'],
  DR: ['di_raw', 'di_mapping', 'di_standard', 'di_codeset', 'di_upload'],
  DM: ['di_party', 'di_crosswalk', 'di_golden', 'di_consent', 'di_affiliation', 'di_link', 'di_activity', 'di_candidate', 'di_decision', 'di_signup_sim'],
  DQ: ['di_dq_rule', 'di_dq_run', 'di_dq_issue', 'di_fix'],
  DP: ['di_run', 'di_watermark', 'di_ods', 'di_lineage', 'di_idem', 'di_event', 'di_selfcheck'],
  DV: ['di_source', 'di_snapshot', 'di_model', 'di_drift', 'di_proposal', 'di_sandbox', 'di_release', 'di_glossary'],
  ID: ['users', 'sessions'], CO: ['companies', 'buyers', 'buyer_favorites', 'export_projects'], MK: ['countries', 'market_content', 'regulations', 'trade_stats', 'faqs', 'notices', 'cms_banners'],
  PG: ['programs', 'applications', 'app_documents', 'program_favorites'], EV: ['events', 'event_participants', 'availability_slots', 'interpreters', 'match_requests', 'satisfaction'],
  CS: ['consultations', 'consultation_messages', 'consultation_summaries', 'consultation_transfers', 'stt_jobs'], RS: ['research_requests', 'news_drafts'], KN: ['collections', 'documents', 'chunks'],
  CH: ['chat_sessions', 'chat_messages', 'message_feedback', 'prompt_library', 'saved_items'], AI: ['agent_defs', 'agent_runs', 'tool_defs', 'tool_runs', 'prompt_versions', 'model_configs', 'eval_cases', 'eval_results', 'playground_apps'],
  GV: ['approvals', 'audit_events', 'status_history', 'notifications', 'outbox', 'api_logs', 'integration_events', 'seq', 'settings'], LG: ['crm_customers', 'mdm_masters', 'mdm_candidates', 'datasets', 'pipelines', 'pipeline_runs', 'quality_issues', 'rfp_coverage'],
  AX: ['ax_feedback', 'ax_orders', 'ax_events', 'ax_rtm', 'ax_rtm_snapshots', 'ax_releases', 'ax_checklist', 'ax_qna', 'ax_members', 'ax_staff', 'ax_raci'],
};
const AREA_OF = {}; for (const [a, ts] of Object.entries(BY_AREA)) ts.forEach((t) => { AREA_OF[t] = a; });
const areaOf = (t) => AREA_OF[t] || (t.startsWith('ax_') ? 'AX' : t.startsWith('di_') ? 'DV' : t.startsWith('demo_') ? 'DS' : 'GV');

// 엔터티(테이블) 논리명 — 엔터티 정의서의 기본값. 화면에서 수정하면 di_glossary 가 우선한다.
const TABLE_KO = {
  demo_crm_customer: 'CRM 고객', demo_crm_participation: 'CRM 사업참여', demo_crm_voc: 'CRM VOC', demo_bk_member: 'BK 회원', demo_bk_product: 'BK 상품', demo_bk_inquiry: 'BK 문의',
  di_glossary: '용어 사전 보정', di_raw: '원천 적재(Raw)', di_mapping: '필드 매핑', di_standard: '데이터 표준', di_codeset: '표준 코드표', di_upload: '업로드 원천', di_party: '정본(Party)', di_crosswalk: '원천 Crosswalk', di_golden: '정본 버전(Golden)', di_consent: '동의(목적별)',
  di_affiliation: '소속 관계', di_link: '정본 연계', di_activity: '고객 활동', di_candidate: '중복 후보', di_decision: '병합 결정', di_signup_sim: '가입 중복 검사', di_dq_rule: '품질 규칙', di_dq_run: '품질 검사 실행', di_dq_issue: '품질 이슈', di_fix: '정비 적용',
  di_run: '파이프라인 실행', di_watermark: '워터마크', di_ods: 'ODS 서빙 프로필', di_lineage: '데이터 계보', di_idem: '멱등 키', di_event: '스튜디오 이벤트', di_selfcheck: '불변식 자체 점검', di_source: '원천 시스템', di_snapshot: '스키마 스냅샷', di_model: '모델 버전',
  di_drift: '스키마 드리프트', di_proposal: '변경 제안', di_sandbox: '샌드박스 시험', di_release: '릴리스',
  users: '사용자', sessions: '세션', companies: '기업', buyers: '해외 바이어', buyer_favorites: '관심 바이어', export_projects: '수출 프로젝트', countries: '국가', market_content: '시장 콘텐츠', regulations: '규제·인증', trade_stats: '무역통계', faqs: 'FAQ', notices: '공지', cms_banners: '배너',
  programs: '지원사업', applications: '사업 신청', app_documents: '신청 서류', program_favorites: '관심 사업', events: '행사', event_participants: '행사 참가', availability_slots: '상담 가능 시간', interpreters: '통역사', match_requests: '상담 매칭', satisfaction: '만족도',
  consultations: '상담', consultation_messages: '상담 메시지', consultation_summaries: '상담 요약', consultation_transfers: '상담 이관', stt_jobs: 'STT 작업', research_requests: '지시조사', news_drafts: '시장뉴스 초안', collections: 'RAG 컬렉션', documents: 'RAG 문서', chunks: 'RAG 청크',
  chat_sessions: 'AI 대화 세션', chat_messages: 'AI 대화 메시지', message_feedback: '메시지 피드백', prompt_library: '프롬프트 라이브러리', saved_items: '저장 항목', agent_defs: 'Agent 정의', agent_runs: 'Agent 실행', tool_defs: 'Tool 정의', tool_runs: 'Tool 실행', prompt_versions: '프롬프트 버전',
  model_configs: '모델 설정', eval_cases: '평가 케이스', eval_results: '평가 결과', playground_apps: 'Playground 앱', approvals: '승인(HITL)', audit_events: '감사 이벤트', status_history: '상태 이력', notifications: '알림', outbox: '발송함(Mock)', api_logs: 'API 로그', integration_events: '연계 이벤트',
  seq: '일련번호', settings: '시스템 설정', crm_customers: '레거시 CRM 고객', mdm_masters: '레거시 MDM 마스터', mdm_candidates: '레거시 MDM 후보', datasets: '데이터셋', pipelines: '파이프라인 정의', pipeline_runs: '파이프라인 실행(레거시)', quality_issues: '품질 이슈(레거시)', rfp_coverage: 'RFP 커버리지',
  ax_feedback: '현업 피드백', ax_orders: '작업지시서', ax_events: '폐루프 이벤트', ax_rtm: '요구사항 추적(RTM)', ax_rtm_snapshots: 'RTM 스냅샷', ax_releases: '릴리즈', ax_checklist: '제출서류 체크리스트', ax_qna: '고객 질의·답변', ax_members: '컨소시엄 참여사', ax_staff: '참여 인력', ax_raci: 'RACI',
};
// DA# 식 표준단어: 영문 단어 → 한글. 컬럼 논리명을 단어 조합으로 유도한다(표준 용어 사전 역방향).
const WORDS = {
  id: '식별자', no: '번호', nm: '명', name: '명칭', title: '제목', body: '본문', text: '텍스트', description: '설명', desc: '설명', summary: '요약', note: '비고', notes: '비고', comment: '의견', detail: '상세', reason: '사유', kind: '구분', type: '유형', category: '분류', status: '상태', state: '상태', mode: '모드', code: '코드', key: '키', value: '값', field: '필드',
  lifecycle: '생명주기', display: '표시', bk: 'BK', crm: 'CRM', residence: '거주', registered: '등록', business: '사업', manager: '담당자', permission: '권한', granted: '부여', expires: '만료', inquiry: '문의', website: '웹사이트', account: '계정', status: '상태', company: '기업', reg: '등록', seller: '판매자', buyer: '바이어', member: '회원', confirmed: '확정', by: '처리자', created: '생성', updated: '수정', deleted: '삭제', approved: '승인', decided: '결정', verified: '검증', submitted: '제출', published: '게시', collected: '수집', captured: '포착', deployed: '배포', applied: '적용', accepted: '수락', claimed: '착수', started: '시작', finished: '종료', detected: '탐지', uploaded: '업로드', released: '릴리스', rolled: '롤백', reverted: '원복', occurred: '발생', effective: '유효', granted: '부여', expires: '만료', revoked: '철회', modified: '수정', last: '최종', sync: '동기화', run: '실행', test: '시험', indexed: '색인',
  at: '일시', date: '일자', time: '시각', start: '시작', end: '종료', from: '시작', to: '종료', until: '종료', valid: '유효', due: '기한', day: '일', slot: '슬롯', minutes: '분', ms: '밀리초', tz: '시간대', offset: '오프셋',
  user: '사용자', company: '기업', buyer: '바이어', seller: '판매자', member: '회원', party: '정본', person: '담당자', org: '조직', organization: '조직', owner: '소유자', author: '작성자', reviewer: '검토자', approver: '승인자', assignee: '담당자', requester: '요청자', actor: '행위자', sender: '발신자', manager: '관리자', contact: '연락', staff: '인력', lead: '주관', role: '역할',
  email: '이메일', mobile: '휴대전화', phone: '전화', address: '주소', website: '웹사이트', url: 'URL', domain: '도메인', country: '국가', region: '권역', city: '도시', venue: '장소', office: '무역관', lang: '언어', language: '언어', languages: '언어', locale: '로케일', currency: '통화',
  program: '지원사업', application: '신청', event: '행사', match: '매칭', consultation: '상담', session: '세션', message: '메시지', project: '프로젝트', product: '상품', products: '상품', hs: 'HS', industry: '산업', size: '규모', employees: '종업원', export: '수출', target: '대상', markets: '시장', stage: '단계', experience: '경험',
  agent: 'Agent', tool: 'Tool', prompt: '프롬프트', model: '모델', token: '토큰', tokens: '토큰', cost: '비용', usd: 'USD', latency: '지연', rating: '평점', score: '점수', confidence: '신뢰도', threshold: '임계값', rule: '규칙', rules: '규칙', risk: '위험도', severity: '심각도', priority: '우선순위', band: '등급', signals: '근거 신호', blocks: '차단 신호',
  source: '원천', table: '테이블', system: '시스템', schema: '스키마', snapshot: '스냅샷', profile: '프로파일', mapping: '매핑', standard: '표준', pipeline: '파이프라인', watermark: '워터마크', counts: '건수', stages: '단계', error: '오류', retry: '재시도', parent: '상위', child: '하위', version: '버전', ver: '버전', rev: '개정', lineage: '계보', ods: 'ODS',
  consent: '동의', purpose: '목적', scope: '범위', legal: '법적', basis: '근거', eligible: '대상여부', revoke: '철회', golden: '정본', crosswalk: '크로스워크', candidate: '후보', decision: '결정', survivor: '생존', absorbed: '흡수', merged: '병합', into: '대상', impact: '영향', policy: '정책', evidence: '증적', findings: '결과', drift: '드리프트', proposal: '제안', sandbox: '샌드박스', release: '릴리스', rollback: '롤백', before: '이전', after: '이후', old: '이전', new: '신규', diff: '차이', change: '변경', set: '집합',
  feedback: '피드백', order: '작업지시서', instruction: '지시', acceptance: '수용기준', guardrails: '가드레일', result: '결과', worker: 'Worker', screen: '화면', screens: '화면', route: '경로', feature: '기능', benefit: '기대효과', as: '현행', is: '', req: '요구사항', rfp: 'RFP', impl: '구현', demo: '시연', owner2: '', apis: 'API', tests: '테스트', files: '파일', checklist: '체크리스트', question: '질의', answer: '답변', pledge: '보안서약', modules: '모듈', deliverable: '산출물', raci: 'RACI',
  count: '건수', total: '합계', passed: '통과', failed: '실패', pass: '통과', enabled: '사용여부', active: '활성', flagged: '플래그', blocked: '차단', abstained: '답변유보', synthetic: '합성데이터', mock: 'Mock', verifiedflag: '', hash: '해시', prev: '이전', trace: 'Trace', ip: 'IP', method: '메서드', path: '경로', ref: '참조', link: '링크', payload: '페이로드', params: '파라미터', json: 'JSON', config: '설정', sort: '정렬', views: '조회수', uses: '사용수', likes: '좋아요', sources: '출처', tags: '태그', hashtags: '해시태그', groups: '그룹', channels: '채널', channel: '채널', conditions: '조건', trust: '신뢰도', past: '과거', success: '성공', idx: '순번', len: '길이', meta: '메타', tf: '용어빈도', chunk: '청크', doc: '문서', collection: '컬렉션', embedding: '임베딩', top: '상위', reranker: '재순위', access: '접근', speaker: '화자', draft: '초안', final: '확정', transfer: '이관', callback: '콜백', hall: '상담장', halls: '상담장', initiator: '신청 주체', journal: '일지', attendance: '출석', temp: '임시', login: '로그인', favorite: '관심', favorites: '관심', population: '인구', gdp: 'GDP', growth: '성장률', hs_prefix: 'HS 접두',
};
const COL_OVERRIDE = { id: '식별자', created_at: '생성일시', updated_at: '수정일시', is_synthetic: '합성데이터 여부', source_type: '출처 유형', title_ko: '제목(국문)', title_en: '제목(영문)', name_ko: '명칭(국문)', name_en: '명칭(영문)', body_ko: '본문(국문)', body_en: '본문(영문)', description_ko: '설명(국문)', description_en: '설명(영문)', summary_ko: '요약(국문)', summary_en: '요약(영문)', hs_code: 'HS코드', biz_no: '사업자번호', ai_class: 'AI 분류', extra_care: 'EXTRA CARE 여부', at_sec: '발화 시점(초)', by_user: '수행 사용자', rule_json: '규칙(JSON)', schema_json: '스키마(JSON)', instruction_md: '지시서 본문(MD)' };
const logicalColumn = (name) => {
  if (COL_OVERRIDE[name]) return COL_OVERRIDE[name];
  const parts = name.split('_'); const out = parts.map((w) => (WORDS[w] !== undefined ? WORDS[w] : null));
  if (out.every((x) => x === null)) return name;
  return parts.map((w, i) => out[i] || w).filter(Boolean).join(' ').replace(/식별자 식별자/g, '식별자');
};
function domainOf(name, type) {
  const t = String(type || '').toUpperCase(); const n = name.toLowerCase();
  if (n === 'id' || n.endsWith('_id') || n.endsWith('_pk') || n === 'key') return '식별자'; if (/(_at|_until|_to|_from)$/.test(n) || n === 'ts' || n === 'at' || n.endsWith('_date') && false) return '일시'; if (/(^|_)date$|^start_date$|^end_date$|^due$/.test(n)) return '일자';
  if (/^(is_|has_)|^(enabled|active|available|verified|eligible|flagged|blocked|abstained|pass|passed|starred|shared|required|lead|domestic|extra_care|ai_draft|consent_ok|unique)$/.test(n)) return '여부';
  if (/status|state/.test(n)) return '상태코드'; if (/(^|_)(code|type|kind|mode|role|band|priority|severity|risk|category|channel|lang|locale|tier|scope)$/.test(n)) return '코드';
  if (/json|payload|params|meta|attributes|schema|tf|signals|blocks|changes|stages|counts|journal|memory|form|plan|entities|sources|results|findings|snapshot|diff|impact|capabilities|result|files|screens|apis|tests/.test(n)) return 'JSON'; if (/name|title|subject|question|topic/.test(n)) return '명칭'; if (/hash|fingerprint|token|trace/.test(n)) return '해시';
  if (t.includes('INT')) return '수량'; if (t.includes('REAL') || t.includes('FLOA') || t.includes('DOUB')) return '수치'; if (/body|text|description|content|summary|note|detail|reason|comment|draft|final|answer|instruction|definition/.test(n)) return '내용'; return t.includes('TEXT') || t.includes('CHAR') ? '문자' : (t || '문자');
}

// ───────── 관계 정의: child.column > parent.column  (? = 선택, ~ = 논리/다형 참조(물리 FK 아님)) ─────────
const REL = `
users.company_id>companies.id? users.buyer_id>buyers.id? sessions.user_id>users.id
buyer_favorites.company_id>companies.id buyer_favorites.buyer_id>buyers.id export_projects.company_id>companies.id
applications.program_id>programs.id applications.company_id>companies.id applications.user_id>users.id applications.approval_id>approvals.id? app_documents.application_id>applications.id program_favorites.user_id>users.id program_favorites.program_id>programs.id
event_participants.event_id>events.id availability_slots.event_id>events.id interpreters.event_id>events.id? match_requests.event_id>events.id match_requests.company_id>companies.id match_requests.buyer_id>buyers.id match_requests.interpreter_id>interpreters.id? satisfaction.match_id>match_requests.id
consultations.company_id>companies.id? consultations.user_id>users.id? consultations.assigned_to>users.id? consultation_messages.consultation_id>consultations.id consultation_summaries.consultation_id>consultations.id consultation_transfers.consultation_id>consultations.id stt_jobs.consultation_id>consultations.id?
research_requests.requester_id>users.id? research_requests.assignee_id>users.id? news_drafts.author_id>users.id? notifications.user_id>users.id approvals.requester_id>users.id? approvals.decided_by>users.id?
documents.collection_id>collections.id chunks.doc_id>documents.id chunks.collection_id>collections.id
chat_sessions.user_id>users.id chat_sessions.project_id>export_projects.id? chat_messages.session_id>chat_sessions.id chat_messages.trace_id>agent_runs.id?~ message_feedback.message_id>chat_messages.id message_feedback.user_id>users.id? prompt_library.user_id>users.id? saved_items.user_id>users.id
agent_runs.session_id>chat_sessions.id? agent_runs.user_id>users.id? tool_runs.run_id>agent_runs.id tool_runs.tool_id>tool_defs.id tool_runs.approval_id>approvals.id? tool_runs.user_id>users.id? prompt_versions.agent_id>agent_defs.id agent_defs.prompt_id>prompt_versions.id?~ eval_results.case_id>eval_cases.id
pipelines.dataset_id>datasets.id? pipeline_runs.pipeline_id>pipelines.id quality_issues.dataset_id>datasets.id mdm_candidates.a_id>crm_customers.id mdm_candidates.b_id>crm_customers.id mdm_candidates.master_id>mdm_masters.id? mdm_masters.company_id>companies.id?
ax_feedback.author_id>users.id ax_feedback.order_id>ax_orders.id? ax_orders.feedback_id>ax_feedback.id ax_orders.release_id>ax_releases.id? ax_releases.order_id>ax_orders.id ax_releases.feedback_id>ax_feedback.id ax_staff.member_id>ax_members.id ax_raci.member_id>ax_members.id ax_qna.asked_by>users.id? ax_rtm.req_id>rfp_coverage.id ax_events.ref_id>ax_feedback.id?~ ax_events.ref_id>ax_orders.id?~
demo_crm_participation.crm_customer_id>demo_crm_customer.crm_customer_id demo_crm_voc.crm_customer_id>demo_crm_customer.crm_customer_id demo_bk_product.bk_member_id>demo_bk_member.bk_member_id demo_bk_inquiry.buyer_member_id>demo_bk_member.bk_member_id? demo_bk_inquiry.seller_member_id>demo_bk_member.bk_member_id?
di_upload.source_id>di_source.id di_snapshot.source_id>di_source.id di_watermark.source_id>di_source.id di_drift.source_id>di_source.id di_raw.source_id>di_source.id di_raw.run_id>di_run.id di_raw.source_pk>demo_crm_customer.crm_customer_id?~ di_raw.source_pk>demo_bk_member.bk_member_id?~
di_mapping.target_field>di_standard.concept?~
di_crosswalk.party_id>di_party.party_id di_golden.party_id>di_party.party_id di_party.golden_version_id>di_golden.id? di_party.merged_into>di_party.party_id? di_party.company_id>companies.id?~ di_consent.party_id>di_party.party_id di_affiliation.person_party_id>di_party.party_id di_affiliation.org_party_id>di_party.party_id di_link.party_a>di_party.party_id di_link.party_b>di_party.party_id di_activity.party_id>di_party.party_id
di_candidate.left_party>di_party.party_id? di_candidate.right_party>di_party.party_id? di_decision.candidate_id>di_candidate.id di_decision.survivor_party>di_party.party_id? di_decision.absorbed_party>di_party.party_id? di_link.decision_id>di_decision.id? di_crosswalk.decision_id>di_decision.id? di_signup_sim.matched_party>di_party.party_id?
di_dq_issue.rule_id>di_dq_rule.id di_fix.issue_id>di_dq_issue.id
di_run.parent_run_id>di_run.id? di_watermark.run_id>di_run.id? di_ods.party_id>di_party.party_id di_ods.golden_version_id>di_golden.id? di_lineage.from_node>di_party.party_id?~
di_snapshot.source_id>di_source.id di_drift.old_snapshot>di_snapshot.id? di_drift.new_snapshot>di_snapshot.id di_proposal.drift_id>di_drift.id di_proposal.sandbox_id>di_sandbox.id? di_proposal.release_id>di_release.id? di_sandbox.proposal_id>di_proposal.id di_release.proposal_id>di_proposal.id di_release.model_before>di_model.id? di_release.model_after>di_model.id? di_model.parent_id>di_model.id?
`.trim().split(/\s+/).filter(Boolean);

const hyd = (c) => ({ name: c.name, type: String(c.type || 'TEXT').toUpperCase(), pk: !!c.pk, notnull: !!c.notnull, dflt: c.dflt_value });
let cache = null; let cacheAt = 0;
const invalidate = () => { cache = null; };

function glossary() { const m = { table: {}, column: {} }; for (const g of q.all('SELECT * FROM di_glossary')) (m[g.kind] || (m[g.kind] = {}))[g.target] = { logical: g.logical, definition: g.definition }; return m; }

function build({ force = false } = {}) {
  if (!force && cache && Date.now() - cacheAt < 30000) return cache;
  const gl = glossary();
  const names = q.all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").map((t) => t.name);
  const ents = names.map((t) => {
    const cols = q.all(`PRAGMA table_info(${t})`).map(hyd); const fks = q.all(`PRAGMA foreign_key_list(${t})`);
    let rows = null; try { rows = q.get(`SELECT COUNT(*) n FROM ${t}`).n; } catch { /* ignore */ }
    const tg = gl.table[t];
    return { name: t, logical: (tg && tg.logical) || TABLE_KO[t] || t, definition: (tg && tg.definition) || '', area: areaOf(t), rows, pkCols: cols.filter((c) => c.pk).map((c) => c.name),
      columns: cols.map((c) => { const f = fks.find((x) => x.from === c.name); const cg = gl.column[`${t}.${c.name}`]; return { name: c.name, logical: (cg && cg.logical) || logicalColumn(c.name), definition: (cg && cg.definition) || '', type: c.type, domain: domainOf(c.name, c.type), pk: c.pk, fk: f ? `${f.table}.${f.to}` : null, nullable: !c.notnull && !c.pk, dflt: c.dflt }; }) };
  });
  const byName = Object.fromEntries(ents.map((e) => [e.name, e]));
  const rels = []; const seen = new Set();
  const push = (r) => { const k = `${r.from}.${r.fromCol}>${r.to}.${r.toCol}`; if (seen.has(k)) return; seen.add(k); rels.push(r); };
  // 1) 선언 FK
  for (const e of ents) for (const c of e.columns) if (c.fk) { const [pt, pc] = c.fk.split('.'); push({ from: e.name, fromCol: c.name, to: pt, toCol: pc, declared: true, soft: false, optional: c.nullable }); }
  // 2) 큐레이션된 논리 관계(+실측 검증)
  for (const tok of REL) {
    const m = /^([a-z0-9_]+)\.([a-z0-9_]+)>([a-z0-9_]+)\.([a-z0-9_]+)(\?)?(~)?$/.exec(tok); if (!m) continue; const [, from, fromCol, to, toCol, opt, soft] = m; if (!byName[from] || !byName[to]) continue;
    if (!byName[from].columns.some((c) => c.name === fromCol) || !byName[to].columns.some((c) => c.name === toCol)) continue; push({ from, fromCol, to, toCol, declared: false, soft: !!soft, optional: !!opt });
  }
  for (const r of rels) {
    const child = byName[r.from]; const parent = byName[r.to]; const col = child.columns.find((c) => c.name === r.fromCol);
    r.identifying = !r.soft && child.pkCols.includes(r.fromCol) && child.pkCols.length >= 1 && !(child.pkCols.length === 1 && r.fromCol === 'id');
    r.optional = r.optional || (col && col.nullable && !r.identifying);
    r.cardinality = r.identifying && child.pkCols.length === 1 ? '1:1' : 'N:1';
    r.confidence = r.declared ? 1 : r.soft ? 0.5 : 0.9;
    if (!r.soft && child.rows != null && child.rows <= 5000) { // 포함관계 실측 검증
      try { const row = q.get(`SELECT COUNT(*) n, SUM(CASE WHEN p.${r.toCol} IS NULL THEN 1 ELSE 0 END) miss FROM (SELECT DISTINCT ${r.fromCol} v FROM ${r.from} WHERE ${r.fromCol} IS NOT NULL) c LEFT JOIN ${r.to} p ON p.${r.toCol}=c.v`); r.verified = { checked: row.n, missing: row.miss || 0, ok: !(row.miss > 0) }; } catch { r.verified = null; }
    }
    col.fk = col.fk || `${r.to}.${r.toCol}`; if (r.soft) col.soft = true;
  }
  // 영향 요약
  const areaStats = AREAS.map((a) => ({ ...a, entities: ents.filter((e) => e.area === a.key).length, columns: ents.filter((e) => e.area === a.key).reduce((s, e) => s + e.columns.length, 0) }));
  const cross = {}; for (const r of rels) { const a = byName[r.from].area; const b = byName[r.to].area; if (a !== b) { const k = `${a}>${b}`; cross[k] = (cross[k] || 0) + 1; } }
  const out = { generated_at: U.iso(), source: 'sqlite_master · PRAGMA table_info/foreign_key_list (실측) + 큐레이션된 논리 관계(포함관계 검증)', areas: areaStats, entities: ents, relations: rels,
    area_links: Object.entries(cross).map(([k, n]) => { const [a, b] = k.split('>'); return { from: a, to: b, count: n }; }),
    stats: { entities: ents.length, columns: ents.reduce((s, e) => s + e.columns.length, 0), relations: rels.length, declared: rels.filter((r) => r.declared).length, logical: rels.filter((r) => !r.declared && !r.soft).length, soft: rels.filter((r) => r.soft).length, identifying: rels.filter((r) => r.identifying).length, verify_failed: rels.filter((r) => r.verified && !r.verified.ok).length, rows: ents.reduce((s, e) => s + (e.rows || 0), 0) } };
  cache = out; cacheAt = Date.now(); return out;
}

function setGlossary(ctx, { kind, target, logical, definition }) {
  if (!['table', 'column'].includes(kind)) throw new U.HttpError(400, 'BAD_KIND', 'kind 는 table / column 입니다');
  const m = build(); const ok = kind === 'table' ? m.entities.some((e) => e.name === target) : m.entities.some((e) => target.startsWith(e.name + '.') && e.columns.some((c) => `${e.name}.${c.name}` === target)); if (!ok) throw U.notFound('대상을 찾을 수 없습니다');
  const lg = String(logical || '').trim().slice(0, 80); if (!lg) throw new U.HttpError(400, 'VALIDATION', '논리명을 입력하세요');
  q.run('INSERT INTO di_glossary(kind,target,logical,definition,updated_by,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(kind,target) DO UPDATE SET logical=excluded.logical, definition=excluded.definition, updated_by=excluded.updated_by, updated_at=excluded.updated_at', kind, target, lg, String(definition || '').slice(0, 300), ctx.user.id, U.iso());
  invalidate(); return { kind, target, logical: lg };
}

// ───────── 내보내기 ─────────
const lname = (e) => (e.logical && e.logical !== e.name ? e.logical : '');
function dictionaryCsv(m = build()) {
  const esc = (v) => { let s = String(v ?? '').replace(/\r?\n/g, ' '); if (/^[=+\-@]/.test(s)) s = "'" + s; return /[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const area = Object.fromEntries(m.areas.map((a) => [a.key, a.ko]));
  const head = ['주제영역', '테이블(물리)', '테이블(논리)', '컬럼 순번', '컬럼(물리)', '컬럼(논리)', '도메인', '데이터 타입', 'PK', 'FK(참조)', 'NULL 허용', '기본값', '설명'];
  const lines = m.entities.flatMap((e) => e.columns.map((c, i) => [area[e.area], e.name, lname(e), i + 1, c.name, c.logical, c.domain, c.type, c.pk ? 'Y' : '', c.fk || '', c.nullable ? 'Y' : 'N', c.dflt ?? '', c.definition || ''].map(esc).join(',')));
  return '﻿' + [head.join(','), ...lines].join('\r\n');
}
function entityListCsv(m = build()) {
  const esc = (v) => { const s = String(v ?? ''); return /[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }; const area = Object.fromEntries(m.areas.map((a) => [a.key + '', a.ko]));
  return '﻿' + [['주제영역', '엔터티(논리)', '테이블(물리)', '컬럼 수', '행 수', 'PK', '정의'].join(','), ...m.entities.map((e) => [area[e.area], lname(e), e.name, e.columns.length, e.rows ?? '', e.pkCols.join('+'), e.definition].map(esc).join(','))].join('\r\n');
}
function ddl(m = build(), { area, dialect = 'ansi' } = {}) {
  const ents = area ? m.entities.filter((e) => e.area === area) : m.entities; const names = new Set(ents.map((e) => e.name));
  const out = ['-- KOTRA-AX 통합 물리모델 — 검토용 DDL (자동 실행 금지)', `-- 생성 ${m.generated_at} · 대상 ${ents.length}개 테이블 · dialect ${dialect}`, ''];
  for (const e of ents) {
    out.push(`-- ${e.logical} (${m.areas.find((a) => a.key === e.area).ko})`, `CREATE TABLE ${e.name} (`);
    const body = e.columns.map((c) => `  ${c.name} ${dialect === 'ansi' ? c.type.replace(/^TEXT$/, 'VARCHAR(4000)').replace(/^REAL$/, 'DOUBLE PRECISION') : c.type}${c.nullable ? '' : ' NOT NULL'}${c.dflt != null ? ` DEFAULT ${c.dflt}` : ''}`);
    if (e.pkCols.length) body.push(`  PRIMARY KEY (${e.pkCols.join(', ')})`); out.push(body.join(',\n'), ');', '');
  }
  out.push('-- 참조 관계(논리 관계는 서버 검증으로 보장 — 물리 FK 는 승인 후 적용)');
  for (const r of m.relations.filter((x) => names.has(x.from) && names.has(x.to) && !x.soft)) out.push(`${r.declared ? '' : '-- '}ALTER TABLE ${r.from} ADD CONSTRAINT fk_${r.from}_${r.fromCol} FOREIGN KEY (${r.fromCol}) REFERENCES ${r.to}(${r.toCol});`);
  return out.join('\n');
}
function mermaid(m = build(), { area } = {}) {
  const ents = area ? m.entities.filter((e) => e.area === area) : m.entities; const names = new Set(ents.map((e) => e.name)); const lines = ['erDiagram'];
  for (const r of m.relations.filter((x) => names.has(x.from) && names.has(x.to))) lines.push(`    ${r.to} ${r.optional ? '|o' : '||'}--${r.identifying ? '' : 'o'}{ ${r.from} : "${r.fromCol}${r.declared ? '' : r.soft ? ' (soft)' : ' (logical)'}"`);
  for (const e of ents) { lines.push(`    ${e.name} {`); e.columns.forEach((c) => lines.push(`        ${c.type.replace(/[^A-Za-z0-9_]/g, '_')} ${c.name}${c.pk ? ' PK' : c.fk ? ' FK' : ''}`)); lines.push('    }'); }
  return lines.join('\n');
}

module.exports = { AREAS, build, invalidate, setGlossary, dictionaryCsv, entityListCsv, ddl, mermaid, logicalColumn, areaOf };
