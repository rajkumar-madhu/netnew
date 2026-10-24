import { timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer } from 'ws';
import { createAlertEngine, RULE_NAMES } from './alerts.js';
import { config } from './config.js';
import { METRICS, openDb } from './db.js';

const WEB_DIST = fileURLToPath(new URL('../../web/dist', import.meta.url));
const AGENT_DIR = fileURLToPath(new URL('../../agent', import.meta.url));
const INSTALL_SCRIPT = fileURLToPath(new URL('./install.sh', import.meta.url));

const now = () => Math.floor(Date.now() / 1000);
const startedAt = now();

const db = openDb(config.dbPath);
const dashboards = new Set(); // browser sockets receiving live updates
const agents = new Map(); // nodeId -> agent socket
const lastSeen = new Map(); // nodeId -> unix seconds of the last sample received
const latest = new Map(); // nodeId -> most recent sample

for (const node of db.listNodes()) {
  const m = db.latestMetric(node.id);
  if (m) latest.set(node.id, m);
}

function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const ws of dashboards) if (ws.readyState === ws.OPEN) ws.send(data);
}

const alerts = createAlertEngine(db, (alert) => {
  broadcast({ type: 'alert', alert: decorateAlert(alert) });
  broadcastNode(alert.node_id);
});

function decorateAlert(a) {
  return { ...a, name: RULE_NAMES[a.rule] ?? a.rule, hostname: a.hostname ?? db.getNode(a.node_id)?.hostname };
}

// "Fresh" means data arrived recently; "online" additionally needs a live
// connection. Alerts key off freshness so a quick agent restart doesn't page.
const isFresh = (id) => now() - (lastSeen.get(id) ?? 0) <= config.offlineAfterSec;
const isOnline = (id) => agents.has(id) && isFresh(id);

function nodeSummary(row) {
  if (!row) return null;
  const sample = latest.get(row.id);
  return {
    id: row.id,
    hostname: row.hostname,
    os: row.os,
    platform: row.platform,
    kernel: row.kernel,
    arch: row.arch,
    cpuModel: row.cpu_model,
    cores: row.cores,
    memTotal: row.mem_total,
    ip: row.ip,
    agentVersion: row.agent_version,
    bootTime: row.boot_time,
    fs: JSON.parse(row.fs || '[]'),
    firstSeen: row.first_seen,
    lastSeen: Math.max(row.last_seen, lastSeen.get(row.id) ?? 0),
    online: isOnline(row.id),
    latest: sample ? Object.fromEntries(['ts', ...METRICS].map((k) => [k, sample[k]])) : null,
    alerts: alerts.countsFor(row.id),
  };
}

function broadcastNode(id) {
  const node = nodeSummary(db.getNode(id));
  if (node) broadcast({ type: 'node', node });
}

// ---------------------------------------------------------------- ingestion

function sanitizeSample(s) {
  const t = now();
  const ts = Math.floor(Number(s?.ts));
  if (!Number.isFinite(ts) || ts < t - config.retentionHours * 3600 || ts > t + 60) return null;
  const m = {};
  for (const k of METRICS) {
    const v = Number(s.m?.[k]);
    m[k] = s.m?.[k] == null || !Number.isFinite(v) ? null : v;
  }
  return { ts, m };
}

function ingest(nodeId, rawSamples) {
  const samples = rawSamples.map(sanitizeSample).filter(Boolean).sort((a, b) => a.ts - b.ts);
  if (!samples.length) return;

  db.transaction(() => {
    for (const { ts, m } of samples) db.insertMetric(nodeId, ts, m);
    db.touchNode(nodeId, samples.at(-1).ts);
  });

  const wasFresh = isFresh(nodeId);
  lastSeen.set(nodeId, now());
  const fresh = now() - 10;
  for (const { ts, m } of samples) {
    alerts.onSample(nodeId, ts, m);
    if (ts >= (latest.get(nodeId)?.ts ?? 0)) latest.set(nodeId, { ts, ...m });
    if (ts >= fresh) broadcast({ type: 'sample', nodeId, ts, m });
  }
  if (!wasFresh) {
    alerts.setOnline(nodeId, true, now());
    broadcastNode(nodeId);
  }
}

