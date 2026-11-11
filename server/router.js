'use strict';
const { q } = require('./db');
const U = require('./util');
const A = require('./auth');

const routes = [];
function route(method, pattern, handler, opts = {}) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/\/:([a-zA-Z_]+)/g, (_, k) => { keys.push(k); return '/([^/]+)'; }) + '/?$');
  routes.push({ method, re, keys, handler, opts, pattern });
}
const api = {
  get: (p, h, o) => route('GET', p, h, o), post: (p, h, o) => route('POST', p, h, o), put: (p, h, o) => route('PUT', p, h, o),
  patch: (p, h, o) => route('PATCH', p, h, o), del: (p, h, o) => route('DELETE', p, h, o),
};
function match(method, pathname) {
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = r.re.exec(pathname);
    if (m) { const params = {}; r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); }); return { r, params }; }
  }
  return null;
}
function readBody(req, limit = 6 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', (c) => { n += c.length; if (n > limit) { reject(new U.HttpError(413, 'PAYLOAD_TOO_LARGE', 'Payload too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      const ct = req.headers['content-type'] || '';
      if (ct.includes('application/json')) { try { resolve(JSON.parse(raw)); } catch { reject(U.bad('Invalid JSON')); } }
      else resolve({ _raw: raw });
    });
    req.on('error', reject);
  });
}

async function handle(req, res, url) {
  const t0 = Date.now();
  const ip = ((A.TRUST_PROXY && req.headers['x-forwarded-for']) || req.socket.remoteAddress || '').toString().split(',')[0].trim();
  const user = A.userFromReq(req);
  const query = Object.fromEntries(url.searchParams.entries());
  const hit = match(req.method, url.pathname);
  let status = 200;
  try {
    if (!hit) throw new U.HttpError(404, 'NOT_FOUND', `No route ${req.method} ${url.pathname}`);
    if (!A.rateLimit(`ip:${ip}`, Number(process.env.API_RATE_LIMIT_PER_MIN || 900), 60000)) throw new U.HttpError(429, 'RATE_LIMITED', 'Too many requests');
    if (hit.r.opts.auth !== false && hit.r.opts.roles) {
      if (!user) throw new U.HttpError(401, 'AUTH_REQUIRED', 'Login required');
      if (!hit.r.opts.roles.includes(user.role)) { const { audit } = require('./gov'); audit({ user, ip }, 'access.denied', 'route', url.pathname, { method: req.method, role: user.role }); throw U.forbidden(`Role ${user.role} cannot access ${url.pathname}`, 'ROLE_FORBIDDEN'); }
    } else if (hit.r.opts.auth === true && !user) throw new U.HttpError(401, 'AUTH_REQUIRED', 'Login required');
    const body = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) ? await readBody(req) : {};
    const ctx = { req, res, user, ip, query, body, params: hit.params, url, headers: {}, sse: null };
    const out = await hit.r.handler(ctx);
    if (res.writableEnded || ctx.sse) return;
    if (out && out.__raw) { status = out.status || 200; res.writeHead(status, { 'content-type': out.type || 'text/plain; charset=utf-8', ...(out.headers || {}), ...ctx.headers }); res.end(out.body); return; }
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...ctx.headers });
    res.end(JSON.stringify(out === undefined ? { ok: true } : out));
  } catch (e) {
    const he = e instanceof U.HttpError ? e : null;
    status = he ? he.status : 500;
    if (!he) console.error('[error]', req.method, url.pathname, e);
    if (!res.headersSent) res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ error: { code: he ? he.code : 'INTERNAL_ERROR', message: he ? he.message : 'Internal server error', ...(he && he.extra ? { extra: he.extra } : {}) } }));
  } finally {
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/open-api/')) {
      try {
        q.run('INSERT INTO api_logs(ts,user_id,method,path,status,ms,ip) VALUES(?,?,?,?,?,?,?)', U.iso(), user ? user.id : null, req.method, url.pathname.slice(0, 200), status, Date.now() - t0, ip);
        if (Math.random() < 0.02) q.run('DELETE FROM api_logs WHERE id < (SELECT MAX(id) - 5000 FROM api_logs)');
      } catch {}
      if (process.env.LOG_JSON !== 'false') console.log(JSON.stringify({ t: new Date().toISOString(), m: req.method, p: url.pathname, s: status, ms: Date.now() - t0, u: user ? user.id : null }));
    }
  }
}
module.exports = { api, handle, route, routes };
