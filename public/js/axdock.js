// 우측 가장자리 "AX개발" · "AXOS" 탭 + AX개발 인덱스 드로어(현재 화면의 세부 기능·연결 요구사항·피드백 입력).
import { h, $, store, L, GET, ic, parseHash, statusBadge, errMsg } from './lib.js';
import { feedbackForm, fbBadge, prioBadge, kindText, screenName, IMPL_LABEL } from './pages/_ax.js';

let open = false; let seq = 0; let bseq = 0; let badgeEl = null; let drawerEl = null; let showForm = false; let formFeature = '';
const enabled = () => !!store.config && store.config.axdev_enabled !== false;
const reviewer = () => !!store.user && ['admin', 'consultant'].includes(store.user.role);
const currentRoute = () => { const { path } = parseHash(); return path || '/'; };

export function mountAxDock() {
  const host = $('#axdock'); if (!host) return;
  host.replaceChildren(); badgeEl = null;
  document.body.classList.toggle('has-ax', enabled());
  if (!enabled()) { closeDrawer(); return; }
  badgeEl = h('span.ax-badge', { hidden: true, 'aria-hidden': 'true' });
  const dev = h('button', { type: 'button', class: 'ax-tab ax-tab-dev', id: 'ax-tab-dev', 'aria-haspopup': 'dialog', 'aria-expanded': String(open), 'aria-controls': 'ax-drawer', title: L('AX개발 인덱스 — 이 화면에 피드백 남기기, RTM·폐루프 보기', 'AX Dev index — leave feedback on this screen, open RTM and the closed loop'), onclick: toggle },
    ic('edit'), h('span.ax-tab-t', L('AX개발', 'AX Dev')), badgeEl);
  const os = reviewer() ? h('a', { class: 'ax-tab ax-tab-os', href: '#/axos', title: L('AXOS — 폐루프 자동개발 운영 콘솔', 'AXOS — closed-loop auto-development console') }, ic('gear'), h('span.ax-tab-t', 'AXOS')) : null;
  host.append(h('div.ax-dock', dev, os));
  if (open) renderDrawer(); else refreshBadge();
}

function toggle() { open ? closeDrawer() : openDrawer(); }
function openDrawer() { open = true; document.body.classList.add('ax-open'); showForm = false; formFeature = ''; const t = $('#ax-tab-dev'); if (t) t.setAttribute('aria-expanded', 'true'); renderDrawer(); }
function closeDrawer() {
  open = false; document.body.classList.remove('ax-open'); const t = $('#ax-tab-dev'); if (t) { t.setAttribute('aria-expanded', 'false'); }
  if (drawerEl) { drawerEl.remove(); drawerEl = null; } document.removeEventListener('keydown', onKey);
}
function onKey(e) { if (e.key === 'Escape') { closeDrawer(); const t = $('#ax-tab-dev'); t && t.focus(); } }

async function refreshBadge() {
  if (!store.user || !badgeEl) return;
  const my = ++bseq;
  try {
    const c = await GET('/api/ax/context?route=' + encodeURIComponent(currentRoute()), { quiet: true });
    if (my !== bseq || !badgeEl) return;
    const n = c.screen ? c.screen.feedback.open : 0; badgeEl.textContent = n > 9 ? '9+' : String(n); badgeEl.hidden = n === 0;
  } catch { if (badgeEl) badgeEl.hidden = true; }
}