function sanitizeNode(n) {
  const str = (v) => (v == null ? null : String(v).slice(0, 200));
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  if (typeof n?.id !== 'string' || !/^[\w-]{8,64}$/.test(n.id)) return null;
  return {
    id: n.id,
    hostname: str(n.hostname) || 'unknown',
    os: str(n.os),
    platform: str(n.platform),
    kernel: str(n.kernel),
    arch: str(n.arch),
    cpuModel: str(n.cpuModel),
    cores: num(n.cores),
    memTotal: num(n.memTotal),
    ip: str(n.ip),
    agentVersion: str(n.agentVersion),
    bootTime: num(n.bootTime),
    fs: Array.isArray(n.fs)
      ? n.fs.slice(0, 32).map((f) => ({
        mount: str(f.mount), type: str(f.type), size: num(f.size), used: num(f.used), pct: num(f.pct),
      }))
      : [],
  };
}

function handleAgent(ws) {
  let nodeId = null;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'hello' || msg.type === 'info') {
      const node = sanitizeNode(msg.node);
      if (!node) return ws.close(4000, 'invalid node info');
      if (nodeId && node.id !== nodeId) return ws.close(4000, 'node id changed');
      if (!nodeId) {
        nodeId = node.id;
        const previous = agents.get(nodeId);
        if (previous && previous !== ws) previous.close(4001, 'replaced by a newer connection');
        agents.set(nodeId, ws);
        console.log(`agent connected: ${node.hostname} (${nodeId})`);
      }
      db.upsertNode(node, now());
      broadcastNode(nodeId);
    } else if (!nodeId) {
      ws.close(4000, 'hello required');
    } else if (msg.type === 'metrics') {
      ingest(nodeId, [msg]);
    } else if (msg.type === 'batch' && Array.isArray(msg.samples)) {
      ingest(nodeId, msg.samples.slice(0, 5000));
    }
  });

  ws.on('close', () => {
    if (nodeId && agents.get(nodeId) === ws) {
      agents.delete(nodeId);
      console.log(`agent disconnected: ${nodeId}`);
      broadcastNode(nodeId);
    }
  });
}

// ---------------------------------------------------------------- HTTP

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

function dashboardAuthorized(req) {
  if (!config.dashboardPassword) return true;
  const [scheme, encoded] = (req.headers.authorization || '').split(' ');
  if (scheme !== 'Basic' || !encoded) return false;
  const decoded = Buffer.from(encoded, 'base64').toString();
  const sep = decoded.indexOf(':');
  return safeEqual(decoded.slice(0, sep), config.dashboardUser)
    && safeEqual(decoded.slice(sep + 1), config.dashboardPassword);
}

// Netdata-style time ranges: after/before are absolute unix seconds, or
// relative to now when <= 0 (after=-900&before=0 is "the last 15 minutes").
function parseRange(q, defaultPoints) {
  const t = now();
  const after = Number(q.after ?? -900);
  const before = Number(q.before ?? 0);
  const to = Math.floor(before <= 0 ? t + before : before);
  let from = Math.floor(after <= 0 ? t + after : after);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  if (from >= to) from = to - 1;
  const points = Math.min(2000, Math.max(10, Number(q.points) || defaultPoints));
  return { from, to, points };
}

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 'loopback');

// The installer and agent files hold no secrets, so remote machines can fetch
// them without dashboard credentials.
app.get('/install.sh', (req, res) => {
  const script = readFileSync(INSTALL_SCRIPT, 'utf8')
    .replaceAll('__NETNEW_URL__', `${req.protocol}://${req.get('host')}`);
  res.type('text/x-shellscript').send(script);
});
app.get('/agent/:file', (req, res) => {
  if (!['index.js', 'package.json'].includes(req.params.file)) return res.sendStatus(404);
  res.sendFile(req.params.file, { root: AGENT_DIR });
});

app.use((req, res, next) => {
  if (dashboardAuthorized(req)) return next();
  res.set('WWW-Authenticate', 'Basic realm="NetNew"').sendStatus(401);
});

const api = express.Router();

api.get('/health', (req, res) => {
  res.json({ ok: true, uptime: now() - startedAt, agents: agents.size });
});

