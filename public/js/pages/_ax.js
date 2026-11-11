// AX개발 · AXOS 공용 UI: 상태 라벨, 피드백 작성 폼, 피드백 상세(타임라인·검토·현업 확인) 다이얼로그.
import { h, L, store, GET, POST, act, ic, toast, modal, statusBadge, fmtDT, errMsg, navigate, field, empty } from '../lib.js';

export const FB_ST = {
  SUBMITTED: ['접수', 'Submitted', 'b-info'], NEEDS_INFO: ['보완 요청', 'Needs info', 'b-warn'], APPROVED: ['개발 진행', 'In dev loop', 'b-primary'], REJECTED: ['반려', 'Declined', 'b-danger'],
  DUPLICATE: ['중복', 'Duplicate', ''], WITHDRAWN: ['철회', 'Withdrawn', ''], DONE: ['반영 완료', 'Done', 'b-ok'], REOPENED: ['재작업', 'Reopened', 'b-warn'],
};
export const WO_ST = {
  QUEUED: ['개발 큐', 'Queued', 'b-info'], IN_PROGRESS: ['개발중', 'In progress', 'b-primary'], REPORTED: ['결과 보고 · 확인 대기', 'Reported · awaiting acceptance', 'b-warn'], FAILED: ['실패', 'Failed', 'b-danger'],
  ACCEPTED: ['현업 확인', 'Accepted', 'b-ok'], REOPENED: ['재작업', 'Reopened', 'b-warn'], CANCELLED: ['취소', 'Cancelled', ''],
};
export const GATE_ST = { PASS: ['통과', 'Pass', 'b-ok'], WARN: ['주의', 'Attention', 'b-warn'], FAIL: ['미통과', 'Fail', 'b-danger'], INFO: ['진행', 'In progress', 'b-info'] };
export const VERIFY_ST = { UNVERIFIED: ['미검증', 'Unverified', ''], VERIFIED: ['현업 검증', 'Verified', 'b-ok'], FAILED: ['검증 실패', 'Failed', 'b-danger'] };
export const KIND_EN = { 화면추가: 'New screen', 기능추가: 'New feature', 개선: 'Improvement', 버그: 'Bug', 데이터: 'Data', 성능: 'Performance', 연계: 'Integration' };
export const PRIO_LABEL = { P1: ['P1 긴급', 'P1 Urgent'], P2: ['P2 보통', 'P2 Normal'], P3: ['P3 낮음', 'P3 Low'] };
export const IMPL_LABEL = { IMPLEMENTED: ['구현', 'Implemented'], MOCK: ['구현(연계 Mock)', 'Implemented (mock)'], PARTIAL: ['부분 구현', 'Partial'], DESIGN_ONLY: ['설계 제시', 'Design only'], OUT_OF_MVP: ['본사업', 'Full programme'] };
export const GROUP_STAGES = [
  ['SUBMITTED', '접수·검토', 'Intake & review'], ['QUEUED', '개발 큐', 'Dev queue'], ['IN_PROGRESS', '자동개발', 'Auto-dev'], ['REPORTED', '결과 보고', 'Reported'], ['ACCEPTED', '현업 확인', 'Accepted'],
];

export const badgeOf = (map, code) => { const s = map[code]; return h('span', { class: 'badge ' + (s ? s[2] : '') }, s ? L(s[0], s[1]) : String(code ?? '-')); };
export const fbBadge = (c) => badgeOf(FB_ST, c);
export const woBadge = (c) => badgeOf(WO_ST, c);
export const prioBadge = (p) => h('span', { class: 'badge ax-prio ' + (p === 'P1' ? 'b-danger' : p === 'P2' ? 'b-info' : '') }, L(...(PRIO_LABEL[p] || [p, p])));
export const kindText = (k) => L(k, KIND_EN[k] || k);
export const synthTag = () => h('span', { class: 'badge b-synth', title: L('시연용 샘플 기록 — 실제 코드 변경·제안 사실이 아닙니다', 'Demo sample record — not a real code change or proposal fact') }, L('시연 샘플', 'Demo sample'));
export const screenName = (s) => (s ? L(s.ko, s.en) : '-');
export const isReviewer = () => store.user && ['admin', 'consultant'].includes(store.user.role);
export const isStaff = () => store.user && ['admin', 'consultant', 'office'].includes(store.user.role);
export const reload = () => window.dispatchEvent(new HashChangeEvent('hashchange'));
export const rfpChip = (id, href) => h(href ? 'a' : 'span', { class: 'rfp-tag', ...(href ? { href } : {}) }, id);

