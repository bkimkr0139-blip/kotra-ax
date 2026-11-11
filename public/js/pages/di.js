// 데이터 통합·MDM — Intelligent Data Integration Studio (통합 스튜디오 홈, 원천, 스키마 발견, 승인함, 감사, 증적).
import { h, L, store, act, ic, navigate, toast, modal, field, errMsg, fmtDT, fmtNum, hbars, lineChart, legend, pageHead, RFP, statusBadge, copyText, qs } from '../lib.js';
import { consoleShell } from './_console.js';
import { fill, dget, dpost, dapi, tbl, card, note, Kpi, modeBadge, badge, pass, pre, mono, download, fetchText, reload, can, confirmBox } from './_di.js';
import { ermodel, mapping, identity, golden } from './di_model.js';
import { quality, pipelines, lineage, evolution } from './di_ops.js';

export const TABS = [
  ['home', '통합 스튜디오 홈', 'Studio home', 'grid'], ['sources', '원천 연결', 'Connection Lab', 'db'], ['discovery', '스키마 발견', 'Schema discovery', 'search'], ['erd', 'ERD Studio', 'ERD Studio', 'layers'],
  ['mapping', '매핑 워크벤치', 'Mapping workbench', 'route'], ['identity', '고객 식별·중복', 'Identity resolution', 'users'], ['golden-records', '정본(Golden Record)', 'Golden records', 'award'], ['quality', '데이터 품질', 'Data quality', 'check'],
  ['pipelines', '파이프라인', 'Pipeline control', 'refresh'], ['lineage', '계보·영향', 'Lineage & impact', 'compass'], ['evolution', '자기진화 엔진', 'Evolution engine', 'ai'], ['approvals', '변경 승인함', 'Approvals', 'handshake'], ['audit', '감사', 'Audit', 'shield'], ['evidence', '증적(Evidence)', 'Evidence center', 'file'],
];
const RENDER = { home, sources, discovery, erd: ermodel, mapping, identity, 'golden-records': golden, quality, pipelines, lineage, evolution, approvals, audit, evidence };

export async function di({ params, query, user }) {
  const tab = RENDER[params.tab] ? params.tab : 'home'; const def = TABS.find((t) => t[0] === tab);
  if (store.config && store.config.di_enabled === false) return consoleShell('#/admin/data-integration', L('데이터 통합·MDM', 'Data integration · MDM'), '', note('warn', L('데이터 통합 스튜디오가 이 환경에서 비활성화되어 있습니다(DATA_INTEGRATION_STUDIO_ENABLED).', 'Data Integration Studio is disabled in this environment (DATA_INTEGRATION_STUDIO_ENABLED).')));
  try { store.di = await dget('/config'); } catch (e) { return consoleShell('#/admin/data-integration', L('데이터 통합·MDM', 'Data integration · MDM'), '', note('danger', errMsg(e))); }
  const body = await RENDER[tab]({ query, user, tab });
  const sub = h('nav.di-sub', { 'aria-label': L('스튜디오 메뉴', 'Studio navigation') }, TABS.map((t) => h('a', { href: t[0] === 'home' ? '#/admin/data-integration' : `#/admin/data-integration/${t[0]}`, class: t[0] === tab ? 'on' : '', 'aria-current': t[0] === tab ? 'page' : null }, ic(t[3]), L(t[1], t[2]))));
  const active = tab === 'home' ? '#/admin/data-integration' : `#/admin/data-integration/${tab}`;
  return consoleShell(active, L(def[1], def[2]), L('CRM·BuyKOREA 이기종 고객정보의 발견 → 모델링 → 식별·정본화 → 품질 → 파이프라인 → 자기진화를 한곳에서 — 합성(SYNTHETIC) 데이터 기반 시연', 'Discover → model → resolve → master → quality → pipeline → evolve CRM and BuyKOREA customer data in one place — demo on synthetic data'),
    h('div.stack', sub, body), { rfp: ['CNR-006', 'CNR-007', 'SFR-009', 'SFR-010', 'SFR-011', 'SFR-012'], badge: h('span.badge.b-synth', { style: 'margin-left:8px' }, 'SYNTHETIC') });
}

