'use strict';
const crypto = require('node:crypto');
const { q, nextId } = require('./db');
const U = require('./util');

const TTL_H = Number(process.env.SESSION_TTL_HOURS || 12);
const COOKIE = 'kt_sid';
const PUBLIC_URL = process.env.PUBLIC_URL || '';
const SECURE = PUBLIC_URL.startsWith('https://') || process.env.COOKIE_SECURE === 'true';
const TRUST_PROXY = process.env.TRUST_PROXY === 'true';

// Access scopes (RFP O/S/C → PUBLIC/MEMBER/INTERNAL/SENSITIVE/CONFIDENTIAL)
const SCOPE = { PUBLIC: 0, MEMBER: 1, INTERNAL: 2, SENSITIVE: 3, CONFIDENTIAL: 4 };
const CLEARANCE = { anon: 0, customer: 1, buyer: 1, office: 2, consultant: 3, admin: 4 };
const clearanceOf = (user) => (user ? CLEARANCE[user.role] ?? 1 : 0);

// Permission matrix (documented in docs/permissions.md)
const PERMS = {
  'ai.chat': ['customer', 'buyer', 'consultant', 'office', 'admin', 'anon'],
  'admin.console': ['admin'],
  'staff.console': ['consultant', 'office', 'admin'],
  'consult.manage': ['consultant', 'admin'],
  'research.manage': ['office', 'consultant', 'admin'],
  'match.admin': ['admin', 'consultant'],
  'company.write': ['customer', 'admin'],
  'buyer.portal': ['buyer', 'admin'],
  'ax.feedback': ['customer', 'buyer', 'consultant', 'office', 'admin'],
  'ax.review': ['consultant', 'admin'],
  'ax.govern': ['consultant', 'office', 'admin'],
  'ax.manage': ['admin'],
};
const can = (user, perm) => (PERMS[perm] || []).includes(user ? user.role : 'anon');

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((p) => { const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return out;
}
function createSession(userId, ip) {
  const token = crypto.randomBytes(24).toString('hex');
  const exp = new Date(Date.now() + TTL_H * 3600 * 1000).toISOString();
  q.run('INSERT INTO sessions(token,user_id,created_at,expires_at,ip) VALUES(?,?,?,?,?)', token, userId, new Date().toISOString(), exp, ip || null);
  return { token, exp };
}
function cookieHeader(token, clear = false) {
  return `${COOKIE}=${clear ? '' : token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${clear ? 0 : TTL_H * 3600}${SECURE ? '; Secure' : ''}`;
}
function userFromReq(req) {
  const t = parseCookies(req)[COOKIE];
  if (!t) return null;
  const s = q.get('SELECT * FROM sessions WHERE token=?', t);
  if (!s || s.expires_at < new Date().toISOString()) return null;
  const u = q.get('SELECT * FROM users WHERE id=? AND active=1', s.user_id);
  return u ? publicUser(u) : null;
}
function publicUser(u) {
  const { pw_hash, ...rest } = u;
  return rest;
}
function login(email, password, ip) {
  const u = q.get('SELECT * FROM users WHERE email=? AND active=1', String(email || '').toLowerCase());
  if (!u || !U.verifyPassword(password, u.pw_hash)) throw new U.HttpError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
  return { user: publicUser(u), ...createSession(u.id, ip) };
}
function loginAs(userId, ip) {
  const u = q.get('SELECT * FROM users WHERE id=? AND active=1', userId);
  if (!u) throw U.notFound('User not found');
  return { user: publicUser(u), ...createSession(u.id, ip) };
}
function logout(req) { const t = parseCookies(req)[COOKIE]; if (t) q.run('DELETE FROM sessions WHERE token=?', t); }
function requireRole(user, ...roles) {
  if (!user) throw new U.HttpError(401, 'AUTH_REQUIRED', 'Login required');
  if (!roles.includes(user.role)) throw U.forbidden(`Role ${user.role} cannot perform this action`);
}
function requirePerm(user, perm) {
  if (!user && !(PERMS[perm] || []).includes('anon')) throw new U.HttpError(401, 'AUTH_REQUIRED', 'Login required');
  if (!can(user, perm)) throw U.forbidden(`Permission ${perm} denied for role ${user ? user.role : 'anon'}`);
}

// Simple sliding-window rate limiter (API flow control — SFR-026)
const buckets = new Map();
function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const arr = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) { buckets.set(key, arr); return false; }
  arr.push(now); buckets.set(key, arr); return true;
}

function clearRateLimits(prefix = '') { for (const k of [...buckets.keys()]) if (k.startsWith(prefix)) buckets.delete(k); }
module.exports = { SECURE, TRUST_PROXY, PUBLIC_URL, clearRateLimits, SCOPE, clearanceOf, PERMS, can, parseCookies, createSession, cookieHeader, userFromReq, publicUser, login, loginAs, logout, requireRole, requirePerm, rateLimit };
