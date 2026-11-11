import { h, L, lf, store, GET, POST, act, ic, navigate, toast, pageHead, alertBox, field, input, select, empty, noResult, RFP, debounce, statusBadge } from '../lib.js';
import { CH_LABEL, sectionHead } from './_shared.js';

export async function channels() {
  const chans = [
    ['AI 상담 (24시간)', 'AI consulting (24/7)', '출처가 붙은 즉시 답변. 근거가 없으면 전문가로 연결합니다.', 'Instant, cited answers; hands off to experts when evidence is thin.', '#/assistant', 'ai', true],
    ['온라인 수출·투자 상담', 'Online export / investment consulting', '상담 신청서를 접수하면 AI가 분류하고 수출전문위원이 답변합니다.', 'Submit a request; AI classifies it and an export specialist replies.', '#/consult/new', 'mail', true],
    ['대표전화 상담', 'Phone consulting', '수출전문위원 전화상담. 통화 내용은 STT·AI 요약 후 상담원이 확정합니다.', 'Specialist phone consulting; calls are transcribed, summarised and confirmed by the agent.', '#/consult/faq', 'phone', false],
    ['모바일 상담 (채팅)', 'Mobile chat', '모바일에서 채팅/챗봇으로 상담합니다.', 'Chat from your phone.', '#/assistant', 'chat', false],
    ['KOTRA 방문상담', 'In-person visit', '본사·지방지원본부 방문 상담을 예약합니다.', 'Book a visit at HQ or regional offices.', '#/consult/new?channel=VISIT', 'building', true],
    ['이동KOTRA', 'Mobile KOTRA', '지역 현장을 찾아가는 수출 상담.', 'On-site consulting in regional areas.', '#/programs/PG-024', 'pin', true],
    ['글로벌 역량진단 (GCL)', 'Global competency diagnosis', '수출 역량을 진단하고 단계별 사업을 안내합니다.', 'Diagnose export capability and get stage-based guidance.', '#/programs/PG-009', 'award', true],
    ['애로·민원 접수', 'Report a difficulty / complaint', '통상애로, 기업규제 애로신고, 칭찬/불만/제안, 민원.', 'Trade barriers, regulation reports, compliments / complaints / suggestions.', '#/consult/new?channel=GRIEVANCE', 'flag', true],
  ];
  const cards = chans.map((c) => h('a.card.card-link', { href: c[4] }, h('div.card-b.stack-sm',
    h('span.badge.b-primary', { style: 'width:42px;height:42px;border-radius:12px;justify-content:center;font-size:20px' }, ic(c[5] === 'chat' ? 'users' : c[5])),
    h('b', { style: 'font-size:1.0625rem' }, L(c[0], c[1])), h('span.small.muted', L(c[2], c[3])),
    c[6] ? null : h('span.badge.b-mock', L('연계 Mock/안내', 'Mock / info only')))));
  const flow = ['접수', 'AI 분류', '담당 배정', '답변·처리', '상담일지 확정', '후속 사업 추천'].map((k, i) => h('div.card', { style: 'flex:1;min-width:140px;text-align:center' }, h('div.card-b', { style: 'padding:12px' }, h('div.stat-big', { style: 'font-size:1.25rem' }, i + 1), h('b.small', L(k, ['Intake', 'AI classify', 'Assign', 'Respond', 'Confirm journal', 'Follow-up'][i])))));
  return h('div', pageHead(L('문의·상담', 'Consulting & help'), L('AI가 이해하고 전문가와 연결합니다. 상담 내용은 사라지지 않고 후속 지원으로 이어집니다.', 'AI understands your issue and connects you to experts; the history carries into follow-up support.'), [{ label: L('상담·애로', 'Consulting') }], RFP('SFR-005', 'SFR-013', 'SFR-017')),
    h('div.container.section.stack-lg', h('div.grid.g4', cards), sectionHead(L('상담 처리 흐름', 'How consulting works')), h('div.row', { style: 'align-items:stretch;gap:8px' }, flow), alertBox('info', L('전화·방문 상담은 데모에서 상담원 화면(Single View)과 STT·AI 요약으로 시연합니다. 실제 CTI/IVR 연계는 Mock입니다.', 'Phone and visit consulting are demonstrated through the agent Single View and STT / AI summary; CTI/IVR integration is mocked.'))));
}

