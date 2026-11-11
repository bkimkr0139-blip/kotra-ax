// AX개발 센터 — 개발 거버넌스(RTM·게이트·백로그·피드백) · 제안·입찰 지원 · 컨소시엄 참여기업 · 변경 이력.
import { h, L, store, GET, POST, PUT, PATCH, act, ic, navigate, toast, modal, tabs, select, pager, field, meter, md, download, copyText, statusBadge, fmtDT, fmtDate, fmtNum, errMsg, pageHead, RFP, empty, qs, debounce } from '../lib.js';
import { consoleShell } from './_console.js';
import * as AX from './_ax.js';

const CSS_IMPL = { IMPLEMENTED: '#17794a', MOCK: '#5f3dc4', PARTIAL: '#0b62a8', DESIGN_ONLY: '#8693a4', OUT_OF_MVP: '#d7dee8' };
const card = (title, body, right) => h('div.card', h('div.card-h', h('h3', title), right), h('div.card-b', body));
const kpi = (l, v, s) => h('div.card', h('div.kpi', h('div.l', l), h('div.v', String(v)), s && h('div.s', String(s))));
const loading = () => h('div.skeleton', { style: 'height:120px' });
const errBox = (e) => h('div.alert.danger', ic('alert'), h('div', errMsg(e)));
const link = (tab, extra, label) => h('a', { href: '#/axdev' + qs({ tab, ...extra }) }, label);

export async function axdev({ query, user }) {
  const staff = AX.isStaff(); const rev = AX.isReviewer(); const admin = user.role === 'admin';
  const defs = [
    { id: 'overview', label: L('개요 · 폐루프', 'Overview · closed loop') },
    { id: 'screens', label: L('메뉴·화면 피드백', 'Menus & feedback') },
    { id: 'feedback', label: rev ? L('피드백 관리', 'Feedback review') : L('내 피드백', 'My feedback') },
    ...(staff ? [{ id: 'rtm', label: L('요구사항·RTM', 'Requirements · RTM') }, { id: 'gates', label: L('완료 게이트·백로그', 'Gates · backlog') }, { id: 'proposal', label: L('제안·입찰 지원', 'Proposal support') }] : []),
    ...(rev ? [{ id: 'consortium', label: L('컨소시엄 참여기업', 'Consortium') }] : []),
    { id: 'changelog', label: L('변경 이력', 'Changelog') },
  ];
  const tab = defs.some((d) => d.id === query.tab) ? query.tab : 'overview';
  const panel = h('div.stack', { id: 'ax-panel' }, loading());
  const R = { overview, screens, feedback, rtm, gates, proposal, consortium, changelog };
  const ctx = { query, user, staff, rev, admin, panel };
  R[tab](ctx).then((node) => { panel.replaceChildren(node); if (tab === 'feedback' && query.id) AX.openFeedback(query.id, { onChange: () => {} }); }).catch((e) => panel.replaceChildren(errBox(e)));
  const content = h('div.stack', tabs(defs, tab, (id) => navigate('/axdev' + qs({ tab: id })), L('AX개발 센터 메뉴', 'AX Dev centre sections')), panel);
  const title = L('AX개발 센터', 'AX Dev centre');
  const desc = L('RFP 요구사항(RTM)과 현업 피드백을 AXOS 폐루프로 연결해 시스템을 지속 고도화합니다.', 'Connects RFP requirements (RTM) and business feedback through the AXOS closed loop to keep improving the system.');
  if (staff) return consoleShell('#/axdev', title, desc, content, { rfp: ['PMR-002', 'PMR-019'] });
  return h('div', pageHead(title, desc, [{ label: title }]), h('div.container.section', content));
}

