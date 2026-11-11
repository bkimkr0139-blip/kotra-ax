'use strict';
// Governance: audit hash-chain, state machines (server-validated), approvals (HITL), notifications, outbox.
const { q, nextId } = require('./db');
const U = require('./util');

// ---------- Audit (tamper-evident hash chain) ----------
function audit(ctx, action, targetType, targetId, detail = {}) {
  const user = ctx && ctx.user;
  const last = q.get('SELECT hash FROM audit_events ORDER BY id DESC LIMIT 1');
  const prev = last ? last.hash : 'GENESIS';
  const ts = U.iso();
  const safe = JSON.parse(U.maskPII(JSON.stringify(detail || {})));
  const body = [prev, ts, user ? user.id : 'system', action, targetType || '', targetId || '', JSON.stringify(safe)].join('|');
  const hash = U.sha(body);
  q.run('INSERT INTO audit_events(ts,actor_id,actor_role,action,target_type,target_id,detail,ip,prev_hash,hash) VALUES(?,?,?,?,?,?,?,?,?,?)',
    ts, user ? user.id : 'system', user ? user.role : 'system', action, targetType || null, targetId || null, JSON.stringify(safe), (ctx && ctx.ip) || null, prev, hash);
  return hash;
}
function verifyAuditChain() {
  const rows = q.all('SELECT * FROM audit_events ORDER BY id ASC');
  let prev = 'GENESIS';
  for (const r of rows) {
    const body = [prev, r.ts, r.actor_id, r.action, r.target_type || '', r.target_id || '', r.detail].join('|');
    if (r.prev_hash !== prev || U.sha(body) !== r.hash) return { ok: false, broken_at: r.id, total: rows.length };
    prev = r.hash;
  }
  return { ok: true, total: rows.length, head: prev };
}

// ---------- State machines ----------
const MACHINES = {
  application: { table: 'applications', t: { DRAFT: ['READY_FOR_REVIEW'], READY_FOR_REVIEW: ['APPROVAL_REQUIRED', 'DRAFT'], APPROVAL_REQUIRED: ['SUBMITTED_DEMO', 'DRAFT'], SUBMITTED_DEMO: ['COMPLETED'], COMPLETED: [] } },
  consultation: { table: 'consultations', t: { OPEN: ['AI_CLASSIFIED', 'ASSIGNED'], AI_CLASSIFIED: ['ASSIGNED'], ASSIGNED: ['IN_PROGRESS'], IN_PROGRESS: ['RESOLVED', 'ASSIGNED'], RESOLVED: ['CLOSED', 'IN_PROGRESS'], CLOSED: [] } },
  match: { table: 'match_requests', t: { REQUESTED: ['ACCEPTED', 'REJECTED'], ACCEPTED: ['SCHEDULED'], REJECTED: [], SCHEDULED: ['COMPLETED', 'ACCEPTED'], COMPLETED: ['FOLLOW_UP'], FOLLOW_UP: [] } },
  research: { table: 'research_requests', t: { DRAFT: ['APPROVAL_REQUESTED'], APPROVAL_REQUESTED: ['ASSIGNED', 'DRAFT'], ASSIGNED: ['IN_PROGRESS'], IN_PROGRESS: ['SUBMITTED'], SUBMITTED: ['REVISION_REQUESTED', 'COMPLETED'], REVISION_REQUESTED: ['SUBMITTED'], COMPLETED: ['EVALUATED'], EVALUATED: [] } },
  approval: { table: 'approvals', t: { PENDING: ['APPROVED', 'REJECTED', 'CANCELLED'], APPROVED: [], REJECTED: [], CANCELLED: [] } },
  news: { table: 'news_drafts', t: { DRAFT: ['REVIEW'], REVIEW: ['APPROVED', 'REJECTED', 'DRAFT'], APPROVED: ['PUBLISHED'], REJECTED: ['DRAFT'], PUBLISHED: [] } },
  // AX개발 폐루프 (docs/15_AX_DEV_LOOP.md)
  ax_feedback: { table: 'ax_feedback', t: { SUBMITTED: ['APPROVED', 'NEEDS_INFO', 'REJECTED', 'DUPLICATE', 'WITHDRAWN'], NEEDS_INFO: ['SUBMITTED', 'REJECTED', 'WITHDRAWN'], APPROVED: ['DONE', 'REOPENED', 'NEEDS_INFO'], REOPENED: ['APPROVED', 'REJECTED', 'NEEDS_INFO'], DONE: ['REOPENED'], REJECTED: [], DUPLICATE: [], WITHDRAWN: [] } },
  ax_order: { table: 'ax_orders', t: { QUEUED: ['IN_PROGRESS', 'CANCELLED'], IN_PROGRESS: ['REPORTED', 'FAILED', 'QUEUED', 'CANCELLED'], REPORTED: ['ACCEPTED', 'REOPENED'], FAILED: ['QUEUED', 'CANCELLED'], ACCEPTED: [], REOPENED: [], CANCELLED: [] } },
  ax_qna: { table: 'ax_qna', t: { RECEIVED: ['ASSIGNED'], ASSIGNED: ['DRAFTED', 'RECEIVED'], DRAFTED: ['REVIEWED', 'ASSIGNED'], REVIEWED: ['SUBMITTED', 'DRAFTED'], SUBMITTED: [] } },
  // Data Integration Studio (docs/16_DATA_INTEGRATION.md)
  di_candidate: { table: 'di_candidate', t: { PENDING: ['MERGED', 'LINKED', 'SEPARATE', 'NEEDS_INFO'], NEEDS_INFO: ['PENDING', 'MERGED', 'LINKED', 'SEPARATE'], BLOCKED: ['SEPARATE', 'NEEDS_INFO'], MERGED: ['PENDING'], LINKED: ['PENDING'], SEPARATE: ['PENDING'] } },
  di_dq: { table: 'di_dq_issue', t: { DETECTED: ['TRIAGED'], TRIAGED: ['ASSIGNED'], ASSIGNED: ['PROPOSED'], PROPOSED: ['REVIEWED', 'REJECTED'], REVIEWED: ['APPROVED', 'REJECTED'], APPROVED: ['APPLIED'], APPLIED: ['VERIFIED'], VERIFIED: ['CLOSED'], REJECTED: ['REOPENED'], REOPENED: ['TRIAGED'], CLOSED: ['REOPENED'] } },
  di_proposal: { table: 'di_proposal', col: 'state', t: { DRAFT: ['SIMULATED', 'REJECTED'], SIMULATED: ['REVIEW_REQUESTED', 'REJECTED', 'DRAFT'], REVIEW_REQUESTED: ['APPROVED', 'REJECTED'], APPROVED: ['DEPLOYING', 'FAILED'], DEPLOYING: ['ACTIVE', 'FAILED'], ACTIVE: ['MONITORED', 'ROLLBACK_REQUESTED', 'ROLLED_BACK'], MONITORED: ['ROLLBACK_REQUESTED', 'ROLLED_BACK'], ROLLBACK_REQUESTED: ['ROLLED_BACK'], REJECTED: [], FAILED: [], ROLLED_BACK: [] } },
  mdm: { table: 'mdm_candidates', t: { PENDING: ['MERGED', 'KEPT_SEPARATE', 'ON_HOLD'], ON_HOLD: ['MERGED', 'KEPT_SEPARATE'], MERGED: [], KEPT_SEPARATE: [] } },
};
function canTransition(machine, from, to) { const m = MACHINES[machine]; return !!(m && m.t[from] && m.t[from].includes(to)); }
function transition(ctx, machine, id, to, note = '', extra = {}) {
  const m = MACHINES[machine];
  if (!m) throw U.bad('Unknown state machine ' + machine);
  const col = m.col || 'status'; // 상태 컬럼명이 다른 엔터티(di_proposal.state) 지원
  const row = q.get(`SELECT ${col} AS status FROM ${m.table} WHERE id=?`, id);
  if (!row) throw U.notFound(`${machine} ${id} not found`);
  if (!canTransition(machine, row.status, to)) {
    throw U.conflict(`Invalid transition ${row.status} → ${to} (${machine})`, 'INVALID_TRANSITION');
  }
  q.update(m.table, id, { [col]: to, ...(m.table !== 'approvals' && m.table !== 'mdm_candidates' ? { updated_at: U.iso() } : {}), ...extra });
  q.run('INSERT INTO status_history(entity,entity_id,from_state,to_state,actor_id,note,ts) VALUES(?,?,?,?,?,?,?)', machine, id, row.status, to, ctx && ctx.user ? ctx.user.id : 'system', note, U.iso());
  audit(ctx, `${machine}.${to}`, machine, id, { from: row.status, to, note });
  return { from: row.status, to };
}
const history = (entity, id) => q.all('SELECT * FROM status_history WHERE entity=? AND entity_id=? ORDER BY id', entity, id);

