import { h, $, $$, L, lf, store, GET, POST, PATCH, DEL, act, ic, navigate, toast, modal, statusBadge, fmtDate, provBadge, synthBadge, alertBox, errMsg, md, download, copyText, lineChart, hbars, meter, clear, ddayBadge, field, input, empty, confirmDialog, kv, ApiError, svgIcon } from '../lib.js';
import { openApproval, scoreBars, MAXP, matchBadge, reasonList, TYPE_LABEL } from './_shared.js';

const STEP_ICON = { received: 'send', understand: 'compass', plan: 'route', agent: 'ai', rag: 'layers', tool: 'gear', policy: 'shield', validate: 'check', compose: 'edit', multihop: 'route', llm: 'ai' };
const AGENT_PROMPTS = {
  strategy: ['베트남에 기능성 화장품을 수출하고 싶은데 무엇부터 해야 하나요?', 'I want to export functional cosmetics to Vietnam — where should I start?'],
  market: ['베트남 화장품 시장 현황과 유통채널을 알려줘', 'Tell me about the Vietnam cosmetics market and distribution channels'],
  buyer: ['베트남 화장품 바이어를 추천해줘', 'Recommend cosmetics buyers in Vietnam'],
  regulation: ['베트남 화장품 수출 규제·인증 체크리스트를 만들어줘', 'Create a regulation checklist for exporting cosmetics to Vietnam'],
  program: ['신청 가능한 지원사업을 추천해줘', 'Recommend programs I can apply to'],
  contract: ['독점 판매 계약서에서 점검할 조항을 알려줘', 'What clauses should I check in an exclusive distribution contract?'],
  report: ['베트남 화장품 시장진출 보고서를 만들어줘', 'Create a Vietnam cosmetics market-entry report'],
};

// ---------- SSE client ----------
async function streamChat(payload, handlers) {
  const res = await fetch('/api/ai/chat?stream=1', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), credentials: 'same-origin' });
  if (!res.ok || !res.headers.get('content-type')?.includes('event-stream')) {
    let err = {}; try { err = await res.json(); } catch { /* ignore */ }
    throw new ApiError(res.status, err?.error?.code || 'ERROR', err?.error?.message || res.statusText);
  }
  const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
  for (;;) {
    const { value, done } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx; while ((idx = buf.indexOf('\n\n')) >= 0) {
      const raw = buf.slice(0, idx); buf = buf.slice(idx + 2);
      const ev = /^event: (.+)$/m.exec(raw)?.[1]; const data = /^data: (.+)$/m.exec(raw)?.[1];
      if (ev && data) { try { handlers[ev] && handlers[ev](JSON.parse(data)); } catch (e) { console.warn(e); } }
    }
  }
}

// ---------- answer rendering ----------
const citeBtn = (n, root) => h('button.cite', { 'aria-label': L(`출처 ${n}로 이동`, `Go to source ${n}`), onclick: () => { const t = $(`.src[data-n="${n}"]`, root()); if (t) { t.scrollIntoView({ block: 'center', behavior: 'smooth' }); t.classList.remove('flash'); void t.offsetWidth; t.classList.add('flash'); } } }, n);
function sectionBody(sec, root, ctx) {
  if (sec.key === 'conclusion') return h('p', withCites(sec.body, root));
  if (sec.key === 'evidence') return h('ul', sec.items.map((i) => h('li', i.text, ' ', (i.cite || []).map((n) => citeBtn(n, root)), i.badge === 'SYNTHETIC' && h('span.badge.b-synth', { style: 'margin-left:6px' }, L('합성 지표', 'Synthetic')))));
  if (sec.key === 'actions') return h('div', sec.items.map((i) => h('button.btn.btn-sm.btn-outline.act-btn', { onclick: () => ctx.runAction(i.action) }, ic(actIcon(i.action.type)), i.text)));
  if (sec.key === 'services') return h('ul', sec.items.map((i) => h('li', h('a', { href: i.href }, i.text), ' ', i.d_day != null && ddayBadge(i.d_day, i.status))));
  if (sec.key === 'cautions') return h('div.stack-sm', sec.items.map((i) => h('div.small', { style: 'display:flex;gap:8px' }, ic('alert', { style: 'color:var(--s-warn);display:inline-flex;flex:0 0 auto;margin-top:3px' }), i.text)));
  return null;
}
const actIcon = (t) => ({ draft_application: 'file', request_match: 'handshake', save_buyer: 'heart', draft_email: 'mail', send_email: 'send', consult_expert: 'phone', open_application: 'file', open_approval: 'check' }[t] || 'arrow');
function withCites(text, root) { const parts = String(text).split(/(\[\d+\])/); return parts.map((p) => { const m = /^\[(\d+)\]$/.exec(p); return m ? citeBtn(Number(m[1]), root) : p; }); }

