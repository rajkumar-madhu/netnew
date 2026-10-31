// The monitoring core: in-memory state about connected agents and nodes, the
// alert/anomaly/notification services, and the live event hub. HTTP routes and
// the agent protocol both work through this object.
import { createAlertEngine, RULE_NAMES } from './services/alerts.js';
import { createAnomalyDetector } from './services/anomalies.js';
import { agentJob } from './services/jobs.js';
import { createNotifier } from './services/notifier.js';
import { METRICS } from './db/index.js';
import { createLogStore } from './db/logs.js';

export const VERSION = '1.0.0';

export function createCore({ config, db }) {
  const now = () => Math.floor(Date.now() / 1000);
  const startedAt = now();

  const liveSockets = new Set(); // dashboard sockets receiving live updates
  const agents = new Map(); // nodeId -> agent socket
  const lastSeen = new Map(); // nodeId -> unix seconds of the last sample received
  const latest = new Map(); // nodeId -> most recent summary sample
  const processes = new Map(); // nodeId -> latest process snapshot
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
    for (const ws of liveSockets) if (ws.readyState === ws.OPEN) ws.send(data);
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

  const decorateAlert = (a) => ({ ...a, name: alertName(a.rule), hostname: a.hostname ?? db.getNode(a.node_id)?.hostname });

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
    if (kind === 'cleared') addEvent(alert.node_id, 'alert.cleared', 'clear', `${decorated.name} cleared`);
    else addEvent(alert.node_id, `alert.${kind}`, alert.severity, alert.message);
    notifier.onAlert(kind, decorated, decorated.hostname ?? alert.node_id);
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
    for (const map of [containers, services, latest, lastSeen, processes]) map.delete(node.id);
    alerts.forgetNode(node.id);
    anomalies.forgetNode(node.id);
    addEvent(null, 'node.removed', 'info', `Node ${node.hostname} was removed`);
    broadcast({ type: 'node_removed', id: node.id });
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

  // Name shown in the UI; set during setup, with the env var as the default.
  const workspaceName = () => db.getSetting('workspace_name') ?? config.workspaceName;

  // Background work: offline detection, retention and rollups.
  function startTimers() {
    const timers = [
      // Raise "node offline" for any known node that has been silent too long,
      // including nodes that never reconnected after a server restart.
      setInterval(() => {
        if (now() - startedAt < config.offlineAfterSec) return;
        for (const node of db.listNodes()) alerts.setOnline(node.id, isFresh(node.id), now());
      }, 5_000),
      setInterval(() => {
        const t = now();
        db.prune(t - config.retentionHours * 3600, t - 7 * 86400, t);
        logs.prune((t - config.logRetentionHours * 3600) * 1000, config.logMaxRows);
      }, 10 * 60_000),
      setInterval(() => db.rollup(now()), 60_000),
    ];
    db.rollup(now());
    for (const t of timers) t.unref();
    return () => timers.forEach(clearInterval);
  }

  return {
    db,
    config,
    version: VERSION,
    now,
    startedAt,
    liveSockets,
    agents,
    lastSeen,
    latest,
    processes,
    containers,
    services,
    jobStatus,
    logs,
    alerts,
    anomalies,
    notifier,
    broadcast,
    addEvent,
    decorateAlert,
    isFresh,
    isOnline,
    nodeSummary,
    broadcastNode,
    removeNode,
    pushJobs,
    clearJob,
    workspaceName,
    startTimers,
  };
}