// ───────── 홈 ─────────
const GUIDE = [['sources', '원천 연결 상태·LIVE 비활성 확인'], ['erd', 'CRM/BK As-Is ERD 전환·자동 탐색'], ['mapping', '필드 매핑 → To-Be ERD'], ['identity', '동명이법인·공유 메일 차단 확인'], ['identity', '후보 병합 승인 → Golden Record v2'], ['pipelines', '원천 정정 주입 → 증분 실행'], ['evolution', '신규 컬럼 주입 → 드리프트 탐지'], ['evolution', 'AI 제안 → 샌드박스 → 승인(요청자≠승인자)'], ['evolution', 'Demo 배포 → 롤백'], ['lineage', '추천 결과 계보·영향'], ['evidence', 'RFP 증적·자체 점검']];
async function home() {
  const o = await dget('/overview');
  const conn = h('div.di-conn', o.connections.map((c) => h('div', { class: 'di-conn-i ' + (c.status === 'HEALTHY' || c.status === 'CONTRACT' ? 'ok' : 'bad') }, h('b', c.name), h('div.row', { style: 'gap:6px' }, modeBadge(c.mode), h('span.xs', c.status)), h('div.xs.muted', c.last_success ? `${L('마지막 성공', 'Last OK')} ${fmtDT(c.last_success)}` : `${fmtNum(c.rows)} rows`))));
  const f = o.flow; const flow = h('div.di-flow', [['CRM', f.crm, 'b-synth'], ['→', '', ''], ['표준화·MDM', f.mdm, 'b-info'], ['←', '', ''], ['BuyKOREA', f.bk, 'b-synth'], ['→', '', ''], ['ODS/Lakehouse Ready', f.ods, 'b-info'], ['→', '', ''], ['Agent/RAG·추천', f.serving, 'b-primary']].map(([t, n, c]) => (t.length === 1 ? h('span.di-arrow', t) : h('div.di-node', h('b', t), h('span', { class: 'badge ' + c }, fmtNum(n))))));
  const a = o.attention;
  const att = card(L('오늘 처리할 일', 'Needs attention'), h('div.stack-sm', [[L('AI 제안(미승인)', 'AI proposals'), a.ai_proposals, 'evolution'], [L('승인 대기', 'Pending approvals'), a.pending_approvals, 'approvals'], [L('실패한 파이프라인', 'Failed runs'), a.failed_runs, 'pipelines'], [L('스키마 드리프트(미처리)', 'Open drift'), a.drift_open, 'evolution'], [L('변경 영향 경고', 'Impact warnings'), a.impact_warnings, 'evolution']].map(([l, n, t]) => h('a.di-att', { href: `#/admin/data-integration/${t}` }, h('span', l), h('b', { class: n ? 'hot' : '' }, String(n))))));
  const trend = o.dq && o.dq.trend.length ? lineChart(o.dq.trend.map((t, i) => ({ x: String(i + 1), y: t.overall || 0 })), { w: 520, hgt: 180, fmt: (v) => String(Math.round(v)), label: 'DQ' }) : h('p.small.muted', L('품질 검사 이력이 없습니다.', 'No quality runs yet.'));
  const dedup = (() => { const m = {}; o.dedup.forEach((d) => { m[`${d.band}/${d.status}`] = d.n; }); return hbars(Object.entries(m).map(([k, v]) => ({ label: k, value: v }))); })();
  return h('div.stack',
    note('info', L('모든 수치는 계산식·기준 시각·출처·분모·시연 여부를 함께 표시합니다(KPI에 마우스를 올리세요). CRM·BuyKOREA 스키마, ID, 데이터는 제안용 합성 예시이며 실제 KOTRA 운영 DB의 확인된 구조가 아닙니다. 운영계 쓰기·자동 DDL은 금지됩니다.', 'Every figure carries its formula, as-of time, source, denominator and demo flag (hover a KPI). Schemas, IDs and data are synthetic proposals — not confirmed KOTRA production structures. Production writes and auto-DDL are forbidden.')),
    conn, h('div.kpi-row', o.kpis.map(Kpi)),
    h('div.grid.g2', { style: '--cols:2' }, card(L('데이터 흐름', 'Data flow'), flow), att),
    h('div.grid.g3', { style: '--cols:3' }, card(L('데이터 품질 추세', 'Quality trend'), trend, h('a.small', { href: '#/admin/data-integration/quality' }, L('품질 센터 ›', 'Quality ›'))), card(L('중복 정비 현황', 'Dedup status'), dedup, h('a.small', { href: '#/admin/data-integration/identity' }, L('식별·중복 ›', 'Identity ›'))),
      card(L('최근 스키마 변동', 'Recent schema changes'), o.schema_changes.length ? h('ul.ax-list', o.schema_changes.map((d) => h('li', h('b', d.id), ' ', d.source_id, ' ', badge('sev', d.severity), h('div.xs.muted', d.change_set.map((c) => `${c.kind}:${c.column || c.table}`).join(', '))))) : h('p.small.muted', L('감지된 변경 없음', 'No drift detected')))),
    card(L('최근 실행 Trace', 'Recent runs'), tbl([{ label: 'Run' }, { label: L('모드', 'Mode') }, { label: L('상태', 'Status') }, { label: L('시작', 'Started') }, { label: L('읽음', 'Read') }, { label: L('격리', 'Quarantined') }], o.recent_runs.map((r) => [h('a', { href: `#/admin/data-integration/pipelines?run=${r.id}` }, r.id), r.mode, badge('run', r.status), fmtDT(r.started_at), r.read, r.quarantined]), {}),
      h('a.small', { href: '#/admin/data-integration/pipelines' }, L('파이프라인 ›', 'Pipelines ›'))),
    card(L('시연 시나리오 가이드 (10~12분)', 'Demo scenario guide (10–12 min)'), h('ol.small', { style: 'margin:0;padding-left:20px;display:grid;gap:4px' }, GUIDE.map(([t, s]) => h('li', h('a', { href: `#/admin/data-integration/${t}` }, s)))), null));
}

