import { timingSafeEqual } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer } from 'ws';
import { createAlertEngine, RULE_NAMES } from './alerts.js';
import { createAnomalyDetector } from './anomalies.js';
import { createApi } from './api.js';
import { config } from './config.js';
import { METRICS, openDb } from './db.js';
import { agentJob } from './jobs.js';
import { createLogStore } from './logstore.js';
import { createNotifier } from './notify.js';

const VERSION = '0.3.0';
const WEB_DIST = fileURLToPath(new URL('../../web/dist', import.meta.url));
const AGENT_DIR = fileURLToPath(new URL('../../agent', import.meta.url));
const INSTALL_SCRIPT = fileURLToPath(new URL('./install.sh', import.meta.url));

const now = () => Math.floor(Date.now() / 1000);
const startedAt = now();

const db = openDb(config.dbPath);
const dashboards = new Set(); // browser sockets receiving live updates
const agents = new Map(); // nodeId -> agent socket
const lastSeen = new Map(); // nodeId -> unix seconds of the last sample received
const latest = new Map(); // nodeId -> most recent summary sample
const processes = new Map(); // nodeId -> latest process snapshot (memory only)
const containers = new Map(); // nodeId -> latest Docker/Kubernetes inventory
const services = new Map(); // nodeId -> latest systemd service units
const jobStatus = new Map(); // job id -> last run result reported by the agent
const logs = createLogStore(db.raw, db.transaction);

for (const node of db.listNodes()) {
  const m = db.latestMetric(node.id);
  if (m) latest.set(node.id, m);
}

function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const ws of dashboards) if (ws.readyState === ws.OPEN) ws.send(data);
}

function addEvent(nodeId, type, severity, message) {
  const event = db.addEvent(now(), nodeId, type, severity, message);
  broadcast({ type: 'event', event: { ...event, hostname: nodeId ? db.getNode(nodeId)?.hostname : null } });
}

function alertName(rule) {
  if (rule.startsWith('check:')) {
    const job = db.getJob(Number(rule.slice(6)));
    return `Check failed: ${job?.name ?? 'deleted job'}`;
  }
  if (rule === 'systemd_failed') return 'Failed systemd units';
  return RULE_NAMES[rule] ?? rule;
}

function decorateAlert(a) {
  return { ...a, name: alertName(a.rule), hostname: a.hostname ?? db.getNode(a.node_id)?.hostname };
}

const notifier = createNotifier({
  db,
  publicUrl: config.publicUrl,
  onFailure: (channel, err) => {
    console.warn(`notification to "${channel.name}" failed: ${err.message}`);
    addEvent(null, 'notification.failed', 'warning', `Notification to "${channel.name}" failed: ${err.message}`);
  },
});

const alerts = createAlertEngine(db, (kind, alert) => {
  const decorated = decorateAlert(alert);
  const host = decorated.hostname ?? alert.node_id;
  if (kind === 'cleared') {
    addEvent(alert.node_id, 'alert.cleared', 'clear', `${decorated.name} cleared`);
  } else {
    addEvent(alert.node_id, `alert.${kind}`, alert.severity, alert.message);
  }
  notifier.onAlert(kind, decorated, host);
  broadcast({ type: 'alert', kind, alert: decorated });
  broadcastNode(alert.node_id);
});

const anomalies = createAnomalyDetector(db);

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
    connected: agents.has(row.id),
    latest: sample ? Object.fromEntries(['ts', ...METRICS].map((k) => [k, sample[k]])) : null,
    alerts: alerts.countsFor(row.id),
  };
}

function broadcastNode(id) {
  const node = nodeSummary(db.getNode(id));
  if (node) broadcast({ type: 'node', node });
}

function removeNode(node) {
  db.deleteNode(node.id);
  logs.deleteNode(node.id);
  containers.delete(node.id);
  services.delete(node.id);
  alerts.forgetNode(node.id);
  anomalies.forgetNode(node.id);
  latest.delete(node.id);
  lastSeen.delete(node.id);
  processes.delete(node.id);
  addEvent(null, 'node.removed', 'info', `Node ${node.hostname} was removed`);
  broadcast({ type: 'node_removed', id: node.id });
}

// ---------------------------------------------------------------- ingestion

const CONTEXT_RE = /^[a-z0-9_.]{1,64}$/;

