// AXOS — 폐루프 자동개발 운영 콘솔(관리자 제어 · 상담전문위원 열람).
import { h, L, store, GET, POST, PUT, act, ic, navigate, toast, modal, confirmDialog, statusBadge, fmtDT, fmtDate, errMsg, copyText, download, meter } from '../lib.js';
import { consoleShell } from './_console.js';
import * as AX from './_ax.js';

const card = (title, body, right) => h('div.card', h('div.card-h', h('h3', title), right), h('div.card-b', body));
const kpi = (l, v, s) => h('div.card', h('div.kpi', h('div.l', l), h('div.v', String(v)), s && h('div.s', String(s))));
const reload = () => window.dispatchEvent(new HashChangeEvent('hashchange'));
const MODES = [
  ['OFF', L('정지 (Kill switch)', 'Off (kill switch)'), L('Worker가 어떤 작업도 가져갈 수 없습니다. 비상 정지용.', 'Workers cannot claim anything. Emergency stop.')],
  ['MANUAL', L('수동 허용 (기본)', 'Manual (default)'), L('관리자가 “착수 허용”한 작업만 Worker가 가져갑니다.', 'Workers take only orders an admin has dispatched.')],
  ['SCHEDULE', L('예약 시간대', 'Scheduled window'), L('평일 09:00–18:00(KST)에만 승인된 저·중위험 작업을 자동 처리합니다.', 'Auto-processes approved low/medium-risk orders on weekdays 09:00–18:00 KST.')],
  ['AUTO', L('상시 자동', 'Always auto'), L('승인된 작업을 시간 제한 없이 자동 처리합니다. 고위험은 별도 확인이 필요합니다.', 'Processes approved orders at any time. HIGH risk still needs acknowledgement.')],
];

