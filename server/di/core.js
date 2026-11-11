'use strict';
// Data Integration Studio 공통: 기능 플래그, 권한(DI 역할 → 기존 5개 역할 매핑), 이벤트·감사, 멱등성, ID.
const { q, nextId } = require('../db');
const U = require('../util');
const G = require('../gov');

const enabled = () => (process.env.DATA_INTEGRATION_STUDIO_ENABLED !== undefined ? process.env.DATA_INTEGRATION_STUDIO_ENABLED === 'true' : process.env.DEMO_MODE !== 'false');
const strictSod = () => process.env.DI_STRICT_SOD === 'true';

// 스펙 §18 역할 → 이 시스템의 역할(server/auth.js). 한 사람이 승인권을 독점하지 않도록 SoD 규칙을 별도 집행한다.
const ROLES = {
  DataViewer: ['admin', 'consultant', 'office'],
  DataSteward: ['admin', 'consultant'],
  MdmSteward: ['admin', 'consultant'],
  DataArchitect: ['admin', 'consultant'],
  ConnectorAdmin: ['admin'],
  PipelineOperator: ['admin'],
  MdmApprover: ['admin'],
  ChangeApprover: ['admin'],
  ReleaseOperator: ['admin'],
  SecurityOfficer: ['admin'],
  Auditor: ['admin'],
};
const rolesOf = (name) => ROLES[name] || ['admin'];
const guard = () => { if (!enabled()) throw new U.HttpError(404, 'DI_DISABLED', 'Data Integration Studio가 비활성화되어 있습니다(DATA_INTEGRATION_STUDIO_ENABLED)'); };

const J = JSON.stringify;
const P = (s, d = null) => U.parse(s, d);
const actorId = (ctx) => (ctx && ctx.user ? ctx.user.id : 'system');
function ev(ctx, event, ref, detail = {}) {
  q.run('INSERT INTO di_event(at,actor,actor_role,event,ref,detail) VALUES(?,?,?,?,?,?)', U.iso(), actorId(ctx), ctx && ctx.user ? ctx.user.role : 'system', event, ref || null, J(detail));
}
const audit = (ctx, action, type, id, detail) => G.audit(ctx, `di.${action}`, type, id, detail);
const nid = (prefix, w = 4) => nextId(prefix, w);

// Idempotency-Key: 같은 키로 재호출하면 처음 응답을 반환(승인 중복 클릭 방지)
function idempotent(ctx, endpoint, fn) {
  const key = ctx && ctx.req && ctx.req.headers ? String(ctx.req.headers['idempotency-key'] || '').slice(0, 80) : '';
  if (!key) return fn();
  const hit = q.get('SELECT * FROM di_idem WHERE key=?', `${endpoint}:${key}`);
  if (hit) return { ...P(hit.response, {}), idempotent_replay: true };
  const out = fn();
  q.run('INSERT OR REPLACE INTO di_idem(key,endpoint,response,at) VALUES(?,?,?,?)', `${endpoint}:${key}`, endpoint, J(out), U.iso());
  return out;
}
// Optimistic concurrency: 요청의 expected_version 이 현재와 다르면 409
function checkVersion(row, expected, what) {
  if (expected !== undefined && expected !== null && Number(expected) !== Number(row.version)) throw U.conflict(`${what} 버전이 변경되었습니다(현재 ${row.version}). 새로고침 후 다시 시도하세요 / Version conflict`, 'VERSION_CONFLICT');
}
const err = (code, message, status = 400, retryable = false) => new U.HttpError(status, code, message, { retryable, operation_status: 'BLOCKED' });

module.exports = { enabled, strictSod, ROLES, rolesOf, guard, J, P, ev, audit, nid, idempotent, checkVersion, err, actorId };