export async function newConsult({ query }) {
  const ch0 = ['ONLINE', 'GRIEVANCE', 'REGULATION_REPORT', 'VISIT'].includes(query.channel) ? query.channel : 'ONLINE';
  const title = input({ maxlength: '120', placeholder: L('예: 베트남 화장품 등록 절차 문의', 'e.g. Vietnam cosmetics registration inquiry') });
  const body = h('textarea', { style: 'min-height:160px', maxlength: '4000', placeholder: L('문의 내용을 구체적으로 적어 주세요 (품목, 국가, 상황). 주민번호·카드번호 등 개인정보는 입력하지 마세요.', 'Describe your inquiry (item, country, situation). Do not enter personal identifiers.') });
  const chSel = select(Object.entries(CH_LABEL).filter(([k]) => ['ONLINE', 'GRIEVANCE', 'REGULATION_REPORT', 'VISIT'].includes(k)).map(([k, v]) => ({ value: k, label: L(...v) })), ch0);
  const agree = h('input', { type: 'checkbox' }); const preview = h('div'); const errs = {}; const res = h('div');
  const classify = debounce(async () => { if (body.value.length < 10) { preview.replaceChildren(); return; } try { const r = await POST('/api/consultations/classify-preview', { text: title.value + ' ' + body.value }, { quiet: true }); const c = r.classification; preview.replaceChildren(h('div.callout.small', ic('ai'), ' ', h('b', L('AI 분류 미리보기: ', 'AI classification preview: ')), `${c.category} → ${c.suggested_team} (${Math.round(c.confidence * 100)}%)`)); } catch { /* optional */ } }, 500);
  body.addEventListener('input', classify); title.addEventListener('input', classify);
  const submit = act(async () => {
    res.replaceChildren(); const problems = [];
    if (!title.value.trim()) problems.push(L('제목을 입력하세요.', 'Enter a title.'));
    if (body.value.trim().length < 10) problems.push(L('문의 내용을 10자 이상 입력하세요.', 'Enter at least 10 characters.'));
    if (!agree.checked) problems.push(L('개인정보 수집·이용에 동의해 주세요.', 'Please consent to personal-data processing.'));
    if (problems.length) { res.append(alertBox('danger', h('ul', { style: 'margin:0;padding-left:18px' }, problems.map((p) => h('li', p))))); return; }
    const r = await POST('/api/consultations', { title: title.value, body: body.value, channel: chSel.value });
    res.append(alertBox('ok', h('b', L('상담이 접수되었습니다.', 'Your request has been received.')), h('div', `${L('접수번호', 'Reference')}: ${r.id}`), h('div', `${L('AI 분류', 'AI classification')}: ${r.classification.category} → ${r.classification.suggested_team}`), h('a.btn.btn-sm.btn-primary', { style: 'margin-top:8px', href: `#/mykotra/consults/${r.id}` }, L('진행 현황 보기', 'Track progress'))));
    title.value = ''; body.value = ''; agree.checked = false; preview.replaceChildren();
  });
  return h('div', pageHead(L('전문가 상담 신청', 'Request expert consulting'), L('접수 즉시 AI가 문의 유형을 분류하고 담당 조직을 제안합니다.', 'AI classifies your inquiry on receipt and proposes the responsible team.'), [{ label: L('상담·애로', 'Consulting'), href: '#/consult' }, { label: L('신청', 'Request') }], RFP('SFR-005', 'SFR-017')),
    h('div.container.section', h('div.layout-side', { style: 'grid-template-columns:minmax(0,1fr) 320px' }, h('form.card', { onsubmit: (e) => { e.preventDefault(); submit(); } }, h('div.card-b.stack', field(L('상담 유형', 'Type'), chSel), field(L('제목', 'Title'), title, { req: true }), field(L('문의 내용', 'Details'), body, { req: true }), preview, h('label.check', agree, h('span.small', L('상담 처리를 위한 개인정보 수집·이용에 동의합니다. (상담 요약 시 사업자번호·전화번호는 제외됩니다.)', 'I consent to personal-data processing for this inquiry. (Business numbers and phone numbers are excluded from summaries.)'))), res, h('button.btn.btn-primary.btn-lg', { type: 'submit' }, ic('send'), L('상담 신청', 'Submit')))),
      h('aside.stack', h('div.card', h('div.card-b.stack-sm', h('h3', L('먼저 AI에게 물어보세요', 'Try the AI first')), h('p.small.muted', L('단순 문의는 AI 수출비서가 출처와 함께 바로 답변합니다.', 'Simple questions get an instant cited answer.')), h('a.btn.btn-outline', { href: '#/assistant' }, ic('ai'), L('AI 수출비서 열기', 'Open AI assistant')))), h('div.card', h('div.card-b.stack-sm', h('h3', L('처리 단계', 'Process')), h('ol.small', { style: 'margin:0;padding-left:18px;display:grid;gap:4px' }, [L('접수', 'Received'), L('AI 분류', 'AI classified'), L('담당 배정', 'Assigned'), L('답변·처리', 'In progress'), L('답변 완료', 'Resolved')].map((t) => h('li', t)))))))));
}

export async function faq() {
  let qn = ''; const list = h('div.stack-sm'); const draw = async () => { const r = await GET('/api/faqs' + (qn ? '?q=' + encodeURIComponent(qn) : '')); list.replaceChildren(...(r.items.length ? r.items.map((f) => h('details.card', h('summary.card-b', { style: 'cursor:pointer;font-weight:600' }, h('span.badge', { style: 'margin-right:8px' }, f.category), L(f.q_ko, f.q_en)), h('div.card-b', { style: 'border-top:var(--b-2)' }, L(f.a_ko, f.a_en)))) : [noResult(() => { qn = ''; qi.value = ''; draw(); })])); }; await draw();
  const qi = input({ type: 'search', placeholder: L('질문 검색', 'Search FAQ'), 'aria-label': L('FAQ 검색', 'Search FAQ'), oninput: debounce((e) => { qn = e.target.value; draw(); }) });
  return h('div', pageHead('FAQ', L('자주 묻는 질문. 답을 못 찾으면 AI 수출비서나 전문가 상담을 이용하세요.', 'Frequently asked questions. Can\'t find an answer? Ask the AI or an expert.'), [{ label: L('상담·애로', 'Consulting'), href: '#/consult' }, { label: 'FAQ' }]),
    h('div.container.section.stack', qi, list, h('div.row', h('a.btn.btn-primary', { href: '#/assistant' }, ic('ai'), L('AI에게 질문', 'Ask AI')), h('a.btn', { href: '#/consult/new' }, ic('phone'), L('전문가 상담', 'Expert consulting')))));
}