function sanitizeCharts(d) {
  if (!Array.isArray(d)) return [];
  const out = [];
  for (const entry of d.slice(0, 500)) {
    if (!Array.isArray(entry) || entry.length !== 3) continue;
    const [context, instance, dims] = entry;
    if (typeof context !== 'string' || !CONTEXT_RE.test(context)) continue;
    if (typeof instance !== 'string' || instance.length > 128) continue;
    if (!dims || typeof dims !== 'object') continue;
    const clean = {};
    for (const [k, v] of Object.entries(dims).slice(0, 256)) {
      if (k.length <= 64 && typeof v === 'number' && Number.isFinite(v)) clean[k] = v;
    }
    if (Object.keys(clean).length) out.push([context, instance, clean]);
  }
  return out;
}

function sanitizeSample(s) {
  const t = now();
  const ts = Math.floor(Number(s?.ts));
  if (!Number.isFinite(ts) || ts < t - config.retentionHours * 3600 || ts > t + 60) return null;
  const m = {};
  for (const k of METRICS) {
    const v = Number(s.m?.[k]);
    m[k] = s.m?.[k] == null || !Number.isFinite(v) ? null : v;
  }
  return { ts, m, d: sanitizeCharts(s.d) };
}

function ingest(nodeId, rawSamples) {
  const samples = rawSamples.map(sanitizeSample).filter(Boolean).sort((a, b) => a.ts - b.ts);
  if (!samples.length) return;

  db.transaction(() => {
    for (const { ts, m, d } of samples) {
      db.insertMetric(nodeId, ts, m);
      for (const [context, instance, dims] of d) db.insertChart(nodeId, ts, context, instance, dims);
    }
    db.touchNode(nodeId, samples.at(-1).ts);
  });

  const wasFresh = isFresh(nodeId);
  lastSeen.set(nodeId, now());
  const fresh = now() - 10;
  for (const { ts, m } of samples) {
    alerts.onSample(nodeId, ts, m);
    anomalies.observe(nodeId, ts, m);
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

function sanitizeProcesses(msg) {
  const str = (v, max = 100) => (v == null ? '' : String(v).slice(0, max));
  const counts = msg.counts ?? {};
  return {
    ts: num(msg.ts) ?? now(),
    counts: { all: num(counts.all), running: num(counts.running), blocked: num(counts.blocked), sleeping: num(counts.sleeping) },
    list: (Array.isArray(msg.list) ? msg.list.slice(0, 100) : []).map((p) => ({
      pid: num(p.pid),
      name: str(p.name),
      user: str(p.user, 64),
      cpu: num(p.cpu),
      mem: num(p.mem),
      rss: num(p.rss),
      state: str(p.state, 32),
      started: str(p.started, 32),
      command: str(p.command, 300),
    })),
  };
}

const str = (v, max) => (v == null ? '' : String(v).slice(0, max));
const num = (v) => (v != null && Number.isFinite(Number(v)) ? Number(v) : null);

function ingestLogs(nodeId, entries) {
  const now = Date.now();
  const clean = entries.slice(0, 5000).map((e) => {
    const ts = Number(e?.ts);
    const priority = Math.trunc(Number(e?.priority));
    return {
      ts: Number.isFinite(ts) && ts > now - 7 * 86400_000 && ts < now + 60_000 ? Math.trunc(ts) : now,
      priority: priority >= 0 && priority <= 7 ? priority : 6,
      source: str(e?.source, 20) || 'file',
      service: str(e?.service, 100) || 'unknown',
      message: str(e?.message, 8000),
    };
  }).filter((e) => e.message);
  if (!clean.length) return;
  logs.insert(nodeId, clean);
  broadcast({ type: 'logs', nodeId, count: clean.length });
}

// Inventories are kept as reported, with every value coerced to a string or number.
function sanitizeInventory(value, depth = 0) {
  if (depth > 4) return null;
  if (Array.isArray(value)) return value.slice(0, 500).map((v) => sanitizeInventory(v, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).slice(0, 60)
      .map(([k, v]) => [str(k, 64), sanitizeInventory(v, depth + 1)]));
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value;
  return value == null ? null : str(value, 500);
}

function handleJobStatus(nodeId, list) {
  const t = now();
  for (const s of (Array.isArray(list) ? list : []).slice(0, 500)) {
    const job = db.getJob(Number(s?.id));
    if (!job || job.node_id !== nodeId) continue;
    const status = {
      ok: Boolean(s.ok), error: str(s.error, 300) || null, latency: num(s.latency),
      failures: num(s.failures) ?? 0, lastRun: num(s.lastRun) ?? t,
    };
    jobStatus.set(job.id, status);
    const failing = !status.ok && status.failures >= 2;
    alerts.setState(nodeId, `check:${job.id}`, failing ? 'critical' : 'clear', status.latency,
      failing ? `${job.name} (${job.type}) failed ${status.failures} times: ${status.error ?? 'unknown error'}` : '', t);
  }
}

function handleServices(nodeId, msg) {
  const list = (Array.isArray(msg.list) ? msg.list : []).slice(0, 2000).map((u) => ({
    unit: str(u?.unit, 200), load: str(u?.load, 20), active: str(u?.active, 20), sub: str(u?.sub, 30), description: str(u?.description, 200),
  }));
  services.set(nodeId, { ts: now(), available: msg.available !== false, error: str(msg.error, 300) || null, list });
  const failed = list.filter((u) => u.active === 'failed');
  alerts.setState(nodeId, 'systemd_failed', failed.length ? 'warning' : 'clear', failed.length,
    failed.length ? `${failed.length} failed: ${failed.slice(0, 5).map((u) => u.unit).join(', ')}${failed.length > 5 ? '…' : ''}` : '', now());
}

// Sends a node's enabled collector jobs to its agent (on connect and on change).
function pushJobs(nodeId) {
  const ws = agents.get(nodeId);
  if (ws?.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'config', jobs: db.jobsForNode(nodeId).map(agentJob) }));
}