async function renderDrawer() {
  const my = ++seq;
  if (!drawerEl) {
    drawerEl = h('aside', { id: 'ax-drawer', class: 'ax-drawer', role: 'complementary', 'aria-label': L('AX개발 인덱스', 'AX Dev index'), tabindex: '-1' });
    document.body.append(drawerEl); document.addEventListener('keydown', onKey);
  }
  const head = h('header.ax-dr-h', h('div', h('h2', L('AX개발 인덱스', 'AX Dev index')), h('p.xs.muted', { style: 'margin:0' }, L('현업 피드백 → RTM → 작업지시서 → AXOS 자동개발 → 현업 확인', 'Feedback → RTM → work order → AXOS auto-dev → acceptance'))), h('button', { type: 'button', class: 'icon-btn', 'aria-label': L('닫기', 'Close'), onclick: () => { closeDrawer(); const t = $('#ax-tab-dev'); t && t.focus(); } }, ic('close')));
  const body = h('div.ax-dr-b');
  drawerEl.replaceChildren(head, body);
  if (!store.user) {
    body.append(h('div.callout', h('b', L('로그인 후 이용할 수 있습니다', 'Log in to use this panel')), h('p.small', L('화면·기능 피드백은 계정으로 접수되어 추적·승인됩니다.', 'Feedback is recorded against your account for tracking and approval.')), h('a.btn.btn-primary.btn-sm', { href: '#/login?next=' + encodeURIComponent(location.hash.slice(1)), onclick: closeDrawer }, L('로그인', 'Log in'))));
    return;
  }
  body.append(h('div.skeleton', { style: 'height:22px;width:60%' }), h('div.skeleton', { style: 'height:80px;margin-top:10px' }));
  let c;
  try { c = await GET('/api/ax/context?route=' + encodeURIComponent(currentRoute()), { quiet: true }); } catch (e) { body.replaceChildren(h('div.alert.danger', errMsg(e))); return; }
  if (my !== seq || !drawerEl) return;
  const s = c.screen;
  body.replaceChildren();
  if (!s) { body.append(h('div.callout', L('이 화면은 AX개발 레지스트리에 등록되어 있지 않습니다.', 'This page is not in the AX Dev registry.')), centerLink()); return; }
  const reload = () => renderDrawer();
  body.append(
    h('section.ax-sec', h('div.ax-cur', h('span.badge.b-primary', L('현재 화면', 'Current screen')), h('h3', screenName(s)), h('code.xs', s.route)),
      h('div.row', { style: 'gap:6px;flex-wrap:wrap;margin-top:6px' }, h('span.badge', `${L('열린 피드백', 'Open')} ${s.feedback.open}`), h('span.badge', `${L('전체', 'Total')} ${s.feedback.total}`), s.feedback.done ? h('span.badge.b-ok', `${L('반영', 'Done')} ${s.feedback.done}`) : null)),
    h('section.ax-sec', h('h4', L('연결 요구사항 (RTM)', 'Linked requirements (RTM)')),
      c.reqs.length ? h('ul.ax-list', c.reqs.slice(0, 6).map((r) => h('li', h('b', r.req_id), ' ', r.name, ' ', statusBadge(r.impl_status)))) : h('p.small.muted', L('연결된 요구사항이 없습니다.', 'No linked requirements.')),
      c.reqs.length > 6 && h('p.xs.muted', L(`외 ${c.reqs.length - 6}건`, `+${c.reqs.length - 6} more`))),
    h('section.ax-sec', h('h4', L('세부 기능 · 피드백 대상', 'Features · feedback targets')),
      h('ul.ax-list', s.features.map((f) => h('li.ax-feat', h('span', L(f.ko, f.en)), h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { showForm = true; formFeature = f.id; renderDrawer(); } }, L('피드백', 'Feedback')))))),
  );
  if (showForm) {
    body.append(h('section.ax-sec', h('h4', L('피드백 작성', 'New feedback')), feedbackForm({ screen: s, featureId: formFeature, route: currentRoute(), kinds: c.kinds, onDone: () => { showForm = false; formFeature = ''; reload(); refreshBadge(); }, onCancel: () => { showForm = false; reload(); } })));
  } else {
    body.append(h('button', { type: 'button', class: 'btn btn-primary ax-wide', onclick: () => { showForm = true; formFeature = ''; renderDrawer(); } }, ic('edit'), ' ', L('이 화면에 피드백 쓰기', 'Write feedback for this screen')));
  }
  body.append(h('section.ax-sec', h('h4', c.can_review ? L('이 화면의 피드백', 'Feedback on this screen') : L('내 피드백', 'My feedback')),
    c.recent.length ? h('ul.ax-list', c.recent.map((f) => h('li', h('a', { href: `#/axdev?tab=feedback&id=${f.id}`, onclick: closeDrawer }, h('b', f.id), ' ', f.title), h('div.row', { style: 'gap:6px;flex-wrap:wrap;margin-top:2px' }, fbBadge(f.status), prioBadge(f.priority), h('span.badge', kindText(f.kind)))))) : h('p.small.muted', L('아직 접수된 피드백이 없습니다.', 'No feedback yet.'))));
  body.append(centerLink(s));
}

function centerLink(s) {
  const q = s ? `&screen=${encodeURIComponent(s.key)}` : '';
  return h('div.ax-dr-f', h('a.btn.btn-outline', { href: `#/axdev?tab=screens${q}`, onclick: closeDrawer }, ic('grid'), ' ', L('AX개발 센터 열기', 'Open AX Dev centre')),
    store.user && ['admin', 'consultant', 'office'].includes(store.user.role) ? h('a.btn.btn-outline', { href: `#/axdev?tab=rtm${s ? `&screen=${encodeURIComponent(s.key)}` : ''}`, onclick: closeDrawer }, ic('layers'), ' RTM') : null,
    reviewer() ? h('a.btn.btn-outline', { href: '#/axos', onclick: closeDrawer }, ic('gear'), ' AXOS') : null);
}

window.addEventListener('hashchange', () => { if (!enabled()) return; if (open) renderDrawer(); else refreshBadge(); });