function answerCard(res, ctx) {
  const root = () => card;
  const card = h('div.stack-sm');
  if (res.blocked) {
    card.append(h('div.alert.danger', { role: 'alert' }, ic('shield'), h('div', h('b', L('요청이 차단되었습니다', 'Request blocked')), h('div', res.answer), h('div.xs', { style: 'margin-top:6px;opacity:.85' }, L('정책 사유: ', 'Policy reason: '), res.blocked.reason, ' · ', L('감사 로그에 기록됨', 'recorded in the audit log')))));
  } else if (res.abstained) {
    card.append(h('div.card', { style: 'border-color:#f0d49b;background:var(--s-warn-bg)' }, h('div.card-b.stack-sm', h('h4', { style: 'margin:0;color:var(--s-warn)' }, ic('alert'), ' ', res.sections && res.sections[0] ? res.sections[0].title : L('근거 부족', 'Insufficient evidence')), h('p', { style: 'margin:0' }, res.sections && res.sections[0] ? res.sections[0].body : res.answer), h('div.row', (res.suggested_actions || []).map((a) => h('button.btn.btn-primary.btn-sm', { onclick: () => ctx.runAction(a) }, ic('phone'), a.label))))));
  } else {
    const ans = h('div.ans');
    (res.sections || []).filter((s) => s.key !== 'sources').forEach((sec) => { ans.append(h('div.sec' + (sec.key === 'conclusion' ? '.conc' : ''), sec.key !== 'conclusion' && h('h4', sec.title), sectionBody(sec, root, ctx))); });
    if (res.sources && res.sources.length) {
      ans.append(h('div.sec', h('h4', L('출처', 'Sources'), ` (${res.sources.length})`), h('div.srcs', res.sources.map((s) => h('div.src', { 'data-n': s.n }, h('span.n', s.n), h('b', s.title), h('div.m', [s.org, fmtDate(s.date), `${L('관련도', 'Relevance')} ${s.relevance}%`].filter(Boolean).join(' · ')), s.snippet && h('div.snip', s.snippet), h('div.row', { style: 'gap:6px;margin-top:6px' }, s.synthetic && h('span.badge.b-synth', L('합성/요약', 'Synthetic')), s.url ? h('a.small', { href: s.url, target: s.url.startsWith('http') ? '_blank' : null, rel: 'noopener noreferrer' }, L('원문 보기', 'View original'), ' ›') : h('span.xs.muted', L('사용자 첨부', 'Your attachment'))))))));
    }
    card.append(ans);
  }
  if (res.tool_runs && res.tool_runs.length) {
    const used = res.tool_runs.map((t) => h('span', { class: 'tool-chip ' + (t.status === 'BLOCKED' ? 'BLOCKED' : t.risk), title: `${t.tool_id} · ${t.latency_ms}ms · ${t.provenance || ''}` }, ic(t.status === 'BLOCKED' ? 'lock' : t.status === 'APPROVAL_REQUIRED' ? 'check' : 'gear'), t.name || t.tool_id, ' ', t.status !== 'OK' && h('b', t.status === 'APPROVAL_REQUIRED' ? L('승인 대기', 'awaiting approval') : t.status), t.provenance && t.provenance !== 'INTERNAL' && h('span.badge.b-mock', { style: 'margin-left:4px' }, t.provenance === 'MOCK_EXTERNAL' ? 'Mock API' : t.provenance)));
    card.append(h('div.row', { style: 'gap:2px' }, h('span.xs.muted', L('실행한 Tool: ', 'Tools used: ')), used));
  }
  // footer: feedback, copy, export, trace
  const stars = h('div.rating', { role: 'radiogroup', 'aria-label': L('답변 평가', 'Rate this answer') }, [1, 2, 3, 4, 5].map((n) => h('button', { role: 'radio', 'aria-label': `${n}`, onclick: async (e) => { if (!store.user) { toast(L('로그인 후 평가할 수 있습니다.', 'Log in to rate.'), 'err'); return; } try { await POST('/api/ai/feedback', { message_id: res.message_id, rating: n, kind: 'RATING' }); [...stars.children].forEach((b, i) => b.classList.toggle('on', i < n)); toast(L('평가해 주셔서 감사합니다.', 'Thanks for rating.'), 'ok', 1800); } catch (er) { toast(errMsg(er), 'err'); } } }, '★')));
  if (res.rating) [...stars.children].forEach((b, i) => b.classList.toggle('on', i < res.rating));
  const foot = h('div.row.row-between', { style: 'gap:6px' }, h('div.row', { style: 'gap:6px' }, h('span.xs.muted', L('답변이 도움이 되었나요?', 'Helpful?')), stars),
    h('div.row', { style: 'gap:2px' }, h('button.btn.btn-ghost.btn-sm', { onclick: () => copyText(res.answer), 'aria-label': L('답변 복사', 'Copy answer') }, ic('copy')),
      store.user && res.message_id && h('button.btn.btn-ghost.btn-sm', { onclick: () => reportModal(res), 'aria-label': L('답변 오류 신고', 'Report an error') }, ic('flag'), L('오류 신고', 'Report')),
      res.trace_id && h('span.badge.b-info', { title: L('추적 ID', 'Trace id') }, res.trace_id), res.provenance && provBadge(res.provenance), res.latency_ms != null && h('span.xs.muted', `${res.latency_ms}ms`)));
  card.append(foot);
  if (res.follow_ups && res.follow_ups.length) card.append(h('div.chips', res.follow_ups.map((f) => h('button.chip', { onclick: () => ctx.send(f) }, ic('ai'), f))));
  return card;
}
function reportModal(res) {
  const c = h('textarea', { placeholder: L('어떤 부분이 잘못되었나요? (개인정보는 입력하지 마세요)', 'What is wrong? (do not enter personal data)') });
  modal({ title: L('답변 오류 신고', 'Report an error in this answer'), size: 'narrow', body: field(L('내용', 'Details'), c, { req: true }), footer: (close) => [h('button.btn', { onclick: close }, L('취소', 'Cancel')), h('button.btn.btn-primary', { onclick: act(async () => { if (c.value.trim().length < 5) throw new Error(L('내용을 입력하세요.', 'Please describe the issue.')); await POST('/api/ai/feedback', { message_id: res.message_id, kind: 'ERROR_REPORT', comment: c.value }); toast(L('신고가 접수되었습니다. 관리자가 검토합니다.', 'Report received; an administrator will review it.'), 'ok'); close(); }) }, L('신고', 'Report'))] });
}

