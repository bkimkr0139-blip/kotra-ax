import { h, L, lf, ic, statusBadge, ddayBadge, synthBadge, fmtDate, fmtDT, meter, store, GET, POST, DEL, act, toast, navigate, provBadge, modal, kv, alertBox, errMsg } from '../lib.js';

export const TYPE_LABEL = { VOUCHER: ['수출바우처', 'Voucher'], BRANCH: ['해외지사화', 'Branch office'], BUYER: ['바이어 발굴', 'Buyer discovery'], RESEARCH: ['시장조사', 'Market research'], MEETING: ['상담회', 'Meeting'], EXHIBITION: ['전시회', 'Exhibition'], EDU: ['교육', 'Training'], CONSULT: ['컨설팅', 'Consulting'], INFRA: ['인프라', 'Infrastructure'], BRIEFING: ['설명회', 'Briefing'], TAILORED: ['기간제 맞춤형', 'Tailored'], HELPDESK: ['헬프데스크', 'Help desk'], TALENT: ['글로벌 인재', 'Global talent'] };
export const GROUP_LABEL = { READY: ['수출준비', 'Export-ready'], NOVICE: ['수출초보', 'Beginner'], PROMISING: ['유망기업', 'Promising'], MIDCAP: ['중견기업', 'Mid-sized'] };
export const CT_LABEL = { news: ['시장뉴스', 'News'], strategy: ['진출전략', 'Strategy'], report: ['심층보고서', 'Report'], trend: ['트렌드', 'Trend'] };
export const CH_LABEL = { ONLINE: ['온라인 상담', 'Online'], PHONE: ['전화 상담', 'Phone'], MOBILE: ['모바일 상담', 'Mobile'], VISIT: ['방문 상담', 'Visit'], INVEST: ['투자 상담', 'Investment'], OMBUDSMAN: ['고충 상담', 'Grievance'], GRIEVANCE: ['애로/민원', 'Complaint'], REGULATION_REPORT: ['기업규제 애로신고', 'Regulation report'] };
export const countryName = (code) => { const c = (store.config?.countries || []).find((x) => x.code === code); return c ? L(c.ko, c.en) : code || ''; };
export const productName = (key) => { const p = (store.config?.products || []).find((x) => x.key === key); return p ? L(p.ko, p.en) : key || ''; };