// ───────── 개요 ─────────
async function overview({ staff }) {
  if (!staff) {
    const [mine, log] = await Promise.all([GET('/api/ax/feedback?mine=1'), GET('/api/ax/changelog')]);
    const by = {}; mine.items.forEach((f) => { by[f.status] = (by[f.status] || 0) + 1; });
    return h('div.stack', hero(null), h('div.kpi-row', kpi(L('내 피드백', 'My feedback'), mine.total), kpi(L('검토 중', 'In review'), (by.SUBMITTED || 0) + (by.NEEDS_INFO || 0)), kpi(L('개발 진행', 'In dev loop'), by.APPROVED || 0), kpi(L('반영 완료', 'Done'), by.DONE || 0)),
      card(L('이렇게 사용하세요', 'How to use'), h('ol.small', { style: 'margin:0;padding-left:20px;display:grid;gap:6px' }, h('li', L('화면 오른쪽 끝의 “AX개발” 탭을 누르면 지금 보고 있는 화면의 세부 기능별로 피드백을 남길 수 있습니다.', 'Press the “AX Dev” tab at the right edge to leave feedback on the screen you are viewing, by feature.')), h('li', L('접수 → 책임자 검토(승인/보완/반려) → 개발 → 결과 보고 순서로 진행되며 진행 상황은 “내 피드백”에서 확인합니다.', 'Intake → review → development → result report; follow progress under “My feedback”.')), h('li', L('결과를 직접 확인하고 “현업 확인(수락)”을 눌러야 반영이 완료됩니다.', 'The change is final only after you verify it and press Accept.')))),
      card(L('최근 반영된 개선', 'Recent improvements'), recentList(log.items.slice(0, 5))));
  }
  const o = await GET('/api/ax/overview'); const m = o.metrics; const p = m.pipeline; const r = o.rtm; const total = r.total || 1;
  const flow = [
    [L('현업 피드백', 'Feedback'), L('메뉴·화면·기능 단위 입력', 'By menu / screen / feature'), p.SUBMITTED],
    [L('RTM 매핑', 'RTM mapping'), L(`요구사항 ${r.total}건 자동 연결`, `${r.total} requirements auto-linked`), `${r.screen_link_pct}%`],
    [L('검토·승인', 'Review (HITL)'), L('책임자 승인/보완/반려', 'Approve / clarify / decline'), (m.feedback.APPROVED || 0) + (m.feedback.DONE || 0)],
    [L('작업지시서', 'Work order'), L('개발 큐 대기', 'Waiting in queue'), p.QUEUED],
    [L('AXOS 자동개발', 'AXOS auto-dev'), L('Worker 개발중', 'Worker running'), p.IN_PROGRESS],
    [L('검증·보고', 'Verify & report'), L('테스트·가드레일 통과', 'Tests & guardrails'), p.REPORTED],
    [L('현업 확인', 'Acceptance'), L('RTM·릴리즈 반영', 'RTM & release updated'), p.ACCEPTED],
  ];
  const segs = ['IMPLEMENTED', 'MOCK', 'PARTIAL', 'DESIGN_ONLY', 'OUT_OF_MVP'];
  return h('div.stack', hero(flow),
    h('div.kpi-row', kpi(L('피드백', 'Feedback'), m.total_feedback, `${L('열림', 'open')} ${m.open}`), kpi(L('승인율', 'Approval'), m.approval_rate_pct == null ? '-' : m.approval_rate_pct + '%'), kpi(L('평균 리드타임', 'Lead time'), m.lead_time_days == null ? '-' : m.lead_time_days + L('일', 'd')), kpi(L('재작업률', 'Rework'), m.reopen_rate_pct == null ? '-' : m.reopen_rate_pct + '%'),
      kpi(L('MVP 구현율', 'MVP coverage'), r.mvp_coverage_pct + '%', `${L('완전 구현', 'full')} ${r.full_pct}%`), kpi(L('현업 검증', 'Verified'), `${r.verified}/${r.total}`), kpi(L('완료 게이트', 'Gates'), `${o.gate_pass}/9`), kpi(L('릴리즈', 'Releases'), m.releases)),
    h('div.grid.g2', { style: '--cols:2' },
      card(L('요구사항 구현 상태 (RTM)', 'Requirement status (RTM)'), h('div.stack-sm', h('div.ax-seg', segs.map((k) => h('i', { style: `width:${(r.by[k] / total) * 100}%;background:${CSS_IMPL[k]}`, title: `${L(...AX.IMPL_LABEL[k])} ${r.by[k]}` }))), h('div.legend', segs.map((k) => h('span', h('i', { style: `background:${CSS_IMPL[k]}` }), `${L(...AX.IMPL_LABEL[k])} ${r.by[k]}`))), h('p.small.muted', { style: 'margin:0' }, L('수치는 요구사항별 제안 답변 근거이며, “현업 검증”은 현업 확인(수락)을 거친 항목만 집계합니다.', 'Counts back each requirement answer; “verified” counts only items accepted by business users.'))), link('rtm', {}, L('RTM 열기 ›', 'Open RTM ›'))),
      card(L('AXOS 자동개발', 'AXOS auto-development'), h('div.stack-sm', h('div', h('span', { class: 'ax-led ' + o.axos.worker.state }), h('b', `${L('Worker', 'Worker')}: ${o.axos.worker.state === 'NEVER' ? L('연결 이력 없음', 'never connected') : o.axos.worker.state}`)), h('div.small', `${L('모드', 'Mode')}: `, h('b', o.axos.mode), ' · ', o.axos.token_configured ? L('Worker 토큰 설정됨', 'worker token set') : L('Worker 토큰 미발급', 'no worker token yet')), h('a.btn.btn-outline.btn-sm', { href: '#/axos' }, ic('gear'), ' ', L('AXOS 콘솔', 'AXOS console'))))),
    card(L('최근 폐루프 활동', 'Recent loop activity'), h('ol.ax-timeline', o.recent.map((e) => h('li', h('b', `${e.ref_id}`), ' ', AX.evLabel(e.event), ' ', h('span.xs.muted', `${e.actor_role || ''} ${fmtDT(e.at)}`))))),
    h('div.grid.g2', { style: '--cols:2' },
      card(L('역할과 책임', 'Roles'), h('ul.small', { style: 'margin:0;padding-left:18px;display:grid;gap:5px' }, h('li', L('현업(고객·바이어·직원): 피드백 입력, 결과 확인(수락/재작업)', 'Business users: write feedback, accept or reopen results')), h('li', L('책임자(상담전문위원·관리자): 검토·승인(HITL), 의견·RTM 검증', 'Reviewers: approve (HITL), comment, verify RTM')), h('li', L('관리자: AXOS 모드·토큰·가드레일, 고위험 변경 승인', 'Admin: AXOS mode, token, guardrails, HIGH-risk approval')), h('li', L('AXOS Worker: 승인된 작업지시서만 가져가 개발 → 테스트 → 결과 보고(스스로 승인·반영 불가)', 'AXOS Worker: takes approved orders only → develop → test → report; can never approve or accept')))),
      card(L('안전장치', 'Safeguards'), h('ul.small', { style: 'margin:0;padding-left:18px;display:grid;gap:5px' }, h('li', L('현업 원문은 데이터로만 인용(프롬프트 인젝션 방어), 위험 문구는 고위험 표시', 'User text is quoted as data; risky wording flags HIGH risk')), h('li', L('금지 경로(.env·data·deploy·키) 변경 시 자동 반려', 'Changes to forbidden paths (.env, data, deploy, keys) are auto-rejected')), h('li', L('테스트 미통과·미보고 시 자동 반려', 'Missing or failing tests are auto-rejected')), h('li', L('모든 상태 전이는 서버 검증 + 해시체인 감사로그', 'Every transition is server-validated and hash-chain audited'))))));
}
function hero(flow) {
  return h('div.ax-hero', h('h2', L('폐루프 AX 개발 체계', 'Closed-loop AX development')),
    h('p', L('제안요청서의 요구사항을 RTM으로 추적하고, 현업이 메뉴·화면·기능별로 남긴 피드백을 승인(HITL) → 작업지시서 → AXOS 자동개발 → 테스트·결과 보고 → 현업 확인으로 이어 반영합니다. 반영 결과는 다시 RTM의 증빙과 구현 상태로 돌아옵니다.', 'Requirements from the RFP are traced in the RTM. Business feedback by menu / screen / feature flows through approval (HITL) → work order → AXOS auto-development → tests & report → business acceptance — and returns to the RTM as evidence.')),
    h('ol.ax-flow.ax-flow-ol', (flow || [[L('현업 피드백', 'Feedback'), L('입력', 'Input'), ''], [L('RTM 매핑', 'RTM'), '', ''], [L('검토·승인', 'Review'), '', ''], [L('작업지시서', 'Work order'), '', ''], [L('AXOS 자동개발', 'Auto-dev'), '', ''], [L('검증·보고', 'Verify'), '', ''], [L('현업 확인', 'Accept'), '', '']]).map(([t, s, n]) => h('li', h('b', t), h('span', s), n !== '' && h('em', String(n))))));
}
const recentList = (items) => (items.length ? h('ul.ax-list', items.map((r) => h('li', h('b', r.ver), ' ', r.title, ' ', r.is_synthetic ? AX.synthTag() : null, h('div.xs.muted', fmtDate(r.at))))) : h('p.small.muted', L('아직 반영 이력이 없습니다.', 'No releases yet.')));