export async function axos({ user }) {
  const admin = user.role === 'admin'; const d = await GET('/api/axos/state'); const m = d.metrics; const p = m.pipeline;
  const stages = [['SUBMITTED', L('접수·검토', 'Intake & review'), p.SUBMITTED, ''], ['QUEUED', L('개발 큐', 'Queued'), p.QUEUED, 'QUEUED'], ['IN_PROGRESS', L('자동개발', 'Auto-dev'), p.IN_PROGRESS, 'IN_PROGRESS'], ['REPORTED', L('결과 보고', 'Reported'), p.REPORTED, 'REPORTED'], ['ACCEPTED', L('현업 확인', 'Accepted'), p.ACCEPTED, ''], ['FAILED', L('실패', 'Failed'), p.FAILED, 'FAILED']];
  const qHolder = h('div'); let filter = '';
  const drawQueue = () => {
    const list = d.queue.filter((o) => !filter || o.status === filter);
    qHolder.replaceChildren(AX.tbl([{ label: 'WO', w: '84px' }, { label: L('제목', 'Title') }, { label: L('화면', 'Screen') }, { label: L('우선', 'Prio'), w: '80px' }, { label: L('위험', 'Risk'), w: '80px' }, { label: L('상태', 'Status'), w: '150px' }, { label: 'Worker', w: '110px' }, { label: L('허용', 'Dispatch'), w: '70px' }],
      list.map((o) => [h('b', o.id), h('span', o.title, ' ', o.is_synthetic ? AX.synthTag() : null), o.screen_key, AX.prioBadge(o.priority), statusBadge(o.risk), AX.woBadge(o.status), o.claimed_by || '-', o.guardrails.dispatched ? '✓' : '-']), { onRow: (_, i) => openOrder(list[i].id, admin) }));
    if (!list.length) qHolder.replaceChildren(h('p.small.muted', L('해당 상태의 작업지시서가 없습니다.', 'No work orders in this state.')));
  };
  drawQueue();
  const st = d.settings; const w = d.worker;
  const modeBtns = h('div.ax-mode', MODES.map(([v, t, ds]) => h('button', { type: 'button', 'aria-pressed': String(st.mode === v), disabled: !admin, onclick: act(async () => {
    if (v === st.mode) return;
    if (v === 'AUTO' && !(await confirmDialog({ title: L('상시 자동 개발로 전환', 'Switch to always-auto'), message: L('승인된 작업지시서를 시간 제한 없이 Worker가 자동 처리합니다. 가드레일(금지 경로·테스트 필수)은 유지됩니다. 계속할까요?', 'Workers will process approved orders at any time. Guardrails (forbidden paths, mandatory tests) stay on. Continue?'), danger: true }))) return;
    await PUT('/api/axos/settings', { mode: v, confirm: v === 'AUTO' ? true : undefined }); toast(L(`모드를 ${v}로 변경했습니다.`, `Mode set to ${v}.`), 'ok'); reload();
  }) }, h('b', t), h('span.small.muted', ds))));
  const tokenBtn = admin && h('button.btn.btn-outline.btn-sm', { onclick: act(async () => {
    if (!(await confirmDialog({ title: L('Worker 토큰 발급', 'Issue worker token'), message: L('새 토큰을 발급하면 기존 토큰은 즉시 무효가 됩니다. 토큰은 한 번만 표시됩니다.', 'Issuing a new token invalidates the old one immediately. It is shown once only.') }))) return;
    const r = await POST('/api/axos/worker/token', { confirm: true });
    const code = h('pre.ax-code', `export AXOS_URL=${location.origin}\nexport AXOS_TOKEN=${r.token}\nnode scripts/axos-worker.js once`);
    modal({ title: L('Worker 토큰 (한 번만 표시)', 'Worker token (shown once)'), body: h('div.stack-sm', h('div.alert.warn', ic('alert'), L('지금 복사해 안전한 곳에 보관하세요. 채팅·문서·코드에 붙여넣지 마세요.', 'Copy it now and store it safely. Do not paste it into chats, docs or code.')), code), footer: (close) => [h('button.btn', { onclick: () => copyText(r.token) }, L('토큰 복사', 'Copy token')), h('button.btn.btn-primary', { onclick: () => { close(); reload(); } }, L('닫기', 'Close'))] });
  }) }, ic('lock'), ' ', d.token_configured ? L('토큰 재발급', 'Rotate token') : L('토큰 발급', 'Issue token'));
  const proto = `# AXOS Worker 프로토콜 (개발 PC/CI에서 실행 — 서버는 코드를 직접 수정하지 않습니다)
# 1) 관리자가 위에서 Worker 토큰을 발급하고 모드를 MANUAL/SCHEDULE/AUTO로 설정
export AXOS_URL=${location.origin}
export AXOS_TOKEN=<발급한 토큰>
# 2) 승인된 작업지시서 1건을 가져와 .axos/orders/WO-xxxx.md 로 저장하고,
#    AXOS_EXEC 가 있으면 그 명령(예: claude -p)으로 개발 → npm test → 결과 자동 보고
export AXOS_EXEC='claude -p "$(cat $AXOS_ORDER_FILE)" --permission-mode acceptEdits'
node scripts/axos-worker.js once
# 3) 상시 폴링
node scripts/axos-worker.js watch --interval 60
# API: POST /api/axos/worker/claim · /orders/{id}/report · /heartbeat  (Authorization: Bearer <token>)`;
  const content = h('div.stack',
    h('div.ax-hero', h('h2', 'AXOS — AX Operating System'), h('p', L('현업 피드백이 승인되면 작업지시서가 만들어지고, Worker가 이를 가져가 개발·테스트한 뒤 결과를 보고합니다. 현업이 확인(수락)해야 릴리즈와 RTM에 반영되는 폐루프 운영 콘솔입니다. Worker는 스스로 승인하거나 수락할 수 없습니다.', 'Approved feedback becomes a work order that a Worker develops and tests, then reports. Only business acceptance updates the release and RTM. Workers can never approve or accept.'))),
    h('div.kpi-row', kpi(L('열린 피드백', 'Open feedback'), m.open), kpi(L('개발 큐', 'Queued'), p.QUEUED), kpi(L('개발중', 'In progress'), p.IN_PROGRESS), kpi(L('확인 대기', 'Awaiting acceptance'), p.REPORTED), kpi(L('현업 확인', 'Accepted'), p.ACCEPTED), kpi(L('실패', 'Failed'), p.FAILED), kpi(L('평균 리드타임', 'Lead time'), m.lead_time_days == null ? '-' : m.lead_time_days + L('일', 'd')), kpi(L('릴리즈', 'Releases'), m.releases)),
    card(L('자동개발 제어', 'Auto-development control'), h('div.stack',
      modeBtns, !admin && h('p.small.muted', L('모드·토큰 변경은 관리자만 할 수 있습니다(열람 전용).', 'Only admins can change mode or token (read-only view).')),
      h('div.grid.g3', { style: '--cols:3' },
        h('div.callout', h('b', 'Worker'), h('div', h('span', { class: 'ax-led ' + w.state }), w.state === 'NEVER' ? L('연결 이력 없음', 'never connected') : `${w.state} · ${w.id} · ${w.age_s}s ${L('전', 'ago')}`), w.order && h('div.xs.muted', `${w.order} · ${w.phase || ''}`), h('div.small', d.token_configured ? (d.env_token ? L('토큰: 서버 환경변수', 'Token: server env') : L('토큰: 발급됨', 'Token: issued')) : L('토큰 미발급', 'No token yet')), tokenBtn),
        h('div.callout', h('b', L('스케줄', 'Schedule')), h('div.small', `${L('요일', 'Days')}: ${st.schedule.days.map((x) => '일월화수목금토'[x]).join('')} · ${st.schedule.from}–${st.schedule.to} ${st.schedule.tz}`), h('div.small', `${L('현재', 'Now')}: ${d.in_window ? L('시간대 내', 'inside window') : L('시간대 밖', 'outside window')}`), h('div.small', `${L('동시 처리 한도', 'Parallel limit')}: ${st.max_parallel}`)),
        h('div.callout', h('b', L('가드레일 (서버 강제)', 'Guardrails (server-enforced)')), h('ul.xs', { style: 'margin:4px 0 0;padding-left:16px' }, h('li', L('금지 경로: ', 'Forbidden: ') + d.guardrails.forbidden.join(' ')), h('li', L(`허용 경로: ${d.guardrails.allowed_roots.join(' ')}`, `Allowed: ${d.guardrails.allowed_roots.join(' ')}`)), h('li', L(`최대 변경 파일 ${d.guardrails.max_files}개`, `Max ${d.guardrails.max_files} files`)), h('li', L('테스트 결과 필수(실패 시 자동 반려)', 'Tests mandatory (auto-reject on failure)'))))),
      admin && h('div.row', { style: 'gap:8px' }, h('button.btn.btn-outline.btn-sm', { onclick: act(async () => { const r = await POST('/api/axos/release-stale', {}); toast(L(`지연된 클레임 ${r.released}건을 큐로 되돌렸습니다.`, `${r.released} stale claim(s) returned to the queue.`), 'ok'); reload(); }) }, ic('refresh'), ' ', L('지연 클레임 회수', 'Release stale claims'))))),
    card(L('폐루프 파이프라인 · 작업지시서 큐', 'Pipeline · work-order queue'), h('div.stack-sm',
      h('div.ax-chips', [['', L('전체 진행', 'All active')], ...stages.filter((s) => s[3]).map((s) => [s[3], `${s[1]} ${s[2]}`])].map(([v, l]) => h('button', { type: 'button', class: 'ax-chip', 'aria-pressed': String(filter === v), onclick: (e) => { filter = v; [...e.currentTarget.parentNode.children].forEach((c) => c.setAttribute('aria-pressed', 'false')); e.currentTarget.setAttribute('aria-pressed', 'true'); drawQueue(); } }, l))),
      qHolder, h('p.xs.muted', L('행을 눌러 지시서 전문·수용 기준·결과·진행 이력을 확인하고 착수 허용/보고/재큐/취소를 처리합니다. 승인은 AX개발 센터 > 피드백 관리에서 합니다.', 'Open a row for the full instruction, acceptance criteria, result and timeline. Approvals happen in AX Dev centre > Feedback review.'))), h('a.btn.btn-outline.btn-sm', { href: '#/axdev?tab=feedback' }, L('피드백 관리 ›', 'Feedback review ›'))),
    h('div.grid.g2', { style: '--cols:2' },
      card(L('RTM 동기화', 'RTM sync'), h('div.stack-sm', h('div.row', { style: 'gap:10px' }, h('b', `${d.rtm.mvp_coverage_pct}%`), h('div', { style: 'flex:1' }, meter(d.rtm.mvp_coverage_pct, 'ok')), h('span.small.muted', L('MVP 구현율', 'MVP coverage'))), h('div.small', `${L('현업 검증', 'Verified')} ${d.rtm.verified}/${d.rtm.total} · ${L('화면 연결', 'screen link')} ${d.rtm.screen_link_pct}%`), h('p.xs.muted', { style: 'margin:0' }, L('현업 확인(수락)된 작업의 결과만 RTM의 증빙·검증 상태에 반영됩니다. 구현 상태 변경은 Worker가 제안하고 수락 시 확정됩니다.', 'Only accepted work updates RTM evidence and verification. Implementation-status changes are proposed by the Worker and finalised on acceptance.')), h('div.row', { style: 'gap:8px' }, h('a.btn.btn-outline.btn-sm', { href: '#/axdev?tab=rtm' }, 'RTM ›'), admin && h('button.btn.btn-outline.btn-sm', { onclick: act(async () => { const r = await POST('/api/ax/rtm/rebuild', {}); toast(L(`RTM 재구축 완료 (${r.snapshot.id})`, `RTM rebuilt (${r.snapshot.id})`), 'ok'); reload(); }) }, L('RTM 재구축', 'Rebuild RTM'))))),
      card(L('최근 릴리즈', 'Recent releases'), d.releases.length ? h('ul.ax-list', d.releases.map((r) => h('li', h('b', r.ver), ' ', r.title, ' ', r.is_synthetic ? AX.synthTag() : null, h('div.xs.muted', fmtDate(r.at))))) : h('p.small.muted', L('아직 없음', 'None yet')))),
    card(L('최근 작업 활동', 'Recent order activity'), h('ol.ax-timeline', d.recent.map((e) => h('li', h('b', e.ref_id), ' ', AX.evLabel(e.event), ' ', h('span.xs.muted', `${e.actor_role || ''} ${fmtDT(e.at)}`))))),
    card(L('Worker 연결 방법', 'Connecting a worker'), h('div.stack-sm', h('pre.ax-code', proto), h('button.btn.btn-outline.btn-sm', { onclick: () => copyText(proto) }, ic('copy'), ' ', L('복사', 'Copy')))));
  return consoleShell('#/axos', 'AXOS', L('폐루프 자동개발 운영 콘솔 — 승인된 피드백이 개발·검증·현업 확인·RTM 반영으로 이어지는 흐름을 제어합니다.', 'Closed-loop auto-development console — controls how approved feedback flows through development, verification, acceptance and RTM.'), content, { rfp: ['PMR-002', 'TER-001'], badge: h('span.badge', { style: 'margin-left:8px' }, st.mode) });
}