// ───────── 원천 연결 (Connection Lab) ─────────
async function sources() {
  const d = await dget('/sources'); const adm = can('ConnectorAdmin');
  const caps = (c) => h('div.row', { style: 'gap:4px' }, ['schema_discovery', 'snapshot', 'incremental', 'cdc', 'writeback'].map((k) => h('span', { class: 'badge ' + (c[k] ? 'b-ok' : ''), title: k }, `${k.replace('schema_discovery', 'discover')}${c[k] ? '' : ' ✕'}`)));
  const rows = d.items.map((s) => [h('b', s.id), s.name, modeBadge(s.integration_mode), h('span', { class: 'badge ' + (s.health && s.health.ok ? 'b-ok' : s.enabled ? 'b-danger' : '') }, s.enabled ? (s.health.ok ? 'HEALTHY' : 'DOWN') : L('승인 전 비활성', 'Disabled')), caps(s.capabilities), s.security_class, s.watermark ? fmtDT(s.watermark) : '-',
    h('div.row', { style: 'gap:6px' }, s.enabled ? [adm && h('button.btn.btn-sm', { onclick: act(async () => { const r = await dpost(`/sources/${s.id}/test`); toast(L(`연결 테스트 OK (읽기 전용) — ${r.rows}행`, `Connection OK (read-only) — ${r.rows} rows`), 'ok'); reload(); }) }, L('연결 테스트', 'Test')), can('DataArchitect') && h('button.btn.btn-sm', { onclick: act(async () => { const r = await dpost(`/sources/${s.id}/discover`); toast(L(`스냅샷 ${r.snapshot_id}: 테이블 ${r.tables} · 컬럼 ${r.columns}`, `Snapshot ${r.snapshot_id}: ${r.tables} tables · ${r.columns} columns`), 'ok'); reload(); }) }, L('스키마 발견', 'Discover')), h('button.btn.btn-sm', { onclick: () => preview(s.id) }, L('미리보기(마스킹)', 'Preview (masked)'))] : h('span.xs.muted', L('보안 심의·읽기 전용 계정·Gateway 승인 이전', 'Pending security review / read-only account / gateway approval')))]);
  return h('div.stack',
    note('warn', d.notes.join(' · ')),
    card(L('원천 시스템', 'Source systems'), tbl([{ label: 'ID' }, { label: L('이름', 'Name') }, { label: L('구분', 'Class') }, { label: L('상태', 'Status') }, { label: L('Connector 계약(capabilities)', 'Connector contract') }, { label: L('보안 등급', 'Security') }, { label: L('워터마크', 'Watermark') }, { label: '' }], rows), adm && h('button.btn.btn-outline.btn-sm', { onclick: registerSource }, L('+ FILE_UPLOAD 원천 등록', '+ Register FILE_UPLOAD source'))),
    h('div.grid.g2', { style: '--cols:2' },
      card(L('Connector 계약', 'Connector contract'), pre(`discoverSchema · previewRead · snapshot · incremental · health · watermark · capabilities\n\n{\n  "source_id": "BUYKOREA_DEMO",\n  "connector_type": "DEMO_TABLES",\n  "capabilities": { "schema_discovery": true, "snapshot": true,\n    "incremental": true, "cdc": false, "writeback": false },\n  "data_class": "SYNTHETIC", "status": "HEALTHY"\n}`)),
      card(L('안전한 읽기/쓰기 경계', 'Safe read/write boundary'), tbl([{ label: L('구간', 'Zone') }, { label: L('허용', 'Allowed') }, { label: L('불허', 'Forbidden') }], [['원천 CRM/BuyKOREA', '승인된 읽기', 'MVP 직접 쓰기·무단 DDL'], ['Landing/Raw', '암호화 적재·원천 추적', '동의 미확인 데이터 반출'], ['Standard/MDM', '규칙 변환·후보·승인형 병합', '근거 없는 자동 병합·원천 증거 삭제'], ['Serving/RAG', '목적·권한별 가공 뷰', '비공개 고객정보 공개 RAG 유출'], ['Evolution', 'AI 제안·사전 테스트·승인·롤백', 'AI의 운영 DB 무승인 변경']].map((r) => r.map((x) => String(x)))))));
}
function registerSource() {
  const id = h('input', { type: 'text', placeholder: 'PARTNER_CSV', maxlength: 30 }); const nm = h('input', { type: 'text', placeholder: L('원천 이름', 'Source name') }); const tb = h('input', { type: 'text', value: 'partners', maxlength: 40 });
  const ta = h('textarea', { rows: 6, style: 'width:100%;font-family:var(--font-mono)' }, 'partner_id,partner_name,email\nP1,Acme Ltd,a@acme.example\nP2,Beta Co,');
  modal({ title: L('FILE_UPLOAD 원천 등록 + 업로드', 'Register FILE_UPLOAD source + upload'), size: 'wide', body: h('div.stack-sm', note('info', L('CSV(머리글 포함, ≤200KB·2000행)를 올리면 스키마 발견·프로파일링이 가능합니다. LIVE DB 연결은 등록할 수 없습니다.', 'Upload CSV (header row, ≤200KB / 2000 rows) to enable discovery and profiling. LIVE database connections cannot be registered.')), field('ID', id), field(L('이름', 'Name'), nm), field(L('테이블 이름', 'Table name'), tb), field('CSV', ta)),
    footer: (close) => [h('button.btn', { onclick: close }, L('취소', 'Cancel')), h('button.btn.btn-primary', { onclick: act(async () => { await dpost('/sources', { id: id.value, name: nm.value, connector_type: 'FILE_UPLOAD' }); const sid = id.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''); await dpost(`/sources/${sid}/upload`, { table: tb.value, format: 'csv', content: ta.value }); const r = await dpost(`/sources/${sid}/discover`); close(); toast(L(`등록·업로드·발견 완료: 테이블 ${r.tables}, 컬럼 ${r.columns}`, `Registered, uploaded, discovered: ${r.tables} tables, ${r.columns} columns`), 'ok'); reload(); }) }, L('등록', 'Register'))] });
}
async function preview(id, table) {
  const r = await dget(`/sources/${id}/preview${table ? `?table=${encodeURIComponent(table)}` : ''}`);
  const m = modal({ title: `${id} · ${r.table}`, size: 'wide', body: h('div.stack-sm', h('div.row', { style: 'gap:6px;flex-wrap:wrap' }, r.tables.map((t) => h('button', { class: 'btn btn-sm' + (t === r.table ? ' btn-primary' : ''), onclick: () => { m.close(); preview(id, t); } }, t))),
    note('info', L('샘플은 기본 마스킹되며 평문 개인정보는 반환되지 않습니다(조회는 감사 기록).', 'Samples are masked by default; plain personal data is never returned (previews are audited).')),
    r.rows.length ? tbl(Object.keys(r.rows[0]).map((k) => ({ label: k })), r.rows.map((x) => Object.values(x).map((v) => (v == null ? '∅' : String(v))))) : h('p', L('행 없음', 'No rows'))) });
}

