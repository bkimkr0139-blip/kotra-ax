import { store, h, $, clear, L, GET, route, resolve, parseHash, navigate, pageSkeleton, errorBox, permDenied, errMsg, toast, setLocale } from './lib.js';
import { mountShell, refreshMe, updateActive, setMode } from './shell.js';

// ---- user preferences (font size, contrast) ----
try { const fs = localStorage.getItem('kt.fs'); if (fs) document.documentElement.dataset.fs = fs; if (localStorage.getItem('kt.contrast')) document.documentElement.dataset.theme = 'contrast'; } catch { /* storage may be blocked */ }

const lazy = (file, fn) => async (ctx) => { const m = await import(`./pages/${file}.js`); return m[fn](ctx); };
const STAFF = ['consultant', 'office', 'admin'], ADMIN = ['admin'], MEMBER = ['customer', 'buyer', 'consultant', 'office', 'admin'], CUST = ['customer', 'admin'];
// [pattern, loader, options{roles, mode, title}]
const R = (p, l, o = {}) => route(p, l, o);
R('/', lazy('home', 'home'), { title: ['홈', 'Home'] });
R('/login', lazy('misc', 'login'), { title: ['로그인', 'Log in'] });
R('/search', lazy('misc', 'search'), { title: ['통합검색', 'Search'] });
R('/about', lazy('misc', 'about'), { title: ['공사안내', 'About KOTRA'] });
R('/sitemap', lazy('misc', 'sitemap'), { title: ['사이트맵', 'Sitemap'] });
R('/services', lazy('misc', 'services'), { title: ['통합 서비스', 'Service hub'] });
R('/accessibility', lazy('misc', 'accessibility'), { title: ['접근성 안내', 'Accessibility'] });
R('/architecture', lazy('misc', 'architecture'), { title: ['To-Be 아키텍처', 'To-Be architecture'] });
R('/playground', lazy('misc', 'playground'), { title: ['AX Playground', 'AX Playground'], roles: STAFF });
R('/markets', lazy('markets', 'hub'), { title: ['해외시장', 'Overseas markets'] });
R('/markets/countries', lazy('markets', 'countries'), { title: ['국가/지역', 'Countries'] });
R('/markets/country/:code', lazy('markets', 'country'), { title: ['국가 정보', 'Country'] });
R('/markets/content', lazy('markets', 'contentList'), { title: ['시장 콘텐츠', 'Market content'] });
R('/markets/content/:id', lazy('markets', 'contentDetail'), { title: ['시장 콘텐츠', 'Market content'] });
R('/markets/regulations', lazy('markets', 'regList'), { title: ['규제·인증', 'Regulation'] });
R('/markets/regulations/:id', lazy('markets', 'regDetail'), { title: ['규제·인증', 'Regulation'] });
R('/markets/stats', lazy('markets', 'stats'), { title: ['무역통계', 'Trade statistics'] });
R('/library', lazy('markets', 'library'), { title: ['무역자료실', 'Trade library'] });
R('/library/:id', lazy('markets', 'libraryDoc'), { title: ['무역자료', 'Library'] });
R('/buyers', lazy('buyers', 'list'), { title: ['바이어 찾기', 'Find buyers'], roles: MEMBER });
R('/buyers/recommend', lazy('buyers', 'recommend'), { title: ['AI 바이어 추천', 'AI buyer recommendation'], roles: CUST });
R('/buyers/favorites', lazy('buyers', 'favorites'), { title: ['관심 바이어', 'Saved buyers'], roles: CUST });
R('/buyers/:id', lazy('buyers', 'detail'), { title: ['바이어 상세', 'Buyer'], roles: MEMBER });
R('/programs', lazy('programs', 'list'), { title: ['지원사업', 'Support programs'] });
R('/programs/recommend', lazy('programs', 'recommend'), { title: ['맞춤 사업 추천', 'Tailored programs'], roles: CUST });
R('/programs/:id', lazy('programs', 'detail'), { title: ['사업 상세', 'Program'] });
R('/events', lazy('events', 'list'), { title: ['전시회·상담회', 'Events'] });
R('/events/:id', lazy('events', 'detail'), { title: ['행사 상세', 'Event'] });
R('/consult', lazy('consult', 'channels'), { title: ['상담·애로', 'Consulting'] });
R('/consult/new', lazy('consult', 'newConsult'), { title: ['전문가 상담 신청', 'Expert consulting'], roles: MEMBER });
R('/consult/faq', lazy('consult', 'faq'), { title: ['FAQ', 'FAQ'] });
R('/assistant', lazy('assistant', 'assistant'), { title: ['AI 수출비서', 'AI Export Assistant'], mode: 'asst' });
R('/invest', lazy('invest', 'invest'), { title: ['Invest KOREA', 'Invest KOREA'] });
for (const [p, fn, t] of [['/mykotra', 'cockpit', ['MyKOTRA', 'MyKOTRA']], ['/mykotra/profile', 'profile', ['기업 프로필', 'Company profile']], ['/mykotra/project', 'project', ['수출 목표', 'Export goal']], ['/mykotra/applications', 'applications', ['신청 사업', 'My applications']], ['/mykotra/applications/:id', 'application', ['신청서', 'Application']], ['/mykotra/matching', 'matching', ['상담/매칭', 'Matching']], ['/mykotra/consults', 'consults', ['상담이력', 'Consultations']], ['/mykotra/consults/:id', 'consultDetail', ['상담 상세', 'Consultation']], ['/mykotra/saved', 'saved', ['저장 콘텐츠', 'Saved']], ['/mykotra/documents', 'documents', ['생성 문서', 'Documents']], ['/mykotra/documents/:id', 'documentView', ['문서', 'Document']], ['/mykotra/notifications', 'notifications', ['알림', 'Notifications']], ['/mykotra/approvals', 'approvals', ['승인(HITL)', 'Approvals']]]) R(p, lazy('mykotra', fn), { title: t, roles: MEMBER });
R('/axdev', lazy('axdev', 'axdev'), { title: ['AX개발 센터', 'AX Dev centre'], roles: MEMBER });
R('/axos', lazy('axos', 'axos'), { title: ['AXOS 폐루프 콘솔', 'AXOS closed-loop console'], roles: ['admin', 'consultant'], mode: 'console' });
R('/admin/data-integration', lazy('di', 'di'), { title: ['데이터 통합·MDM', 'Data integration · MDM'], roles: STAFF, mode: 'console' });
R('/admin/data-integration/:tab', lazy('di', 'di'), { title: ['데이터 통합·MDM', 'Data integration · MDM'], roles: STAFF, mode: 'console' });
R('/staff/consult', lazy('staff', 'consult'), { title: ['상담 Single View', 'Consultation Single View'], roles: STAFF, mode: 'console' });
R('/staff/stt', lazy('staff', 'stt'), { title: ['STT·상담일지', 'STT & journal'], roles: STAFF, mode: 'console' });
R('/staff/research', lazy('staff', 'research'), { title: ['지시조사', 'Research workflow'], roles: STAFF, mode: 'console' });
R('/staff/news', lazy('staff', 'news'), { title: ['해외시장뉴스 AI', 'Market-news AI'], roles: STAFF, mode: 'console' });
for (const [p, fn, t, r] of [['/admin', 'dashboard', ['Dashboard', 'Dashboard'], STAFF], ['/admin/approvals', 'approvals', ['승인 큐', 'Approvals'], STAFF], ['/admin/companies', 'companies', ['고객/기업', 'Companies'], STAFF], ['/admin/programs', 'programs', ['지원사업 관리', 'Programs'], ['admin', 'consultant']], ['/admin/content', 'content', ['콘텐츠/CMS', 'Content'], STAFF], ['/admin/matching', 'matching', ['상담매칭 관리', 'Matching admin'], STAFF], ['/admin/ai', 'ai', ['AI Operations', 'AI Operations'], STAFF], ['/admin/rag', 'rag', ['RAG Manager', 'RAG Manager'], STAFF], ['/admin/data', 'data', ['데이터 카탈로그', 'Data catalog'], STAFF], ['/admin/mdm', 'mdm', ['고객 MDM', 'Customer MDM'], STAFF], ['/admin/users', 'users', ['사용자/권한', 'Users'], STAFF], ['/admin/audit', 'audit', ['감사로그', 'Audit log'], ADMIN], ['/admin/system', 'system', ['모니터링', 'Monitoring'], STAFF], ['/admin/rfp', 'rfp', ['RFP Coverage', 'RFP Coverage'], STAFF], ['/admin/demo', 'demo', ['Demo Director', 'Demo Director'], ADMIN]]) R(p, lazy('admin', fn), { title: t, roles: r, mode: 'console' });

