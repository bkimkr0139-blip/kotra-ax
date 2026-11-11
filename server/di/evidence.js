'use strict';
// Evidence Center: 스펙 §21 의 10개 증적 문서를 "현재 실제 시스템 상태"에서 생성한다(고정 성공 문구 금지).
const { q } = require('../db');
const U = require('../util');
const S = require('./schema');
const M = require('./mapping');
const DQ = require('./quality');
const PL = require('./pipeline');
const EV = require('./evolution');
const MDM = require('./mdm');

const hdr = (title, note) => `# ${title}\n\n> 자동 생성 ${U.iso()} · 데이터 구분: SYNTHETIC(합성) — 실제 KOTRA 운영 DB·연동 결과가 아닙니다.${note ? `\n> ${note}` : ''}\n`;
const table = (cols, rows) => [`| ${cols.join(' | ')} |`, `|${cols.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.map((c) => String(c ?? '-').replace(/\|/g, '/').replace(/\n/g, ' ')).join(' | ')} |`)].join('\n');
const snap = (id) => { const s = S.latestSnapshot(id); return s; };

const DOCS = {
  'CNR006_ASIS_CRM_BK_SCHEMA_ANALYSIS.md': () => {
    let md = hdr('CNR-006 As-Is CRM·BuyKOREA 스키마 분석', 'RFP CNR-006 / SFR-009 근거');
    for (const id of ['CRM_DEMO', 'BUYKOREA_DEMO']) {
      const s = snap(id); if (!s) continue; md += `\n## ${id} (스냅샷 ${s.id}, v${s.version}, hash ${s.schema_hash.slice(0, 12)})\n\n`;
      md += table(['테이블', '행 수(근사)', '컬럼 수', 'PK', 'FK(선언)'], s.schema.tables.map((t) => [t.name, t.rows_approx, t.columns.length, t.columns.filter((c) => c.pk).map((c) => c.name).join(','), t.columns.filter((c) => c.fk).map((c) => `${c.name}→${c.fk}`).join(', ') || '-'])) + '\n\n### 관계(선언/추론)\n\n';
      md += table(['from', 'to', '구분', '신뢰도', '검증(포함관계)'], s.schema.relations.map((r) => [`${r.from}.${r.fromCol}`, `${r.to}.${r.toCol}`, r.declared ? '선언 FK' : '추론(확정 전)', r.confidence, r.verified && r.verified.ok != null ? (r.verified.ok ? `OK(${r.verified.checked})` : `누락 ${r.verified.missing}`) : '-']));
      md += '\n\n### 컬럼 프로파일(요약, 샘플은 마스킹)\n\n';
      md += table(['테이블.컬럼', '타입', '의미', 'Null', 'Distinct', '무효', '개념 후보'], s.schema.tables.flatMap((t) => t.columns.map((c) => { const p = (s.profile[t.name] || {})[c.name] || {}; return [`${t.name}.${c.name}`, c.type, p.semantic, `${p.null_count}/${p.total}`, p.distinct_count, p.invalid_count, c.concept || '-']; })));
    }
    const cands = q.all("SELECT band, status, COUNT(*) n FROM di_candidate GROUP BY band, status"); md += `\n\n## 식별·중복 현황\n\n${table(['등급', '상태', '건수'], cands.map((c) => [c.band, c.status, c.n]))}\n`;
    return md;
  },
  'CNR007_MDM_TARGET_MODEL.md': () => {
    const m = S.activeModel('TOBE_MDM'); const c = S.activeModel('CONCEPT'); let md = hdr('CNR-007 CRM 확장형 MDM 목표 모델', `활성 모델 ${m.version} · 개념 모델 ${c.version}`);
    md += '\n## 설계 원칙\n- 법인 ≠ 담당자 개인 ≠ 로그인 계정 / CRM 기준 정본 / 원천 레코드 삭제·덮어쓰기 금지 / 동의는 목적별 / Slowly Changing Dimension Type 2\n';
    md += '\n## 식별·병합 정책\n- 정책 버전 ' + MDM.POLICY_VERSION + ': 검증 법인 ID +45, 국가 +10, 법인명 유사 +20, 주소 +10, 도메인 +10, 제품 호환 +5. 서로 다른 검증 ID·국가 불일치(검증 ID 없음)·이메일만 일치는 하드 블록. 초기에는 자동 병합 금지(승인형).\n';
    md += `\n## Mermaid ERD (${m.version})\n\n\`\`\`mermaid\n${S.toMermaid(m.model)}\n\`\`\`\n\n## DDL 미리보기(검토용 — 자동 실행 금지)\n\n\`\`\`sql\n${S.toDdl(m.model)}\n\`\`\`\n`;
    md += `\n## 표준 점검\n\n${table(['심각도', '대상', '규칙', '메시지'], S.checkStandards(m.model).map((i) => [i.severity, `${i.entity || ''}${i.column ? '.' + i.column : ''}`, i.rule, i.message])) || ''}\n`;
    const hist = q.all("SELECT version,status,created_at,note FROM di_model WHERE scope='TOBE_MDM' ORDER BY created_at"); md += `\n## 모델 버전 이력\n\n${table(['버전', '상태', '생성', '메모'], hist.map((h) => [h.version, h.status, h.created_at, h.note]))}\n`;
    return md;
  },
  'FIELD_MAPPING_STANDARD_DICTIONARY.csv': () => {
    const esc = (v) => { let s = String(v ?? '').replace(/\r?\n/g, ' '); if (/^[=+\-@]/.test(s)) s = "'" + s; return /[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const std = q.all('SELECT * FROM di_standard ORDER BY concept'); const maps = q.all('SELECT * FROM di_mapping ORDER BY mapping_version, source_system, source_field');
    const a = ['# 데이터 사전', ['concept', 'standard_name', 'english_name', 'data_type', 'length', 'nullable', 'domain', 'sensitivity', 'status', 'version', 'definition'].join(','), ...std.map((s) => [s.concept, s.standard_name, s.english_name, s.data_type, s.length, s.nullable, s.domain, s.sensitivity, s.status, s.version, s.definition].map(esc).join(','))];
    const b = ['', '# 필드 매핑', ['mapping_id', 'version', 'status', 'source_system', 'source_table', 'source_field', 'target_entity', 'target_field', 'rules'].join(','), ...maps.map((m) => [m.id, m.mapping_version, m.status, m.source_system, m.source_table, m.source_field, m.target_entity, m.target_field, m.rule_json].map(esc).join(','))];
    return '﻿' + [...a, ...b].join('\r\n');
  },
  'MDM_DEDUP_QUALITY_REPORT.md': () => {
    let md = hdr('MDM 중복·품질 보고서', 'SFR-010 / SFR-011 근거'); const dq = DQ.latest();
    if (dq) md += `\n## 데이터 품질(${dq.run_id}, rule ${dq.rule_version})\n\n전체 ${dq.overall ?? 'N/A'}\n\n${table(['차원', '점수', '평가', '통과', '가중치', '계산식'], Object.entries(dq.scores).map(([k, v]) => [DQ.DIM_LABEL[k][0], v.score ?? 'N/A', v.evaluated, v.passed, v.weight, v.formula]))}\n`;
    md += `\n## 정비 큐\n\n${table(['상태', '건수'], Object.entries(DQ.issueSummary()).map(([k, v]) => [k, v]))}\n`;
    const dec = q.all('SELECT * FROM di_decision ORDER BY created_at'); md += `\n## 병합/연계/분리 결정\n\n${dec.length ? table(['결정', '유형', '후보', '승인자', '사유', '일시'], dec.map((d) => [d.id, d.decision, d.candidate_id, d.approver, d.reason, d.created_at])) : '결정 이력 없음(승인 전)'}\n`;
    md += `\n## 정본 현황\n\n${table(['상태', '건수'], q.all('SELECT lifecycle_status s, COUNT(*) n FROM di_party GROUP BY lifecycle_status').map((r) => [r.s, r.n]))}\n`;
    return md;
  },
  'PIPELINE_RECONCILIATION_REPORT.md': () => {
    let md = hdr('파이프라인 정합성 보고서', 'SFR-010 근거'); const runs = PL.listRuns(15);
    md += `\n## 최근 실행\n\n${table(['실행', '모드', '상태', '시작', '읽음', '적재(신규/변경/중복)', '격리', '재시도', '오류'], runs.map((r) => [r.id, r.mode, r.status, r.started_at, r.counts.read, `${r.counts.landed_new}/${r.counts.landed_changed}/${r.counts.duplicate_skipped}`, r.counts.quarantined, r.retry_no, r.error ? `${r.error.stage}: ${r.error.message}` : '-']))}\n`;
    const rec = PL.reconcile(['CRM_DEMO', 'BUYKOREA_DEMO'], 'INCREMENTAL'); md += `\n## 현재 시점 정합성 검증\n\n${table(['검증', '기대', '실제', '결과', '비고'], rec.map((c) => [c.name, c.expected, c.actual, c.pass ? 'PASS' : 'FAIL', c.note]))}\n`;
    md += `\n## 워터마크\n\n${table(['원천', '값', '실행'], q.all('SELECT * FROM di_watermark').map((w) => [w.source_id, w.value, w.run_id]))}\n\n> 워터마크는 최종 검증 성공 후에만 전진하며, 실패 실행은 전진시키지 않습니다. 소스가 제공하지 않는 CDC는 지원한다고 표시하지 않습니다.\n`;
    return md;
  },
  'SCHEMA_EVOLUTION_REPORT.md': () => {
    let md = hdr('스키마 진화 보고서', '자기진화(Self-Evolving) 증적'); const props = EV.listProposals();
    md += `\n## 드리프트\n\n${table(['ID', '원천', '심각도', '상태', '감지', '변경'], EV.listDrifts().map((d) => [d.id, d.source_id, d.severity, d.status, d.detected_at, d.change_set.map((c) => `${c.kind}:${c.column || c.table}`).join(', ')]))}\n`;
    md += `\n## 제안/승인/배포\n\n${props.length ? table(['제안', '상태', '위험', '요약', '요청자', '승인자', '릴리스'], props.map((p) => [p.id, p.state, p.risk, p.summary, p.requested_by, p.approved_by, p.release_id])) : '제안 없음'}\n`;
    for (const p of props) { const d = EV.proposalDetail(p.id); if (d.sandbox) md += `\n### ${p.id} 샌드박스 결과 (${d.sandbox.pass ? 'PASS' : 'FAIL'})\n\n${table(['게이트', '결과', '상세'], (d.sandbox.findings.gates || []).map((g) => [g.name, g.pass ? 'PASS' : 'FAIL', g.detail]))}\n`; }
    md += `\n## 릴리스\n\n${table(['릴리스', '상태', '모델', '매핑', '배포자', '배포', '롤백'], q.all('SELECT * FROM di_release ORDER BY deployed_at').map((r) => [r.id, r.state, `${r.model_before}→${r.model_after}`, `${r.mapping_before}→${r.mapping_after}`, r.deployed_by, r.deployed_at, r.rolled_back_at || '-']))}\n\n> AI 제안은 승인 전 어떤 모델·매핑·서빙도 변경하지 않으며, 요청자는 자가 승인할 수 없습니다. 모델 롤백과 데이터 정정(보상 트랜잭션)은 구분됩니다.\n`;
    return md;
  },
  'DATA_LINEAGE_IMPACT_REPORT.md': () => {
    let md = hdr('데이터 계보·영향 보고서'); const n = q.count('di_lineage'); md += `\n계보 엣지 ${n}개\n\n${table(['종류', '엣지 수'], q.all('SELECT kind, COUNT(*) n FROM di_lineage GROUP BY kind').map((r) => [r.kind, r.n]))}\n`;
    const linked = q.all("SELECT party_id, company_id, display_name FROM di_party WHERE company_id IS NOT NULL AND lifecycle_status='ACTIVE' AND party_type='ORGANIZATION'"); md += `\n## 서비스 연결 기업\n\n${table(['정본', '기업', '이름', 'ODS 서빙 키'], linked.map((p) => { const k = MDM.servingKeysFor(p.company_id); return [p.party_id, p.company_id, p.display_name, k ? k.extra_product_keys.join(', ') : '(없음)']; }))}\n`;
    return md;
  },
  'SECURITY_CONSENT_AUDIT_REPORT.md': () => {
    let md = hdr('보안·동의·감사 점검 보고서', 'SER 계열 근거'); const sc = EV.selfCheck(null, { persist: false });
    md += `\n## 불변식 자체 점검 (${sc.passed}/${sc.total})\n\n${table(['ID', '점검', '결과', '상세'], sc.results.map((r) => [r.id, r.name, r.pass ? 'PASS' : 'FAIL', r.detail]))}\n`;
    md += `\n## 동의 판정\n\n${table(['상태', '건수'], q.all('SELECT status, COUNT(*) n FROM di_consent GROUP BY status').map((r) => [r.status, r.n]))}\n\n제외 레코드:\n\n${table(['원천', 'PK', '사유'], q.all('SELECT source_id, source_pk, reason FROM di_raw WHERE eligible=0 AND status<>\'SUPERSEDED\'').map((r) => [r.source_id, r.source_pk, r.reason]))}\n`;
    const chain = require('../gov').verifyAuditChain(); md += `\n## 감사 해시체인\n\n무결성 ${chain.ok ? '정상' : '훼손'} · 총 ${chain.total}건. DI 관련 감사: ${q.count('audit_events', "WHERE action LIKE 'di.%'")}건\n`;
    md += `\n## 접근 통제\n\n- 원천 샘플은 기본 마스킹(이메일·식별번호·주소·이름). 평문 PII 는 UI에 노출하지 않음.\n- 병합/연계/Unmerge/배포/롤백은 관리자(MDM·변경 승인자) 권한 + confirm + 사유. 요청자=승인자 차단.\n`;
    return md;
  },
  'RFP_COMPLIANCE_EVIDENCE_MATRIX.md': () => {
    const ids = ['CNR-006', 'CNR-007', 'SFR-009', 'SFR-010', 'SFR-011', 'SFR-012', 'DAR-004', 'DAR-005', 'DAR-010', 'DAR-014', 'SER-007', 'SER-009', 'TER-001', 'TER-003', 'QUR-005'];
    const rows = q.all(`SELECT * FROM rfp_coverage WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY id`, ...ids);
    return hdr('RFP 준수 증적 매트릭스 (실제 범위 vs Mock vs 향후 실연동)', '구현 상태는 rfp_coverage 를 따르며 과장하지 않습니다.') + '\n' + table(['RFP', '요구', '구현', '시연', '화면', '증빙', '한계'], rows.map((r) => [r.id, r.name, r.impl_status, r.demo_status, r.screen, r.evidence, r.notes])) + '\n';
  },
  'DEMO_OPERATIONS_PLAYBOOK.md': () => hdr('데모 운영 플레이북') + `
## 역할별 계정(시연)
| 역할 | 계정 | 권한 |
|---|---|---|
| 데이터 아키텍트/스튜어드 | consultant@kotra.example (P3) | 매핑·후보 검토 의견·정비 검토·진화 제안 시뮬레이션·승인 요청 |
| MDM 승인자 / 변경 승인자 / 배포 | admin@kotra.example (P5), ops@kotra.example | 병합·Unmerge·정비 승인·진화 승인·Demo 배포·롤백·원천 연결 |
| 감사 | auditor@kotra.example | 증적·감사로그 열람 |

## 시연 순서(10~12분)
1) 통합 스튜디오 홈(연계 상태·KPI) → 2) ERD: CRM/BK As-Is → 3) 매핑·To-Be ERD → 4) 중복 후보(동명이법인·공유 메일 차단) → 5) 병합 승인 → Golden v2 → 6) 원천 정정 주입 → 증분 실행 → 7) 신규 컬럼 주입 → 드리프트 탐지 → 8) AI 제안 → 샌드박스 → 9) 승인(요청자≠승인자) → Demo 배포 → 롤백 → 10) 바이어 추천 변화/계보 → 11) RFP 증적.

## 초기화·복구
- 시드 초기화: 관리자 > Demo Director > Seed Reset (원천 데모 테이블도 초기 상태로 재생성).
- 실패 복구: 파이프라인 탭에서 실패 실행의 '재시도'. 워터마크는 성공 시에만 전진.
- 기능 플래그: DATA_INTEGRATION_STUDIO_ENABLED (운영 기본 비활성, 시연 환경만 활성).
`,
};
const NAMES = Object.keys(DOCS);
function generate(name) { if (!DOCS[name]) return null; return { name, mime: name.endsWith('.csv') ? 'text/csv; charset=utf-8' : 'text/markdown; charset=utf-8', body: DOCS[name]() }; }
function index() { return NAMES.map((n) => ({ name: n, kind: n.endsWith('.csv') ? 'CSV' : 'Markdown' })); }
function bundle() { const parts = NAMES.map((n) => { const g = generate(n); return `\n\n<!-- ===== ${n} ===== -->\n\n${g.body}`; }); return hdr('AXOS 데이터 통합 스튜디오 — 증적 묶음') + parts.join(''); }

module.exports = { generate, index, bundle, NAMES };
