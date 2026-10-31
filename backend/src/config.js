import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Agents authenticate with a shared token. Generate one on first start so the
// server is never accidentally open to anyone who can reach it.
function loadAgentToken(env, dataDir) {
  if (env.AGENT_TOKEN) return env.AGENT_TOKEN;
  const file = join(dataDir, 'agent-token');
  if (existsSync(file)) return readFileSync(file, 'utf8').trim();
  const token = randomBytes(24).toString('base64url');
  writeFileSync(file, `${token}\n`, { mode: 0o600 });
  return token;
}

/** Reads server settings from environment variables (see backend/.env.example). */
export function loadConfig(env = process.env) {
  const dataDir = resolve(env.DATA_DIR || 'data');
  mkdirSync(dataDir, { recursive: true });
  return {
    port: Number(env.PORT ?? 3000),
    host: env.HOST || '0.0.0.0',
    dataDir,
    dbPath: join(dataDir, 'netnew.db'),
    agentToken: loadAgentToken(env, dataDir),
    agentTokenFromEnv: Boolean(env.AGENT_TOKEN),
    retentionHours: Number(env.RETENTION_HOURS || 24),
    logRetentionHours: Number(env.LOG_RETENTION_HOURS || 72),
    logMaxRows: Number(env.LOG_MAX_ROWS || 2_000_000),
    offlineAfterSec: Number(env.OFFLINE_AFTER_SEC || 15),
    // Default workspace name until the first-run setup sets one.
    workspaceName: env.WORKSPACE_NAME || 'My Workspace',
    // Creates this admin account on start when no users exist yet
    // (for automated deployments that skip the setup page).
    adminEmail: env.ADMIN_EMAIL || '',
    adminPassword: env.ADMIN_PASSWORD || '',
    // Public dashboard URL, used for links in alert notifications.
    publicUrl: env.PUBLIC_URL || '',
    // 'auto' marks the session cookie Secure when the request came over HTTPS.
    cookieSecure: env.COOKIE_SECURE || 'auto',
  };
}
