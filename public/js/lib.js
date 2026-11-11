// Core UI library: DOM builder, i18n, API client, components, charts, router. No framework, no innerHTML for user data (XSS-safe).
export const store = { user: null, company: null, buyer: null, locale: 'ko', config: null, unread: 0, pendingApprovals: 0, perms: {} };
try { store.locale = localStorage.getItem('kt.lang') || ((navigator.language || 'ko').startsWith('ko') ? 'ko' : 'en'); } catch { /* storage unavailable */ }

// ---------- i18n ----------
export const L = (ko, en) => (store.locale === 'en' ? (en ?? ko) : ko);
export const lf = (o, k) => (o ? (store.locale === 'en' ? (o[k + '_en'] || o[k + '_ko'] || o[k]) : (o[k + '_ko'] || o[k])) : '');
export const nameOf = (o) => (!o ? '' : store.locale === 'en' ? (o.name_en || o.en || o.name || o.ko) : (o.name || o.ko || o.name_ko || o.name_en));
export function setLocale(l) { store.locale = l; try { localStorage.setItem('kt.lang', l); } catch { /* ignore */ } document.documentElement.lang = l; window.dispatchEvent(new Event('locale')); }

// ---------- DOM ----------
const SVGNS = 'http://www.w3.org/2000/svg';
export function h(tag, props, ...kids) {
  if (props && (props.nodeType || typeof props === 'string' || Array.isArray(props) || typeof props === 'number')) { kids.unshift(props); props = null; }
  const m = /^([a-zA-Z0-9]*)((?:[.#][\w-]+)*)$/.exec(tag) || [null, 'div', ''];
  const el = document.createElement(m[1] || 'div');
  (m[2].match(/[.#][\w-]+/g) || []).forEach((t) => { if (t[0] === '.') el.classList.add(t.slice(1)); else el.id = t.slice(1); });
  if (props) for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class' || k === 'className') v.split(' ').filter(Boolean).forEach((c) => el.classList.add(c));
    else if (k === 'style') { if (typeof v === 'string') el.style.cssText = v; else Object.assign(el.style, v); }
    else if (k === 'html') el.innerHTML = v; // static SVG/markup only
    else if (k === 'value') el.value = v;
    else if (k === 'checked' || k === 'selected' || k === 'disabled') el[k] = !!v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  const add = (c) => { if (c == null || c === false) return; if (Array.isArray(c)) c.forEach(add); else el.append(c.nodeType ? c : document.createTextNode(String(c))); };
  kids.forEach(add);
  return el;
}
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };

// ---------- icons (24px stroke) ----------
const P = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>', menu: '<path d="M3 6h18M3 12h18M3 18h18"/>', close: '<path d="M6 6l12 12M18 6 6 18"/>', globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>', users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17" cy="9" r="2.5"/><path d="M17 14.5a5 5 0 0 1 4.5 5"/>', bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 21h4"/>',
  ai: '<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M19 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>', building: '<path d="M4 21V5l8-2v18M12 8l8 2v11M3 21h18M8 8h.01M8 12h.01M8 16h.01M16 14h.01M16 18h.01"/>',
  chart: '<path d="M4 20V4M4 20h16"/><path d="M8 16v-4M12 16V8M16 16v-6"/>', file: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h6"/>', shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="m9 12 2 2 4-4"/>',
  check: '<path d="m5 12 5 5 9-10"/>', alert: '<path d="M12 4 3 20h18z"/><path d="M12 10v5M12 18h.01"/>', info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>', arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>', calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>', phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>', pin: '<path d="M12 21s7-6.5 7-12a7 7 0 0 0-14 0c0 5.500 7 12 7 12z"/><circle cx="12" cy="9" r="2.5"/>',
  star: '<path d="m12 3 2.7 5.8 6.3.8-4.6 4.4 1.2 6.3L12 17.300 6.400 20.300l1.200-6.300L3 9.600l6.300-.8z"/>', heart: '<path d="M12 20s-8-5-8-11a4.500 4.500 0 0 1 8-2.800A4.500 4.500 0 0 1 20 9c0 6-8 11-8 11z"/>', upload: '<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>', download: '<path d="M12 4v12M7 11l5 5 5-5M4 20h16"/>',
  send: '<path d="M4 12 20 4l-4 16-4-6z"/><path d="m12 14 8-10"/>', plus: '<path d="M12 5v14M5 12h14"/>', trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>', edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13 7 4 4"/>', lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5M3 17l9 5 9-5"/>', db: '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.700 3.600 3 8 3s8-1.300 8-3V6M4 12v6c0 1.700 3.600 3 8 3s8-1.300 8-3v-6"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.200 4.200l2.100 2.100M17.700 17.700l2.100 2.100M2 12h3M19 12h3M4.200 19.800l2.100-2.100M17.700 6.300l2.100-2.100"/>', compass: '<circle cx="12" cy="12" r="9"/><path d="m15.500 8.500-2 5-5 2 2-5z"/>',
  handshake: '<path d="m3 12 4-4 4 2 4-3 6 5-5 6-3-1-2 2-3-2-3 1z"/>', briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V4h6v3M3 13h18"/>', book: '<path d="M4 4h7a3 3 0 0 1 3 3v13a3 3 0 0 0-3-3H4zM20 4h-7"/><path d="M20 4v13h-6"/>',
  flag: '<path d="M5 21V4M5 5h12l-2 4 2 4H5"/>', play: '<path d="M7 4v16l13-8z"/>', refresh: '<path d="M20 11a8 8 0 1 0-2.300 5.700M20 4v7h-7"/>', filter: '<path d="M3 5h18l-7 8v6l-4-2v-4z"/>', ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6"/>',
  home: '<path d="M3 11 12 3l9 8M5 10v10h14V10"/>', trend: '<path d="m3 17 6-6 4 4 8-9M15 6h6v6"/>', award: '<circle cx="12" cy="9" r="6"/><path d="m8.500 14-1.500 7 5-3 5 3-1.500-7"/>', mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  clip: '<path d="m20 11-8.500 8.500a5 5 0 0 1-7-7L13 4a3.500 3.500 0 0 1 5 5l-8.500 8.500a2 2 0 0 1-3-3L14 7"/>', copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>', thumb: '<path d="M7 11v9H4v-9zM7 11l4-7c2 0 3 1.500 2.500 3.500L13 10h6a2 2 0 0 1 2 2.300l-1 6A2 2 0 0 1 18 20H7"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/>', list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>', eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  caret: '<path d="m6 9 6 6 6-6"/>', pause: '<path d="M8 5v14M16 5v14"/>', route: '<circle cx="6" cy="18" r="2.500"/><circle cx="18" cy="6" r="2.500"/><path d="M8.500 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.500"/>', box: '<path d="m12 3 9 4.500v9L12 21l-9-4.500v-9z"/><path d="m3 7.500 9 4.500 9-4.500M12 12v9"/>',
};
export const icon = (name, cls = '') => h('span', { class: 'ico-s ' + cls, 'aria-hidden': 'true', style: 'display:inline-flex', html: `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:1.15em;height:1.15em">${P[name] || P.info}</svg>` });
export const svgIcon = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || P.info}</svg>`;
export const ic = (name, props = {}) => h('span', { ...props, 'aria-hidden': 'true', style: 'display:inline-flex;width:1.2em;height:1.2em', html: svgIcon(name) });

// ---------- format ----------
export const fmtDate = (s) => (s ? String(s).slice(0, 10).replace(/-/g, '.') : '-');
export const fmtDT = (s) => (s ? String(s).slice(0, 16).replace('T', ' ').replace(/-/g, '.') : '-');
export const fmtNum = (n) => (n == null ? '-' : Number(n).toLocaleString(store.locale === 'en' ? 'en-US' : 'ko-KR'));
export const esc = (s) => String(s ?? '');
export const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

// ---------- status labels ----------
const ST = {
  OPEN: ['모집중', 'Open', 'b-ok'], UPCOMING: ['모집예정', 'Upcoming', 'b-info'], CLOSED: ['마감', 'Closed', 'badge'],
  DRAFT: ['작성중', 'Draft', 'badge'], READY_FOR_REVIEW: ['검토 대기', 'Ready for review', 'b-info'], APPROVAL_REQUIRED: ['승인 필요', 'Approval required', 'b-warn'], SUBMITTED_DEMO: ['제출됨(시연)', 'Submitted (demo)', 'b-ok'], COMPLETED: ['완료', 'Completed', 'b-ok'],
  AI_CLASSIFIED: ['AI 분류', 'AI classified', 'b-info'], ASSIGNED: ['배정', 'Assigned', 'b-info'], IN_PROGRESS: ['진행중', 'In progress', 'b-info'], RESOLVED: ['답변완료', 'Resolved', 'b-ok'],
  REQUESTED: ['신청됨', 'Requested', 'b-warn'], ACCEPTED: ['수락', 'Accepted', 'b-ok'], REJECTED: ['반려', 'Declined', 'b-danger'], SCHEDULED: ['일정확정', 'Scheduled', 'b-primary'], FOLLOW_UP: ['후속지원', 'Follow-up', 'b-ok'],
  APPROVAL_REQUESTED: ['승인요청', 'Approval requested', 'b-warn'], SUBMITTED: ['제출', 'Submitted', 'b-info'], REVISION_REQUESTED: ['보완요청', 'Revision requested', 'b-warn'], EVALUATED: ['평가완료', 'Evaluated', 'b-ok'],
  PENDING: ['대기', 'Pending', 'b-warn'], APPROVED: ['승인', 'Approved', 'b-ok'], CANCELLED: ['취소', 'Cancelled', 'badge'], REVIEW: ['검토중', 'In review', 'b-info'], PUBLISHED: ['게시됨', 'Published', 'b-ok'],
  NOT_STARTED: ['미시작', 'Not started', 'badge'], DONE: ['완료', 'Done', 'b-ok'], WARNING: ['주의', 'Attention', 'b-warn'], ACTIVE: ['활성', 'Active', 'b-ok'], QUARANTINED: ['격리', 'Quarantined', 'b-danger'], ARCHIVED: ['보관', 'Archived', 'badge'],
  Success: ['성공', 'Success', 'b-ok'], Warning: ['경고', 'Warning', 'b-warn'], Failed: ['실패', 'Failed', 'b-danger'], Running: ['실행중', 'Running', 'b-info'], Mock: ['Mock', 'Mock', 'b-mock'], Skipped: ['건너뜀', 'Skipped', 'badge'], NA: ['해당없음', 'N/A', 'badge'],
  OK: ['정상', 'OK', 'b-ok'], ABSTAINED: ['답변 유보', 'Abstained', 'b-warn'], BLOCKED: ['차단', 'Blocked', 'b-danger'], ERROR: ['오류', 'Error', 'b-danger'],
  LOW: ['낮음', 'Low', 'b-ok'], MEDIUM: ['보통', 'Medium', 'b-warn'], HIGH: ['높음', 'High', 'b-danger'],
  LIVE: ['LIVE', 'LIVE', 'b-ok'], CACHED: ['CACHED', 'CACHED', 'b-info'], MOCK: ['MOCK', 'MOCK', 'b-mock'], SYNTHETIC: ['시연용 합성 데이터', 'Synthetic demo data', 'b-synth'], LOCAL: ['LOCAL', 'LOCAL', 'b-info'], MOCK_EXTERNAL: ['Mock API', 'Mock API', 'b-mock'], INTERNAL: ['내부', 'Internal', 'badge'],
  IMPLEMENTED: ['구현', 'Implemented', 'b-ok'], PARTIAL: ['부분 구현', 'Partial', 'b-info'], DESIGN_ONLY: ['설계만', 'Design only', 'badge'], OUT_OF_MVP: ['본사업 범위', 'Full program', 'badge'], READY: ['시연 가능', 'Demo-ready', 'b-ok'],
  NOT_CONFIGURED: ['미설정', 'Not configured', 'badge'], CONSENTED: ['동의', 'Consented', 'b-ok'], MERGED: ['병합', 'Merged', 'b-ok'], KEPT_SEPARATE: ['별도 유지', 'Kept separate', 'badge'], ON_HOLD: ['보류', 'On hold', 'b-warn'],
  CONFIRMED: ['확정', 'Confirmed', 'b-ok'], EDITED: ['수정됨', 'Edited', 'b-info'], SENT: ['이관됨', 'Sent', 'b-info'], RECRUITING: ['모집중', 'Recruiting', 'b-ok'], MOCK_SENT: ['Mock 발송', 'Mock sent', 'b-mock'], REVIEW_PENDING: ['검토 대기', 'Review pending', 'b-warn'],
  DELIVERED_MOCK: ['Mock 전달', 'Mock delivered', 'b-mock'], CUSTOMER: ['기업', 'Company', 'badge'],
};
export function statusBadge(code, extra = '') { const s = ST[code]; return h('span', { class: `badge ${s ? s[2] : ''} ${extra}` }, s ? L(s[0], s[1]) : String(code ?? '-')); }
export const statusText = (code) => (ST[code] ? L(ST[code][0], ST[code][1]) : String(code));
export const provBadge = (p) => (p ? h('span', { class: 'badge ' + ({ LIVE: 'b-ok', LOCAL: 'b-info', MOCK: 'b-mock', MOCK_EXTERNAL: 'b-mock', CACHED: 'b-info', SYNTHETIC: 'b-synth' }[p] || ''), title: L('데이터 출처 표시', 'Data provenance') }, p === 'MOCK_EXTERNAL' ? 'Mock API' : p === 'SYNTHETIC' ? L('시연용 합성', 'Synthetic') : p) : null);
export const synthBadge = () => h('span', { class: 'badge b-synth', title: L('실제 개인정보·비공개 데이터가 아닌 시연용 데이터입니다', 'Demo data — not real or private data') }, L('시연용 합성 데이터', 'Synthetic demo data'));
export function ddayBadge(d, status) {
  if (status === 'CLOSED') return h('span', { class: 'badge' }, L('마감', 'Closed'));
  if (d == null) return null;
  return h('span', { class: 'dday' + (d <= 7 ? ' urgent' : '') }, d < 0 ? L('마감', 'Closed') : d === 0 ? 'D-Day' : `D-${d}`);
}
export const RFP = (...ids) => h('span', { class: 'rfp-tags', title: L('제안요청서 요구사항 ID', 'RFP requirement IDs') }, ids.map((i) => h('span', { class: 'rfp-tag' }, i)));

// ---------- toast ----------
function toastRoot() { let r = $('#toasts'); if (!r) { r = h('div#toasts.toast-wrap', { 'aria-live': 'polite', role: 'status' }); document.body.append(r); } return r; }
export function toast(msg, kind = '', ms = 4200) { const t = h('div', { class: 'toast ' + kind }, msg); toastRoot().append(t); if (ms) setTimeout(() => t.remove(), ms); return t; }

// ---------- API ----------
export class ApiError extends Error { constructor(status, code, message, extra) { super(message); this.status = status; this.code = code; this.extra = extra; } }
let slowCount = 0, slowToast = null;
function slowStart() { slowCount++; return setTimeout(() => { if (!slowToast) slowToast = toast([h('span.spin'), h('span', L('처리에 3초 이상 걸릴 수 있습니다. 잠시만 기다려 주세요…', 'This may take more than 3 seconds. Please wait…'))], 'slow', 0); }, 1200); }
function slowEnd(t) { clearTimeout(t); slowCount = Math.max(0, slowCount - 1); if (!slowCount && slowToast) { slowToast.remove(); slowToast = null; } }
export async function api(method, url, body, opts = {}) {
  const t = opts.quiet ? null : slowStart();
  try {
    const res = await fetch(url, { method, headers: body !== undefined ? { 'content-type': 'application/json' } : undefined, body: body !== undefined ? JSON.stringify(body) : undefined, credentials: 'same-origin', signal: opts.signal });
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('json') ? await res.json() : await res.text();
    if (!res.ok) throw new ApiError(res.status, data?.error?.code || 'ERROR', data?.error?.message || res.statusText, data?.error?.extra);
    return data;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if (e.name === 'AbortError') throw e;
    throw new ApiError(0, 'NETWORK', L('서버에 연결할 수 없습니다. 네트워크를 확인하고 다시 시도해 주세요.', 'Cannot reach the server. Check your connection and retry.'));
  } finally { if (t) slowEnd(t); }
}
export const GET = (u, o) => api('GET', u, undefined, o); export const POST = (u, b = {}, o) => api('POST', u, b, o); export const PUT = (u, b = {}, o) => api('PUT', u, b, o); export const PATCH = (u, b = {}, o) => api('PATCH', u, b, o); export const DEL = (u, o) => api('DELETE', u, undefined, o);
export function errMsg(e) { if (!(e instanceof ApiError)) return String(e.message || e); if (e.code === 'AUTH_REQUIRED') return L('로그인이 필요합니다.', 'Login required.'); return e.message; }
// wrap a button handler: disables the button, toasts errors, optional success toast
export function act(fn, { ok, btn } = {}) {
  return async (ev) => {
    const b = btn || (ev && ev.currentTarget); if (b && b.disabled) return; if (b) b.disabled = true;
    try { const r = await fn(ev); if (ok) toast(typeof ok === 'function' ? ok(r) : ok, 'ok'); return r; }
    catch (e) { if (e.code === 'AUTH_REQUIRED') { navigate('/login?next=' + encodeURIComponent(location.hash.slice(1))); return; } toast(errMsg(e), 'err', 6000); }
    finally { if (b) b.disabled = false; }
  };
}

// ---------- components ----------
export const skeleton = (n = 3) => h('div.stack', Array.from({ length: n }, (_, i) => h('div.skeleton', { style: `height:${i === 0 ? 28 : 18}px;width:${i === 0 ? '40%' : 90 - i * 10 + '%'}` })));
export const pageSkeleton = () => h('div.container.section', { 'aria-busy': 'true', 'aria-label': L('불러오는 중', 'Loading') }, h('div.skeleton', { style: 'height:40px;width:35%;margin-bottom:20px' }), h('div.grid.g3', [1, 2, 3].map(() => h('div.skeleton', { style: 'height:150px' }))), h('div.skeleton', { style: 'height:240px;margin-top:20px' }));
export const empty = (msg, sub, action) => h('div.empty', ic('box', { style: 'font-size:56px;display:inline-flex' }), h('p.bold', msg || L('표시할 항목이 없습니다.', 'Nothing to show.')), sub && h('p.small', sub), action);
export const noResult = (onReset) => empty(L('검색 결과가 없습니다.', 'No results found.'), L('검색어나 필터를 바꿔 보세요.', 'Try different keywords or filters.'), onReset && h('button.btn.btn-outline', { onclick: onReset }, L('필터 초기화', 'Reset filters')));
export const errorBox = (e, retry) => h('div.container.section', h('div.alert.danger', ic('alert'), h('div', h('b', L('불러오지 못했습니다', 'Could not load')), h('div', errMsg(e)), retry && h('button.btn.btn-sm.btn-outline', { style: 'margin-top:8px', onclick: retry }, L('다시 시도', 'Retry')))));
export const permDenied = () => h('div.container.section', h('div.card', h('div.card-b.center', ic('lock', { style: 'font-size:48px;display:inline-flex;color:var(--c-ink-4)' }), h('h2', L('접근 권한이 없습니다', 'Access denied')), h('p.muted', L('이 화면은 해당 역할의 사용자만 이용할 수 있습니다. 시도는 감사 로그에 기록됩니다.', 'This screen is restricted to authorised roles. The attempt is recorded in the audit log.')), h('a.btn.btn-primary', { href: '#/' }, L('홈으로', 'Go home')))));
export const alertBox = (kind, ...children) => h('div', { class: 'alert ' + kind, role: kind === 'danger' ? 'alert' : 'note' }, ic(kind === 'danger' || kind === 'warn' ? 'alert' : kind === 'ok' ? 'check' : 'info'), h('div', children));
export function pageHead(title, desc, crumbs = [], right) {
  return h('div.page-h', h('div.container', crumbs.length > 0 && h('nav.crumbs', { 'aria-label': 'breadcrumb' }, h('a', { href: '#/' }, L('홈', 'Home')), crumbs.map((c) => (c.href ? h('span', h('a', { href: c.href }, c.label)) : h('span', c.label)))), h('div.row.row-between', h('div', h('h1', { tabindex: '-1', id: 'page-title' }, title), desc && h('p', desc)), right)));
}
export function tabs(items, active, onChange, label) {
  const wrap = h('div.tabs', { role: 'tablist', 'aria-label': label || '' });
  items.forEach((it) => { const b = h('button', { role: 'tab', 'aria-selected': it.id === active ? 'true' : 'false', tabindex: it.id === active ? '0' : '-1', onclick: () => onChange(it.id), onkeydown: (e) => { const i = items.findIndex((x) => x.id === it.id); if (e.key === 'ArrowRight') onChange(items[(i + 1) % items.length].id); if (e.key === 'ArrowLeft') onChange(items[(i - 1 + items.length) % items.length].id); } }, it.label, it.count != null && h('span.badge', { style: 'margin-left:6px' }, it.count)); wrap.append(b); });
  return wrap;
}
export function pager(page, pages, onPage) {
  if (pages <= 1) return null;
  const nums = []; for (let i = 1; i <= pages; i++) if (i === 1 || i === pages || Math.abs(i - page) <= 2) nums.push(i); else if (nums[nums.length - 1] !== '…') nums.push('…');
  return h('nav.pager', { 'aria-label': 'pagination' }, h('button', { disabled: page <= 1, onclick: () => onPage(page - 1), 'aria-label': L('이전', 'Previous') }, '‹'), nums.map((n) => (n === '…' ? h('span', '…') : h('button', { 'aria-current': n === page ? 'page' : null, onclick: () => onPage(n) }, n))), h('button', { disabled: page >= pages, onclick: () => onPage(page + 1), 'aria-label': L('다음', 'Next') }, '›'));
}
export function table(cols, rows, { caption, onRow, empty: emptyNode } = {}) {
  if (!rows || !rows.length) return emptyNode || empty();
  return h('div.table-wrap', h('table.tbl', caption && h('caption', caption), h('thead', h('tr', cols.map((c) => h('th', { scope: 'col', style: c.w ? `width:${c.w}` : null }, c.label)))), h('tbody', rows.map((r) => h('tr', { class: onRow ? 'click' : '', tabindex: onRow ? '0' : null, onclick: onRow ? () => onRow(r) : null, onkeydown: onRow ? (e) => { if (e.key === 'Enter') onRow(r); } : null }, cols.map((c) => h('td', { 'data-label': c.label }, c.render ? c.render(r) : esc(r[c.key]))))))));
}
export function field(label, input, { hint, err, req, id } = {}) { const fid = id || input.id || 'f' + Math.random().toString(36).slice(2, 8); if (!input.id) input.id = fid; return h('div', { class: 'field' + (err ? ' invalid' : '') }, h('label', { for: fid, class: req ? 'req' : '' }, label), input, hint && h('div.hint', hint), err && h('div.err', { role: 'alert' }, err)); }
export const input = (props = {}) => h('input', { type: 'text', ...props });
export function select(options, value, props = {}) { const s = h('select', props, options.map((o) => h('option', { value: o.value, selected: String(o.value) === String(value) }, o.label))); return s; }
export const kv = (pairs) => h('dl.kv', pairs.filter(Boolean).map(([k, v]) => [h('dt', k), h('dd', v ?? '-')]));
export function meter(pct, cls = '') { return h('div', { class: 'meter ' + cls, role: 'progressbar', 'aria-valuenow': String(Math.round(pct)), 'aria-valuemin': '0', 'aria-valuemax': '100' }, h('i', { style: `width:${clamp(pct, 0, 100)}%` })); }

// modal with focus trap
export function modal({ title, body, footer, size = '', onClose, dismissible = true }) {
  const prev = document.activeElement;
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey); if (prev && prev.focus) prev.focus(); onClose && onClose(); };
  const onKey = (e) => { if (e.key === 'Escape' && dismissible) close(); if (e.key === 'Tab') { const f = $$('a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])', box); if (!f.length) return; const first = f[0], last = f[f.length - 1]; if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); } } };
  const box = h('div', { class: 'modal ' + size, role: 'dialog', 'aria-modal': 'true', 'aria-label': typeof title === 'string' ? title : '' }, h('div.modal-h', h('h2', title), dismissible && h('button.icon-btn', { 'aria-label': L('닫기', 'Close'), onclick: close }, ic('close'))), h('div.modal-b', body), footer && h('div.modal-f', typeof footer === 'function' ? footer(close) : footer));
  const back = h('div.modal-back', { onmousedown: (e) => { if (e.target === back && dismissible) close(); } }, box);
  document.body.append(back); document.addEventListener('keydown', onKey);
  setTimeout(() => { const f = $('button.btn-primary,input,textarea,select,button', box); f && f.focus(); }, 30);
  return { close, box };
}
export function confirmDialog({ title, message, confirm = L('확인', 'Confirm'), cancel = L('취소', 'Cancel'), danger, extra }) {
  return new Promise((resolve) => { modal({ title, size: 'narrow', body: h('div.stack', typeof message === 'string' ? h('p', message) : message, extra), footer: (close) => [h('button.btn', { onclick: () => { close(); resolve(false); } }, cancel), h('button.btn ' + (danger ? 'btn-danger' : 'btn-primary'), { onclick: () => { close(); resolve(true); } }, confirm)], onClose: () => resolve(false) }); });
}

// ---------- charts (inline SVG) ----------
const PAL = ['#0b4ea2', '#0a9bd8', '#17794a', '#e49b0f', '#7a4fd1', '#c0172a', '#0b7285', '#5b6879'];
export const palette = PAL;
export function barChart(data, { w = 520, hgt = 220, color = PAL[0], fmt = fmtNum, label = '' } = {}) {
  const max = Math.max(1, ...data.map((d) => d.value)); const pad = { l: 40, r: 10, t: 14, b: 38 }; const bw = (w - pad.l - pad.r) / data.length;
  const svg = document.createElementNS(SVGNS, 'svg'); svg.setAttribute('viewBox', `0 0 ${w} ${hgt}`); svg.setAttribute('class', 'chart'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', label);
  const el = (n, a, t) => { const e = document.createElementNS(SVGNS, n); for (const k in a) e.setAttribute(k, a[k]); if (t != null) e.textContent = t; svg.append(e); return e; };
  [0, 0.5, 1].forEach((f) => { const y = pad.t + (hgt - pad.t - pad.b) * (1 - f); el('line', { x1: pad.l, x2: w - pad.r, y1: y, y2: y, stroke: '#e3e9f1' }); el('text', { x: pad.l - 6, y: y + 4, 'text-anchor': 'end' }, fmt(Math.round(max * f))); });
  data.forEach((d, i) => { const bh = (hgt - pad.t - pad.b) * (d.value / max); const x = pad.l + i * bw + bw * 0.18; el('rect', { x, y: hgt - pad.b - bh, width: bw * 0.64, height: Math.max(1, bh), rx: 3, fill: d.color || color }); el('text', { x: x + bw * 0.32, y: hgt - pad.b - bh - 4, 'text-anchor': 'middle', style: 'fill:var(--c-ink-2);font-weight:700' }, fmt(d.value)); const lab = String(d.label); el('text', { x: x + bw * 0.32, y: hgt - pad.b + 14, 'text-anchor': 'middle' }, lab.length > 8 ? lab.slice(0, 7) + '…' : lab); });
  return svg;
}
export function lineChart(points, { w = 520, hgt = 220, color = PAL[0], fmt = fmtNum, label = '' } = {}) {
  const pad = { l: 44, r: 14, t: 16, b: 30 }; const max = Math.max(1, ...points.map((p) => p.y)) * 1.1; const min = 0; const n = points.length;
  const X = (i) => pad.l + (n === 1 ? 0 : (i * (w - pad.l - pad.r)) / (n - 1)); const Y = (v) => pad.t + (hgt - pad.t - pad.b) * (1 - (v - min) / (max - min));
  const svg = document.createElementNS(SVGNS, 'svg'); svg.setAttribute('viewBox', `0 0 ${w} ${hgt}`); svg.setAttribute('class', 'chart'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', label);
  const el = (nme, a, t) => { const e = document.createElementNS(SVGNS, nme); for (const k in a) e.setAttribute(k, a[k]); if (t != null) e.textContent = t; svg.append(e); return e; };
  [0, 0.5, 1].forEach((f) => { const y = Y(max * f / 1.1 * 1.1 * (f ? 1 : 0)); el('line', { x1: pad.l, x2: w - pad.r, y1: Y(max * f), y2: Y(max * f), stroke: '#e3e9f1' }); el('text', { x: pad.l - 6, y: Y(max * f) + 4, 'text-anchor': 'end' }, fmt(Math.round(max * f))); });
  el('path', { d: points.map((p, i) => `${i ? 'L' : 'M'}${X(i)} ${Y(p.y)}`).join(' '), fill: 'none', stroke: color, 'stroke-width': 2.5, 'stroke-linejoin': 'round' });
  el('path', { d: `M${X(0)} ${Y(0)} ` + points.map((p, i) => `L${X(i)} ${Y(p.y)}`).join(' ') + ` L${X(n - 1)} ${Y(0)} Z`, fill: color, 'fill-opacity': '.08' });
  points.forEach((p, i) => { el('circle', { cx: X(i), cy: Y(p.y), r: 4, fill: '#fff', stroke: color, 'stroke-width': 2 }); el('text', { x: X(i), y: hgt - 8, 'text-anchor': 'middle' }, p.x); el('text', { x: X(i), y: Y(p.y) - 9, 'text-anchor': 'middle', style: 'fill:var(--c-ink-2);font-weight:700' }, fmt(p.y)); });
  return svg;
}
export function sparkline(vals, { w = 120, hgt = 32, color = PAL[0] } = {}) {
  const max = Math.max(1, ...vals), n = vals.length; const svg = document.createElementNS(SVGNS, 'svg'); svg.setAttribute('viewBox', `0 0 ${w} ${hgt}`); svg.setAttribute('width', w); svg.setAttribute('height', hgt); svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(SVGNS, 'path'); p.setAttribute('d', vals.map((v, i) => `${i ? 'L' : 'M'}${(i * w) / Math.max(1, n - 1)} ${hgt - 2 - (v / max) * (hgt - 4)}`).join(' ')); p.setAttribute('fill', 'none'); p.setAttribute('stroke', color); p.setAttribute('stroke-width', '2'); svg.append(p); return svg;
}
export const legend = (items) => h('div.legend', items.map(([c, t]) => h('span', h('i', { style: `background:${c}` }), t)));
export function hbars(rows, { max, color = PAL[0], fmt = fmtNum } = {}) { const m = max || Math.max(1, ...rows.map((r) => r.value)); return h('div.stack-sm', rows.map((r) => h('div', { style: 'display:grid;grid-template-columns:130px 1fr 54px;gap:8px;align-items:center;font-size:var(--fs-sm)' }, h('span.muted', { style: 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, r.label), meter((r.value / m) * 100), h('b.nowrap', { style: 'text-align:right' }, fmt(r.value))))); }

// minimal markdown (headings, bullets, bold, numbered) → DOM
export function md(src) {
  const root = h('div.stack-sm'); let ul = null;
  const inline = (t) => { const out = []; String(t).split(/(\*\*[^*]+\*\*)/).forEach((p) => out.push(p.startsWith('**') && p.endsWith('**') ? h('b', p.slice(2, -2)) : p)); return out; };
  String(src || '').split('\n').forEach((line) => {
    if (/^\s*[-*]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) { if (!ul) { ul = h('ul'); root.append(ul); } ul.append(h('li', inline(line.replace(/^\s*([-*]|\d+\.)\s+/, '')))); return; }
    ul = null; if (/^###\s/.test(line)) root.append(h('h4', line.slice(4))); else if (/^##\s/.test(line)) root.append(h('h3', line.slice(3))); else if (/^#\s/.test(line)) root.append(h('h2', line.slice(2))); else if (/^>\s?/.test(line)) root.append(h('div.callout.small', inline(line.replace(/^>\s?/, '')))); else if (line.trim()) root.append(h('p', inline(line)));
  });
  return root;
}
export function download(name, text, mime = 'text/plain;charset=utf-8') { const a = h('a', { href: URL.createObjectURL(new Blob([text], { type: mime })), download: name }); document.body.append(a); a.click(); a.remove(); }
export async function copyText(t) { try { await navigator.clipboard.writeText(t); toast(L('복사했습니다.', 'Copied.'), 'ok', 1800); } catch { toast(L('복사에 실패했습니다. 직접 선택해 복사하세요.', 'Copy failed. Select and copy manually.'), 'err'); } }
export const debounce = (fn, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

// ---------- router ----------
const table_ = [];
export function route(pattern, loader, opts = {}) { const keys = []; const re = new RegExp('^' + pattern.replace(/:([a-zA-Z_]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$'); table_.push({ re, keys, loader, opts, pattern }); }
export function parseHash() { const raw = location.hash.replace(/^#/, '') || '/'; const [path, qs] = raw.split('?'); return { path: path || '/', query: Object.fromEntries(new URLSearchParams(qs || '')) }; }
export function navigate(path) { if (('#' + path) === location.hash) window.dispatchEvent(new HashChangeEvent('hashchange')); else location.hash = path; }
export function resolve() { const { path, query } = parseHash(); for (const r of table_) { const m = r.re.exec(path); if (m) { const params = {}; r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); }); return { r, params, query, path }; } } return null; }
export const qs = (o) => { const p = new URLSearchParams(); Object.entries(o).forEach(([k, v]) => { if (v !== '' && v != null && v !== false) p.set(k, v); }); const s = p.toString(); return s ? '?' + s : ''; };

// 시연 접근 코드 입력 모달(로그인 화면·페르소나 전환 공용). 취소하면 '' 를 돌려준다.
export function askDemoCode() {
  return new Promise((resolve) => {
    const inp = input({ type: 'password', autocomplete: 'off', placeholder: L('시연 접근 코드', 'Demo access code') }); let done = false;
    const fin = (v, close) => { if (done) return; done = true; close && close(); resolve(v); };
    modal({ title: L('시연 접근 코드 입력', 'Enter demo access code'), size: 'narrow', onClose: () => fin(''),
      body: h('div.stack', h('p.small.muted', L('페르소나 전환에는 발표자/담당자에게 받은 접근 코드가 필요합니다.', 'Switching persona needs the access code from the presenter.')), field(L('접근 코드', 'Access code'), inp, { req: true })),
      footer: (close) => [h('button.btn', { onclick: () => fin('', close) }, L('취소', 'Cancel')), h('button.btn.btn-primary', { onclick: () => { if (!inp.value.trim()) { inp.focus(); return; } fin(inp.value.trim(), close); } }, L('확인', 'Continue'))] });
    setTimeout(() => inp.focus(), 60); inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const b = document.querySelector('.modal .btn-primary'); b && b.click(); } });
  });
}
