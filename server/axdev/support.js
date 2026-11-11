'use strict';
// 제안·입찰 지원(요구사항 답변 조견표·제출서류·질의응답·증빙팩) + 컨소시엄 참여기업(역할·RACI·인력/보안서약).
// 참여사·인력은 시연용 합성 데이터이며 실제 기업/개인이 아니다. 요구사항 답변은 RTM(ax_rtm)에서 계산한다.
const { q, nextId } = require('../db');
const U = require('../util');
const G = require('../gov');
const RTM = require('./rtm');
const REG = require('./registry');

const STANCE = {
  IMPLEMENTED: ['수용', 'Accept', 'MVP에서 구현·시연 가능', 'Implemented and demonstrable in the MVP'],
  MOCK: ['수용(연계 Mock)', 'Accept (mock integration)', '업무 흐름은 구현, 외부 시스템 연계는 Mock', 'Workflow implemented; external integration mocked'],
  PARTIAL: ['부분 수용', 'Partially accept', '핵심 흐름은 구현, 세부 범위는 본사업에서 보완', 'Core flow implemented; remaining scope in the full programme'],
  DESIGN_ONLY: ['수용(설계 제시)', 'Accept (design only)', '아키텍처·어댑터 설계로 제시', 'Presented as architecture/adapter design'],
  OUT_OF_MVP: ['본사업 제안', 'Full-programme proposal', 'MVP 범위 외 — 본사업 수행계획에서 제안', 'Outside the MVP — proposed in the full-programme plan'],
};
function answers(filters = {}) {
  return RTM.rows(filters).map((r) => {
    const s = STANCE[r.impl_status] || STANCE.OUT_OF_MVP;
    const screens = r.screen_titles.map((x) => x.ko).filter(Boolean);
    return {
      req_id: r.req_id, category: r.category, name: r.name, impl_status: r.impl_status, demo_status: r.demo_status, verify_status: r.verify_status,
      stance_ko: s[0], stance_en: s[1], screens: r.screen_titles, owner: r.owner,
      answer_ko: `${s[0]} — ${s[2]}.${r.evidence && r.evidence !== '-' ? ` 근거: ${r.evidence}.` : ''}${r.notes ? ` 한계/비고: ${r.notes}.` : ''}${screens.length ? ` 관련 화면: ${screens.join(', ')}.` : ''}`,
      answer_en: `${s[1]} — ${s[3]}.${r.evidence && r.evidence !== '-' ? ` Evidence (KO): ${r.evidence}.` : ''}${r.notes ? ` Limits (KO): ${r.notes}.` : ''}`,
      evidence: r.evidence, notes: r.notes, tests: r.tests,
    };
  });
}
const csvCell = (v) => { let s = String(v ?? '').replace(/\r?\n/g, ' '); if (/^[=+\-@\t]/.test(s)) s = "'" + s; return /[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
function answersCsv() {
  const head = ['요구사항ID', '분류', '요구사항명', '수용여부', '구현상태', '시연상태', '검증상태', '관련 화면', '증빙', '한계/비고', '연결 테스트'];
  const lines = answers().map((a) => [a.req_id, a.category, a.name, a.stance_ko, a.impl_status, a.demo_status, a.verify_status, a.screens.map((s) => s.ko).join(' / '), a.evidence, a.notes, (a.tests || []).join(' / ')].map(csvCell).join(','));
  return '﻿' + [head.join(','), ...lines].join('\r\n');
}
function evidencePack() {
  const rows = answers(); const sum = RTM.summary(); const rel = q.all('SELECT * FROM ax_releases ORDER BY at DESC LIMIT 20');
  const md = [`# 근거·증빙팩 (자동 생성 ${U.iso().slice(0, 10)})`, '', `- 요구사항 ${sum.total}건 · MVP 구현율 ${sum.mvp_coverage_pct}% · 완전 구현 ${sum.by.IMPLEMENTED}건 · 현업 검증 ${sum.verified}건`, `- 구현 상태: ${Object.entries(sum.by).map(([k, v]) => `${k} ${v}`).join(' · ')}`, '', '## 요구사항별 증빙', '', '| ID | 요구사항 | 상태 | 증빙 | 연결 화면 | 테스트 |', '|---|---|---|---|---|---|',
    ...rows.map((a) => `| ${a.req_id} | ${a.name} | ${a.impl_status} | ${String(a.evidence || '-').replace(/\|/g, '/')} | ${a.screens.map((s) => s.route || s.key).join(', ') || '-'} | ${(a.tests || []).join(', ') || '-'} |`),
    '', '## 최근 반영 이력(현업 확인 완료)', '', ...(rel.length ? rel.map((r) => `- ${r.ver} · ${r.title}${r.is_synthetic ? ' (시연 샘플)' : ''}`) : ['- 아직 없음'])].join('\n');
  return { summary: sum, count: rows.length, markdown: md };
}

// ── 제출서류 체크리스트
const CHECK_STATES = ['TODO', 'IN_PROGRESS', 'DONE', 'N/A'];
const listChecklist = () => q.all('SELECT * FROM ax_checklist ORDER BY id');
function patchChecklist(ctx, id, b) {
  const cur = q.get('SELECT * FROM ax_checklist WHERE id=?', id); if (!cur) throw U.notFound('Checklist item not found');
  const patch = { updated_at: U.iso() };
  if (b.status !== undefined) { if (!CHECK_STATES.includes(b.status)) throw U.bad('status 값이 올바르지 않습니다', 'VALIDATION'); patch.status = b.status; }
  if (b.owner !== undefined) patch.owner = String(b.owner).slice(0, 60); if (b.note !== undefined) patch.note = String(b.note).slice(0, 400); if (b.due !== undefined) patch.due = String(b.due).slice(0, 10);
  q.update('ax_checklist', id, patch); G.audit(ctx, 'ax.checklist.update', 'ax_checklist', id, { from: cur.status, to: patch.status });
  return q.get('SELECT * FROM ax_checklist WHERE id=?', id);
}

// ── 고객 질의·답변 관리(접수→배정→작성→검토→제출)
const listQna = () => q.all('SELECT * FROM ax_qna ORDER BY created_at DESC');
function createQna(ctx, b) {
  const question = String(b.question || '').trim().slice(0, 1500); if (question.length < 4) throw U.bad('질의 내용을 입력하세요 / Enter the question', 'VALIDATION');
  const rfp = b.rfp_id ? String(b.rfp_id).toUpperCase().slice(0, 12) : null; if (rfp && !q.get('SELECT 1 x FROM ax_rtm WHERE req_id=?', rfp)) throw U.bad('RFP ID를 찾을 수 없습니다', 'UNKNOWN_RFP');
  const id = nextId('QA', 4); q.insert('ax_qna', { id, question: U.maskPII(question), rfp_id: rfp, asked_by: ctx.user.id, status: 'RECEIVED', assignee: null, answer: null, created_at: U.iso(), updated_at: U.iso() });
  G.audit(ctx, 'ax.qna.created', 'ax_qna', id, { rfp }); return q.get('SELECT * FROM ax_qna WHERE id=?', id);
}
function patchQna(ctx, id, b) {
  const cur = q.get('SELECT * FROM ax_qna WHERE id=?', id); if (!cur) throw U.notFound('Q&A not found');
  const patch = {};
  if (b.assignee !== undefined) patch.assignee = String(b.assignee).slice(0, 60);
  if (b.answer !== undefined) patch.answer = U.maskPII(String(b.answer).slice(0, 4000));
  if (Object.keys(patch).length) q.update('ax_qna', id, { ...patch, updated_at: U.iso() });
  if (b.status && b.status !== cur.status) {
    if (['DRAFTED', 'REVIEWED', 'SUBMITTED'].includes(b.status) && !(patch.answer ?? cur.answer)) throw U.bad('답변을 먼저 작성하세요 / Write an answer first', 'VALIDATION');
    if (b.status === 'ASSIGNED' && !(patch.assignee ?? cur.assignee)) throw U.bad('담당자를 지정하세요 / Assign an owner first', 'VALIDATION');
    if (b.status === 'SUBMITTED' && b.confirm !== true) throw U.bad('제출에는 confirm:true가 필요합니다(대외 제출)', 'CONFIRM_REQUIRED');
    G.transition(ctx, 'ax_qna', id, b.status, String(b.note || '').slice(0, 200));
  }
  return q.get('SELECT * FROM ax_qna WHERE id=?', id);
}

// ── 컨소시엄
const DELIVERABLES = [['D01', '제안서 본문', 'Proposal body'], ['D02', '요구사항 정의·RTM', 'Requirements & RTM'], ['D03', '화면 설계서', 'Screen design'], ['D04', '데이터·API 설계서', 'Data & API design'], ['D05', 'AI/RAG 설계·평가서', 'AI/RAG design & evaluation'], ['D06', '테스트 결과서', 'Test report'], ['D07', '보안·개인정보 점검서', 'Security & privacy review'], ['D08', '교육·인수인계 자료', 'Training & handover'], ['D09', '운영 매뉴얼', 'Operations manual']];
function consortium() {
  const members = q.all('SELECT * FROM ax_members ORDER BY lead DESC, id').map((m) => ({ ...m, modules: U.parse(m.modules, []) }));
  const staff = q.all('SELECT * FROM ax_staff ORDER BY member_id, id');
  const raci = q.all('SELECT * FROM ax_raci'); const grid = {};
  for (const r of raci) (grid[r.deliverable] = grid[r.deliverable] || {})[r.member_id] = r.code;
  const bad = DELIVERABLES.filter(([d]) => Object.values(grid[d] || {}).filter((c) => c === 'A').length !== 1).map(([d]) => d);
  return { members, staff, deliverables: DELIVERABLES.map(([id, ko, en]) => ({ id, ko, en })), raci: grid, raci_issues: bad, pledge: { signed: staff.filter((s) => s.pledge === 'SIGNED').length, total: staff.length } };
}
function setRaci(ctx, b) {
  const d = String(b.deliverable || ''); const m = String(b.member_id || ''); const code = String(b.code || '').toUpperCase();
  if (!DELIVERABLES.some(([x]) => x === d) || !q.get('SELECT 1 x FROM ax_members WHERE id=?', m)) throw U.bad('산출물 또는 참여사가 올바르지 않습니다', 'VALIDATION');
  if (!['R', 'A', 'C', 'I', ''].includes(code)) throw U.bad('RACI 코드는 R/A/C/I 중 하나입니다', 'VALIDATION');
  if (code === 'A' && q.get("SELECT 1 x FROM ax_raci WHERE deliverable=? AND code='A' AND member_id<>?", d, m)) throw U.conflict('산출물당 책임자(A)는 1곳이어야 합니다 / Only one Accountable per deliverable', 'RACI_ONE_ACCOUNTABLE');
  if (code === '') q.run('DELETE FROM ax_raci WHERE deliverable=? AND member_id=?', d, m);
  else q.run('INSERT INTO ax_raci(deliverable,member_id,code) VALUES(?,?,?) ON CONFLICT(deliverable,member_id) DO UPDATE SET code=excluded.code', d, m, code);
  G.audit(ctx, 'ax.raci.set', 'ax_raci', d, { member: m, code }); return consortium();
}
function setPledge(ctx, id, pledge) {
  if (!['SIGNED', 'PENDING', 'EXPIRED'].includes(pledge)) throw U.bad('pledge 값이 올바르지 않습니다', 'VALIDATION');
  if (!q.get('SELECT 1 x FROM ax_staff WHERE id=?', id)) throw U.notFound('Staff not found');
  q.update('ax_staff', id, { pledge, updated_at: U.iso() }); G.audit(ctx, 'ax.pledge.set', 'ax_staff', id, { pledge }); return consortium();
}

module.exports = { STANCE, answers, answersCsv, evidencePack, listChecklist, patchChecklist, CHECK_STATES, listQna, createQna, patchQna, consortium, setRaci, setPledge, DELIVERABLES };
