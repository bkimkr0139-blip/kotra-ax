// App shell: demo bar, utility bar, header with GNB + mega menu, mobile drawer, search, quick dock, tab bar, footer.
import { h, $, $$, clear, store, L, setLocale, ic, svgIcon, GET, POST, toast, navigate, parseHash, act, errMsg, askDemoCode } from './lib.js';
import { GNB, FAMILY } from './nav.js';
import { mountAxDock } from './axdock.js';

export async function refreshMe() {
  try {
    const me = await GET('/api/me', { quiet: true });
    store.user = me.user; store.company = me.company || null; store.buyer = me.buyer || null; store.unread = me.unread || 0; store.pendingApprovals = me.pending_approvals || 0; store.perms = me.permissions || {};
  } catch { store.user = null; }
}
const isStaff = () => store.user && ['consultant', 'office', 'admin'].includes(store.user.role);
// 공식 로고 이미지(public/img/kotra-logo.png). 파일이 없으면 기존 텍스트·SVG 로고로 자동 대체한다.
const LOGO_SRC = '/img/kotra-logo.png';
const fallbackBrand = () => [
  h('span', { html: '<svg viewBox="0 0 44 44" width="40" height="40" aria-hidden="true"><circle cx="22" cy="22" r="21" fill="#0b4ea2"/><ellipse cx="22" cy="22" rx="21" ry="8.500" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="1.400"/><ellipse cx="22" cy="22" rx="8.500" ry="21" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="1.400"/></svg>' }),
  h('span.bt', h('b', 'KOTRA'), h('span', L('무역투자24 · 지능형 플랫폼', 'Trade-Investment 24 · Intelligent Platform'))),
];
const logo = () => {
  const a = h('a.brand', { href: '#/', 'aria-label': L('KOTRA 무역투자24 홈', 'KOTRA Trade-Investment 24 home') });
  const img = h('img', { class: 'brand-img', src: LOGO_SRC, alt: L('KOTRA 무역투자24', 'KOTRA Trade-Investment 24'), height: 40, decoding: 'async' });
  img.addEventListener('error', () => { a.replaceChildren(...fallbackBrand()); a.classList.remove('has-img'); }, { once: true });
  img.addEventListener('load', () => a.classList.add('has-img'), { once: true });
  a.append(img); return a;
};