// ───────── 피드백 작성 폼 ─────────
const DRAFT = 'kt.ax.draft';
const readDraft = () => { try { return JSON.parse(localStorage.getItem(DRAFT) || 'null'); } catch { return null; } };
const writeDraft = (d) => { try { localStorage.setItem(DRAFT, JSON.stringify(d)); } catch { /* storage blocked */ } };
const clearDraft = () => { try { localStorage.removeItem(DRAFT); } catch { /* ignore */ } };

export function feedbackForm({ screen, featureId = '', route = '', kinds, onDone, onCancel }) {
  const KINDS = kinds || ['화면추가', '기능추가', '개선', '버그', '데이터', '성능', '연계'];
  const draft = readDraft(); const same = draft && draft.screen_key === screen.key;
  const st = { kind: (same && draft.kind) || '개선', priority: (same && draft.priority) || 'P2' };
  const feat = h('select', { 'aria-label': L('세부 기능', 'Feature') },
    h('option', { value: '' }, L('화면 전반', 'Whole screen')),
    (screen.features || []).map((f) => h('option', { value: f.id, selected: f.id === featureId }, L(f.ko, f.en))));
  const title = h('input', { type: 'text', maxlength: 120, placeholder: L('무엇을 추가·개선할지 한 줄로', 'One line: what should change?'), value: same ? draft.title || '' : '' });
  const asis = h('textarea', { rows: 2, maxlength: 2000, placeholder: L('지금은 어떻게 동작하나요? (구체적으로)', 'How does it work today? Be specific.') }, same ? draft.as_is || '' : '');
  const tobe = h('textarea', { rows: 3, maxlength: 2000, placeholder: L('무엇이 어떻게 바뀌어야 하나요? 화면·버튼·데이터·계산 등', 'What should change? Screen, buttons, data, calculations…') }, same ? draft.to_be || '' : '');
  const benefit = h('textarea', { rows: 2, maxlength: 1500, placeholder: L('왜 필요한가요? 업무 효과·RFP 근거 등 (선택)', 'Why is it needed? Business impact, RFP basis (optional)') }, same ? draft.benefit || '' : '');
  const rfp = h('input', { type: 'text', placeholder: L('예: SFR-043, SFR-036 (비우면 화면 연결 요구사항 자동 연결)', 'e.g. SFR-043 (blank = auto-link by screen)'), maxlength: 80 });
  const quality = h('div.ax-quality', { 'aria-live': 'polite' });
  const msg = h('div.small', { role: 'status' });
  const submit = h('button', { class: 'btn btn-primary', type: 'button', disabled: true }, L('피드백 접수', 'Submit feedback'));
  const chips = (items, key, labelFn) => {
    const box = h('div.ax-chips', { role: 'group' });
    const paint = () => [...box.children].forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.v === st[key])));
    items.forEach((v) => box.append(h('button', { type: 'button', class: 'ax-chip', 'data-v': v, onclick: () => { st[key] = v; paint(); save(); } }, labelFn(v))));
    paint(); return box;
  };
  const checks = [
    [L('제목 2자+', 'Title 2+'), () => title.value.trim().length >= 2],
    [L('현행 4자+', 'As-Is 4+'), () => asis.value.trim().length >= 4],
    [L('목표 4자+', 'To-Be 4+'), () => tobe.value.trim().length >= 4],
  ];
  function save() { writeDraft({ screen_key: screen.key, kind: st.kind, priority: st.priority, title: title.value, as_is: asis.value, to_be: tobe.value, benefit: benefit.value }); refresh(); }
  function refresh() {
    const res = checks.map(([l, f]) => [l, f()]);
    quality.replaceChildren(...res.map(([l, ok]) => h('span', { class: 'ax-ck' + (ok ? ' ok' : '') }, (ok ? '✓ ' : '○ ') + l)));
    submit.disabled = !res.every(([, ok]) => ok);
  }
  [title, asis, tobe, benefit].forEach((el) => el.addEventListener('input', save));
  const body = {
    kind: () => st.kind, priority: () => st.priority,
  };
  submit.onclick = act(async () => {
    msg.textContent = '';
    const r = await POST('/api/ax/feedback', { screen_key: screen.key, feature_id: feat.value || undefined, route: route || screen.route, kind: body.kind(), priority: body.priority(), title: title.value, as_is: asis.value, to_be: tobe.value, benefit: benefit.value, rfp_ids: rfp.value, lang: store.locale });
    clearDraft();
    toast(L(`피드백 ${r.id}이(가) 접수되었습니다.`, `Feedback ${r.id} submitted.`), 'ok');
    onDone && onDone(r);
  }, { btn: submit });
  const wrap = h('form', { class: 'ax-form stack-sm', onsubmit: (e) => e.preventDefault(), 'aria-label': L('화면·기능 피드백 작성', 'Write screen/feature feedback') },
    h('div.ax-target', h('b', L('대상 화면', 'Target screen')), ' ', screenName(screen), ' ', h('span.xs.muted', screen.route)),
    field(L('세부 기능', 'Feature'), feat),
    h('div', h('div.lbl', L('유형', 'Type')), chips(KINDS, 'kind', kindText)),
    field(L('제목', 'Title'), title, { req: true }), field(L('현행 (As-Is)', 'As-Is'), asis, { req: true }), field(L('목표 (To-Be)', 'To-Be'), tobe, { req: true }), field(L('기대효과 · 근거', 'Benefit / basis'), benefit),
    h('div', h('div.lbl', L('우선순위', 'Priority')), chips(['P1', 'P2', 'P3'], 'priority', (v) => L(...PRIO_LABEL[v]))),
    field(L('관련 RFP 요구사항 ID (선택)', 'Related RFP IDs (optional)'), rfp),
    quality, msg,
    h('div.row', { style: 'gap:8px;justify-content:flex-end' }, onCancel && h('button.btn', { type: 'button', onclick: onCancel }, L('취소', 'Cancel')), submit),
    h('p.xs.muted', { style: 'margin:0' }, L('접수 후 현업 책임자 검토(승인/보완/반려)를 거쳐 작업지시서가 만들어지고, 결과는 현업 확인 후 RTM에 반영됩니다. 개인정보·비밀번호·접근 코드는 입력하지 마세요.', 'After review (approve / clarify / decline) a work order is created; results reach the RTM only after business acceptance. Do not enter personal data, passwords or access codes.')));
  if (same && (draft.title || draft.to_be)) msg.append(h('span', { style: 'color:var(--c-primary)' }, L('작성 중이던 내용을 복원했습니다. ', 'Restored your draft. '), h('a', { href: '#', onclick: (e) => { e.preventDefault(); clearDraft(); title.value = asis.value = tobe.value = benefit.value = ''; refresh(); msg.textContent = ''; } }, L('비우기', 'Clear'))));
  refresh();
  return wrap;
}