// ───────── 메뉴·화면 피드백 ─────────
async function screens({ query }) {
  const d = await GET('/api/ax/screens'); const filter = { q: '' };
  const sel = d.screens.find((s) => s.key === query.screen) || d.screens.find((s) => s.kind === 'screen');
  const tree = h('div.ax-tree', { role: 'tree', 'aria-label': L('메뉴 트리', 'Menu tree') });
  const draw = () => {
    const t = filter.q.trim().toLowerCase(); tree.replaceChildren();
    Object.entries(d.groups).forEach(([g, name]) => {
      const list = d.screens.filter((s) => s.group === g && (!t || `${s.ko} ${s.en} ${s.route} ${s.features.map((f) => f.ko + f.en).join(' ')}`.toLowerCase().includes(t)));
      if (!list.length) return;
      const open = list.some((s) => s.key === sel.key) || !!t;
      tree.append(h('details', { open }, h('summary', L(...name), ' ', h('span.ax-cnt', list.length)),
        list.map((s) => h('button', { type: 'button', class: 'ax-node', role: 'treeitem', 'aria-current': String(s.key === sel.key), onclick: () => navigate('/axdev' + qs({ tab: 'screens', screen: s.key })) }, h('span', AX.screenName(s)), s.feedback.open ? h('span.ax-cnt.open', s.feedback.open) : s.feedback.total ? h('span.ax-cnt', s.feedback.total) : null))));
    });
  };
  const search = h('input', { type: 'search', placeholder: L('메뉴·화면·기능 검색', 'Search menus, screens, features'), 'aria-label': L('메뉴 검색', 'Search menus'), style: 'width:100%', oninput: debounce((e) => { filter.q = e.target.value; draw(); }, 150) });
  draw();
  const fb = await GET('/api/ax/feedback?screen=' + encodeURIComponent(sel.key));
  const reqs = AX.isStaff() ? (await GET('/api/ax/rtm?screen=' + encodeURIComponent(sel.key))).items : [];
  const byFeat = {}; fb.items.forEach((f) => { const k = f.feature_id || '_'; byFeat[k] = (byFeat[k] || 0) + 1; });
  const openForm = (featureId) => {
    const m = modal({ title: `${L('피드백 작성', 'New feedback')} — ${AX.screenName(sel)}`, size: 'wide', body: AX.feedbackForm({ screen: sel, featureId, kinds: d.kinds, onDone: () => { m.close(); window.dispatchEvent(new HashChangeEvent('hashchange')); }, onCancel: () => m.close() }) });
  };
  const openable = !sel.route.includes(':') && sel.kind === 'screen';
  const detail = h('div.stack',
    h('div.card', h('div.card-b.stack-sm', h('div.row.row-between', h('div', h('h2', { style: 'margin:0' }, AX.screenName(sel)), h('div.small.muted', `${L(...d.groups[sel.group])} · `, h('code', sel.route))), h('div.row', { style: 'gap:8px' }, openable && h('a.btn.btn-outline.btn-sm', { href: '#' + sel.route }, L('화면 열기', 'Open screen')), h('button.btn.btn-primary.btn-sm', { onclick: () => openForm('') }, ic('edit'), ' ', L('이 화면에 피드백', 'Feedback on this screen')))),
      sel.file && h('div.xs.muted', `${L('구현', 'Source')}: ${sel.file} · API: ${sel.api.length ? sel.api.join(', ') : '-'}`))),
    card(L('세부 기능', 'Features'), h('div.stack-sm', sel.features.map((f) => h('div.ax-feat-card', h('div', h('b', L(f.ko, f.en)), h('div.xs.muted', f.id)), h('div.row', { style: 'gap:8px' }, byFeat[f.id] ? h('span.ax-cnt.open', `${byFeat[f.id]}`) : null, h('button.btn.btn-sm', { onclick: () => openForm(f.id) }, L('피드백', 'Feedback'))))))),
    AX.isStaff() && card(L('연결 요구사항 (RTM)', 'Linked requirements (RTM)'), reqs.length ? h('div.row', { style: 'gap:6px;flex-wrap:wrap' }, reqs.map((r) => h('a.ax-req', { href: '#/axdev' + qs({ tab: 'rtm', screen: sel.key }), title: r.name }, h('b', r.req_id), ' ', r.name.slice(0, 20), ' ', statusBadge(r.impl_status)))) : h('p.small.muted', L('연결된 요구사항이 없습니다.', 'No linked requirements.'))),
    card(AX.isReviewer() ? L('이 화면의 피드백', 'Feedback on this screen') : L('내 피드백', 'My feedback'), fb.items.length ? feedbackTable(fb.items, AX.isReviewer()) : h('p.small.muted', L('아직 접수된 피드백이 없습니다. 위 버튼으로 첫 의견을 남겨 보세요.', 'No feedback yet — be the first.'))));
  return h('div.ax-split', h('div.stack-sm', search, tree), detail);
}