api.get('/nodes', (req, res) => {
  res.json(db.listNodes().map(nodeSummary));
});

api.get('/nodes/:id', (req, res) => {
  const node = nodeSummary(db.getNode(req.params.id));
  if (!node) return res.status(404).json({ error: 'node not found' });
  res.json(node);
});

api.delete('/nodes/:id', (req, res) => {
  const { id } = req.params;
  if (!db.getNode(id)) return res.status(404).json({ error: 'node not found' });
  if (agents.has(id)) return res.status(409).json({ error: 'node is connected; stop its agent first' });
  db.deleteNode(id);
  alerts.forgetNode(id);
  latest.delete(id);
  lastSeen.delete(id);
  broadcast({ type: 'node_removed', id });
  res.status(204).end();
});

api.get('/nodes/:id/metrics', (req, res) => {
  if (!db.getNode(req.params.id)) return res.status(404).json({ error: 'node not found' });
  const range = parseRange(req.query, 900);
  if (!range) return res.status(400).json({ error: 'invalid after/before' });
  res.json({ ...range, ...db.history(req.params.id, range.from, range.to, range.points) });
});

api.get('/overview', (req, res) => {
  const range = parseRange(req.query, 300);
  if (!range) return res.status(400).json({ error: 'invalid after/before' });
  const data = db.overview(String(req.query.metric || 'cpu'), range.from, range.to, range.points);
  if (!data) return res.status(400).json({ error: 'unknown metric' });
  res.json({ ...range, ...data });
});

api.get('/alerts', (req, res) => {
  const rows = req.query.state === 'active' ? db.activeAlerts() : db.recentAlerts(200);
  res.json(rows.map(decorateAlert));
});

app.use('/api', api);
app.use('/api', (req, res) => res.status(404).json({ error: 'not found' }));

if (existsSync(WEB_DIST)) {
  app.use(express.static(WEB_DIST));
  app.get('/{*path}', (req, res) => res.sendFile('index.html', { root: WEB_DIST }));
} else {
  app.get('/', (req, res) => {
    res.type('text').send('Dashboard not built. Run `npm run build` (or `npm run dev:web` for development).');
  });
}

// ---------------------------------------------------------------- WebSockets

const server = createServer(app);
const agentWss = new WebSocketServer({ noServer: true, maxPayload: 4 * 1024 * 1024 });
const liveWss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

server.on('upgrade', (req, socket, head) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  const reject = (status) => {
    socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
  };

  if (pathname === '/ws/agent') {
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!safeEqual(token, config.agentToken)) return reject('401 Unauthorized');
    agentWss.handleUpgrade(req, socket, head, (ws) => handleAgent(ws));
  } else if (pathname === '/ws/live') {
    if (!dashboardAuthorized(req)) return reject('401 Unauthorized');
    liveWss.handleUpgrade(req, socket, head, (ws) => {
      dashboards.add(ws);
      ws.on('close', () => dashboards.delete(ws));
      ws.send(JSON.stringify({ type: 'hello', serverTime: now() }));
    });
  } else {
    reject('404 Not Found');
  }
});

// Drop agents that stopped answering pings (e.g. the machine lost power).
setInterval(() => {
  for (const ws of agentWss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 15_000).unref();

// Raise "node offline" for any known node that has been silent too long,
// including nodes that never reconnected after a server restart.
setInterval(() => {
  if (now() - startedAt < config.offlineAfterSec) return;
  for (const node of db.listNodes()) alerts.setOnline(node.id, isFresh(node.id), now());
}, 5_000).unref();

setInterval(() => {
  const t = now();
  db.prune(t - config.retentionHours * 3600, t - 7 * 86400);
}, 10 * 60_000).unref();

server.listen(config.port, config.host, () => {
  console.log(`NetNew server listening on http://${config.host}:${config.port}`);
  if (!config.agentTokenFromEnv) {
    console.log(`Agent token (saved in ${config.dataDir}/agent-token): ${config.agentToken}`);
  }
  if (!config.dashboardPassword) {
    console.log('Dashboard auth is disabled. Set DASHBOARD_PASSWORD to protect it.');
  }
});

function shutdown() {
  for (const ws of agentWss.clients) ws.close(1001, 'server shutting down');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
