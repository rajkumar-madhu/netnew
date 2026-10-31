// Accounts and sessions: scrypt password hashes, random session tokens stored
// only as SHA-256 hashes, and an httpOnly cookie that carries the token.
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb);
const KEY_LENGTH = 64;
const SCRYPT = { N: 16384, r: 8, p: 1 };

export const SESSION_COOKIE = 'netnew_session';
export const SESSION_DAYS = 30;
export const ROLES = ['admin', 'viewer'];

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEY_LENGTH, SCRYPT);
  return `scrypt$${SCRYPT.N}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  const [scheme, n, salt, hash] = String(stored).split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const key = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, { ...SCRYPT, N: Number(n) });
  return timingSafeEqual(key, expected);
}

export const newToken = () => randomBytes(32).toString('base64url');
export const hashToken = (token) => createHash('sha256').update(token).digest('hex');

export function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

export function parseCookies(header) {
  const out = {};
  for (const part of String(header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function sessionCookie(token, { secure, maxAge = SESSION_DAYS * 86400 }) {
  return [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
    secure ? 'Secure' : null,
  ].filter(Boolean).join('; ');
}

// Validation shared by setup, user creation and password changes.
export function validateEmail(email) {
  const value = String(email ?? '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 200 ? value : null;
}

export function passwordProblem(password) {
  const p = String(password ?? '');
  if (p.length < 8) return 'Password must be at least 8 characters';
  if (p.length > 200) return 'Password is too long';
  return null;
}

/** Looks up the user behind a request's session cookie, or null. */
export function sessionUser(db, cookieHeader, nowSec) {
  const token = parseCookies(cookieHeader)[SESSION_COOKIE];
  if (!token) return null;
  const s = db.getSession(hashToken(token), nowSec);
  return s ? { id: s.user_id, email: s.email, name: s.name, role: s.role, tokenHash: s.token_hash } : null;
}

export async function startSession(db, userId, nowSec) {
  const token = newToken();
  db.createSession(hashToken(token), userId, nowSec, nowSec + SESSION_DAYS * 86400);
  db.touchLogin(userId, nowSec);
  return token;
}
