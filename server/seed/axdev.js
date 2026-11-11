'use strict';
// AX개발·AXOS 시연 시드. 모든 폐루프 기록은 is_synthetic=1(시연 샘플)이며 실제 코드 변경·실제 제안 사실을 의미하지 않는다.
const { q } = require('../db');
const U = require('../util');
const RTM = require('../axdev/rtm');
const LOOP = require('../axdev/loop');

const userCtx = (id) => ({ user: (() => { const { pw_hash, ...u } = q.get('SELECT * FROM users WHERE id=?', id); return u; })(), ip: 'seed' });
const WORKER = { user: { id: 'axos-worker', role: 'worker', name: 'AXOS Worker (demo)' }, ip: 'seed' };
const ago = (d, h = 9) => `${U.addDays(U.today(), -d)}T${String(h).padStart(2, '0')}:10:00.000Z`;

function backdate(fbId, woId, baseDaysAgo, spanDays) {
  const base = new Date(ago(baseDaysAgo)).getTime(); const step = (spanDays * 86400000) / 8;
  const stamp = (refType, id, t0) => q.all('SELECT id FROM ax_events WHERE ref_type=? AND ref_id=? ORDER BY id', refType, id).forEach((e, i) => q.run('UPDATE ax_events SET at=? WHERE id=?', new Date(t0 + i * step).toISOString(), e.id));
  q.run('UPDATE ax_feedback SET created_at=?, updated_at=? WHERE id=?', new Date(base).toISOString(), new Date(base + spanDays * 86400000).toISOString(), fbId);
  stamp('feedback', fbId, base);
  if (woId) {
    q.run('UPDATE ax_orders SET created_at=?, updated_at=?, claimed_at=CASE WHEN claimed_at IS NULL THEN NULL ELSE ? END, started_at=CASE WHEN started_at IS NULL THEN NULL ELSE ? END, finished_at=CASE WHEN finished_at IS NULL THEN NULL ELSE ? END, accepted_at=CASE WHEN accepted_at IS NULL THEN NULL ELSE ? END WHERE id=?',
      new Date(base + step).toISOString(), new Date(base + spanDays * 86400000).toISOString(), new Date(base + 2 * step).toISOString(), new Date(base + 2 * step).toISOString(), new Date(base + 5 * step).toISOString(), new Date(base + 7 * step).toISOString(), woId);
    stamp('order', woId, base + step);
    q.run('UPDATE ax_releases SET at=? WHERE order_id=?', new Date(base + 7 * step).toISOString(), woId);
  }
}

