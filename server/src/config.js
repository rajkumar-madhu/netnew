import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const env = process.env;
const dataDir = resolve(env.DATA_DIR || 'data');
mkdirSync(dataDir, { recursive: true });

// Agents authenticate with a shared token. Generate one on first start so the
// server is never accidentally open to anyone who can reach it.
function loadAgentToken() {
  if (env.AGENT_TOKEN) return env.AGENT_TOKEN;
  const file = join(dataDir, 'agent-token');
  if (existsSync(file)) return readFileSync(file, 'utf8').trim();
  const token = randomBytes(24).toString('base64url');
  writeFileSync(file, `${token}\n`, { mode: 0o600 });
  return token;
}

export const config = {
  port: Number(env.PORT || 3000),
  host: env.HOST || '0.0.0.0',
  dataDir,
  dbPath: join(dataDir, 'netnew.db'),
  agentToken: loadAgentToken(),
  agentTokenFromEnv: Boolean(env.AGENT_TOKEN),
  retentionHours: Number(env.RETENTION_HOURS || 24),
  offlineAfterSec: Number(env.OFFLINE_AFTER_SEC || 15),
  dashboardUser: env.DASHBOARD_USER || 'admin',
  dashboardPassword: env.DASHBOARD_PASSWORD || '',
  spaceName: env.SPACE_NAME || 'My Space',
  // Public dashboard URL, used for links in alert notifications.
  publicUrl: env.PUBLIC_URL || '',
};
