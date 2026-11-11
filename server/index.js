'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { handle, api } = require('./router');
const { q, getSetting, setSetting } = require('./db');
const U = require('./util');

const PORT = Number(process.env.PORT || 4400);
const HOST = process.env.HOST || (process.env.PUBLIC_URL ? '127.0.0.1' : '0.0.0.0');
const PUB = path.join(__dirname, '..', 'public');
const A = require('./auth');
const ALLOWED_HOSTS = (process.env.ALLOWED_HOSTS || (A.PUBLIC_URL ? new URL(A.PUBLIC_URL).host : '')).split(',').map((x) => x.trim()).filter(Boolean);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.csv': 'text/csv; charset=utf-8' };

function hardenForPublic() {
  // Public exposure must never keep the well-known demo password or an open admin demo-login.
  if (!A.PUBLIC_URL) return;
  const { verifyPassword, hashPassword } = U; const fs_ = fs; const f = path.join(__dirname, '..', 'data', '.demo-password');
  const admin = q.get("SELECT pw_hash FROM users WHERE email='admin@kotra.example'");
  if (admin && !process.env.DEMO_PASSWORD && verifyPassword('Kotra!2026demo', admin.pw_hash)) {
    const pw = require('node:crypto').randomBytes(12).toString('base64url') + '!9a';
    const hash = hashPassword(pw); q.run('UPDATE users SET pw_hash=?', hash); process.env.DEMO_PASSWORD = pw;
    fs_.writeFileSync(f, pw + '\n', { mode: 0o600 });
    console.warn(`[security] PUBLIC_URL is set: the default demo password was replaced. New password saved to ${f}`);
  } else if (!process.env.DEMO_PASSWORD && fs.existsSync(f)) process.env.DEMO_PASSWORD = fs.readFileSync(f, 'utf8').trim();
  if (process.env.DEMO_MODE !== 'false' && !process.env.DEMO_ACCESS_CODE) console.warn('[security] DEMO_MODE=true without DEMO_ACCESS_CODE: staff/admin personas are disabled for one-click login on the public URL.');
}
function boot() {
  // first run: seed automatically
  if (q.count('users') === 0) { console.log('[boot] empty database → seeding demo data'); require('./seed/index').seedAll({ reset: true }); }
  // 기존 DB(AX개발 도입 전)에도 RTM·시연 샘플을 한 번만 채운다.
  if (q.count('ax_rtm') === 0 && q.count('rfp_coverage') > 0) { try { const r = require('./seed/axdev').seedAxdev(); console.log('[boot] AX개발 RTM/시연 데이터 초기화', JSON.stringify(r)); } catch (e) { console.error('[boot] axdev seed failed:', e.message); } }
  if (require('./di/core').enabled() && q.count('di_source') === 0 && q.count('users') > 0) { try { const r = q.tx(() => require('./di/seed').seedDi()); console.log('[boot] 데이터 통합 스튜디오 시드', JSON.stringify(r)); } catch (e) { console.error('[boot] DI seed failed:', e.message); } }
  hardenForPublic();
  U.setClock(process.env.DEMO_CLOCK || getSetting('demo_clock', null) || null);
  const clock = getSetting('demo_clock', null); if (clock) U.setClock(clock);
  // model status reflects LLM configuration honestly
  const LLM = require('./ai/llm');
  const st = LLM.status();
  q.run("UPDATE model_configs SET status=? WHERE id='claude-sonnet-5-5'", st.configured ? 'ACTIVE' : 'NOT_CONFIGURED');
  require('./routes/public'); require('./routes/customer'); require('./routes/ai'); require('./routes/staff'); require('./routes/admin'); require('./routes/axdev'); require('./routes/di');
}

function secHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), geolocation=(), microphone=(self)');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; media-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'" + (A.SECURE ? '; upgrade-insecure-requests' : ''));
  if (A.SECURE) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}
function serveStatic(req, res, pathname) {
  let p = path.normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
  let file = path.join(PUB, p);
  if (!file.startsWith(PUB)) { res.writeHead(403); return res.end('Forbidden'); }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(PUB, 'index.html'); // SPA fallback
  const ext = path.extname(file);
  const isHtml = ext === '.html';
  res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream', 'cache-control': isHtml ? 'no-cache' : 'public, max-age=300' });
  fs.createReadStream(file).pipe(res);
}

function createServer() {
  return http.createServer(async (req, res) => {
    secHeaders(res);
    const host = String(req.headers.host || '');
    if (ALLOWED_HOSTS.length && !/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host) && !ALLOWED_HOSTS.includes(host)) { res.writeHead(421, { 'content-type': 'text/plain' }); return res.end('Misdirected request'); }
    const url = new URL(req.url, `http://${host || 'localhost'}`);
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/open-api/')) return handle(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    return serveStatic(req, res, url.pathname);
  });
}

if (require.main === module) {
  boot();
  const server = createServer();
  server.listen(PORT, HOST, () => console.log(`KOTRA AX Portal listening on http://localhost:${PORT}  (demo mode: ${process.env.DEMO_MODE !== 'false'})`));
  process.on('SIGINT', () => process.exit(0)); process.on('SIGTERM', () => process.exit(0));
}
module.exports = { boot, createServer };