export function programCard(p, { reco } = {}) {
  const dd = p.live_status === 'UPCOMING' ? h('span.badge.b-info', L(`D-${p.days_to_start} 시작`, `Starts D-${p.days_to_start}`)) : ddayBadge(p.d_day, p.live_status);
  return h('a.card.card-link', { href: `#/programs/${p.id}`, 'aria-label': lf(p, 'title') }, h('div.card-b.stack-sm',
    h('div.row.row-between', h('div.row', { style: 'gap:6px' }, h('span.badge.b-primary', L(...(TYPE_LABEL[p.type] || [p.type, p.type]))), statusBadge(p.live_status), p.mode && h('span.badge', p.mode === 'ONLINE' ? L('온라인', 'Online') : L('오프라인', 'Offline'))), dd),
    h('h3', { style: 'margin:6px 0 2px;font-size:1.0625rem' }, lf(p, 'title')), h('p.small.muted', { style: 'margin:0;min-height:2.9em' }, lf(p, 'summary')),
    h('div.small.muted', L('대상: ', 'Target: '), lf(p, 'target')), h('div.small.muted', L('신청: ', 'Apply: '), `${fmtDate(p.apply_start)} ~ ${fmtDate(p.apply_end)}`, p.event_start && ` · ${L('개최', 'Event')} ${fmtDate(p.event_start)}`),
    (reco || p.recommend != null) && h('div.row', { style: 'gap:10px' }, h('span.small.bold', { style: 'color:var(--c-primary)' }, `${L('추천도', 'Fit')} ${p.recommend ?? '-'}%`), h('div', { style: 'flex:1' }, meter(p.recommend ?? 0, p.recommend >= 80 ? 'ok' : ''))),
    h('div.row.row-between', h('span.xs.muted', lf(p, 'dept')), h('span.small.bold', { style: 'color:var(--c-primary)' }, L('상세보기 ›', 'Details ›')))));
}
export function scoreBars(parts, max, labels) {
  const lab = labels || { product: L('품목 적합', 'Product fit'), country: L('국가 적합', 'Country fit'), conditions: L('거래조건', 'Trade terms'), interest: L('관심도', 'Interest'), time: L('상담 가능시간', 'Availability'), past: L('과거 성과', 'Track record'), other: L('기타', 'Other') };
  return h('div.score-bars', Object.keys(lab).filter((k) => parts[k] != null).map((k) => h('div.r', h('span.muted', lab[k]), meter((parts[k] / (max[k] || 1)) * 100, parts[k] / (max[k] || 1) >= 0.8 ? 'ok' : ''), h('b', `${parts[k]}/${max[k] || ''}`))));
}
export const MAXP = { product: 30, country: 20, conditions: 15, interest: 10, time: 10, past: 10, other: 5 };
export function matchBadge(score) { return h('div.match-score', { style: `--p:${score}`, role: 'img', 'aria-label': `AI Match ${score}` }, h('b', score)); }
export function reasonList(reasons) { return h('ul.small', { style: 'margin:0;padding-left:18px;display:grid;gap:3px' }, (reasons || []).map((r) => h('li', { style: r.neg ? 'color:var(--s-danger)' : '' }, L(r.ko, r.en)))); }
export function buyerCard(b, { onFav, event, actions } = {}) {
  return h('div.card', h('div.card-b.stack-sm',
    h('div.row', { style: 'align-items:flex-start;gap:14px' }, b.score != null && matchBadge(b.score), h('div.grow', h('a', { href: `#/buyers/${b.id}`, style: 'text-decoration:none' }, h('h3', { style: 'margin:0 0 2px;font-size:1.0625rem;color:var(--c-ink)' }, b.name)), h('div.small.muted', `${b.country_name ? L(b.country_name.ko, b.country_name.en) : b.country} · ${b.type} · ${L('규모', 'Size')} ${b.size}`), h('div.row', { style: 'gap:6px;margin-top:6px' }, b.verified ? h('span.badge.b-ok', L('KOTRA 검증', 'Verified')) : h('span.badge', L('미검증', 'Unverified')), h('span.badge.b-info', `${L('신뢰도', 'Trust')} ${b.trust}`), synthBadge())),
      onFav && h('button.icon-btn', { 'aria-label': L('관심 바이어 저장/해제', 'Save / unsave buyer'), 'aria-pressed': String(!!b.favorite), onclick: onFav, style: b.favorite ? 'color:var(--c-red)' : '' }, ic('heart'))),
    h('p.small', { style: 'margin:0' }, store.locale === 'en' ? b.description_en || b.description : b.description),
    h('div.chips', (b.hashtags || []).slice(0, 5).map((t) => h('span.badge', '#' + t))),
    b.reasons && b.reasons.length > 0 && h('div.callout.small', h('b', L('추천 근거', 'Why recommended')), reasonList(b.reasons.slice(0, 3))),
    actions));
}
export function contentCard(c) {
  return h('a.card.card-link', { href: `#/markets/content/${c.id}` }, h('div.card-b.stack-sm', h('div.row', { style: 'gap:6px' }, h('span.badge.b-primary', L(...(CT_LABEL[c.type] || [c.type, c.type]))), c.country && h('span.badge', countryName(c.country)), c.is_synthetic ? h('span.badge.b-synth', L('시연용', 'Demo')) : null), h('h3', { style: 'font-size:1.0625rem;margin:4px 0' }, lf(c, 'title')), c.body_ko && h('p.small.muted', { style: 'margin:0' }, (store.locale === 'en' ? c.body_en : c.body_ko).slice(0, 110) + '…'), h('div.xs.muted', `${c.source_name || ''} · ${fmtDate(c.published_at)}`)));
}
export const sectionHead = (title, desc, right) => h('div.section-h', h('div', h('h2', title), desc && h('p', desc)), right);
export const linkBtn = (href, label, cls = 'btn-outline btn-sm') => h('a.btn.' + cls.split(' ').join('.'), { href }, label, ic('arrow'));
export async function toggleFav(b, rerender) { try { const r = await POST(`/api/buyers/${b.id}/favorite`); toast(r.favorite ? L('관심 바이어로 저장했습니다.', 'Saved to your shortlist.') : L('관심 바이어에서 해제했습니다.', 'Removed from your shortlist.'), 'ok', 2200); rerender && rerender(); } catch (e) { toast(e.message, 'err'); } }