let openMega = null;
function closeMega() { if (openMega) { openMega.classList.remove('open'); const b = $('button', openMega); b && b.setAttribute('aria-expanded', 'false'); openMega = null; } }
function gnb() {
  const { path } = parseHash();
  return h('nav.gnb', { 'aria-label': L('주 메뉴', 'Main navigation') }, GNB.map((m) => {
    const item = h('div', { class: 'gnb-item' + (path.startsWith(m.base) ? ' active' : '') });
    const btn = h('button', { 'aria-expanded': 'false', 'aria-haspopup': 'true', onclick: (e) => { e.stopPropagation(); toggle(); }, onkeydown: (e) => { if (e.key === 'Escape') { closeMega(); btn.focus(); } if (e.key === 'ArrowDown') { e.preventDefault(); open(); const a = $('.mega a', item); a && a.focus(); } } }, L(m.ko, m.en), h('span', { class: 'caret', html: svgIcon('caret') }));
    const panel = h('div.mega', { role: 'region', 'aria-label': L(m.ko, m.en) }, h('div.container', h('div.mega-intro', h('h3', L(m.ko, m.en)), h('p', L(m.dko, m.den)), h('a.btn.btn-primary.btn-sm', { href: '#' + m.base, onclick: closeMega }, L('바로가기', 'Open'), ic('arrow'))), h('div.mega-links', m.items.map((it) => h('a', { href: it.href, onclick: closeMega, onkeydown: (e) => { if (e.key === 'Escape') { closeMega(); btn.focus(); } } }, h('b', L(it.ko, it.en)), (it.dko || it.den) && h('span', L(it.dko, it.den)))))));
    const open = () => { if (openMega && openMega !== item) closeMega(); item.classList.add('open'); btn.setAttribute('aria-expanded', 'true'); openMega = item; };
    const toggle = () => (item.classList.contains('open') ? closeMega() : open());
    item.addEventListener('mouseenter', () => { if (matchMedia('(hover:hover)').matches) open(); });
    item.addEventListener('mouseleave', () => { if (matchMedia('(hover:hover)').matches) closeMega(); });
    item.append(btn, panel); return item;
  }));
}
function searchPop() {
  const inp = h('input', { type: 'search', placeholder: L('예: 베트남 화장품 규제, 수출바우처, 인코텀즈', 'e.g. Vietnam cosmetics regulation, export voucher, Incoterms'), 'aria-label': L('통합검색', 'Global search'), id: 'gsearch' });
  const go = () => { const v = inp.value.trim(); if (v) { pop.classList.remove('open'); navigate('/search?q=' + encodeURIComponent(v)); } };
  const ask = () => { const v = inp.value.trim(); pop.classList.remove('open'); navigate('/assistant' + (v ? '?q=' + encodeURIComponent(v) : '')); };
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); if (e.key === 'Escape') pop.classList.remove('open'); });
  const pop = h('div.search-pop', { id: 'search-pop' }, h('div.container', h('div.search-box', inp, h('button.btn.btn-primary', { onclick: go }, ic('search'), L('검색', 'Search')), h('button.btn.btn-outline', { onclick: ask }, ic('ai'), L('AI에게 물어보기', 'Ask AI'))), h('div.row', { style: 'margin-top:12px' }, h('span.small.muted', L('인기 검색어', 'Popular')), ...[['베트남 화장품', 'Vietnam cosmetics'], ['미국 MoCRA', 'US MoCRA'], ['수출바우처', 'Export voucher'], ['바이어 발굴', 'Buyer discovery'], ['인코텀즈', 'Incoterms']].map(([k, e]) => h('a.chip', { href: '#/search?q=' + encodeURIComponent(L(k, e)), onclick: () => pop.classList.remove('open') }, L(k, e))))));
  return pop;
}
function drawer() {
  const root = h('div');
  const close = () => { d.classList.remove('open'); scrim.remove(); };
  const scrim = h('div.scrim', { onclick: close });
  const d = h('aside.mobile-drawer', { id: 'drawer', 'aria-label': L('모바일 메뉴', 'Mobile menu') }, h('div.row.row-between', { style: 'margin-bottom:8px' }, logo(), h('button.icon-btn', { 'aria-label': L('닫기', 'Close'), onclick: close }, ic('close'))),
    h('div.seg', { style: 'margin:8px 0 12px' }, ['ko', 'en'].map((l) => h('button', { 'aria-pressed': String(store.locale === l), onclick: () => { setLocale(l); close(); } }, l === 'ko' ? '한국어' : 'English'))),
    GNB.map((m) => { const it = h('div.acc-item', h('button', { onclick: () => it.classList.toggle('open'), 'aria-expanded': 'false' }, L(m.ko, m.en), ic('caret')), h('div.acc-b', m.items.map((x) => h('a', { href: x.href, onclick: close }, L(x.ko, x.en))))); return it; }),
    h('div.acc-item.open', h('div.acc-b', { style: 'display:block' }, h('a', { href: '#/invest', onclick: close }, 'Invest KOREA'), h('a', { href: '#/services', onclick: close }, L('통합 서비스 허브', 'Service hub')), h('a', { href: '#/about', onclick: close }, L('공사안내', 'About KOTRA')), h('a', { href: '#/sitemap', onclick: close }, L('사이트맵', 'Sitemap')), isStaff() && h('a', { href: store.user.role === 'admin' ? '#/admin' : '#/staff/consult', onclick: close }, L('업무 콘솔', 'Console')))));
  root.openDrawer = () => { document.body.append(scrim); d.classList.add('open'); }; root.append(d); return root;
}


