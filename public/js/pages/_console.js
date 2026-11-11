import { h, L, store, ic, RFP } from '../lib.js';
import { STAFF_NAV, ADMIN_NAV } from '../nav.js';
const ADMIN_ONLY = ['#/admin/audit', '#/admin/demo'];
// 그룹 표시 순서: 개요 → 현업(상담·해외정보·업무) → AI·데이터 → AX개발 → 시스템 → 검수
const ORDER = ['개요', '상담 업무', '해외정보', '업무 관리', '데이터 통합·MDM', 'AI 운영', '데이터', 'AX개발', '시스템', '검수·시연', '참고'];
const rank = (g) => { const i = ORDER.indexOf(g.g[0]); return i < 0 ? 99 : i; };
export function navFor(role) {
  let groups;
  if (role === 'admin') groups = [...STAFF_NAV, ...ADMIN_NAV.map((g) => ({ g: g.g, items: g.items.map((i) => [i[0], i[1], i[2], i[3], null, i[5]]) }))].filter((g, idx, arr) => arr.findIndex((x) => x.g[0] === g.g[0]) === idx);
  else if (role === 'consultant') groups = [...STAFF_NAV, ...ADMIN_NAV.map((g) => ({ g: g.g, items: g.items.filter((i) => !ADMIN_ONLY.includes(i[0])).map((i) => [i[0], i[1], i[2], i[3], null, i[5]]) })).filter((g) => g.items.length)];
  else groups = [...STAFF_NAV, { g: ['참고', 'Reference'], items: [['#/admin', 'Dashboard', 'Dashboard', 'grid'], ['#/admin/rfp', 'RFP Coverage', 'RFP Coverage', 'flag'], ['#/axdev', 'AX개발 센터', 'AX Dev centre', 'layers'], ['#/admin/data', 'Catalog · Pipeline', 'Catalog · Pipeline', 'db'], ['#/admin/data-integration', '데이터 통합·MDM', 'Data integration · MDM', 'route']] }];
  if (store.config && store.config.di_enabled === false) groups = groups.map((g) => ({ ...g, items: g.items.filter((i) => !String(i[0]).includes('/admin/data-integration')) })).filter((g) => g.items.length); // 기능 플래그(DATA_INTEGRATION_STUDIO_ENABLED)
  return groups.map((g, i) => ({ g, i })).sort((a, b) => rank(a.g) - rank(b.g) || a.i - b.i).map((x) => x.g);
}

// ───────── 업무 콘솔 셸: 접이식 그룹 · 메뉴 검색 · 아이콘 레일 · 모바일 드로어 · 브레드크럼 ─────────
const LS = 'kt.adm.nav';
const load = () => { try { return JSON.parse(localStorage.getItem(LS) || '{}'); } catch { return {}; } };
const save = (o) => { try { localStorage.setItem(LS, JSON.stringify(o)); } catch { /* storage may be blocked */ } };
let navScroll = 0; // 메뉴를 눌러 화면이 다시 그려져도 사이드바 스크롤 위치를 유지