function clearJob(job) {
  jobStatus.delete(job.id);
  alerts.setState(job.node_id, `check:${job.id}`, 'clear', null, '', now());
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
      const isNew = db.upsertNode(node, now());
      if (!nodeId) {
        nodeId = node.id;
        const previous = agents.get(nodeId);
        if (previous && previous !== ws) previous.close(4001, 'replaced by a newer connection');
        agents.set(nodeId, ws);
        console.log(`agent connected: ${node.hostname} (${nodeId})`);
        if (isNew) addEvent(nodeId, 'node.created', 'info', `New node ${node.hostname} joined the space`);
        addEvent(nodeId, 'node.connected', 'info', `Agent connected (${node.agentVersion ?? 'unknown version'})`);
        pushJobs(nodeId);
      }
      broadcastNode(nodeId);
    } else if (!nodeId) {
      ws.close(4000, 'hello required');
    } else if (msg.type === 'metrics') {
      ingest(nodeId, [msg]);
    } else if (msg.type === 'batch' && Array.isArray(msg.samples)) {
      ingest(nodeId, msg.samples.slice(0, 5000));
    } else if (msg.type === 'processes') {
      processes.set(nodeId, sanitizeProcesses(msg));
    } else if (msg.type === 'logs' && Array.isArray(msg.entries)) {
      ingestLogs(nodeId, msg.entries);
    } else if (msg.type === 'containers') {
      containers.set(nodeId, { ts: now(), docker: sanitizeInventory(msg.docker), k8s: sanitizeInventory(msg.k8s) });
    } else if (msg.type === 'jobs') {
      handleJobStatus(nodeId, msg.list);
    } else if (msg.type === 'services') {
      handleServices(nodeId, msg);
    }
  });

  ws.on('close', () => {
    if (nodeId && agents.get(nodeId) === ws) {
      agents.delete(nodeId);
      console.log(`agent disconnected: ${nodeId}`);
      addEvent(nodeId, 'node.disconnected', 'warning', 'Agent disconnected');
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

const core = {
  db,
  config,
  version: VERSION,
  now,
  startedAt,
  agents,
  processes,
  containers,
  services,
  jobStatus,
  logs,
  pushJobs,
  clearJob,
  nodeSummary,
  decorateAlert,
  broadcast,
  notifier,
  removeNode,
};

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
// The agent is a handful of flat .js files plus package.json; the manifest
// lets installers fetch whatever the current version consists of.
const agentFiles = () => readdirSync(AGENT_DIR).filter((f) => /^[a-z]+\.js$/.test(f) || f === 'package.json').sort();
app.get('/agent/manifest', (req, res) => res.type('text').send(`${agentFiles().join('\n')}\n`));
app.get('/agent/:file', (req, res) => {
  if (!agentFiles().includes(req.params.file)) return res.sendStatus(404);
  res.sendFile(req.params.file, { root: AGENT_DIR });
});

app.use((req, res, next) => {
  if (dashboardAuthorized(req)) return next();
  res.set('WWW-Authenticate', 'Basic realm="NetNew"').sendStatus(401);
});

app.use('/api', createApi(core));

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
const agentWss = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 * 1024 });
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
  logs.prune((t - config.logRetentionHours * 3600) * 1000, config.logMaxRows);
}, 10 * 60_000).unref();

// Per-minute rollups for long-range charts.
db.rollup(now());
setInterval(() => db.rollup(now()), 60_000).unref();

server.listen(config.port, config.host, () => {
  console.log(`NetNew server ${VERSION} listening on http://${config.host}:${config.port}`);
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