function seedAxdev() {
  RTM.rebuildRtm(null, 'seed baseline');
  const admin = userCtx('U-028'); const consultant = userCtx('U-021');
  const mk = (uid, b) => { const r = LOOP.createFeedback(userCtx(uid), b); q.run('UPDATE ax_feedback SET is_synthetic=1 WHERE id=?', r.id); return r.id; };
  const approve = (id, who = admin) => { const r = LOOP.review(who, id, { decision: 'APPROVE', confirm: true, risk_ack: true, note: '시연 샘플 승인' }); q.run('UPDATE ax_orders SET is_synthetic=1 WHERE id=?', r.order_id); return r.order_id; };
  const work = (wo, files, summary, tests = { cmd: 'npm test', total: 7, passed: 7, failed: 0 }) => { LOOP.orderAction(admin, wo, 'start', { risk_ack: true }); return LOOP.report(WORKER, wo, { worker: 'axos-demo', files, summary, tests }); };

  // 1) 완료(현업 확인 완료) — 시연 샘플
  const f1 = mk('U-001', { screen_key: 'programs.detail', kind: '개선', priority: 'P2', title: '신청 전 자격 점검 결과를 상세 화면 상단에 요약', as_is: '지원사업 상세에서 자격 요건을 스크롤하며 직접 대조해야 한다.', to_be: '기업 프로필 기준 충족/미충족 항목을 상단 요약 카드로 보여주고 미충족 사유를 링크로 안내한다.', benefit: '신청 포기율 감소, 담당자 문의 감소' });
  const w1 = approve(f1); work(w1, ['public/js/pages/programs.js', 'public/css/app.css'], '(시연 샘플) 상세 상단에 자격 요약 카드 추가 — 실제 코드 변경 없음.'); LOOP.accept(userCtx('U-001'), w1, { confirm: true, note: '확인했습니다' });
  backdate(f1, w1, 9, 4);
  // 2) 결과 보고됨(현업 확인 대기)
  const f2 = mk('U-021', { screen_key: 'staff.consult', kind: '기능추가', priority: 'P1', title: '상담 요약에 동일 고객의 재문의 이력 자동 연결', as_is: '같은 고객이 같은 주제로 다시 문의해도 이전 상담을 수동으로 찾아야 한다.', to_be: '상담 Single View 요약 영역에 최근 90일 내 동일 주제 상담 3건을 자동 링크하고, 요약 확정 시 연관 상담 ID를 기록한다.', benefit: '재문의 처리 시간 단축, 일관된 안내' });
  const w2 = approve(f2); work(w2, ['public/js/pages/staff.js', 'server/routes/staff.js', 'test/scenarios.test.js'], '(시연 샘플) 재문의 연결 영역 추가, 연관 상담 조회 API 확장.'); backdate(f2, w2, 3, 2);
  // 3) 개발중
  const f3 = mk('U-024', { screen_key: 'staff.research', kind: '개선', priority: 'P2', title: '보완 요청 시 이전 제출본과 변경 비교', as_is: '보완 제출 후 무엇이 바뀌었는지 담당자가 두 문서를 열어 비교한다.', to_be: '재제출본에서 변경된 문단을 하이라이트하는 비교 보기를 제공한다.', benefit: '검토 시간 단축' });
  const w3 = approve(f3); LOOP.orderAction(admin, w3, 'start', { risk_ack: true }); backdate(f3, w3, 2, 1);
  // 4) 개발 큐 대기
  const f4 = mk('U-002', { screen_key: 'mykotra', kind: '화면추가', priority: 'P3', title: '수출 진행 타임라인 인쇄/PDF 저장', as_is: 'Cockpit의 진행 현황을 외부 보고용으로 내보낼 수 없다.', to_be: 'Cockpit 진행 타임라인을 인쇄 친화 레이아웃으로 제공하고 PDF로 저장할 수 있다.', benefit: '내부 보고 자료 작성 시간 절감' });
  const w4 = approve(f4); backdate(f4, w4, 1, 1);
  // 5) 실패(테스트 실패 → 재큐 대기)
  const f5 = mk('U-005', { screen_key: 'consult.new', kind: '기능추가', priority: 'P2', title: '상담 신청 시 이전 상담 첨부 재사용', as_is: '추가 문의 때 같은 서류를 다시 올려야 한다.', to_be: '이전 상담에 올린 첨부를 선택해 재사용할 수 있다.', benefit: '입력 부담 감소' });
  const w5 = approve(f5); work(w5, ['public/js/pages/consult.js', 'server/routes/customer.js'], '(시연 샘플) 첨부 재사용 선택 UI 구현 시도.', { cmd: 'npm test', total: 7, passed: 6, failed: 1 }); backdate(f5, w5, 2, 1);
  // 6) 접수 / 보완요청 / 반려 / 중복
  const f6 = mk('U-016', { screen_key: 'events.detail', kind: '개선', priority: 'P2', title: '상담 시간표 기본 시간대를 내 현지 시간으로', as_is: '시간표가 행사 현지 시간 기준이라 환산이 필요하다.', to_be: '바이어 로그인 시 내 시간대를 기본 표시하고 행사 현지 시간은 보조로 병기한다.', benefit: '일정 착오 방지' }); backdate(f6, null, 1, 0);
  const f7 = mk('U-022', { screen_key: 'admin.matching', kind: '성능', priority: 'P2', title: '자동매칭 미리보기가 느림', as_is: '참가 기업이 많은 행사에서 미리보기 응답이 느려진다.', to_be: '미리보기 계산을 3초 이내로 줄인다.', benefit: '운영 효율' });
  LOOP.review(admin, f7, { decision: 'NEEDS_INFO', note: '행사 규모(참가 기업/바이어 수)와 재현 시각을 알려 주세요.' }); backdate(f7, null, 2, 1);
  mk('U-003', { screen_key: 'markets.stats', kind: '버그', priority: 'P2', title: '영문 전환 시 차트 단위가 한글로 표시', as_is: '영문 모드에서 무역통계 차트의 단위 표기가 한글로 남는다.', to_be: '영문 모드에서는 단위·범례를 영어로 표시한다.', benefit: '해외 사용자 이해도' });
  const f9 = mk('U-029', { screen_key: 'assistant', kind: '기능추가', priority: 'P3', title: '실시간 환율 기반 자동 견적', as_is: '견적 계산이 지원되지 않는다.', to_be: '대화 중 실시간 환율로 견적을 자동 계산한다.', benefit: '편의' });
  LOOP.review(admin, f9, { decision: 'REJECT', note: '외부 환율 API 연계가 MVP 범위 밖입니다(본사업 제안 항목으로 이관).' });
  const f10 = mk('U-004', { screen_key: 'mykotra', kind: '화면추가', priority: 'P3', title: 'Cockpit 진행 현황 PDF 출력', as_is: '출력 기능이 없다.', to_be: '진행 현황을 PDF로 출력한다.', benefit: '보고' });
  LOOP.review(admin, f10, { decision: 'DUPLICATE', duplicate_of: f4, note: `${f4}와 동일 요청` });
  q.run("UPDATE ax_feedback SET is_synthetic=1 WHERE id IN (?,?,?)", f9, f10, f7);

  // 제안·입찰 지원
  const chk = [['C01', '제안서 본문(장별 작성)', 'Proposal body (by chapter)', '주관사 PM', 7, 'IN_PROGRESS'], ['C02', '제안요약서·발표자료', 'Executive summary & deck', '주관사 PM', 10, 'TODO'], ['C03', '요구사항 답변·조견표', 'Requirement answers & matrix', 'AX개발 RTM', 3, 'DONE'], ['C04', '사업수행계획서·일정', 'Project plan & schedule', '주관사 PM', 9, 'IN_PROGRESS'], ['C05', '보안·개인정보 서약서', 'Security & privacy pledges', '보안 담당', 8, 'IN_PROGRESS'], ['C06', '컨소시엄 협약서', 'Consortium agreement', 'PMO', 12, 'TODO'], ['C07', '참여인력 투입 확인서', 'Staffing confirmation', 'PMO', 12, 'TODO'], ['C08', '근거·증빙팩(제출용)', 'Evidence pack', 'AX개발 RTM', 5, 'DONE'], ['C09', '시연 환경 URL·계정 안내', 'Demo URL & accounts', '플랫폼 담당', 6, 'IN_PROGRESS'], ['C10', '가격 제안서', 'Price proposal', 'PMO', 14, 'N/A']];
  chk.forEach(([id, ko, en, owner, due, st]) => q.insert('ax_checklist', { id, title_ko: ko, title_en: en, owner, due: U.addDays(U.today(), due), status: st, note: '시연 샘플', updated_at: U.iso() }));
  [['QA-0001', 'SFR-001 JAVA·전자정부 표준프레임워크 기준 요건과 MVP 구현 방식의 차이를 어떻게 해소하는지 설명해 주세요.', 'SFR-001', 'RECEIVED', null, null], ['QA-0002', 'SFR-023 27B 이상 LLM 2식 요건의 GPU 구성 전제와 폐쇄망 모델 교체 절차를 알려 주세요.', 'SFR-023', 'DRAFTED', '플랫폼 담당', 'MVP는 Model Gateway 어댑터로 모델 교체 구조를 검증했으며, 27B+ 모델·GPU는 본사업 인프라 설계에서 확정합니다(시연 샘플).'], ['QA-0003', 'SER-013 DB 암호화 적용 범위를 제안서에 어떻게 반영하는지 확인 부탁드립니다.', 'SER-013', 'SUBMITTED', '보안 담당', '운영 DB는 본사업에서 컬럼·테이블스페이스 암호화를 적용하며, MVP는 설계 문서로 제시했습니다(시연 샘플).']]
    .forEach(([id, qs, rfp, st, as, an]) => q.insert('ax_qna', { id, question: qs, rfp_id: rfp, asked_by: 'U-028', status: st, assignee: as, answer: an, created_at: ago(4), updated_at: ago(2) }));
  q.run('INSERT INTO seq(name,n) VALUES(?,?) ON CONFLICT(name) DO UPDATE SET n=excluded.n', 'QA', 3);

  // 컨소시엄(합성)
  const members = [['M1', '주관사 (시연용)', 'Lead integrator (demo)', 'PMO·플랫폼·AI 총괄', 'PMO, platform & AI lead', ['AI 수출비서·Multi-RAG', '통합 포털·MyKOTRA', 'PMO·품질'], 1], ['M2', '데이터·AI 참여사 (시연용)', 'Data & AI partner (demo)', 'MDM·데이터 플랫폼·LLMOps', 'MDM, data platform, LLMOps', ['고객 MDM', '통합 데이터 저장소', 'LLMOps'], 0], ['M3', '무역·투자 도메인 자문사 (시연용)', 'Trade & investment advisory (demo)', '업무 검증·UAT·콘텐츠 자문', 'Business validation, UAT, content', ['해외정보·상담매칭 업무 검증', 'UAT'], 0], ['M4', '인프라·보안 참여사 (시연용)', 'Infra & security partner (demo)', '클라우드·보안·운영', 'Cloud, security, operations', ['클라우드 이행', '보안·개인정보', '운영 자동화'], 0], ['M5', 'UX·접근성 참여사 (시연용)', 'UX & accessibility partner (demo)', 'UI/UX·웹접근성', 'UI/UX and web accessibility', ['디자인 시스템', '웹접근성 심사 대응'], 0]];
  members.forEach(([id, ok, oe, rk, re, mods, lead]) => q.insert('ax_members', { id, org_ko: ok, org_en: oe, role_ko: rk, role_en: re, modules: JSON.stringify(mods), lead, is_synthetic: 1 }));
  [['S01', 'M1', 'PM (가상 인력 A1)', 'PM', 'IN', 'SIGNED'], ['S02', 'M1', 'AI 아키텍트 (가상 인력 A2)', 'AI Architect', 'IN', 'SIGNED'], ['S03', 'M1', '프런트엔드 개발 (가상 인력 A3)', 'Developer', 'PLANNED', 'PENDING'], ['S04', 'M2', 'MDM 설계 (가상 인력 B1)', 'Data', 'IN', 'SIGNED'], ['S05', 'M2', 'MLOps (가상 인력 B2)', 'MLOps', 'EXTERNAL', 'PENDING'], ['S06', 'M3', '업무 자문 (가상 인력 C1)', 'Advisor', 'EXTERNAL', 'SIGNED'], ['S07', 'M4', '보안 책임 (가상 인력 D1)', 'Security', 'IN', 'SIGNED'], ['S08', 'M4', '인프라 (가상 인력 D2)', 'Infra', 'PLANNED', 'PENDING'], ['S09', 'M5', 'UX 디자이너 (가상 인력 E1)', 'Designer', 'IN', 'EXPIRED'], ['S10', 'M5', '접근성 심사 (가상 인력 E2)', 'QA', 'EXTERNAL', 'PENDING']]
    .forEach(([id, m, name, role, kind, pledge]) => q.insert('ax_staff', { id, member_id: m, name, role, kind, pledge, updated_at: U.iso() }));
  // 산출물 × 참여사 RACI (A는 산출물당 1곳)
  const raci = { D01: { M1: 'A', M2: 'R', M3: 'C', M4: 'C', M5: 'I' }, D02: { M1: 'A', M2: 'C', M3: 'R', M4: 'I', M5: 'I' }, D03: { M1: 'R', M2: 'I', M3: 'C', M4: 'I', M5: 'A' }, D04: { M1: 'A', M2: 'R', M3: 'I', M4: 'C', M5: 'I' }, D05: { M1: 'R', M2: 'A', M3: 'C', M4: 'I', M5: 'I' }, D06: { M1: 'A', M2: 'R', M3: 'R', M4: 'C', M5: 'C' }, D07: { M1: 'C', M2: 'C', M3: 'I', M4: 'A', M5: 'I' }, D08: { M1: 'R', M2: 'C', M3: 'A', M4: 'C', M5: 'R' }, D09: { M1: 'R', M2: 'C', M3: 'I', M4: 'A', M5: 'I' } };
  for (const [d, row] of Object.entries(raci)) for (const [m, c] of Object.entries(row)) q.run('INSERT INTO ax_raci(deliverable,member_id,code) VALUES(?,?,?)', d, m, c);
  q.run("DELETE FROM settings WHERE k='axos_worker'"); // 시연 샘플 보고가 실제 Worker 연결처럼 보이지 않도록 초기화
  // 초기 AXOS 설정: 기본 MANUAL(사람이 착수 허용한 작업만 Worker가 가져감)
  return { feedback: q.count('ax_feedback'), orders: q.count('ax_orders'), releases: q.count('ax_releases'), rtm: q.count('ax_rtm'), consultant: consultant.user.id };
}
module.exports = { seedAxdev };