// ───────── 피드백 상세 / 검토 / 현업 확인 ─────────
const EVT = {
  submitted: ['접수', 'Submitted'], approved: ['승인(개발 큐 등록)', 'Approved → queued'], needs_info: ['보완 요청', 'Needs info'], rejected: ['반려', 'Declined'], duplicate: ['중복 처리', 'Duplicate'], responded: ['보완 응답', 'Author responded'], withdrawn: ['철회', 'Withdrawn'],
  comment: ['의견', 'Comment'], created: ['작업지시서 생성', 'Work order created'], dispatched: ['착수 허용', 'Dispatched'], claimed: ['Worker 착수', 'Worker claimed'], started: ['수동 착수', 'Manual start'], reported: ['결과 보고', 'Result reported'],
  failed: ['실패', 'Failed'], requeued: ['재큐', 'Requeued'], cancelled: ['취소', 'Cancelled'], accepted: ['현업 확인', 'Accepted'], reopened: ['재작업 요청', 'Reopened'], done: ['반영 완료', 'Done'],
};
export const evLabel = (e) => L(...(EVT[e] || [e, e]));

export async function openFeedback(id, { onChange } = {}) {
  let d;
  try { d = await GET(`/api/ax/feedback/${encodeURIComponent(id)}`); } catch (e) { toast(errMsg(e), 'err'); return; }
  const me = store.user; const mine = d.author_id === me.id; const rv = isReviewer();
  const m = modal({ title: `${d.id} · ${d.title}`, size: 'wide', body: null, footer: null });
  const refresh = async () => { m.close(); onChange && onChange(); await openFeedback(id, { onChange }); };
  const done = async (fn, okMsg) => { try { await fn(); toast(okMsg, 'ok'); onChange && onChange(); m.close(); reload(); } catch (e) { toast(errMsg(e), 'err', 6000); } };
  const body = m.box.querySelector('.modal-b'); const foot = m.box.querySelector('.modal-f') || h('div.modal-f'); if (!foot.parentNode) m.box.append(foot);
  const rows = [
    h('div.row', { style: 'gap:6px;flex-wrap:wrap' }, fbBadge(d.status), prioBadge(d.priority), h('span.badge', kindText(d.kind)), d.is_synthetic ? synthTag() : null, d.order && woBadge(d.order.status), (d.review && d.review.flags && d.review.flags.length) ? h('span.badge.b-danger', { title: d.review.flags.join(', ') }, L('보안 주의 표시', 'Security flag')) : null),
    h('p.small.muted', { style: 'margin:0' }, `${screenName(d.screen)} · ${d.screen ? d.screen.route : ''} · ${d.author_name || ''} · ${fmtDT(d.created_at)}`),
    h('div.ax-grid2',
      h('div.callout', h('b', L('현행 (As-Is)', 'As-Is')), h('p.small', { style: 'white-space:pre-wrap;margin:4px 0 0' }, d.as_is)),
      h('div.callout', h('b', L('목표 (To-Be)', 'To-Be')), h('p.small', { style: 'white-space:pre-wrap;margin:4px 0 0' }, d.to_be))),
    d.benefit && h('div.callout.small', h('b', L('기대효과 · 근거', 'Benefit')), ' ', d.benefit),
    d.reqs.length > 0 && h('div', h('div.lbl', L('연결 요구사항 (RTM)', 'Linked requirements (RTM)')), h('div.row', { style: 'gap:6px;flex-wrap:wrap' }, d.reqs.map((r) => h('span.ax-req', { title: r.name }, h('b', r.req_id), ' ', r.name.slice(0, 22), ' ', statusBadge(r.impl_status))))),
  ];
  if (d.review && d.review.decision) rows.push(h('div.callout.small', h('b', L('검토 결과', 'Review')), ` ${d.review.decision} — ${d.review.note || ''}`, d.review.by_name ? ` (${d.review.by_name})` : ''));
  if (d.similar && d.similar.length) rows.push(h('div.alert.warn', ic('alert'), h('div', h('b', L('유사 피드백 후보', 'Similar feedback')), d.similar.map((s) => h('div.small', h('a', { href: '#', onclick: (e) => { e.preventDefault(); m.close(); openFeedback(s.id, { onChange }); } }, s.id), ` ${s.title} (${Math.round(s.sim * 100)}%)`)))));
  if (d.order) {
    const o = d.order; const r = o.result;
    rows.push(h('div.card', h('div.card-b.stack-sm',
      h('div.row.row-between', h('b', `${o.id} · ${L('작업지시서', 'Work order')}`), h('span.row', { style: 'gap:6px' }, woBadge(o.status), statusBadge(o.risk), o.is_synthetic ? synthTag() : null)),
      r ? h('div.small', h('b', L('결과 보고', 'Result')), ' ', r.summary || '-', r.files && r.files.length ? h('div.xs.muted', `${L('변경 파일', 'Files')}: ${r.files.join(', ')}`) : null, r.tests ? h('div.xs.muted', `${L('테스트', 'Tests')}: ${r.tests.passed}/${r.tests.total} ${L('통과', 'passed')}${r.tests.failed ? ` · ${r.tests.failed} ${L('실패', 'failed')}` : ''}`) : null, (r.reasons && r.reasons.length) ? h('div.xs', { style: 'color:var(--s-danger)' }, r.reasons.join(' | ')) : null) : h('div.small.muted', L('아직 개발 결과 보고가 없습니다.', 'No result reported yet.')))));
  }
  rows.push(h('div', h('div.lbl', L('진행 이력', 'Timeline')), h('ol.ax-timeline', d.events.map((e) => h('li', h('b', evLabel(e.event)), ' ', h('span.xs.muted', `${e.actor_role || ''} ${fmtDT(e.at)}`), e.detail && (e.detail.text || e.detail.note || e.detail.reason) ? h('div.small', e.detail.text || e.detail.note || e.detail.reason) : null)))));
  body.replaceChildren(h('div.stack-sm', rows));

  // 액션
  const actions = [];
  const note = h('textarea', { rows: 2, placeholder: L('사유 / 의견 (반려·보완·중복은 필수)', 'Reason / comment (required to decline / clarify / mark duplicate)'), style: 'width:100%' });
  const dup = h('input', { type: 'text', placeholder: L('중복 대상 FB-ID', 'Duplicate of FB-ID'), style: 'width:150px' });
  if (rv && ['SUBMITTED', 'REOPENED'].includes(d.status)) {
    const risk = d.order ? d.order.risk : null; const flagged = d.review && d.review.flags && d.review.flags.length;
    const ack = h('input', { type: 'checkbox' }); const conf = h('input', { type: 'checkbox' });
    actions.push(h('div.stack-sm', { style: 'width:100%' }, note,
      h('label.check', conf, h('span', L('검토를 마쳤으며, 승인 시 작업지시서가 개발 큐에 등록됨을 확인합니다. (Human-in-the-Loop)', 'I have reviewed this; approving creates a work order in the dev queue. (Human-in-the-Loop)'))),
      (flagged || me.role === 'admin') && h('label.check', ack, h('span', L('고위험(보안·권한·개인정보·스키마) 변경이면 위험을 확인했습니다.', 'If HIGH risk (security/permissions/PII/schema), I acknowledge the risk.'))),
      h('div.row', { style: 'gap:8px;flex-wrap:wrap' },
        h('button.btn.btn-primary', { onclick: act(async () => { if (!conf.checked) { toast(L('확인 항목에 체크하세요.', 'Please tick the confirmation.'), 'err'); return; } await done(() => POST(`/api/ax/feedback/${id}/review`, { decision: 'APPROVE', confirm: true, risk_ack: ack.checked, note: note.value }), L('승인되어 개발 큐에 등록되었습니다.', 'Approved and queued.')); }) }, L('승인 → 개발 큐', 'Approve → dev queue')),
        h('button.btn', { onclick: act(async () => done(() => POST(`/api/ax/feedback/${id}/review`, { decision: 'NEEDS_INFO', note: note.value }), L('보완을 요청했습니다.', 'Clarification requested.'))) }, L('보완 요청', 'Ask for info')),
        h('button.btn.btn-danger', { onclick: act(async () => done(() => POST(`/api/ax/feedback/${id}/review`, { decision: 'REJECT', note: note.value }), L('반려했습니다.', 'Declined.'))) }, L('반려', 'Decline')),
        dup, h('button.btn', { onclick: act(async () => done(() => POST(`/api/ax/feedback/${id}/review`, { decision: 'DUPLICATE', duplicate_of: dup.value.trim(), note: note.value }), L('중복 처리했습니다.', 'Marked duplicate.'))) }, L('중복', 'Duplicate')))));
  }
  if (mine && d.status === 'NEEDS_INFO') {
    const t = h('textarea', { rows: 3, placeholder: L('보완 내용을 입력하세요', 'Add the requested details'), style: 'width:100%' });
    actions.push(h('div.stack-sm', { style: 'width:100%' }, t, h('button.btn.btn-primary', { onclick: act(async () => done(() => POST(`/api/ax/feedback/${id}/respond`, { text: t.value }), L('보완 내용을 제출했습니다.', 'Clarification sent.'))) }, L('보완 제출', 'Send clarification'))));
  }
  if (d.order && d.order.status === 'REPORTED' && (mine || rv)) {
    const reason = h('textarea', { rows: 2, placeholder: L('재작업 사유 (재작업 시 필수)', 'Reason for rework'), style: 'width:100%' });
    const conf2 = h('input', { type: 'checkbox' });
    actions.push(h('div.stack-sm', { style: 'width:100%' }, h('div.callout.small', L('결과 화면을 직접 확인한 뒤 수락하면 릴리즈가 기록되고 연결 요구사항(RTM)이 갱신됩니다.', 'Check the result yourself first. Accepting records a release and updates the linked RTM rows.')), reason, h('label.check', conf2, h('span', L('결과를 확인했으며 수락합니다.', 'I verified the result and accept it.'))),
      h('div.row', { style: 'gap:8px' }, h('button.btn.btn-primary', { onclick: act(async () => { if (!conf2.checked) { toast(L('확인 항목에 체크하세요.', 'Please tick the confirmation.'), 'err'); return; } await done(() => POST(`/api/axos/orders/${d.order.id}/accept`, { confirm: true }), L('현업 확인 완료 — 릴리즈에 반영되었습니다.', 'Accepted — release recorded.')); }) }, L('현업 확인(수락)', 'Accept')),
        h('button.btn', { onclick: act(async () => done(() => POST(`/api/axos/orders/${d.order.id}/reopen`, { reason: reason.value }), L('재작업을 요청했습니다.', 'Rework requested.'))) }, L('재작업 요청', 'Request rework')))));
  }
  if ((mine || me.role === 'admin') && ['SUBMITTED', 'NEEDS_INFO'].includes(d.status)) actions.push(h('button.btn.btn-sm', { onclick: act(async () => done(() => POST(`/api/ax/feedback/${id}/withdraw`), L('철회했습니다.', 'Withdrawn.'))) }, L('철회', 'Withdraw')));
  const cmt = h('input', { type: 'text', placeholder: L('의견 남기기', 'Add a comment'), style: 'flex:1', maxlength: 800 });
  foot.replaceChildren(h('div.stack-sm', { style: 'width:100%' }, ...actions, h('div.row', { style: 'gap:8px' }, cmt, h('button.btn.btn-sm', { onclick: act(async () => { if (!cmt.value.trim()) return; await POST(`/api/ax/feedback/${id}/comment`, { text: cmt.value }); await refresh(); }) }, L('등록', 'Post')))));
}
export const goFeedback = (id) => navigate(`/axdev?tab=feedback&id=${id}`);

// 셀 배열 기반 표(공용 table()은 컬럼 키 기반이라 별도 제공)
export function tbl(cols, rows, { onRow } = {}) {
  if (!rows || !rows.length) return empty();
  const go = (r, i) => onRow && onRow(r, i);
  return h('div.table-wrap', h('table.tbl',
    h('thead', h('tr', cols.map((c) => h('th', { scope: 'col', style: c.w ? `width:${c.w}` : null }, c.label)))),
    h('tbody', rows.map((r, i) => h('tr', { class: onRow ? 'click' : '', tabindex: onRow ? '0' : null, onclick: onRow ? () => go(r, i) : null, onkeydown: onRow ? (e) => { if (e.key === 'Enter') go(r, i); } : null },
      r.map((cell, ci) => h('td', { 'data-label': cols[ci] ? cols[ci].label : '' }, cell)))))));
}