// ───────── 스키마 발견 ─────────
async function discovery() {
  const d = await dget('/discovery'); const out = [];
  for (const [id, s] of Object.entries(d.sources)) {
    const rows = s.schema.tables.flatMap((t) => t.columns.map((c) => { const p = (s.profile[t.name] || {})[c.name] || {}; return [h('code.xs', `${t.name}.${c.name}`), c.type, [c.pk ? '🔑 PK' : '', c.fk ? `↗ ${c.fk}` : ''].filter(Boolean).join(' ') || '-', p.semantic || '-', `${p.null_count}/${p.total}`, p.distinct_count, p.invalid_count ? h('b', { style: 'color:var(--s-danger)' }, p.invalid_count) : 0, c.concept || '-', (p.sample || []).join(' · ') || '-']; }));
    out.push(card(`${id} · ${L('스냅샷', 'snapshot')} ${s.snapshot_id} v${s.version}`, h('div.stack-sm', h('div.row', { style: 'gap:8px' }, h('span.badge', `hash ${s.schema_hash.slice(0, 12)}`), h('span.badge', `${s.schema.tables.length} ${L('테이블', 'tables')}`), h('span.badge', `${s.schema.tables.reduce((a, t) => a + t.columns.length, 0)} ${L('컬럼', 'columns')}`)),
      h('details', { open: true }, h('summary', L('컬럼 프로파일 (Null · Distinct · 무효 · 개념 후보 · 마스킹 샘플)', 'Column profile (null · distinct · invalid · concept · masked sample)')), tbl([{ label: L('컬럼', 'Column') }, { label: L('타입', 'Type') }, { label: L('키', 'Key') }, { label: L('의미', 'Semantic') }, { label: 'Null' }, { label: 'Distinct' }, { label: L('무효', 'Invalid') }, { label: L('개념', 'Concept') }, { label: L('샘플(마스킹)', 'Sample (masked)') }], rows)),
      h('div', h('b', L('관계 (선언 FK = 실선 · 추론 = 점선/확정 전)', 'Relations (declared = solid · inferred = dashed/unconfirmed)')), tbl([{ label: 'From' }, { label: 'To' }, { label: L('구분', 'Kind') }, { label: L('신뢰도', 'Confidence') }, { label: L('포함관계 검증', 'Inclusion check') }], s.schema.relations.map((r) => [`${r.from}.${r.fromCol}`, `${r.to}.${r.toCol}`, r.declared ? h('span.badge.b-ok', L('선언 FK', 'Declared')) : h('span.badge.b-warn', L('추론(확정 전)', 'Inferred')), r.confidence, r.verified && r.verified.ok != null ? (r.verified.ok ? `OK (${r.verified.checked})` : h('b', { style: 'color:var(--s-danger)' }, `${L('누락', 'missing')} ${r.verified.missing}`)) : '-']))))));
  }
  return h('div.stack',
    h('div.kpi-row', h('div.card', h('div.kpi', h('div.l', L('표준 개념 후보', 'Standard-concept candidates')), h('div.v', String(d.standard_candidates.length)), h('div.s', L('CRM↔BK 동일 개념 컬럼 쌍(자동 계산)', 'CRM↔BK column pairs sharing a concept (computed)')))), h('div.card', h('div.kpi', h('div.l', L('타입 상이 쌍', 'Type-mismatch pairs')), h('div.v', String(d.standard_candidates.filter((x) => x.type_diff).length)), h('div.s', L('표준화 필요', 'Needs standardisation'))))),
    card(L('표준·유사 필드 후보 (CRM ↔ BuyKOREA)', 'Standard / similar field candidates'), tbl([{ label: L('개념', 'Concept') }, { label: 'CRM' }, { label: 'BuyKOREA' }, { label: L('타입 차이', 'Type diff') }], d.standard_candidates.map((c) => [c.concept, mono(c.crm + ' : ' + c.crm_type), mono(c.bk + ' : ' + c.bk_type), c.type_diff ? h('span.badge.b-warn', '≠') : '-'])), can('DataArchitect') && h('button.btn.btn-outline.btn-sm', { onclick: act(async () => { for (const id of ['CRM_DEMO', 'BUYKOREA_DEMO']) await dpost(`/sources/${id}/discover`); toast(L('두 원천을 다시 발견했습니다(새 스냅샷).', 'Both sources re-discovered (new snapshots).'), 'ok'); reload(); }) }, L('스키마 재발견', 'Re-discover'))),
    card(L('도메인 분류 제안', 'Domain suggestions'), h('div.row', { style: 'gap:8px;flex-wrap:wrap' }, d.domain_suggestions.map(([t, dm]) => h('span.badge', `${t} → ${dm}`)))), ...out);
}