// ───────── 피드백 목록 ─────────
function feedbackTable(items, showAuthor) {
  return AX.tbl([{ label: 'ID', w: '86px' }, { label: L('제목', 'Title') }, { label: L('유형', 'Type'), w: '90px' }, { label: L('우선', 'Prio'), w: '80px' }, { label: L('상태', 'Status'), w: '120px' }, ...(showAuthor ? [{ label: L('작성자', 'Author'), w: '100px' }] : []), { label: L('작업지시서', 'Work order'), w: '110px' }, { label: L('접수', 'Created'), w: '110px' }],
    items.map((f) => [h('b', f.id), h('span', f.title, ' ', f.is_synthetic ? AX.synthTag() : null), AX.kindText(f.kind), AX.prioBadge(f.priority), AX.fbBadge(f.status), ...(showAuthor ? [f.author_name] : []), f.order_id || '-', fmtDate(f.created_at)]), { onRow: (r, i) => AX.openFeedback(items[i].id, { onChange: () => window.dispatchEvent(new HashChangeEvent('hashchange')) }) });
}
async function feedback({ rev, query }) {
  const state = { scope: rev ? 'all' : 'mine', status: query.status || '', q: '' }; const holder = h('div');
  const groups = [['', L('전체', 'All')], ['SUBMITTED,NEEDS_INFO,REOPENED', L('검토 대기·보완', 'Needs review')], ['APPROVED', L('개발 진행', 'In dev loop')], ['DONE', L('반영 완료', 'Done')], ['REJECTED,DUPLICATE,WITHDRAWN', L('반려·중복·철회', 'Closed')]];
  async function draw() {
    const p = new URLSearchParams(); if (state.status) p.set('status', state.status); if (state.scope === 'mine') p.set('mine', '1'); if (state.q) p.set('q', state.q);
    const d = await GET('/api/ax/feedback?' + p.toString());
    holder.replaceChildren(d.items.length ? feedbackTable(d.items, rev) : empty(L('조건에 맞는 피드백이 없습니다.', 'No matching feedback.')));
  }
  const bar = h('div.row', { style: 'gap:8px;flex-wrap:wrap' },
    h('div.ax-chips', groups.map(([v, l]) => h('button', { type: 'button', class: 'ax-chip', 'aria-pressed': String(state.status === v), onclick: (e) => { state.status = v; [...e.currentTarget.parentNode.children].forEach((c) => c.setAttribute('aria-pressed', 'false')); e.currentTarget.setAttribute('aria-pressed', 'true'); draw(); } }, l))),
    rev && h('label.check', h('input', { type: 'checkbox', onchange: (e) => { state.scope = e.target.checked ? 'mine' : 'all'; draw(); } }), h('span', L('내가 쓴 것만', 'Mine only'))),
    h('input', { type: 'search', placeholder: L('제목·내용·ID 검색', 'Search title, text, ID'), 'aria-label': L('피드백 검색', 'Search feedback'), style: 'min-width:220px', oninput: debounce((e) => { state.q = e.target.value; draw(); }, 250) }));
  await draw();
  return h('div.stack', rev && h('div.callout.small', L('“검토 대기·보완” 항목을 열어 승인(개발 큐 등록) · 보완 요청 · 반려 · 중복 처리를 하세요. 승인에는 확인 체크가 필요하며, 본인이 쓴 피드백은 관리자만 승인할 수 있습니다.', 'Open “Needs review” items to approve (queue), request info, decline or mark duplicate. Approval needs an explicit confirmation; only admins may approve their own feedback.')), bar, holder);
}