export function consoleShell(active, title, desc, content, { rfp = [], right, badge } = {}) {
  const st = load();
  const groups = navFor(store.user.role);
  const activeGroup = groups.find((g) => g.items.some((i) => i[0] === active));
  const adm = h('div', { class: 'adm' + (st.rail ? ' rail' : '') });
  const scroller = h('div.adm-ns');
  const closeDrawer = () => { adm.classList.remove('nav-open'); mbtn.setAttribute('aria-expanded', 'false'); };

  const link = (i) => {
    const on = active === i[0];
    return h('a', { href: i[0], class: 'adm-link' + (on ? ' active' : ''), 'aria-current': on ? 'page' : null, title: L(i[1], i[2]), 'data-t': `${i[1]} ${i[2]}`.toLowerCase(), onclick: closeDrawer },
      ic(i[3] || 'grid'), h('span.t', L(i[1], i[2])), i[5] === 'approvals' && store.pendingApprovals > 0 ? h('span.cnt', store.pendingApprovals) : null);
  };
  groups.forEach((g) => {
    const key = g.g[0]; const closed = g !== activeGroup && !!(st.closed && st.closed[key]);
    const sec = h('section', { class: 'adm-grp' + (closed ? ' closed' : '') });
    const head = h('button', { type: 'button', class: 'adm-gh', 'aria-expanded': String(!closed), title: L(g.g[0], g.g[1]), onclick: () => {
      const c = sec.classList.toggle('closed'); head.setAttribute('aria-expanded', String(!c)); const s = load(); s.closed = { ...(s.closed || {}), [key]: c }; save(s);
    } }, h('span', L(g.g[0], g.g[1])), ic('caret'));
    sec.append(head, h('div.adm-gi', g.items.map(link))); scroller.append(sec);
  });

  const empty = h('p.adm-none', { hidden: true }, L('일치하는 메뉴가 없습니다.', 'No matching menu.'));
  const search = h('input', { type: 'search', class: 'adm-search', placeholder: L('메뉴 검색', 'Search menu'), 'aria-label': L('콘솔 메뉴 검색', 'Search console menu'), autocomplete: 'off', oninput: (e) => {
    const t = e.target.value.trim().toLowerCase(); nav.classList.toggle('searching', !!t); let any = false;
    scroller.querySelectorAll('.adm-grp').forEach((sec) => { let n = 0; sec.querySelectorAll('.adm-link').forEach((a) => { const hit = !t || a.dataset.t.includes(t); a.hidden = !hit; if (hit) n++; }); sec.hidden = n === 0; if (n) any = true; });
    empty.hidden = any;
  } });
  const railBtn = h('button', { type: 'button', class: 'adm-rail-btn', 'aria-label': L('메뉴 접기/펼치기', 'Collapse / expand menu'), 'aria-pressed': String(!!st.rail), title: L('메뉴 접기/펼치기', 'Collapse / expand menu'), onclick: () => {
    const on = adm.classList.toggle('rail'); railBtn.setAttribute('aria-pressed', String(on)); const s = load(); s.rail = on; save(s);
  } }, ic('menu'));
  const nav = h('nav', { class: 'adm-nav', id: 'adm-nav', 'aria-label': L('업무 콘솔 메뉴', 'Console menu') },
    h('div.adm-nh', h('b.adm-nt', L('업무 콘솔', 'Work console')), railBtn),
    h('div.adm-sw', search), scroller, empty,
    h('a.adm-back', { href: '#/', title: L('고객 포털로', 'Customer portal') }, ic('home'), h('span.t', L('고객 포털로 돌아가기', 'Back to customer portal'))));
  nav.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });
  scroller.addEventListener('scroll', () => { navScroll = scroller.scrollTop; }, { passive: true });
  const restore = () => { scroller.scrollTop = navScroll; const a = scroller.querySelector('a.active'); if (a) { const r = a.getBoundingClientRect(); const n = scroller.getBoundingClientRect(); if (r.height && (r.top < n.top || r.bottom > n.bottom)) { a.scrollIntoView({ block: 'nearest' }); navScroll = scroller.scrollTop; } } };
  requestAnimationFrame(() => { restore(); requestAnimationFrame(restore); });

  const mbtn = h('button', { type: 'button', class: 'adm-mbtn', 'aria-controls': 'adm-nav', 'aria-expanded': 'false', onclick: () => { const o = adm.classList.toggle('nav-open'); mbtn.setAttribute('aria-expanded', String(o)); } }, ic('menu'), h('span', L('메뉴', 'Menu')));
  const mbar = h('div.adm-mbar', mbtn, h('b.adm-mt', title));
  const scrim = h('div.adm-scrim', { onclick: closeDrawer });

  const crumb = h('nav.adm-crumb', { 'aria-label': 'breadcrumb' }, h('a', { href: '#/' }, L('고객 포털', 'Portal')), h('span', '›'), h('span', L('업무 콘솔', 'Console')), activeGroup && [h('span', '›'), h('span', L(activeGroup.g[0], activeGroup.g[1]))], h('span', '›'), h('b', title));
  const main = h('div.adm-main', crumb,
    h('div.adm-head', h('div.adm-ttl', h('h1', { id: 'page-title', tabindex: '-1' }, title, rfp.length > 0 && RFP(...rfp), badge), desc && h('p.muted', desc)),
      h('div.adm-act', right, h('a.btn.btn-outline.btn-sm.adm-portal-btn', { href: '#/', title: L('고객 포털 홈으로 이동', 'Go to the customer portal home') }, ic('home'), L('고객 포털로', 'Customer portal')))),
    content);
  adm.append(mbar, nav, scrim, main);
  return adm;
}