// ───────── 작업지시서 상세 ─────────
async function openOrder(id, admin) {
  let o; try { o = await GET('/api/axos/orders/' + id); } catch (e) { toast(errMsg(e), 'err'); return; }
  const m = modal({ title: `${o.id} · ${o.title}`, size: 'wide', body: null, footer: null });
  const body = m.box.querySelector('.modal-b'); let foot = m.box.querySelector('.modal-f'); if (!foot) { foot = h('div.modal-f'); m.box.append(foot); }
  const done = async (fn, okMsg) => { try { await fn(); toast(okMsg, 'ok'); m.close(); reload(); } catch (e) { toast(errMsg(e), 'err', 6000); } };
  const r = o.result;
  body.replaceChildren(h('div.stack-sm',
    h('div.row', { style: 'gap:6px;flex-wrap:wrap' }, AX.woBadge(o.status), statusBadge(o.risk), AX.prioBadge(o.priority), o.is_synthetic ? AX.synthTag() : null, h('span.badge', `rev ${o.rev}`), h('a.badge', { href: '#', onclick: (e) => { e.preventDefault(); m.close(); AX.openFeedback(o.feedback_id); } }, o.feedback_id)),
    h('div.small.muted', `${o.targets.route} · ${o.targets.file} · ${L('생성', 'created')} ${fmtDT(o.created_at)}${o.claimed_by ? ` · Worker ${o.claimed_by}` : ''}`),
    o.instruction_md && h('div', h('div.row.row-between', h('b', L('작업지시서 전문', 'Full instruction')), h('span.row', { style: 'gap:6px' }, h('button.btn.btn-sm', { onclick: () => copyText(o.instruction_md) }, ic('copy'), ' ', L('복사', 'Copy')), h('button.btn.btn-sm', { onclick: () => download(`${o.id}.md`, o.instruction_md, 'text/markdown;charset=utf-8') }, ic('download'), ' .md'))), h('pre.ax-code', o.instruction_md)),
    h('div', h('b', L('수용 기준', 'Acceptance criteria')), h('ul.small', { style: 'margin:4px 0 0;padding-left:18px' }, o.acceptance.map((a) => h('li', a)))),
    r && h('div.callout', h('b', L('결과 보고', 'Result')), h('p.small', { style: 'margin:4px 0' }, r.summary || '-'), h('div.xs.muted', `${L('파일', 'Files')}: ${(r.files || []).join(', ') || '-'}`), r.tests && h('div.xs.muted', `${L('테스트', 'Tests')}: ${r.tests.passed}/${r.tests.total}${r.tests.failed ? ` (${r.tests.failed} failed)` : ''} ${r.tests.cmd || ''}`), (r.reasons && r.reasons.length) ? h('div.xs', { style: 'color:var(--s-danger)' }, r.reasons.join(' | ')) : null, (r.rtm_updates && r.rtm_updates.length) ? h('div.xs', `RTM ${L('제안', 'proposals')}: ${r.rtm_updates.map((x) => `${x.req_id}${x.impl_status ? '→' + x.impl_status : ''}`).join(', ')}`) : null),
    h('div', h('b', L('진행 이력', 'Timeline')), h('ol.ax-timeline', o.events.map((e) => h('li', h('b', AX.evLabel(e.event)), ' ', h('span.xs.muted', `${e.actor_role || ''} ${fmtDT(e.at)}`)))))));
  const acts = [];
  if (admin) {
    const ack = h('input', { type: 'checkbox' }); const why = h('input', { type: 'text', placeholder: L('사유(선택)', 'Reason (optional)'), style: 'width:220px' });
    if (o.status === 'QUEUED') {
      if (o.risk === 'HIGH' && !o.guardrails.risk_ack) acts.push(h('label.check', ack, h('span', L('고위험 작업임을 확인했습니다(risk_ack)', 'I acknowledge this HIGH-risk order'))));
      acts.push(h('button.btn.btn-primary', { onclick: act(async () => done(() => POST(`/api/axos/orders/${o.id}/dispatch`, { risk_ack: ack.checked || o.guardrails.risk_ack }), L('Worker 착수를 허용했습니다.', 'Dispatched to workers.'))) }, L('착수 허용 (Worker)', 'Dispatch to worker')));
      acts.push(h('button.btn', { onclick: act(async () => done(() => POST(`/api/axos/orders/${o.id}/start`, { risk_ack: ack.checked || o.guardrails.risk_ack }), L('직접 착수했습니다.', 'Started manually.'))) }, L('직접 착수', 'Start manually')));
    }
    if (o.status === 'IN_PROGRESS') acts.push(h('button.btn.btn-primary', { onclick: () => { m.close(); manualReport(o); } }, L('결과 보고 입력', 'Enter result report')), h('button.btn', { onclick: act(async () => done(() => POST(`/api/axos/orders/${o.id}/requeue`, {}), L('큐로 되돌렸습니다.', 'Returned to queue.'))) }, L('재큐', 'Requeue')));
    if (o.status === 'FAILED') acts.push(h('button.btn.btn-primary', { onclick: act(async () => done(() => POST(`/api/axos/orders/${o.id}/requeue`, {}), L('큐로 되돌렸습니다.', 'Returned to queue.'))) }, L('재큐 (재시도)', 'Requeue (retry)')));
    if (['QUEUED', 'IN_PROGRESS', 'FAILED'].includes(o.status)) acts.push(why, h('button.btn.btn-danger', { onclick: act(async () => done(() => POST(`/api/axos/orders/${o.id}/cancel`, { reason: why.value }), L('취소했습니다.', 'Cancelled.'))) }, L('취소', 'Cancel')));
  }
  if (o.status === 'REPORTED') acts.push(h('button.btn.btn-primary', { onclick: () => { m.close(); AX.openFeedback(o.feedback_id, { onChange: reload }); } }, L('결과 확인 · 현업 확인(수락)/재작업', 'Review result · accept / rework')));
  foot.replaceChildren(h('div.row', { style: 'gap:8px;flex-wrap:wrap;width:100%' }, acts.length ? acts : h('span.small.muted', L('이 상태에서 가능한 작업이 없습니다.', 'No actions available in this state.'))));
}