// ───────── RTM ─────────
async function rtm({ query, rev, admin }) {
  const f = { cat: '', status: '', verify: '', q: '', open: false, screen: query.screen || '' }; let page = 1; const PER = 25;
  const holder = h('div.stack-sm'); const sumBox = h('div'); let rows = [];
  const catSel = select([{ value: '', label: L('전체 분류', 'All categories') }, ...['SFR', 'SIR', 'DAR', 'SER', 'PER', 'QUR', 'TER', 'COR', 'PMR', 'PSR', 'CCR', 'CNR'].map((c) => ({ value: c, label: c }))], '', { 'aria-label': L('분류', 'Category'), style: 'width:auto;min-width:150px' });
  const stSel = select([{ value: '', label: L('전체 구현 상태', 'All statuses') }, ...Object.entries(AX.IMPL_LABEL).map(([k, v]) => ({ value: k, label: L(...v) }))], '', { 'aria-label': L('구현 상태', 'Status'), style: 'width:auto;min-width:170px' });
  const vSel = select([{ value: '', label: L('전체 검증', 'All verification') }, ...Object.entries(AX.VERIFY_ST).map(([k, v]) => ({ value: k, label: L(v[0], v[1]) }))], '', { 'aria-label': L('검증 상태', 'Verification'), style: 'width:auto;min-width:170px' });
  async function load() {
    const p = new URLSearchParams(); Object.entries({ cat: f.cat, status: f.status, verify: f.verify, q: f.q, screen: f.screen }).forEach(([k, v]) => v && p.set(k, v)); if (f.open) p.set('open', '1');
    const d = await GET('/api/ax/rtm?' + p.toString()); rows = d.items; page = 1; sum(d.summary); draw();
  }
  function sum(s) { sumBox.replaceChildren(h('div.kpi-row', kpi(L('요구사항', 'Requirements'), s.total), kpi(L('MVP 구현율', 'MVP coverage'), s.mvp_coverage_pct + '%'), kpi(L('완전 구현', 'Fully implemented'), s.by.IMPLEMENTED), kpi(L('부분·Mock', 'Partial / mock'), s.by.PARTIAL + s.by.MOCK), kpi(L('설계 제시', 'Design only'), s.by.DESIGN_ONLY), kpi(L('본사업', 'Full programme'), s.by.OUT_OF_MVP), kpi(L('현업 검증', 'Verified'), s.verified))); }
  function draw() {
    const part = rows.slice((page - 1) * PER, page * PER);
    holder.replaceChildren(h('p.small.muted', { style: 'margin:0' }, L(`${rows.length}건 중 ${part.length}건 표시`, `Showing ${part.length} of ${rows.length}`)),
      h('div.table-wrap', h('table.tbl.ax-trace.keep-table', h('thead', h('tr', ['ID', L('요구사항', 'Requirement'), L('구현', 'Impl.'), L('시연', 'Demo'), L('검증', 'Verif.'), L('연결 화면', 'Screens'), L('테스트', 'Tests'), L('피드백', 'Feedback')].map((c) => h('th', { scope: 'col' }, c)))),
        h('tbody', part.map((r) => { const x = h('tr.ax-rowx', { hidden: true }, h('td', { colspan: 8 }, h('div.skeleton', { style: 'height:40px' }))); const tr = h('tr.click', { tabindex: 0, 'aria-expanded': 'false', onclick: () => toggle(tr, x, r), onkeydown: (e) => { if (e.key === 'Enter') toggle(tr, x, r); } },
          h('td', h('b', r.req_id)), h('td', r.name), h('td', statusBadge(r.impl_status)), h('td', statusBadge(r.demo_status)), h('td', AX.badgeOf(AX.VERIFY_ST, r.verify_status)), h('td', r.screen_titles.length ? r.screen_titles.slice(0, 2).map((s) => h('div.xs', s.ko || s.key)) : h('span.muted', '-')), h('td', r.tests.length ? '✓ ' + r.tests.length : h('span.muted', '-')),
          h('td', r.feedback.open ? h('span.ax-cnt.open', r.feedback.open) : r.feedback.done ? h('span.ax-cnt', r.feedback.done) : '-')); return [tr, x]; })))),
      pager(page, Math.ceil(rows.length / PER), (n) => { page = n; draw(); }));
  }
  async function toggle(tr, x, r) {
    const open = x.hidden; x.hidden = !open; tr.setAttribute('aria-expanded', String(open)); if (!open || x.dataset.loaded) return; x.dataset.loaded = '1';
    try {
      const d = await GET('/api/ax/rtm/' + r.req_id); const owner = h('input', { type: 'text', value: d.owner || '', maxlength: 60, 'aria-label': L('담당', 'Owner'), style: 'width:160px' });
      const ver = select(Object.entries(AX.VERIFY_ST).map(([k, v]) => ({ value: k, label: L(v[0], v[1]) })), d.verify_status); const note = h('input', { type: 'text', placeholder: L('검증 메모', 'Verification note'), value: d.verify_note || '', maxlength: 300, style: 'width:240px' });
      x.firstChild.replaceChildren(h('div.stack-sm',
        h('div.ax-grid2', h('div', h('b', L('RFP 원문 요약', 'RFP excerpt')), h('p.small', { style: 'margin:4px 0 0;white-space:pre-wrap' }, d.rfp_detail || '-')), h('div.stack-sm', h('div.small', h('b', L('증빙', 'Evidence')), ': ', d.evidence || '-'), h('div.small', h('b', L('한계·비고', 'Limits')), ': ', d.notes || '-'), h('div.small', h('b', 'API'), ': ', d.apis.join(', ') || '-'), h('div.small', h('b', L('테스트', 'Tests')), ': ', d.tests.join(', ') || '-'),
          h('div.small', h('b', L('피드백', 'Feedback')), ': ', d.feedback_items.length ? d.feedback_items.map((f) => h('a', { href: '#', style: 'margin-right:8px', onclick: (e) => { e.preventDefault(); AX.openFeedback(f.id); } }, f.id)) : '-'), h('div.small', h('b', L('작업지시서', 'Work orders')), ': ', d.orders.map((o) => `${o.id}(${o.status})`).join(', ') || '-'),
          h('div.small', h('b', L('연결 화면', 'Screens')), ': ', d.screen_titles.map((s) => h('a', { href: '#/axdev' + qs({ tab: 'screens', screen: s.key }), style: 'margin-right:8px' }, s.ko || s.key)))), ),
        rev && h('div.row', { style: 'gap:8px;flex-wrap:wrap' }, h('b', L('담당·검증', 'Owner · verification')), owner, ver, note, h('button.btn.btn-sm.btn-primary', { onclick: act(async () => { await PATCH('/api/ax/rtm/' + r.req_id, { owner: owner.value, verify_status: ver.value, verify_note: note.value }); toast(L('저장했습니다.', 'Saved.'), 'ok'); load(); }) }, L('저장', 'Save')))));
    } catch (e) { x.firstChild.replaceChildren(errBox(e)); }
  }
  const search = h('input', { type: 'search', placeholder: L('ID·요구사항·증빙 검색', 'Search ID, requirement, evidence'), 'aria-label': L('RTM 검색', 'Search RTM'), style: 'min-width:240px', oninput: debounce((e) => { f.q = e.target.value; load(); }, 250) });
  catSel.onchange = () => { f.cat = catSel.value; load(); }; stSel.onchange = () => { f.status = stSel.value; load(); }; vSel.onchange = () => { f.verify = vSel.value; load(); };
  const snaps = admin ? h('button.btn.btn-outline.btn-sm', { onclick: act(async () => { const r = await POST('/api/ax/rtm/rebuild', {}); toast(L(`RTM를 재구축했습니다 (${r.updated}건 갱신, 스냅샷 ${r.snapshot.id}).`, `RTM rebuilt (${r.updated} rows, snapshot ${r.snapshot.id}).`), 'ok'); load(); }) }, ic('layers'), ' ', L('RTM 재구축', 'Rebuild RTM')) : null;
  await load();
  return h('div.stack', h('div.callout.small', L('RFP 요구사항 150건을 화면·API·테스트·증빙·피드백·작업지시서에 연결한 추적 매트릭스입니다. 행을 눌러 근거와 연결 항목을 확인하고, 책임자는 담당·검증 상태를 기록합니다. “재구축”은 사람이 입력한 담당·검증 내용을 보존합니다.', 'The matrix links all 150 RFP requirements to screens, APIs, tests, evidence, feedback and work orders. Open a row for details; reviewers record owner and verification. Rebuild preserves human-entered data.')),
    sumBox, h('div.row', { style: 'gap:8px;flex-wrap:wrap' }, catSel, stSel, vSel, search, h('label.check', h('input', { type: 'checkbox', onchange: (e) => { f.open = e.target.checked; load(); } }), h('span', L('열린 피드백 있음', 'Has open feedback'))), f.screen && h('button.ax-chip', { type: 'button', 'aria-pressed': 'true', onclick: () => { f.screen = ''; load(); } }, `${L('화면', 'Screen')}: ${f.screen} ✕`), snaps), holder);
}

