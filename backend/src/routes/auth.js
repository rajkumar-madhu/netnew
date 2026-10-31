// Accounts: first-run setup, sign in/out, the current user, password changes;
// plus the middleware that protects every other API route.
import {
  hashPassword, passwordProblem, ROLES, sessionCookie, sessionUser, startSession, validateEmail, verifyPassword,
} from '../services/auth.js';
import { bad } from './helpers.js';

const LOGIN_WINDOW_MS = 10 * 60_000;
const LOGIN_MAX_ATTEMPTS = 10;

const publicUser = (u) => u && { id: u.id, email: u.email, name: u.name, role: u.role };

function secureCookie(core, req) {
  const setting = core.config.cookieSecure;
  return setting === 'auto' ? req.secure : setting === 'true';
}

export function registerAuthRoutes(api, { core, db }) {
  const attempts = new Map(); // ip -> { count, resetAt }

  async function signIn(req, res, user) {
    const token = await startSession(db, user.id, core.now());
    res.set('Set-Cookie', sessionCookie(token, { secure: secureCookie(core, req) }));
  }

  api.get('/auth/state', (req, res) => {
    const user = sessionUser(db, req.headers.cookie, core.now());
    res.json({ setupRequired: db.countUsers() === 0, user: publicUser(user), workspaceName: core.workspaceName(), version: core.version });
  });

  // Creates the first admin account; only allowed while there are no users.
  api.post('/auth/setup', async (req, res) => {
    if (db.countUsers() > 0) return bad(res, 'setup is already complete', 409);
    const email = validateEmail(req.body?.email);
    const name = String(req.body?.name ?? '').trim().slice(0, 80);
    const workspace = String(req.body?.workspaceName ?? '').trim().slice(0, 80);
    if (!workspace) return bad(res, 'Workspace name is required');
    if (!name) return bad(res, 'Your name is required');
    if (!email) return bad(res, 'A valid email is required');
    const problem = passwordProblem(req.body?.password);
    if (problem) return bad(res, problem);
    const user = db.createUser({ email, name, passwordHash: await hashPassword(req.body.password), role: 'admin' }, core.now());
    db.setSetting('workspace_name', workspace);
    await signIn(req, res, user);
    res.status(201).json({ user: publicUser(user) });
  });

  api.post('/auth/login', async (req, res) => {
    const ip = req.ip;
    const entry = attempts.get(ip);
    if (entry && entry.resetAt > Date.now() && entry.count >= LOGIN_MAX_ATTEMPTS) {
      return bad(res, 'Too many attempts. Try again in a few minutes.', 429);
    }
    const email = validateEmail(req.body?.email);
    const user = email && db.getUserByEmail(email);
    const ok = user && await verifyPassword(String(req.body?.password ?? ''), user.password_hash);
    if (!ok) {
      const next = entry && entry.resetAt > Date.now() ? entry : { count: 0, resetAt: Date.now() + LOGIN_WINDOW_MS };
      next.count++;
      attempts.set(ip, next);
      return bad(res, 'Incorrect email or password', 401);
    }
    attempts.delete(ip);
    await signIn(req, res, user);
    res.json({ user: publicUser(user) });
  });

  api.post('/auth/logout', (req, res) => {
    const user = sessionUser(db, req.headers.cookie, core.now());
    if (user) db.deleteSession(user.tokenHash);
    res.set('Set-Cookie', sessionCookie('', { secure: secureCookie(core, req), maxAge: 0 }));
    res.status(204).end();
  });
}

/** Rejects cross-site writes: browsers always send Origin on POST/PUT/PATCH/DELETE. */
export function sameOrigin(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  const origin = req.headers.origin;
  if (!origin) return next(); // non-browser clients (curl, tests)
  try {
    if (new URL(origin).host === req.headers.host) return next();
  } catch {}
  bad(res, 'cross-origin request rejected', 403);
}

/** Attaches req.user from the session cookie; 401 when signed out. */
export function requireUser({ core, db }) {
  return (req, res, next) => {
    const user = sessionUser(db, req.headers.cookie, core.now());
    if (!user) return bad(res, 'sign in required', 401);
    req.user = user;
    next();
  };
}

/** Viewers can read everything; changes need an admin. */
export function adminForWrites(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.user.role === 'admin') return next();
  bad(res, 'only admins can make changes', 403);
}

// Routes for any signed-in user: who am I, change my password.
export function registerAccountRoutes(api, { db }) {
  api.get('/auth/me', (req, res) => res.json({ user: publicUser(req.user) }));

  api.post('/auth/password', async (req, res) => {
    const user = db.getUser(req.user.id);
    if (!await verifyPassword(String(req.body?.current ?? ''), user.password_hash)) return bad(res, 'Current password is incorrect', 401);
    const problem = passwordProblem(req.body?.next);
    if (problem) return bad(res, problem);
    db.setPassword(user.id, await hashPassword(req.body.next));
    res.json({ ok: true });
  });
}

export { ROLES };