// ───────── 사용자 메뉴(헤더 우측): 계정 정보 · 바로가기 · 로그아웃 ─────────
const ROLE_LABEL = { customer: ['기업 회원', 'Company member'], buyer: ['해외 바이어', 'Overseas buyer'], consultant: ['상담전문위원', 'Consultant'], office: ['무역관 담당', 'KBC officer'], admin: ['플랫폼 관리자', 'Administrator'] };
function userMenu() {
  const u = store.user;
  if (!u) return h('a.btn.btn-outline.btn-sm.um-login', { href: '#/login' }, ic('user'), h('span', L('로그인', 'Log in')));
  const name = store.locale === 'en' && u.name_en ? u.name_en : u.name;
  const role = ROLE_LABEL[u.role] || [u.role, u.role];
  const close = () => { pop.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
  const item = (href, icon, label) => h('a', { role: 'menuitem', href, onclick: close }, ic(icon), h('span', label));
  const staffHome = u.role === 'admin' ? '#/admin' : '#/staff/consult';
  const pop = h('div', { class: 'um-pop', role: 'menu', hidden: true },
    h('div.um-head', h('span.um-av.lg', { 'aria-hidden': 'true' }, String(name || '?').slice(0, 1)), h('div', h('b', name), h('div.xs.muted', L(...role)))),
    h('div.um-list',
      item('#/mykotra', 'user', 'MyKOTRA'),
      item('#/mykotra/notifications', 'bell', L('알림', 'Notifications') + (store.unread > 0 ? ` (${store.unread})` : '')),
      isStaff() ? item(staffHome, 'gear', L('업무 콘솔', 'Work console')) : null,
      isStaff() ? item('#/axdev', 'layers', L('AX개발 센터', 'AX Dev centre')) : null),
    h('div.um-sep'),
    h('button', { type: 'button', role: 'menuitem', class: 'um-out', onclick: act(async () => { await POST('/api/auth/logout'); store.user = null; store.company = null; mountShell(); navigate('/'); toast(L('로그아웃되었습니다.', 'Logged out.'), 'ok'); }) }, ic('arrow'), h('span', L('로그아웃', 'Log out'))));
  const btn = h('button', { type: 'button', class: 'um-btn', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': L('내 계정', 'My account'), onclick: (e) => { e.stopPropagation(); const o = pop.hidden; closeMega(); pop.hidden = !o; btn.setAttribute('aria-expanded', String(o)); if (o) { const f = pop.querySelector('a,button'); f && f.focus(); } } },
    h('span.um-av', { 'aria-hidden': 'true' }, String(name || '?').slice(0, 1)), h('span.um-n', name), ic('caret'));
  pop.addEventListener('keydown', (e) => { if (e.key === 'Escape') { close(); btn.focus(); } });
  return h('div.um', btn, pop);
}

export function mountShell() {
  const sk = $('#skip'); if (sk) sk.textContent = L('본문 바로가기', 'Skip to main content');
  const dbar = $('#demo-bar'), top = $('#topbar'), hdr = $('#site-header'), foot = $('#footer'), dock = $('#dock'), tab = $('#tabbar');
  [dbar, top, hdr, foot, dock, tab].forEach(clear);
  // demo bar
  const cfg = store.config || {};
  if (cfg.demo_mode) {
    const showSwitch = !cfg.public_url || (store.user && store.user.role === 'admin');
    const dest = (p) => (p === 'admin' ? '/admin' : p === 'consultant' ? '/staff/consult' : p === 'office' ? '/staff/research' : '/mykotra');
    const current = () => ((cfg.personas || []).find((x) => store.user && x.email === store.user.email) || {}).key || '';
    const sel = h('select', { 'aria-label': L('시연 페르소나 전환', 'Switch demo persona'), onchange: async (e) => {
      const el = e.target; const p = el.value; if (!p) return; const revert = () => { el.value = current(); };
      let code = ''; try { code = sessionStorage.getItem('kt.demo') || ''; } catch { /* storage may be blocked */ }
      if (cfg.demo_code_required && !code) { code = await askDemoCode(); if (!code) { revert(); return; } }
      el.disabled = true;
      try {
        await POST('/api/auth/demo-login', { persona: p, code });
        try { if (code) sessionStorage.setItem('kt.demo', code); } catch { /* ignore */ }
        await refreshMe(); mountShell(); navigate(dest(p));
      } catch (err) {
        if (err.code === 'DEMO_CODE_REQUIRED') { try { sessionStorage.removeItem('kt.demo'); } catch { /* ignore */ } toast(L('접근 코드가 올바르지 않습니다. 다시 선택해 코드를 입력하세요.', 'Incorrect access code — select again and re-enter it.'), 'err', 6000); }
        else toast(errMsg(err), 'err', 7000);
        revert();
      } finally { el.disabled = false; }
    } }, h('option', { value: '' }, L('페르소나 전환…', 'Switch persona…')), (cfg.personas || []).map((p) => h('option', { value: p.key, selected: store.user && store.user.email === p.email }, L(p.ko, p.en))));
    dbar.append(h('div.container', h('b', L('MVP 시연 환경', 'MVP demo environment')), h('span', L('· 기업·바이어는 합성 데이터이며 일부 외부 연계는 Mock으로 표시됩니다 · AI: ', '· Companies and buyers are synthetic; some integrations are labelled Mock · AI: ')), h('span.badge.b-info', cfg.llm && cfg.llm.provenance === 'LIVE' ? 'LIVE' : 'LOCAL'), h('span', { style: 'margin-left:auto' }), showSwitch ? sel : null));
  }
  // utility bar
  const lang = h('div.seg', { role: 'group', 'aria-label': L('언어', 'Language') }, ['ko', 'en'].map((l) => h('button', { 'aria-pressed': String(store.locale === l), lang: l, onclick: () => setLocale(l) }, l === 'ko' ? '한국어' : 'EN')));
  const fs = h('span.fs-ctl', { role: 'group', 'aria-label': L('글자 크기', 'Text size') }, h('button', { 'aria-label': L('글자 작게', 'Smaller text'), onclick: () => stepFs(-1) }, 'A-'), ' ', h('button', { 'aria-label': L('글자 크게', 'Larger text'), onclick: () => stepFs(1) }, 'A+'));
  const contrast = h('button.lnk', { 'aria-pressed': String(document.documentElement.dataset.theme === 'contrast'), onclick: (e) => { const on = document.documentElement.dataset.theme !== 'contrast'; document.documentElement.dataset.theme = on ? 'contrast' : ''; try { localStorage.setItem('kt.contrast', on ? '1' : ''); } catch { /* ignore */ } e.currentTarget.setAttribute('aria-pressed', String(on)); } }, L('고대비', 'High contrast'));
  const fam = h('select', { 'aria-label': L('패밀리 사이트', 'Family sites'), style: 'width:auto;min-height:30px;padding:2px 8px;font-size:12px;border-radius:6px', onchange: (e) => { if (e.target.value) navigate(e.target.value.slice(1)); e.target.value = ''; } }, h('option', { value: '' }, L('패밀리 사이트', 'Family sites')), FAMILY.map((f) => h('option', { value: f[2] }, L(f[0], f[1]))));
  top.append(h('div.container', h('nav', { 'aria-label': L('보조 메뉴', 'Utility navigation') }, h('a', { href: '#/invest' }, 'Invest KOREA'), h('a', { href: '#/services' }, L('통합 서비스', 'Service hub')), h('a', { href: '#/about' }, L('공사안내', 'About KOTRA')), h('a', { href: '#/sitemap' }, L('사이트맵', 'Sitemap')), fam),
    h('div.tools', fs, contrast, lang)));
  // header
  const sp = searchPop(); const dr = drawer();
  hdr.append(h('div.container', logo(), gnb(), h('div.hdr-tools', h('button.icon-btn', { 'aria-label': L('통합검색', 'Search'), 'aria-controls': 'search-pop', onclick: () => { sp.classList.toggle('open'); if (sp.classList.contains('open')) $('input', sp).focus(); } }, ic('search')),
    h('a.btn.btn-primary.btn-sm.hide-m', { href: '#/assistant', 'aria-label': L('AI 수출비서', 'AI Assistant'), title: L('AI 수출비서', 'AI Assistant') }, ic('ai'), h('span.bl', L('AI 수출비서', 'AI Assistant'))),
    store.user && h('a.icon-btn', { href: '#/mykotra/notifications', 'aria-label': L('알림', 'Notifications') }, ic('bell'), store.unread > 0 && h('span.dot', store.unread)),
    userMenu(),
    h('button.icon-btn.menu-btn', { 'aria-label': L('메뉴 열기', 'Open menu'), 'aria-controls': 'drawer', onclick: () => dr.openDrawer() }, ic('menu')))), sp, dr);
  // footer
  foot.append(h('div.footer', h('div.container', h('div.fgrid', h('div', h('h4', 'KOTRA ' + L('대한무역투자진흥공사', 'Korea Trade-Investment Promotion Agency')), h('p', L('서울특별시 서초구 헌릉로 13', '13 Heolleung-ro, Seocho-gu, Seoul')), h('p.small', L('본 사이트는 지능형 무역투자 플랫폼 MVP 시연 환경입니다. 기업·바이어 데이터는 합성 데이터이며 일부 외부 연계는 Mock입니다.', 'This is the MVP demo of the intelligent trade & investment platform. Company and buyer data are synthetic and some integrations are mocked.'))),
    h('div', h('h4', L('서비스', 'Services')), h('ul', [['해외시장', 'Markets', '#/markets'], ['바이어·파트너', 'Buyers', '#/buyers'], ['지원사업', 'Programs', '#/programs'], ['AI 수출비서', 'AI Assistant', '#/assistant'], ['Invest KOREA', 'Invest KOREA', '#/invest']].map((x) => h('li', h('a', { href: x[2] }, L(x[0], x[1])))))),
    h('div', h('h4', L('고객지원', 'Support')), h('ul', [['상담 채널', 'Consulting channels', '#/consult'], ['FAQ', 'FAQ', '#/consult/faq'], ['애로 접수', 'Report a difficulty', '#/consult/new?channel=GRIEVANCE'], ['공지사항', 'Notices', '#/about'], ['사이트맵', 'Sitemap', '#/sitemap']].map((x) => h('li', h('a', { href: x[2] }, L(x[0], x[1])))))),
    h('div', h('h4', L('정책·접근성', 'Policy & accessibility')), h('ul', [['접근성 안내', 'Accessibility', '#/accessibility'], ['To-Be 아키텍처', 'To-Be architecture', '#/architecture'], ['AX Playground', 'AX Playground', '#/playground'], ['공식 사이트(kotra.or.kr)', 'Official site (kotra.or.kr)', 'https://www.kotra.or.kr/index.do']].map((x) => h('li', h('a', { href: x[2], target: x[2].startsWith('http') ? '_blank' : null, rel: x[2].startsWith('http') ? 'noopener noreferrer' : null }, L(x[0], x[1])))))),
  ), h('div.copy', h('span', '© KOTRA — ' + L('MVP 시연 환경 (실제 서비스 아님)', 'MVP demo environment (not a live service)')), h('span', L('웹 접근성·반응형·한/영 지원', 'Accessible · responsive · KO/EN'))))));
  // quick dock (desktop) & tab bar (mobile)
  const { path } = parseHash();
  dock.append(h('nav.quick-dock', { 'aria-label': L('퀵 메뉴', 'Quick menu') }, h('a.ai', { href: '#/assistant' }, ic('ai'), L('AI 수출비서', 'AI')), h('a', { href: '#/consult/new' }, ic('phone'), L('상담신청', 'Consult')), h('a', { href: '#/programs' }, ic('briefcase'), L('지원사업', 'Programs')), h('a', { href: '#/buyers' }, ic('handshake'), L('바이어', 'Buyers')), h('button', { onclick: () => window.scrollTo({ top: 0, behavior: 'smooth' }), 'aria-label': L('맨 위로', 'Back to top') }, ic('arrow', { style: 'transform:rotate(-90deg);display:inline-flex;width:1.2em;height:1.2em' }), L('위로', 'Top'))));
  tab.append(...[['/', 'home', L('홈', 'Home')], ['/programs', 'briefcase', L('지원사업', 'Programs')], ['/assistant', 'ai', 'AI'], ['/buyers', 'handshake', L('바이어', 'Buyers')], [store.user ? '/mykotra' : '/login', 'user', 'MyKOTRA']].map(([p, i, t]) => h('a', { href: '#' + p, class: (p === '/' ? path === '/' : path.startsWith(p)) ? 'active' : (i === 'ai' ? 'ai-tab' : '') }, i === 'ai' ? h('span.pill-i', ic(i)) : ic(i), t)));
  tab.setAttribute('aria-label', L('하단 메뉴', 'Bottom navigation'));
  mountAxDock();
}
export function updateActive() {
  const { path } = parseHash();
  $$('.gnb-item').forEach((el, i) => el.classList.toggle('active', path.startsWith(GNB[i].base)));
  $$('#tabbar a').forEach((a) => { const p = a.getAttribute('href').slice(1); a.classList.toggle('active', p === '/' ? path === '/' : path.startsWith(p)); });
  const hdr = $('#site-header'); if (hdr) hdr.classList.toggle('scrolled', window.scrollY > 4);
}
export function setMode(mode) { document.body.dataset.mode = mode; $('#footer').classList.toggle('hide', mode !== 'site'); $('#dock').classList.toggle('hide', mode !== 'site'); }
const FS = ['sm', '', 'lg', 'xl'];
function stepFs(d) { const cur = FS.indexOf(document.documentElement.dataset.fs || ''); const n = Math.max(0, Math.min(FS.length - 1, cur + d)); document.documentElement.dataset.fs = FS[n]; try { localStorage.setItem('kt.fs', FS[n]); } catch { /* ignore */ } }
document.addEventListener('click', (e) => { if (!e.target.closest('.gnb-item')) closeMega(); if (!e.target.closest('.search-pop') && !e.target.closest('[aria-controls="search-pop"]')) { const sp = $('#search-pop'); sp && sp.classList.remove('open'); } });
window.addEventListener('scroll', () => { const hdr = $('#site-header'); hdr && hdr.classList.toggle('scrolled', window.scrollY > 4); }, { passive: true });

document.addEventListener('click', (e) => { if (!e.target.closest('.um')) $$('.um-pop').forEach((p) => { p.hidden = true; const b = p.parentNode.querySelector('.um-btn'); b && b.setAttribute('aria-expanded', 'false'); }); });