// ───────── 게이트·백로그 ─────────
async function gates() {
  const [g, b] = await Promise.all([GET('/api/ax/gates'), GET('/api/ax/backlog')]);
  return h('div.stack',
    h('div.callout.small', L('게이트 값은 RTM·저장소·감사로그·평가 결과에서 실시간 계산합니다(고정 문구 아님).', 'Gate values are computed live from the RTM, repository, audit log and evaluation results — not static text.')),
    h('div.grid.g3', { style: '--cols:3' }, g.items.map((x) => h('div', { class: 'ax-gate ' + x.status }, h('div.row.row-between', h('b', `${x.id} · ${L(x.ko, x.en)}`), AX.badgeOf(AX.GATE_ST, x.status)), h('div.v', x.value), h('div.xs.muted', L(x.detail_ko, x.detail_en))))),
    card(L(`구현 보완 대상 요구사항 (${b.requirements.length}건)`, `Requirements to strengthen (${b.requirements.length})`), AX.tbl([{ label: 'ID', w: '90px' }, { label: L('요구사항', 'Requirement') }, { label: L('상태', 'Status'), w: '110px' }, { label: L('한계·비고', 'Limits') }, { label: L('열린 피드백', 'Open'), w: '90px' }], b.requirements.slice(0, 40).map((r) => [h('b', r.id), r.title, statusBadge(r.status), r.note || '-', r.open_feedback || '-'])), h('span.xs.muted', L(`본사업 범위 ${b.out_of_mvp}건은 별도`, `${b.out_of_mvp} full-programme items excluded`))),
    card(L(`진행 중 피드백 (${b.feedback.length}건)`, `Open feedback (${b.feedback.length})`), b.feedback.length ? AX.tbl([{ label: 'ID', w: '86px' }, { label: L('제목', 'Title') }, { label: L('화면', 'Screen') }, { label: L('우선', 'Prio'), w: '80px' }, { label: L('상태', 'Status'), w: '110px' }, { label: L('지시서', 'WO'), w: '90px' }], b.feedback.map((f) => [h('b', f.id), f.title, f.screen, AX.prioBadge(f.priority), AX.fbBadge(f.status), f.order_id || '-']), { onRow: (_, i) => AX.openFeedback(b.feedback[i].id) }) : h('p.small.muted', L('없음', 'None'))));
}