// ───────── 승인함 ─────────
async function approvals() {
  const d = await dget('/approvals'); const go = (t) => navigate(`/admin/data-integration/${t}`);
  return h('div.stack', note('info', d.note),
    card(L(`MDM 병합 승인 대기 (${d.candidates.length})`, `Merge approvals (${d.candidates.length})`), tbl([{ label: 'ID' }, { label: L('후보', 'Candidate') }, { label: L('점수', 'Score') }, { label: L('검토자', 'Reviewer') }, { label: '' }], d.candidates.map((c) => [c.id, `${c.left_ref.split(':')[2]} ↔ ${c.right_ref.split(':')[2]}`, c.score, c.reviewer || '-', h('button.btn.btn-sm', { onclick: () => go('identity') }, L('검토', 'Review'))]))),
    card(L(`스키마/규칙 변경 승인 (${d.proposals.length})`, `Change approvals (${d.proposals.length})`), tbl([{ label: 'ID' }, { label: L('요약', 'Summary') }, { label: L('위험', 'Risk') }, { label: L('요청자', 'Requested by') }, { label: '' }], d.proposals.map((p) => [p.id, p.summary, badge('sev', p.risk), p.requested_by || '-', h('button.btn.btn-sm', { onclick: () => navigate(`/admin/data-integration/evolution?id=${p.id}`) }, L('열기', 'Open'))]))),
    card(L(`품질 정비 승인 (${d.dq.length})`, `Remediation approvals (${d.dq.length})`), tbl([{ label: 'ID' }, { label: L('규칙', 'Rule') }, { label: L('대상', 'Target') }, { label: L('상태', 'Status') }, { label: '' }], d.dq.map((i) => [i.id, i.rule_id, `${i.source_ref.split(':')[2]}.${i.field}`, badge('dq', i.status), h('button.btn.btn-sm', { onclick: () => go('quality') }, L('열기', 'Open'))]))));
}

