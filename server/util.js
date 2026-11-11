'use strict';
const crypto = require('node:crypto');

const j = (v) => JSON.stringify(v ?? null);
const parse = (s, d = null) => { if (s == null || s === '') return d; try { return JSON.parse(s); } catch { return d; } };
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const uid = (n = 8) => crypto.randomBytes(n).toString('hex');
const clamp = (x, a = 0, b = 100) => Math.max(a, Math.min(b, x));
const round = (x, d = 0) => { const p = 10 ** d; return Math.round(x * p) / p; };
const pad = (n, w = 4) => String(n).padStart(w, '0');
const uniq = (a) => [...new Set(a)];

function hashPassword(pw, salt = crypto.randomBytes(16).toString('hex')) {
  const h = crypto.scryptSync(pw, salt, 32).toString('hex');
  return `${salt}:${h}`;
}
function verifyPassword(pw, stored) {
  if (!stored) return false;
  const [salt, h] = stored.split(':');
  const x = crypto.scryptSync(pw, salt, 32);
  const y = Buffer.from(h, 'hex');
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// ---- PII masking (applied to AI output, STT transcripts and logs) ----
const RE_EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const RE_PHONE = /(?:\+?\d{1,3}[-.\s]?)?(?:0\d{1,2}|\(\d{2,3}\))[-.\s]?\d{3,4}[-.\s]?\d{4}/g;
const RE_RRN = /\b\d{6}-?[1-4]\d{6}\b/g;
function maskPII(text) {
  if (!text) return text;
  return String(text)
    .replace(RE_RRN, '******-*******')
    .replace(RE_EMAIL, (m) => { const [a, d] = m.split('@'); return a.slice(0, 2) + '***@' + d; })
    .replace(RE_PHONE, (m) => m.slice(0, 3) + '-****-' + m.slice(-4));
}
function maskEmail(e) { if (!e) return e; const [a, d] = e.split('@'); return (a || '').slice(0, 2) + '***@' + (d || ''); }

// ---- demo clock ----
let _clock = null;
function setClock(s) { _clock = s || null; }
// With a demo clock the DATE is fixed but the time of day keeps flowing (so ordering/latency/trends stay meaningful).
function now() {
  if (!_clock) return new Date();
  const d = new Date(); const [y, m, dd] = _clock.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, dd, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds()));
}
function today() { const d = now(); return d.toISOString().slice(0, 10); }
function iso() { return now().toISOString(); }
function dday(dateStr) {
  if (!dateStr) return null;
  const a = new Date(today() + 'T00:00:00Z').getTime();
  const b = new Date(String(dateStr).slice(0, 10) + 'T00:00:00Z').getTime();
  return Math.round((b - a) / 86400000);
}
function addDays(dateStr, n) {
  const d = new Date(String(dateStr).slice(0, 10) + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

class HttpError extends Error {
  constructor(status, code, message, extra) { super(message || code); this.status = status; this.code = code; this.extra = extra; }
}
const bad = (m, code = 'BAD_REQUEST') => new HttpError(400, code, m);
const forbidden = (m = 'Forbidden', code = 'FORBIDDEN') => new HttpError(403, code, m);
const notFound = (m = 'Not found') => new HttpError(404, 'NOT_FOUND', m);
const conflict = (m, code = 'CONFLICT') => new HttpError(409, code, m);

module.exports = { j, parse, sha, uid, clamp, round, pad, uniq, hashPassword, verifyPassword, maskPII, maskEmail, setClock, now, today, iso, dday, addDays, HttpError, bad, forbidden, notFound, conflict };