let seq = 0;
async function render() {
  const my = ++seq; const main = $('#main'); const hit = resolve();
  if (!hit) { clear(main).append(h('div.container.section', h('div.card', h('div.card-b.center', h('h1', '404'), h('p', L('요청하신 페이지를 찾을 수 없습니다.', 'Page not found.')), h('a.btn.btn-primary', { href: '#/' }, L('홈으로', 'Home')))))); return; }
  const { r, params, query, path } = hit; const mode = r.opts.mode || 'site'; setMode(mode);
  if (r.opts.roles && path !== '/login') {
    if (!store.user) { navigate('/login?next=' + encodeURIComponent(location.hash.slice(1))); return; }
    if (!r.opts.roles.includes(store.user.role)) { clear(main).append(permDenied()); return; }
  }
  if (r.opts.title) document.title = `${L(...r.opts.title)} · KOTRA ${L('무역투자24', 'Trade-Investment 24')}`;
  clear(main).append(pageSkeleton());
  try {
    const node = await r.loader({ params, query, path, user: store.user, rerender: render });
    if (my !== seq) return;
    clear(main).append(node);
    if (mode !== 'asst') { const t = $('#page-title') || main; try { t.focus({ preventScroll: true }); } catch { /* ignore */ } window.scrollTo(0, 0); }
  } catch (e) {
    if (my !== seq) return;
    if (e.code === 'AUTH_REQUIRED') { navigate('/login?next=' + encodeURIComponent(location.hash.slice(1))); return; }
    if (e.status === 403) { clear(main).append(permDenied()); return; }
    clear(main).append(errorBox(e, render));
  }
  updateActive();
}

window.addEventListener('hashchange', () => { render(); updateActive(); });
window.addEventListener('locale', () => { mountShell(); render(); });
window.addEventListener('unhandledrejection', (e) => { if (e.reason && e.reason.code === 'AUTH_REQUIRED') return; console.warn('[unhandled]', e.reason); });
(async () => {
  document.documentElement.lang = store.locale;
  try { store.config = await GET('/api/config', { quiet: true }); } catch { store.config = {}; }
  await refreshMe(); mountShell(); await render();
  window.__kotra = { store, render, navigate }; // test hook
})();