// ───────── 감사 ─────────
async function audit() {
  let d; try { d = await dget('/audit'); } catch (e) { return note('warn', errMsg(e)); }
  return h('div.stack', h('div.kpi-row', h('div.card', h('div.kpi', h('div.l', L('감사 해시체인', 'Audit hash-chain')), h('div.v', d.chain.ok ? 'OK' : 'BROKEN'), h('div.s', `${d.chain.total} events`))), h('div.card', h('div.kpi', h('div.l', L('원천 샘플 조회', 'Source previews')), h('div.v', String(d.access.sample_previews)), h('div.s', L('모두 감사 기록', 'all audited'))))),
    note('info', d.access.note),
    card(L('데이터 통합 감사 이벤트', 'Data-integration audit events'), tbl([{ label: '#' }, { label: L('시각', 'Time') }, { label: L('행위자', 'Actor') }, { label: L('행위', 'Action') }, { label: L('대상', 'Target') }, { label: L('상세', 'Detail') }], d.events.map((e) => [e.id, fmtDT(e.ts), `${e.actor_id} (${e.actor_role})`, h('code.xs', e.action), `${e.target_type || ''} ${e.target_id || ''}`, h('span.xs', JSON.stringify(e.detail).slice(0, 120))]))));
}

// ───────── 증적(Evidence Center) ─────────
async function evidence() {
  const d = await dget('/evidence'); const sc = d.selfcheck;
  const view = async (name) => { const t = await fetchText(`/evidence/export?doc=${encodeURIComponent(name)}`); modal({ title: name, size: 'wide', body: h('div.stack-sm', note('info', L('요청 시점의 실제 시스템 상태에서 생성된 문서입니다.', 'Generated from the live system state at request time.')), pre(t.slice(0, 20000) + (t.length > 20000 ? '\n…' : ''))), footer: (close) => [h('button.btn', { onclick: () => copyText(t) }, L('복사', 'Copy')), h('button.btn.btn-primary', { onclick: () => download(name, t, name.endsWith('.csv') ? 'text/csv;charset=utf-8' : 'text/markdown;charset=utf-8') }, L('내려받기', 'Download')), h('button.btn', { onclick: close }, L('닫기', 'Close'))] }); };
  return h('div.stack', note('info', d.note),
    card(L('RFP 증적 문서 (10종)', 'RFP evidence documents (10)'), tbl([{ label: L('문서', 'Document') }, { label: L('형식', 'Format') }, { label: '' }], d.documents.map((x) => [h('b', x.name), x.kind, h('div.row', { style: 'gap:6px' }, h('button.btn.btn-sm', { onclick: act(async () => view(x.name)) }, L('보기', 'View')), can('Auditor') && h('button.btn.btn-sm', { onclick: act(async () => { const t = await fetchText(`/evidence/export?doc=${encodeURIComponent(x.name)}`); download(x.name, t, x.name.endsWith('.csv') ? 'text/csv;charset=utf-8' : 'text/markdown;charset=utf-8'); }) }, L('내려받기', 'Download')))])),
      can('Auditor') && h('button.btn.btn-primary.btn-sm', { onclick: act(async () => { const t = await fetchText('/evidence/export?doc=bundle'); download('axos-data-integration-evidence.md', t, 'text/markdown;charset=utf-8'); }) }, ic('download'), ' ', L('전체 묶음(.md)', 'Full bundle (.md)'))),
    card(L('불변식 자체 점검 (실제 상태 기반)', 'Invariant self-check (live state)'), h('div.stack-sm', sc ? h('p.small', `${fmtDT(sc.at)} · ${sc.results.filter((r) => r.pass).length}/${sc.results.length} PASS`) : h('p.small.muted', L('아직 실행하지 않았습니다.', 'Not run yet.')), sc && tbl([{ label: 'ID' }, { label: L('점검', 'Check') }, { label: L('결과', 'Result') }, { label: L('상세', 'Detail') }], sc.results.map((r) => [r.id, r.name, pass(r.pass), r.detail])),
      can('DataSteward') && h('button.btn.btn-outline.btn-sm', { onclick: act(async () => { const r = await dpost('/selfcheck'); toast(`${r.passed}/${r.total} PASS`, r.passed === r.total ? 'ok' : 'err'); reload(); }) }, L('자체 점검 실행', 'Run self-check')))),
    card(L('보조 산출물', 'Supporting artifacts'), h('div.row', { style: 'gap:6px;flex-wrap:wrap' }, d.aux.map((a) => h('span.badge', a)))), card(L('시드 Golden Test Dataset (C01~C10)', 'Seed golden test dataset (C01–C10)'), h('button.btn.btn-outline.btn-sm', { onclick: act(async () => { const g = await dget('/golden-dataset'); download('di_golden_dataset.json', JSON.stringify(g, null, 2), 'application/json'); }) }, L('JSON 내려받기', 'Download JSON'))));
}