// ───────── 제안·입찰 지원 ─────────
async function proposal({ query, rev }) {
  const sub = ['answers', 'checklist', 'qna', 'evidence'].includes(query.sub) ? query.sub : 'answers';
  const nav = h('div.seg', { role: 'group' }, [['answers', L('요구사항 답변(조견표)', 'Requirement answers')], ['checklist', L('제출서류 체크리스트', 'Submission checklist')], ['qna', L('고객 질의·답변', 'Customer Q&A')], ['evidence', L('근거·증빙팩', 'Evidence pack')]].map(([id, l]) => h('button', { 'aria-pressed': String(sub === id), onclick: () => navigate('/axdev' + qs({ tab: 'proposal', sub: id })) }, l)));
  const body = await ({ answers: pAnswers, checklist: pChecklist, qna: pQna, evidence: pEvidence }[sub])({ rev });
  return h('div.stack', h('div.callout.small', L('요구사항 답변은 RTM의 구현 상태·증빙·한계에서 자동 생성되므로 구현이 바뀌면 답변도 함께 바뀝니다. 아래 데이터 중 제출서류·질의·컨소시엄 항목은 시연용 샘플입니다.', 'Answers are generated from the RTM, so they change when the implementation changes. Checklist, Q&A and consortium entries are demo samples.')), nav, body);
}
async function pAnswers() {
  const d = await GET('/api/ax/proposal/answers'); let cat = ''; const holder = h('div');
  const draw = () => holder.replaceChildren(AX.tbl([{ label: 'ID', w: '86px' }, { label: L('요구사항', 'Requirement'), w: '20%' }, { label: L('수용 여부', 'Stance'), w: '130px' }, { label: L('답변 초안', 'Draft answer') }, { label: L('검증', 'Verif.'), w: '90px' }],
    d.items.filter((a) => !cat || a.category === cat).slice(0, 150).map((a) => [h('b', a.req_id), a.name, h('b', L(a.stance_ko, a.stance_en)), h('span.small', L(a.answer_ko, a.answer_en)), AX.badgeOf(AX.VERIFY_ST, a.verify_status)])));
  const sel = select([{ value: '', label: L('전체 분류', 'All') }, ...['SFR', 'SIR', 'DAR', 'SER', 'PER', 'QUR', 'TER', 'COR', 'PMR', 'PSR', 'CCR', 'CNR'].map((c) => ({ value: c, label: c }))], '', { 'aria-label': L('분류', 'Category'), style: 'width:auto;min-width:150px', onchange: (e) => { cat = e.target.value; draw(); } });
  draw();
  return h('div.stack-sm', h('div.row', { style: 'gap:10px;flex-wrap:wrap' }, sel, ...Object.entries(d.by_stance).map(([k, v]) => h('span.badge', `${k} ${v}`)), h('button.btn.btn-outline.btn-sm', { onclick: act(async () => { const r = await fetch('/api/ax/proposal/answers.csv', { credentials: 'same-origin' }); if (!r.ok) throw new Error('export failed'); download('kotra-ax-rfp-answers.csv', await r.text(), 'text/csv;charset=utf-8'); }) }, ic('file'), ' ', L('조견표 CSV 내보내기', 'Export CSV'))), holder);
}
async function pChecklist({ rev }) {
  const d = await GET('/api/ax/proposal/checklist'); const done = d.items.filter((i) => i.status === 'DONE').length; const na = d.items.filter((i) => i.status === 'N/A').length;
  const label = { TODO: L('미착수', 'To do'), IN_PROGRESS: L('진행', 'In progress'), DONE: L('완료', 'Done'), 'N/A': L('해당없음', 'N/A') };
  return h('div.stack-sm', h('div.row', { style: 'gap:12px' }, h('b', `${done}/${d.items.length - na} ${L('완료', 'done')}`), h('div', { style: 'flex:1' }, meter(((done) / Math.max(1, d.items.length - na)) * 100, 'ok'))),
    AX.tbl([{ label: 'ID', w: '60px' }, { label: L('서류', 'Document') }, { label: L('담당', 'Owner'), w: '120px' }, { label: L('기한', 'Due'), w: '100px' }, { label: L('상태', 'Status'), w: '140px' }],
      d.items.map((i) => [i.id, L(i.title_ko, i.title_en), i.owner, fmtDate(i.due), rev ? select(d.states.map((s) => ({ value: s, label: label[s] })), i.status, { 'aria-label': `${i.id} ${L('상태', 'status')}`, onchange: act(async (e) => { await PATCH('/api/ax/proposal/checklist/' + i.id, { status: e.target.value }); toast(L('저장했습니다.', 'Saved.'), 'ok'); }) }) : label[i.status]])));
}
async function pQna({ rev }) {
  const d = await GET('/api/ax/proposal/qna'); const next = { RECEIVED: ['ASSIGNED'], ASSIGNED: ['DRAFTED'], DRAFTED: ['REVIEWED'], REVIEWED: ['SUBMITTED'], SUBMITTED: [] };
  const lab = { RECEIVED: L('접수', 'Received'), ASSIGNED: L('배정', 'Assigned'), DRAFTED: L('작성', 'Drafted'), REVIEWED: L('검토', 'Reviewed'), SUBMITTED: L('제출', 'Submitted') };
  const edit = (it, to) => {
    const who = h('input', { type: 'text', value: it.assignee || '', placeholder: L('담당자', 'Assignee'), style: 'width:100%' }); const ans = h('textarea', { rows: 5, style: 'width:100%' }, it.answer || ''); const ok = h('input', { type: 'checkbox' });
    const m = modal({ title: `${it.id} → ${lab[to]}`, body: h('div.stack-sm', h('p.small', it.question), to === 'ASSIGNED' ? field(L('담당자', 'Assignee'), who) : field(L('답변', 'Answer'), ans), to === 'SUBMITTED' && h('label.check', ok, h('span', L('대외 제출임을 확인했습니다.', 'I confirm this is an external submission.')))), footer: (close) => [h('button.btn', { onclick: close }, L('취소', 'Cancel')), h('button.btn.btn-primary', { onclick: act(async () => { await PATCH('/api/ax/proposal/qna/' + it.id, { status: to, assignee: who.value, answer: ans.value, confirm: ok.checked }); close(); window.dispatchEvent(new HashChangeEvent('hashchange')); }) }, L('저장', 'Save'))] });
    return m;
  };
  const add = () => { const qn = h('textarea', { rows: 4, style: 'width:100%' }); const rf = h('input', { type: 'text', placeholder: 'SFR-001', style: 'width:140px' }); modal({ title: L('새 질의 등록', 'New question'), body: h('div.stack-sm', field(L('질의 내용', 'Question'), qn), field(L('관련 RFP ID(선택)', 'RFP ID (optional)'), rf)), footer: (close) => [h('button.btn', { onclick: close }, L('취소', 'Cancel')), h('button.btn.btn-primary', { onclick: act(async () => { await POST('/api/ax/proposal/qna', { question: qn.value, rfp_id: rf.value }); close(); window.dispatchEvent(new HashChangeEvent('hashchange')); }) }, L('등록', 'Add'))] }); };
  return h('div.stack-sm', rev && h('div', h('button.btn.btn-primary.btn-sm', { onclick: add }, L('+ 질의 등록', '+ Add question'))),
    AX.tbl([{ label: 'ID', w: '80px' }, { label: L('질의', 'Question') }, { label: 'RFP', w: '90px' }, { label: L('상태', 'Status'), w: '90px' }, { label: L('담당', 'Owner'), w: '100px' }, { label: L('답변', 'Answer') }, ...(rev ? [{ label: '', w: '110px' }] : [])],
      d.items.map((i) => [i.id, h('span.small', i.question), i.rfp_id || '-', h('span.badge', lab[i.status]), i.assignee || '-', h('span.small', i.answer || '-'), ...(rev ? [next[i.status].map((to) => h('button.btn.btn-sm', { onclick: () => edit(i, to) }, `→ ${lab[to]}`))] : [])])));
}
async function pEvidence() {
  const d = await GET('/api/ax/proposal/evidence');
  return h('div.stack-sm', h('div.row', { style: 'gap:8px' }, h('button.btn.btn-outline.btn-sm', { onclick: () => download('kotra-ax-evidence-pack.md', d.markdown, 'text/markdown;charset=utf-8') }, L('Markdown 내려받기', 'Download .md')), h('button.btn.btn-outline.btn-sm', { onclick: () => copyText(d.markdown) }, L('복사', 'Copy'))), h('pre.ax-code', d.markdown.slice(0, 6000) + (d.markdown.length > 6000 ? '\n…' : '')));
}