// ---------- Notifications / outbox (mock channels, labelled MOCK) ----------
function notify(userId, type, title, body, link) {
  if (!userId) return;
  q.insert('notifications', { id: nextId('NTF', 5), user_id: userId, type, title, body: U.maskPII(body || ''), link: link || null, is_read: 0, created_at: U.iso() });
}
function sendMock(channel, to, subject, body, related) {
  const id = nextId('OUT', 5);
  q.insert('outbox', { id, channel, to_addr: U.maskEmail(to) || to, subject, body: U.maskPII(body), status: 'MOCK_SENT', related: related || null, created_at: U.iso() });
  return id;
}
function integrationEvent(system, event, payload) {
  const id = nextId('INT', 5);
  q.insert('integration_events', { id, system, event, payload: JSON.stringify(payload || {}), mode: 'MOCK', status: 'DELIVERED_MOCK', created_at: U.iso() });
  return id;
}

// ---------- Approvals (HITL) ----------
// approver_role: 'self' = the requester must explicitly confirm (user-owned action); otherwise staff role required.
function requestApproval(ctx, { kind, refType, refId, title, risk = 'HIGH', approverRole = 'consultant', payload = {}, traceId = null }) {
  const id = nextId('APR', 4);
  q.insert('approvals', { id, kind, ref_type: refType, ref_id: refId, title, risk, requester_id: ctx.user.id, approver_role: approverRole, status: 'PENDING', payload: JSON.stringify(payload), trace_id: traceId, created_at: U.iso() });
  audit(ctx, 'approval.requested', 'approval', id, { kind, refType, refId, risk, approverRole });
  if (approverRole !== 'self') {
    const staff = q.all("SELECT id FROM users WHERE role IN ('admin',?) AND active=1", approverRole);
    staff.forEach((s) => notify(s.id, 'approval', `[승인요청] ${title}`, `${kind} · ${risk}`, '#/admin/approvals'));
  }
  return id;
}
function canDecide(user, approval) {
  if (approval.approver_role === 'self') return approval.requester_id === user.id;
  return user.role === 'admin' || user.role === approval.approver_role || (approval.approver_role === 'consultant' && user.role === 'office');
}

module.exports = { audit, verifyAuditChain, MACHINES, canTransition, transition, history, notify, sendMock, integrationEvent, requestApproval, canDecide };