function manualReport(o) {
  const sum = h('textarea', { rows: 3, style: 'width:100%', placeholder: L('무엇을 어떻게 반영했는지', 'What changed and how') });
  const files = h('textarea', { rows: 4, style: 'width:100%', placeholder: 'public/js/pages/markets.js\nserver/routes/public.js' });
  const tot = h('input', { type: 'number', value: '7', min: 0, style: 'width:80px' }); const pas = h('input', { type: 'number', value: '7', min: 0, style: 'width:80px' }); const fai = h('input', { type: 'number', value: '0', min: 0, style: 'width:80px' });
  const rtmIn = h('textarea', { rows: 2, style: 'width:100%', placeholder: o.rfp_ids.length ? `${o.rfp_ids[0]}:IMPLEMENTED:검증 메모` : 'SFR-005:IMPLEMENTED:메모' });
  const m = modal({ title: `${o.id} — ${L('결과 보고 (수동)', 'Result report (manual)')}`, size: 'wide', body: h('div.stack-sm', h('div.alert.info', ic('info'), L('Worker 없이 사람이 직접 개발한 경우의 보고입니다. 금지 경로·테스트 미통과는 서버가 자동 반려합니다.', 'Use when a human did the work. The server auto-rejects forbidden paths and missing/failing tests.')), h('label.lbl', L('작업 요약', 'Summary')), sum, h('label.lbl', L('변경 파일 (한 줄에 하나, 저장소 상대 경로)', 'Changed files (one per line, repo-relative)')), files, h('div.row', { style: 'gap:8px;align-items:center' }, h('span', L('테스트', 'Tests')), L('전체', 'total'), tot, L('통과', 'passed'), pas, L('실패', 'failed'), fai), h('label.lbl', L('RTM 제안 (줄마다 REQ:구현상태:메모, 선택)', 'RTM proposals (REQ:STATUS:note per line, optional)')), rtmIn),
    footer: (close) => [h('button.btn', { onclick: close }, L('취소', 'Cancel')), h('button.btn.btn-primary', { onclick: act(async () => {
      const rtm_updates = rtmIn.value.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const [req_id, impl_status, ...n] = l.split(':'); return { req_id: req_id.trim(), impl_status: (impl_status || '').trim() || undefined, note: n.join(':').trim() }; });
      const r = await POST(`/api/axos/orders/${o.id}/report`, { summary: sum.value, files: files.value.split('\n').map((x) => x.trim()).filter(Boolean), tests: { cmd: 'npm test', total: Number(tot.value), passed: Number(pas.value), failed: Number(fai.value) }, rtm_updates, worker: 'manual' });
      close(); toast(r.status === 'REPORTED' ? L('결과를 보고했습니다 — 현업 확인을 기다립니다.', 'Reported — awaiting business acceptance.') : L('자동 반려되었습니다: ', 'Auto-rejected: ') + r.reasons.join(' | '), r.status === 'REPORTED' ? 'ok' : 'err', 7000); reload();
    }) }, L('보고', 'Report'))] });
  return m;
}