// ───────── 컨소시엄 ─────────
async function consortium({ admin }) {
  const d = await GET('/api/ax/consortium'); const mem = Object.fromEntries(d.members.map((m) => [m.id, m]));
  const redraw = () => window.dispatchEvent(new HashChangeEvent('hashchange'));
  return h('div.stack',
    h('div.alert.mock', ic('info'), h('div', L('참여사·인력은 시연용 가상 데이터입니다. 실제 컨소시엄 구성이 확정되면 이 화면에서 교체합니다.', 'Participants and staff are fictional demo data; replace them when the real consortium is fixed.'))),
    h('div.kpi-row', kpi(L('참여사', 'Members'), d.members.length), kpi(L('투입 인력', 'Staff'), d.staff.length), kpi(L('보안서약 완료', 'Pledges signed'), `${d.pledge.signed}/${d.pledge.total}`), kpi(L('RACI 점검', 'RACI check'), d.raci_issues.length ? `${d.raci_issues.length} ${L('이슈', 'issues')}` : 'OK')),
    h('div.grid.g3', { style: '--cols:3' }, d.members.map((m) => h('div.card', h('div.card-b.stack-sm', h('div.row.row-between', h('b', L(m.org_ko, m.org_en)), m.lead ? h('span.badge.b-primary', L('주관', 'Lead')) : null), h('div.small', L(m.role_ko, m.role_en)), h('div.row', { style: 'gap:6px;flex-wrap:wrap' }, m.modules.map((x) => h('span.badge', x))))))),
    card(L('RACI · 산출물 담당표', 'RACI · deliverable ownership'), h('div.table-wrap', h('table.ax-matrix', h('thead', h('tr', [L('산출물', 'Deliverable'), ...d.members.map((m) => L(m.org_ko.replace(/ \(.*\)/, ''), m.org_en.replace(/ \(.*\)/, '')))].map((c) => h('th', c)))),
      h('tbody', d.deliverables.map((x) => h('tr', h('td', `${x.id} ${L(x.ko, x.en)}`), ...d.members.map((m) => { const code = (d.raci[x.id] || {})[m.id] || ''; return h('td', { class: code ? 'ax-raci-' + code : '' }, admin ? select(['', 'R', 'A', 'C', 'I'].map((c) => ({ value: c, label: c || '·' })), code, { 'aria-label': `${x.id} ${m.id}`, onchange: act(async (e) => { await PUT('/api/ax/consortium/raci', { deliverable: x.id, member_id: m.id, code: e.target.value }); redraw(); }) }) : code || '·'); })))))),
      h('p.xs.muted', L('R 수행 · A 최종책임(산출물당 1곳) · C 협의 · I 통보', 'R responsible · A accountable (exactly one) · C consulted · I informed')), d.raci_issues.length ? h('div.alert.warn', ic('alert'), `${L('책임자(A)가 1곳이 아닌 산출물', 'Deliverables without exactly one A')}: ${d.raci_issues.join(', ')}`) : null),
    card(L('참여인력 · 보안서약', 'Staff · security pledge'), AX.tbl([{ label: 'ID', w: '60px' }, { label: L('소속', 'Member') }, { label: L('인력(가상)', 'Staff (fictional)') }, { label: L('구분', 'Kind'), w: '100px' }, { label: L('보안서약', 'Pledge'), w: '140px' }],
      d.staff.map((s) => [s.id, L(mem[s.member_id].org_ko, mem[s.member_id].org_en), `${s.name}`, { IN: L('자사', 'In-house'), PLANNED: L('채용예정', 'Planned'), EXTERNAL: L('외부자문', 'External') }[s.kind], admin ? select([['SIGNED', L('서명 완료', 'Signed')], ['PENDING', L('대기', 'Pending')], ['EXPIRED', L('만료', 'Expired')]].map(([value, label]) => ({ value, label })), s.pledge, { 'aria-label': `${s.id} pledge`, onchange: act(async (e) => { await PATCH('/api/ax/consortium/staff/' + s.id, { pledge: e.target.value }); redraw(); }) }) : s.pledge]))));
}

// ───────── 변경 이력 ─────────
async function changelog() {
  const d = await GET('/api/ax/changelog');
  return d.items.length ? h('div.stack-sm', d.items.map((r) => h('div.card', h('div.card-b.stack-sm', h('div.row.row-between', h('div.row', { style: 'gap:8px' }, h('span.badge.b-ok', r.ver), h('b', r.title), r.is_synthetic ? AX.synthTag() : null), h('span.small.muted', fmtDate(r.at))), r.summary && h('p.small', { style: 'margin:0' }, r.summary), h('div.row', { style: 'gap:6px;flex-wrap:wrap' }, r.screen && h('a.badge', { href: '#/axdev' + qs({ tab: 'screens', screen: r.screen.key }) }, AX.screenName(r.screen)), r.rfp_ids.map((x) => AX.rfpChip(x)), h('span.xs.muted', `${r.feedback_id} · ${r.order_id}`)))))) : empty(L('아직 반영 이력이 없습니다.', 'No releases yet.'));
}