// Human-in-the-loop approval dialog: shows exactly what will happen, requires explicit confirmation.
export async function openApproval(id, { onDone } = {}) {
  const { approval: a } = await GET(`/api/approvals/${id}`);
  const p = a.payload || {}; const self = a.approver_role === 'self'; const risk = a.risk;
  const chk = h('input', { type: 'checkbox', id: 'hitl-ok' });
  const reason = h('textarea', { placeholder: L('반려/취소 사유 (선택)', 'Reason for rejecting / cancelling (optional)'), style: 'min-height:60px' });
  const rows = Object.entries(p).filter(([k]) => !['form'].includes(k)).map(([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v).slice(0, 160) : String(v).slice(0, 220)]);
  const decide = (decision) => async () => {
    try { await POST(`/api/approvals/${a.id}/decision`, { decision, confirm: decision === 'APPROVE' ? true : undefined, reason: reason.value }); toast(decision === 'APPROVE' ? L('승인되어 실행되었습니다.', 'Approved and executed.') : L('처리되었습니다.', 'Done.'), 'ok'); box.close(); onDone && onDone(decision); }
    catch (e) { toast(errMsg(e), 'err', 6000); }
  };
  const box = modal({ title: L('최종 확인 (Human-in-the-Loop)', 'Final confirmation (Human-in-the-Loop)'), size: '', dismissible: true, body: h('div.stack',
    h('div.row', statusBadge(risk), h('b', a.title)), alertBox(risk === 'HIGH' ? 'warn' : 'info', self ? L('이 작업은 대외 영향이 있어 본인의 최종 승인이 필요합니다. 승인 전에는 아무것도 실행되지 않습니다.', 'This action has external impact and needs your final approval. Nothing runs before you approve.') : L('권한 있는 담당자의 승인이 필요한 작업입니다.', 'This action needs approval from an authorised officer.')),
    a.kind === 'APPLICATION_SUBMIT' && h('div.callout.small', L('시연 환경: 사업관리시스템 연계는 Mock이며 실제 접수되지 않습니다.', 'Demo: the program-management integration is mocked; nothing is actually filed.')),
    a.kind === 'EMAIL_SEND' && h('div.callout.small', L('시연 환경: 실제 이메일은 발송되지 않고 발송함(Mock)에 기록됩니다.', 'Demo: no real email is sent — it is recorded in the mock outbox.')),
    kv(rows.length ? rows : [[L('대상', 'Target'), `${a.ref_type} ${a.ref_id}`]]), h('label.check', chk, h('span', L('위 내용을 확인했으며 실행에 동의합니다.', 'I have reviewed the details above and agree to execute.'))), reason),
    footer: [h('button.btn', { onclick: decide('CANCEL') }, L('요청 취소', 'Cancel request')), h('button.btn.btn-danger', { onclick: decide('REJECT') }, L('반려', 'Reject')), h('button.btn.btn-primary', { onclick: (e) => { if (!chk.checked) { toast(L('확인란에 체크해 주세요.', 'Please tick the confirmation box.'), 'err'); chk.focus(); return; } decide('APPROVE')(); } }, ic('check'), L('승인 및 실행', 'Approve & execute'))] });
  return box;
}
