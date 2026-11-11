// Data Integration Studio 공용: API 호출(Idempotency-Key 지원), 배지, 표/카드 헬퍼.
import { h, L, store, ic, ApiError, toast, errMsg, fmtDT, statusBadge, modal } from '../lib.js';
import { tbl } from './_ax.js';
export { tbl };

export const BASE = '/api/v1/data-integration';
export async function dapi(method, path, body, headers = {}) {
  const res = await fetch(BASE + path, { method, credentials: 'same-origin', headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const ct = res.headers.get('content-type') || ''; const data = ct.includes('json') ? await res.json() : await res.text();
  if (!res.ok) throw new ApiError(res.status, data?.error?.code || 'ERROR', data?.error?.message || res.statusText, data?.error?.extra);
  return data;
}
export const dget = (p) => dapi('GET', p); export const dpost = (p, b = {}, h2) => dapi('POST', p, b, h2);
export const fill = (el, ...kids) => { el.replaceChildren(...kids.flat(Infinity).filter((c) => c != null && c !== false)); return el; }; // null/undefined 가 문자열로 렌더링되지 않도록
export const idem = () => ({ 'idempotency-key': (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random()).slice(0, 60) });
export const reload = () => window.dispatchEvent(new HashChangeEvent('hashchange'));
export const can = (cap) => !!(store.di && store.di.capabilities && store.di.capabilities[cap]);

const MODE = { SYNTHETIC: ['SYNTHETIC', 'b-synth'], MOCK: ['MOCK', 'b-mock'], PLANNED: ['PLANNED', ''], LIVE: ['LIVE', 'b-ok'], DEMO: ['DEMO', 'b-info'] };
export const modeBadge = (m) => { const x = MODE[m] || [m, '']; return h('span', { class: 'badge ' + x[1], title: L('데이터/연계 구분 — 실제 운영 연결이 아닙니다', 'Data/integration class — not a real production connection') }, x[0]); };
const MAPS = {
  band: { AUTO_LINK_CANDIDATE: ['자동 연계 후보', 'Auto-link candidate', 'b-warn'], REVIEW_REQUIRED: ['검토 필요', 'Review required', 'b-info'], DO_NOT_LINK: ['연계 금지', 'Do not link', 'b-danger'] },
  cand: { PENDING: ['대기', 'Pending', 'b-info'], NEEDS_INFO: ['보완 요청', 'Needs info', 'b-warn'], MERGED: ['병합됨', 'Merged', 'b-ok'], LINKED: ['연계만', 'Linked', 'b-primary'], SEPARATE: ['별도 유지', 'Kept separate', ''], BLOCKED: ['차단', 'Blocked', 'b-danger'] },
  run: { SUCCEEDED: ['성공', 'Succeeded', 'b-ok'], PARTIAL: ['부분(격리 있음)', 'Partial', 'b-warn'], FAILED: ['실패', 'Failed', 'b-danger'], RETRYING: ['재시도', 'Retrying', 'b-info'], RUNNING: ['실행중', 'Running', 'b-info'] },
  prop: { DRAFT: ['초안', 'Draft', ''], SIMULATED: ['샌드박스 통과', 'Simulated', 'b-info'], REVIEW_REQUESTED: ['승인 요청', 'Review requested', 'b-warn'], APPROVED: ['승인', 'Approved', 'b-ok'], DEPLOYING: ['배포중', 'Deploying', 'b-info'], ACTIVE: ['적용(ACTIVE)', 'Active', 'b-primary'], MONITORED: ['모니터링', 'Monitored', 'b-ok'], REJECTED: ['반려', 'Rejected', 'b-danger'], FAILED: ['실패', 'Failed', 'b-danger'], ROLLBACK_REQUESTED: ['롤백 요청', 'Rollback requested', 'b-warn'], ROLLED_BACK: ['롤백됨', 'Rolled back', ''] },
  dq: { DETECTED: ['탐지', 'Detected', 'b-info'], TRIAGED: ['분류', 'Triaged', 'b-info'], ASSIGNED: ['배정', 'Assigned', 'b-info'], PROPOSED: ['제안', 'Proposed', 'b-warn'], REVIEWED: ['검토', 'Reviewed', 'b-warn'], APPROVED: ['승인', 'Approved', 'b-ok'], APPLIED: ['적용', 'Applied', 'b-primary'], VERIFIED: ['검증', 'Verified', 'b-ok'], CLOSED: ['종료', 'Closed', ''], REJECTED: ['반려', 'Rejected', 'b-danger'], REOPENED: ['재개', 'Reopened', 'b-warn'] },
  stage: { OK: ['OK', 'OK', 'b-ok'], WARN: ['경고', 'Warn', 'b-warn'], FAILED: ['실패', 'Failed', 'b-danger'], SKIPPED: ['건너뜀', 'Skipped', ''] },
  sev: { LOW: ['낮음', 'Low', 'b-ok'], MEDIUM: ['보통', 'Medium', 'b-warn'], HIGH: ['높음', 'High', 'b-danger'], BLOCK: ['차단', 'Block', 'b-danger'] },
};
export const badge = (kind, code) => { const s = (MAPS[kind] || {})[code]; return h('span', { class: 'badge ' + (s ? s[2] : '') }, s ? L(s[0], s[1]) : String(code ?? '-')); };
export const pass = (ok) => h('span', { class: 'badge ' + (ok ? 'b-ok' : 'b-danger') }, ok ? 'PASS' : 'FAIL');
export const card = (title, body, right, cls = '') => h('div', { class: 'card ' + cls }, h('div.card-h', h('h3', title), right), h('div.card-b', body));
export const note = (kind, ...c) => h('div', { class: 'alert ' + kind }, ic(kind === 'warn' || kind === 'danger' ? 'alert' : 'info'), h('div', c));
export const Kpi = (k) => h('div.card.di-kpi', { title: `${L('계산식', 'Formula')}: ${k.formula}\n${L('분모', 'Denominator')}: ${k.denominator}\n${L('기준 시각', 'As of')}: ${fmtDT(k.as_of)}\n${L('출처', 'Source')}: ${k.source}\n${L('구분', 'Class')}: ${k.demo ? 'SYNTHETIC/DEMO' : '-'}` },
  h('div.kpi', h('div.l', k.label), h('div.v', String(k.value)), h('div.s', k.denominator)));
export const pre = (txt, cls = '') => h('pre', { class: 'ax-code ' + cls }, txt);
export const mono = (t) => h('code.xs', t);
export function download(name, text, mime = 'text/plain;charset=utf-8') { const a = h('a', { href: URL.createObjectURL(new Blob([text], { type: mime })), download: name }); document.body.append(a); a.click(); a.remove(); }
export async function fetchText(path) { const r = await fetch(BASE + path, { credentials: 'same-origin' }); if (!r.ok) throw new ApiError(r.status, 'ERROR', r.statusText); return r.text(); }
export const confirmBox = (title, body, onOk, { okLabel = L('확인', 'Confirm'), danger = false } = {}) => {
  const m = modal({ title, body, footer: (close) => [h('button.btn', { onclick: close }, L('취소', 'Cancel')), h('button', { class: 'btn ' + (danger ? 'btn-danger' : 'btn-primary'), onclick: async (e) => { e.currentTarget.disabled = true; try { await onOk(); close(); } catch (err) { toast(errMsg(err), 'err', 7000); e.currentTarget.disabled = false; } } }, okLabel)] });
  return m;
};
export { errMsg, toast, fmtDT, statusBadge, modal };