// ---------- artifacts ----------
function artifactView(a, ctx) {
  if (!a) return empty(L('아직 생성된 결과물이 없습니다.', 'No artifact yet.'), L('질문하면 비교표, 체크리스트, 바이어 리스트, 신청 초안 등이 이곳에 표시됩니다.', 'Tables, checklists, buyer lists and drafts will appear here.'));
  if (a.type === 'bundle') {
    let active = 0; const body = h('div'); const draw = () => { body.replaceChildren(artifactView(a.tabs[active], ctx)); };
    const names = { market_table: L('시장', 'Market'), chart: L('통계', 'Chart'), checklist: L('규제', 'Regulation'), buyers: L('바이어', 'Buyers'), programs: L('사업', 'Programs'), application: L('신청', 'Application'), email: L('이메일', 'Email'), contract: L('계약', 'Contract'), report: L('보고서', 'Report') };
    const tabs_ = h('div.tabs', { role: 'tablist' }, a.tabs.map((t, i) => h('button', { role: 'tab', 'aria-selected': String(i === active), onclick: (e) => { active = i; [...tabs_.children].forEach((b, j) => b.setAttribute('aria-selected', String(j === i))); draw(); } }, names[t.type] || t.type))); draw();
    return h('div.stack', tabs_, body);
  }
  const d = a.data || {}; const title = h('h3', { style: 'margin:0 0 8px' }, a.title);
  if (a.type === 'market_table') return h('div.stack-sm', title, h('div.table-wrap', h('table.tbl', h('thead', h('tr', ['#', L('제목', 'Title'), L('기관', 'Org'), L('유형', 'Type'), L('관련도', 'Rel.')].map((c) => h('th', c)))), h('tbody', d.rows.map((r) => h('tr', h('td', r.n), h('td', r.title), h('td', r.org), h('td', r.type), h('td', `${r.relevance}%`)))))), downloadRow(a, d.rows.map((r) => [r.n, r.title, r.org, r.type, r.relevance]), ['n', 'title', 'org', 'type', 'relevance']));
  if (a.type === 'chart') {
    const rows = d.rows || []; const key = rows[0] && rows[0].year != null ? 'year' : Object.keys(rows[0] || {})[0];
    const node = rows[0] && rows[0].year != null ? lineChart(rows.map((r) => ({ x: r.year, y: r.export_usd_m })), { label: a.title }) : hbars(rows.map((r) => ({ label: r.country || r.hs_prefix || r[key], value: r.export_usd_m })));
    return h('div.stack-sm', title, node, h('div.callout.small', h('b', L('실행된 SQL (읽기전용)', 'Executed SQL (read-only)')), h('pre.mono.xs', { style: 'white-space:pre-wrap;margin:6px 0 0' }, d.sql, '\n', JSON.stringify(d.params))), synthBadge(), downloadRow(a, rows.map((r) => Object.values(r)), Object.keys(rows[0] || {})));
  }
  if (a.type === 'checklist') {
    const done = new Set(); const prog = h('div'); const upd = () => prog.replaceChildren(h('div.small.bold', `${done.size}/${d.items.length}`), meter((done.size / Math.max(1, d.items.length)) * 100, done.size === d.items.length ? 'ok' : ''));
    upd();
    return h('div.stack-sm', title, h('div.row', statusBadge(d.risk), h('span.badge', 'HS ' + d.hs), h('span.xs.muted', d.agency)), prog, d.items.map((it) => h('label.check', h('input', { type: 'checkbox', onchange: (e) => { if (e.target.checked) done.add(it.id); else done.delete(it.id); upd(); } }), h('span', it.text))), h('div.row', h('button.btn.btn-primary.btn-sm', { onclick: act(async () => { await POST('/api/saved', { kind: 'checklist', ref_id: d.country, title: a.title, payload: { items: d.items, done: [...done], country: d.country } }); }, { ok: L('MyKOTRA에 저장했습니다 (수출 여정 3단계 진행중).', 'Saved to MyKOTRA (journey step 3 in progress).') }) }, ic('check'), L('내 프로젝트에 저장', 'Save to my project')), d.source_url && h('a.btn.btn-sm', { href: d.source_url, target: '_blank', rel: 'noopener noreferrer' }, L('원문', 'Original'), ic('ext'))), downloadRow(a, d.items.map((i, n) => [n + 1, i.text]), ['no', 'step']));
  }
  if (a.type === 'buyers') {
    return h('div.stack-sm', title, synthBadge(), d.buyers.map((b) => h('div.card', h('div.card-b.stack-sm', h('div.row', { style: 'gap:12px;flex-wrap:nowrap;align-items:flex-start' }, matchBadge(b.score), h('div.grow', h('a', { href: `#/buyers/${b.id}`, style: 'text-decoration:none' }, h('b', b.name)), h('div.xs.muted', `${b.country_name ? L(b.country_name.ko, b.country_name.en) : b.country} · ${b.type} · ${L('신뢰도', 'Trust')} ${b.trust}`), b.verified && h('span.badge.b-ok', L('검증', 'Verified')))), scoreBars(b.parts, b.max), reasonList((b.reasons || []).slice(0, 3)), h('div.row', { style: 'gap:6px' }, h('button.btn.btn-sm', { onclick: () => ctx.runAction({ type: 'save_buyer', buyer_id: b.id }) }, ic('heart'), L('관심', 'Save')), (b.match ? h('a.btn.btn-sm.btn-outline', { href: '#/mykotra/matching' }, statusBadge(b.match.status), ' ', b.match.initiator === 'BUYER' && b.match.status === 'REQUESTED' ? L('받은 신청 — 수락하기', 'Received — accept') : L('진행 중 상담 보기', 'View meeting')) : d.event && h('button.btn.btn-sm.btn-primary', { onclick: () => ctx.runAction({ type: 'request_match', buyer_id: b.id, event_id: d.event.id }) }, ic('handshake'), L('상담 신청', 'Request'))), h('button.btn.btn-sm', { onclick: () => ctx.runAction({ type: 'draft_email', buyer_id: b.id }) }, ic('mail'), L('이메일 초안', 'Email draft')))))), downloadRow(a, d.buyers.map((b) => [b.id, b.name, b.country, b.type, b.score]), ['id', 'name', 'country', 'type', 'score']));
  }
  if (a.type === 'programs') {
    return h('div.stack-sm', title, d.programs.map((p) => h('div.card', h('div.card-b.stack-sm', h('div.row.row-between', h('span.badge.b-primary', L(...(TYPE_LABEL[p.type] || [p.type, p.type]))), ddayBadge(p.d_day, p.live_status)), h('a', { href: `#/programs/${p.id}`, style: 'text-decoration:none' }, h('b', lf(p, 'title'))), h('div.row', { style: 'gap:10px' }, h('b.small', { style: 'color:var(--c-primary)' }, `${L('추천도', 'Fit')} ${p.recommend ?? '-'}%`), h('div.grow', meter(p.recommend ?? 0, p.recommend >= 80 ? 'ok' : ''))), reasonList((p.reasons || []).slice(0, 3)), p.live_status === 'OPEN' && h('button.btn.btn-sm.btn-primary', { onclick: () => ctx.runAction({ type: 'draft_application', program_id: p.id }) }, ic('file'), L('신청 초안 만들기', 'Draft application'))))), downloadRow(a, d.programs.map((p) => [p.id, p.title_ko, p.recommend, p.d_day]), ['id', 'title', 'fit', 'd_day']));
  }
  if (a.type === 'application') {
    return h('div.stack-sm', title, h('div.row', statusBadge(d.status), h('b', d.program_title)), kv([[L('회사', 'Company'), d.form.company_name], [L('사업자번호', 'Biz no.'), d.form.biz_no], [L('주요 품목', 'Main product'), d.form.main_product], [L('목표시장', 'Target markets'), d.form.target_markets], [L('신청 목적', 'Purpose'), d.form.purpose]]), d.missing && d.missing.length > 0 && alertBox('warn', L(`보완 필요 ${d.missing.length}건`, `${d.missing.length} items to complete`)), h('div.row', h('a.btn.btn-primary.btn-sm', { href: `#/mykotra/applications/${d.application_id}` }, ic('edit'), L('열어서 수정·제출', 'Open to edit & submit')), h('button.btn.btn-sm', { onclick: () => ctx.send(L('신청 제출해줘', 'Submit the application')) }, ic('send'), L('제출 요청(승인 필요)', 'Request submission (approval)'))));
  }
  if (a.type === 'email') {
    const subj = h('input', { type: 'text', value: d.subject }); const body = h('textarea', { style: 'min-height:260px' }, d.body); body.value = d.body;
    return h('div.stack-sm', title, d.buyer && h('div.small', L('수신: ', 'To: '), h('b', d.buyer.name)), field(L('제목', 'Subject'), subj), field(L('본문', 'Body'), body), alertBox('mock', L('발송은 HITL 승인을 거치며, 시연 환경에서는 실제 발송되지 않고 발송함(Mock)에 기록됩니다.', 'Sending requires HITL approval; in this demo it is recorded in the mock outbox, not delivered.')), h('div.row', h('button.btn.btn-sm', { onclick: () => copyText(subj.value + '\n\n' + body.value) }, ic('copy'), L('복사', 'Copy')), h('button.btn.btn-primary.btn-sm', { onclick: () => ctx.runAction({ type: 'send_email', data: { to: d.to || 'buyer@example.com', subject: subj.value, body: body.value } }) }, ic('send'), L('발송 요청 (승인 필요)', 'Request send (approval)'))));
  }
  if (a.type === 'contract') {
    return h('div.stack-sm', title, h('div.row', L('위험도', 'Risk'), statusBadge(d.risk_level)), kv([[L('품목', 'Item'), d.extracted.item], [L('금액', 'Amount'), d.extracted.amount], [L('선적일', 'Shipment date'), d.extracted.shipment_date]]), d.findings.length ? h('div.table-wrap', h('table.tbl', h('thead', h('tr', h('th', L('심각도', 'Severity')), h('th', L('점검 사항', 'Finding')))), h('tbody', d.findings.map((f) => h('tr', h('td', statusBadge(f.severity)), h('td', L(f.ko, f.en))))))) : alertBox('ok', L('주요 위험 조항이 발견되지 않았습니다.', 'No major risk clauses found.')), alertBox('warn', d.disclaimer));
  }
  if (a.type === 'report') {
    return h('div.stack-sm', md(d.markdown), h('div.row', h('button.btn.btn-sm', { onclick: () => download(`${a.title}.md`, d.markdown, 'text/markdown;charset=utf-8') }, ic('download'), 'Markdown'), h('button.btn.btn-sm', { onclick: () => copyText(d.markdown) }, ic('copy'), L('복사', 'Copy')), h('button.btn.btn-sm', { onclick: () => window.print() }, ic('file'), L('인쇄/PDF', 'Print / PDF')), h('a.btn.btn-sm.btn-outline', { href: '#/mykotra/documents' }, L('생성 문서함', 'My documents'))));
  }
  return h('pre', JSON.stringify(a, null, 2));
}
function downloadRow(a, rows, head) { const csv = '﻿' + [head, ...rows].map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n'); return h('div.row', { style: 'gap:6px' }, h('button.btn.btn-ghost.btn-sm', { onclick: () => download(`${a.type}.csv`, csv, 'text/csv;charset=utf-8') }, ic('download'), L('CSV(엑셀) 내보내기', 'Export CSV (Excel)')), h('button.btn.btn-ghost.btn-sm', { onclick: () => copyText(rows.map((r) => r.join('\t')).join('\n')) }, ic('copy'), L('표 복사', 'Copy table'))); }

// ---------- page ----------
export async function assistant({ query }) {
  const user = store.user; const locale = store.locale;
  let sessionId = query.session || null; let busy = false; let attachments = []; let currentArtifact = null; let showArtifact = true;
  const state = { sessions: [] };
  const chatInner = h('div.chat-inner'); const scroll = h('div.chat-scroll', { 'aria-live': 'polite', 'aria-label': L('대화', 'Conversation') }, chatInner);
  const artBody = h('div.artifact-b'); const artPanel = h('aside.artifact', { 'aria-label': L('결과물 패널', 'Artifact panel') }, h('div.artifact-h', ic('layers'), h('b', L('결과물 (Artifact)', 'Artifact')), h('span', { style: 'flex:1' }), h('button.btn.btn-ghost.btn-sm', { onclick: () => { showArtifact = false; layout(); }, 'aria-label': L('닫기', 'Close') }, ic('close'))), artBody);
  const list = h('div.list'); const side = h('aside.asst-side', { 'aria-label': L('대화 목록', 'Conversations') });
  const root = h('div.asst');
  const ctx = {
    send: (text) => send(text),
    runAction: async (a) => { try { await runAction(a); } catch (e) { toast(errMsg(e), 'err', 6000); } },
  };
  function layout() { root.classList.toggle('no-art', !currentArtifact || !showArtifact); artPanel.classList.toggle('hide', !currentArtifact || !showArtifact); }
  function setArtifact(a) { currentArtifact = a; showArtifact = !!a; clear(artBody).append(artifactView(a, ctx)); layout(); }

  async function runAction(a) {
    const lang = store.locale;
    if (a.type === 'open_application') return navigate(`/mykotra/applications/${a.application_id}`);
    if (a.type === 'open_approval') return openApproval(a.approval_id, { onDone: () => toast(L('처리되었습니다.', 'Done.'), 'ok') });
    if (a.type === 'create_report') return send(L('이 내용으로 시장진출 보고서를 만들어줘', 'Create a market-entry report from this'));
    if (!user) { toast(L('로그인 후 사용할 수 있는 기능입니다.', 'Please log in to use this action.'), 'err'); return navigate('/login?next=' + encodeURIComponent('/assistant')); }
    const r = await POST('/api/ai/action', { ...a, lang });
    if (r.type === 'application') { setArtifact({ type: 'application', title: L('사업 신청 초안', 'Application draft'), data: { application_id: r.application.id, program_id: r.application.program_id, program_title: r.application.program_id, status: r.application.status, form: r.application.form, checklist: r.application.checklist, missing: r.missing } }); toast(L('신청 초안을 생성했습니다.', 'Draft created.'), 'ok'); }
    else if (r.type === 'email') setArtifact({ type: 'email', title: L('이메일 초안', 'Email draft'), data: { subject: r.subject, body: r.body, to: r.to, buyer: r.buyer } });
    else if (r.type === 'approval') await openApproval(r.approval_id, { onDone: () => refreshSessions() });
    else if (r.type === 'validation') toast(L('제출 전 보완이 필요합니다: ', 'Complete first: ') + (r.missing || []).join(', '), 'err', 7000);
    else if (r.type === 'saved') toast(L('저장했습니다.', 'Saved.'), 'ok');
    else if (r.type === 'consultation') toast(L(`전문가 상담이 접수되었습니다 (${r.consultation_id}). 분류: ${r.classification.category}`, `Consultation registered (${r.consultation_id}) — ${r.classification.category}`), 'ok', 7000);
  }

  function userBubble(text, atts) { return h('div.msg.u', h('div.av', (user && user.name || 'Me').slice(0, 1)), h('div.bubble', text, atts && atts.length > 0 && h('div.xs', { style: 'margin-top:6px;opacity:.85' }, ic('clip'), ' ', atts.map((a) => a.name).join(', ')))); }
  function aiShell() { return h('div.msg.a', h('div.av', 'AI'), h('div.bubble')); }
  const scrollDown = () => { scroll.scrollTop = scroll.scrollHeight; };
  function welcome() {
    const sug = [[L('베트남에 화장품을 수출하려는데 시장성, 인증, 바이어, 지원사업을 한 번에 알려줘', 'I want to export cosmetics to Vietnam — tell me the market, certification, buyers and support programs at once'), 'market'], ...Object.entries(AGENT_PROMPTS).filter(([k]) => k !== 'strategy' && k !== 'market').slice(0, 5).map(([k, v]) => [L(...v), k])];
    return h('div.stack-lg', { style: 'padding:24px 0' }, h('div.center.stack-sm', h('div', { style: 'width:64px;height:64px;margin:0 auto;border-radius:20px;background:var(--c-primary);color:#fff;display:flex;align-items:center;justify-content:center;font-size:30px' }, ic('ai')), h('h1', { style: 'margin:0' }, L('수출 목표를 말씀하세요', 'Tell me your export goal')), h('p.muted', L('시장 탐색부터 바이어·지원사업·상담·실행 준비까지 함께합니다. 모든 답변에는 출처가 붙고, 근거가 없으면 답변을 유보합니다.', 'From market exploration to buyers, programs, consulting and execution. Every answer cites sources; with no evidence, I abstain.'))),
      h('div.starter', sug.map(([t]) => h('button', { onclick: () => send(t) }, t))), !user && alertBox('info', L('로그인하면 기업 프로필 기반 맞춤 추천, 대화 저장, 신청 초안 등 모든 기능을 사용할 수 있습니다. 비로그인 상태에서는 공개 자료 검색만 가능합니다.', 'Log in for profile-based recommendations, saved chats and application drafts. Anonymous mode searches public material only.')), h('div.row', { style: 'justify-content:center' }, h('span.badge.b-info', L('HITL 승인', 'HITL approval')), h('span.badge.b-info', L('출처 표시', 'Citations')), h('span.badge.b-info', L('개인정보 필터', 'PII filter')), h('span.badge.b-info', `AI: ${store.config?.llm?.provenance === 'LIVE' ? 'LIVE' : 'LOCAL'}`)));
  }

  async function send(text, opts = {}) {
    text = String(text || '').trim(); if (!text || busy) return;
    busy = true; sendBtn.disabled = true;
    if (chatInner.firstChild && chatInner.firstChild.classList && !chatInner.querySelector('.msg')) clear(chatInner);
    const atts = attachments; attachments = []; drawAttach();
    chatInner.append(userBubble(text, atts));
    const shell = aiShell(); const bub = $('.bubble', shell);
    const trace = h('div.run-trace', { role: 'status' }, h('div.st.live', h('span.d'), L('질문을 분석하고 있습니다…', 'Analysing your question…'))); const typing = h('div.typing'); bub.append(trace, typing);
    chatInner.append(shell); scrollDown();
    const slow = setTimeout(() => toast(L('답변 생성에 3초 이상 걸릴 수 있습니다.', 'This answer may take more than 3 seconds.'), 'slow', 3000), 3000);
    let final = null;
    try {
      await streamChat({ message: text, locale: store.locale, session_id: sessionId, attachments: atts.map((a) => ({ name: a.name, text: a.text })) }, {
        step: (s) => { trace.querySelectorAll('.st.live').forEach((x) => x.classList.remove('live')); trace.append(h('div.st.live', h('span.d'), ic(STEP_ICON[s.kind] || 'gear'), s.label, s.latency_ms != null && h('span.xs.muted', ` ${s.latency_ms}ms`), s.status && s.status !== 'OK' && h('span.badge', { class: s.status === 'BLOCKED' ? 'badge b-danger' : 'badge b-warn' }, s.status), s.provenance && s.provenance !== 'INTERNAL' && provBadge(s.provenance))); scrollDown(); },
        token: (t) => { typing.textContent += t.text; scrollDown(); },
        final: (f) => { final = f; }, error: (e) => { throw new ApiError(500, e.code, e.message); },
      });
    } catch (e) {
      clearTimeout(slow); busy = false; sendBtn.disabled = false; shell.remove();
      chatInner.append(h('div.msg.a', h('div.av', 'AI'), h('div.bubble', h('div.alert.danger', ic('alert'), h('div', h('b', e.code === 'AI_RATE_LIMITED' || e.code === 'AI_REPEAT_BLOCKED' ? L('질의가 제한되었습니다', 'Query limited') : L('답변을 가져오지 못했습니다', 'Could not get an answer')), h('div', errMsg(e)), h('button.btn.btn-sm.btn-outline', { style: 'margin-top:8px', onclick: () => { shell.remove(); send(text); } }, L('다시 시도', 'Retry')))))));
      scrollDown(); return;
    }
    clearTimeout(slow); busy = false; sendBtn.disabled = false;
    if (!final) { shell.remove(); return; }
    sessionId = final.session_id || sessionId;
    typing.remove(); const tr = trace; tr.replaceChildren(h('details', h('summary.small', { style: 'cursor:pointer' }, ic('route'), ' ', L(`처리 과정 보기 (${tr.querySelectorAll('.st').length}단계)`, `Show processing steps`), ' ', h('span.xs.muted', `${final.latency_ms}ms`)), ...[...tr.querySelectorAll('.st')].map((x) => x.cloneNode(true)))); [...tr.querySelectorAll('.st')].forEach((x) => x.classList.remove('live'));
    bub.append(answerCard(final, ctx)); if (final.artifact) setArtifact(final.artifact);
    scrollDown(); refreshSessions();
  }

  // ----- composer
  const ta = h('textarea', { rows: 1, placeholder: L('예: 베트남에 기능성 화장품을 수출하고 싶은데 무엇부터 해야 하나요?  (Enter 전송 · Shift+Enter 줄바꿈)', 'e.g. I want to export functional cosmetics to Vietnam — where do I start?  (Enter to send)'), 'aria-label': L('질문 입력', 'Message'), maxlength: '4000', onkeydown: (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); const v = ta.value; ta.value = ''; ta.style.height = ''; send(v); } }, oninput: () => { ta.style.height = 'auto'; ta.style.height = Math.min(160, ta.scrollHeight) + 'px'; counter.textContent = `${ta.value.length}/4000`; } });
  const counter = h('span.xs.muted', '0/4000'); const attWrap = h('div.row', { style: 'gap:6px;margin-bottom:6px' });
  const drawAttach = () => attWrap.replaceChildren(...attachments.map((a, i) => h('span.badge.b-info', ic('clip'), ' ', a.name, h('button', { 'aria-label': 'remove', style: 'border:0;background:none;cursor:pointer;margin-left:4px', onclick: () => { attachments.splice(i, 1); drawAttach(); } }, '×'))));
  const fileIn = h('input', { type: 'file', accept: '.txt,.csv,.md,.json', multiple: true, class: 'hide', onchange: async (e) => { for (const f of e.target.files) { if (f.size > 200 * 1024) { toast(L(`${f.name}: 200KB를 초과합니다.`, `${f.name}: exceeds 200KB`), 'err'); continue; } try { attachments.push({ name: f.name, text: await f.text() }); } catch { toast(L(`${f.name}: 파일을 읽지 못했습니다 (FILE_PARSE_FAILED).`, `${f.name}: could not read file (FILE_PARSE_FAILED).`), 'err'); } } e.target.value = ''; drawAttach(); } });
  let rec = null; const micBtn = h('button.icon-btn', { 'aria-label': L('음성 입력', 'Voice input'), title: L('음성 입력 (브라우저 음성인식)', 'Voice input (browser speech recognition)'), onclick: () => { const SR = window.SpeechRecognition || window.webkitSpeechRecognition; if (!SR) { toast(L('이 브라우저는 음성 입력을 지원하지 않습니다.', 'Voice input is not supported in this browser.'), 'err'); return; } if (rec) { rec.stop(); return; } rec = new SR(); rec.lang = store.locale === 'en' ? 'en-US' : 'ko-KR'; rec.interimResults = true; rec.onresult = (ev) => { ta.value = [...ev.results].map((r) => r[0].transcript).join(''); }; rec.onend = () => { rec = null; micBtn.style.color = ''; }; rec.onerror = () => { rec = null; micBtn.style.color = ''; toast(L('음성 인식에 실패했습니다.', 'Speech recognition failed.'), 'err'); }; micBtn.style.color = 'var(--c-red)'; rec.start(); } }, ic('mic'));
  const promptBtn = h('button.icon-btn', { 'aria-label': L('프롬프트 라이브러리', 'Prompt library'), title: L('프롬프트 라이브러리', 'Prompt library'), onclick: () => promptModal() }, ic('book'));
  const sendBtn = h('button.btn.btn-primary', { 'aria-label': L('전송', 'Send'), onclick: () => { const v = ta.value; ta.value = ''; ta.style.height = ''; send(v); } }, ic('send'), h('span.hide-m', L('전송', 'Send')));
  const composer = h('div.composer', h('div.composer-in', attWrap, h('div.composer-box', h('button.icon-btn', { 'aria-label': L('파일 첨부 (txt·csv·md·json)', 'Attach file (txt, csv, md, json)'), title: L('파일 첨부 (txt·csv·md·json)', 'Attach (txt, csv, md, json)'), onclick: () => fileIn.click() }, ic('clip')), fileIn, ta, micBtn, promptBtn, sendBtn), h('div.row.row-between', { style: 'margin-top:4px' }, h('span.xs.muted', L('개인정보(주민번호·카드번호)는 입력하지 마세요. 답변은 참고용이며 중요한 실행은 승인 단계를 거칩니다.', 'Do not enter personal identifiers. Answers are advisory; important actions require approval.')), counter)));
  async function promptModal() {
    const r = user ? await GET('/api/prompts') : { items: [] }; const body = h('div.stack-sm');
    const draw = (items) => body.replaceChildren(...items.map((p) => h('div.card', h('div.card-b.row.row-between', { style: 'padding:10px 14px' }, h('div.grow', h('b.small', p.title), h('div.xs.muted', p.body.slice(0, 90))), h('div.row', { style: 'gap:4px' }, h('button.btn.btn-sm.btn-primary', { onclick: () => { ta.value = p.body.replace(/\{\{([^}]+)\}\}/g, '$1'); ta.focus(); box.close(); if (user) POST(`/api/prompts/${p.id}/use`).catch(() => {}); } }, L('사용', 'Use')), p.user_id && h('button.btn.btn-sm.btn-ghost', { 'aria-label': 'delete', onclick: act(async () => { await DEL(`/api/prompts/${p.id}`); const rr = await GET('/api/prompts'); draw(rr.items); }) }, ic('trash')))))));
    draw(r.items); const nt = h('input', { type: 'text', placeholder: L('저장할 프롬프트 제목', 'Title to save') });
    const box = modal({ title: L('프롬프트 라이브러리', 'Prompt library'), size: 'wide', body: h('div.stack', body, user && h('div.row', h('div.grow', nt), h('button.btn.btn-outline', { onclick: act(async () => { if (!ta.value.trim() || !nt.value.trim()) throw new Error(L('입력창에 프롬프트를 작성하고 제목을 입력하세요.', 'Write a prompt in the box and enter a title.')); await POST('/api/prompts', { title: nt.value, body: ta.value }); const rr = await GET('/api/prompts'); draw(rr.items); nt.value = ''; toast(L('저장했습니다.', 'Saved.'), 'ok'); }) }, ic('plus'), L('현재 입력 저장', 'Save current input'))), !user && alertBox('info', L('로그인 후 저장할 수 있습니다.', 'Log in to save prompts.'))) });
  }

  // ----- sessions
  async function refreshSessions(q) {
    if (!user) return;
    const r = await GET('/api/ai/sessions' + (q ? '?q=' + encodeURIComponent(q) : ''), { quiet: true }); state.sessions = r.items;
    list.replaceChildren(...(r.items.length ? r.items.map((s) => h('div.row', { style: 'gap:0;flex-wrap:nowrap' }, h('button.conv' + (s.id === sessionId ? '.on' : ''), { onclick: () => openSession(s.id) }, s.starred ? ic('star', { style: 'color:#f5a623;display:inline-flex' }) : ic('ai'), h('span.tt', s.title), h('span.xs.muted', s.n || '')), h('button.icon-btn', { style: 'width:32px;height:32px', 'aria-label': L('즐겨찾기', 'Star'), 'aria-pressed': String(!!s.starred), onclick: act(async () => { await PATCH(`/api/ai/sessions/${s.id}`, { starred: !s.starred }); refreshSessions(); }) }, ic('star')), h('button.icon-btn', { style: 'width:32px;height:32px', 'aria-label': L('삭제', 'Delete'), onclick: act(async () => { if (!(await confirmDialog({ title: L('대화 삭제', 'Delete chat'), message: L('이 대화를 삭제할까요? 되돌릴 수 없습니다.', 'Delete this chat? This cannot be undone.'), danger: true, confirm: L('삭제', 'Delete') }))) return; await DEL(`/api/ai/sessions/${s.id}`); if (s.id === sessionId) newChat(); else refreshSessions(); }) }, ic('trash')))) : [h('p.small.muted', { style: 'padding:12px' }, L('저장된 대화가 없습니다.', 'No saved chats.'))]));
  }
  async function openSession(id) {
    const r = await GET(`/api/ai/sessions/${id}`); sessionId = id; clear(chatInner); setArtifact(null); let lastArt = null;
    r.messages.forEach((m) => { if (m.role === 'user') chatInner.append(userBubble(m.content)); else { const p = m.payload || {}; const shell = aiShell(); $('.bubble', shell).append(answerCard({ answer: m.content, sections: p.sections, sources: p.sources, suggested_actions: p.suggested_actions, tool_runs: p.tool_runs, abstained: p.abstained, blocked: p.blocked, follow_ups: [], trace_id: m.trace_id, message_id: m.id, rating: m.rating }, ctx)); chatInner.append(shell); if (p.artifact) lastArt = p.artifact; } });
    if (lastArt) setArtifact(lastArt); refreshSessions(); side.classList.remove('open'); setTimeout(scrollDown, 30);
  }
  function newChat() { sessionId = null; clear(chatInner).append(welcome()); setArtifact(null); refreshSessions(); side.classList.remove('open'); ta.focus(); }
  const search = h('input', { type: 'search', placeholder: L('대화 검색', 'Search chats'), 'aria-label': L('대화 검색', 'Search chats'), oninput: debounce_((e) => refreshSessions(e.target.value)) });
  function debounce_(fn) { let t; return (e) => { clearTimeout(t); t = setTimeout(() => fn(e), 250); }; }
  side.append(h('div', { style: 'padding:12px' }, h('button.btn.btn-primary', { style: 'width:100%', onclick: newChat }, ic('plus'), L('새 대화', 'New chat')), h('div', { style: 'margin-top:8px' }, search)), h('div.xs.muted', { style: 'padding:0 14px' }, store.company ? L(`프로젝트: ${store.company.name}`, `Project: ${store.company.name_en || store.company.name}`) : L('대화 목록', 'Conversations')), list, h('div', { style: 'padding:10px;border-top:var(--b-1)' }, h('div.xs.muted', L('내보내기: ', 'Export: '), ...['txt', 'json', 'html'].map((f) => h('a', { href: '#', style: 'margin-right:8px', onclick: (e) => { e.preventDefault(); if (!sessionId) return toast(L('내보낼 대화가 없습니다.', 'No chat to export.'), 'err'); window.open(`/api/ai/sessions/${sessionId}/export?fmt=${f}`, '_blank'); } }, f.toUpperCase())), h('button.btn.btn-ghost.btn-sm', { onclick: act(async () => { if (!sessionId) return toast(L('요약할 대화가 없습니다.', 'No chat to summarise.'), 'err'); const r = await POST(`/api/ai/sessions/${sessionId}/summarize`); modal({ title: L('여기까지 요약', 'Summary so far'), size: 'narrow', body: h('pre', { style: 'white-space:pre-wrap;font-family:inherit' }, r.summary) }); }) }, L('여기까지 요약', 'Summarise')))));
  const mobileBar = h('div.row.row-between', { style: 'padding:8px 12px;border-bottom:var(--b-1)' }, h('button.btn.btn-sm', { onclick: () => side.classList.toggle('open') }, ic('list'), L('대화 목록', 'Chats')), h('button.btn.btn-sm', { onclick: () => { showArtifact = !showArtifact; layout(); } }, ic('layers'), L('결과물', 'Artifact')));
  const chat = h('section.chat', { 'aria-label': L('AI 수출비서 대화', 'AI Export Assistant chat') }, scroll, composer);
  root.append(side, chat, artPanel);
  if (matchMedia('(max-width:900px)').matches) chat.prepend(mobileBar);
  clear(chatInner).append(welcome()); setArtifact(null); layout();
  if (sessionId) await openSession(sessionId); else await refreshSessions();
  const pre = query.q || (query.agent && AGENT_PROMPTS[query.agent] ? L(...AGENT_PROMPTS[query.agent]) : null);
  if (pre) { history.replaceState(null, '', '#/assistant'); setTimeout(() => send(pre), 60); }
  return root;
}
export { answerCard, artifactView };
