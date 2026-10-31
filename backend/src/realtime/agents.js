// Agent protocol over WebSocket (/ws/agent). After a `hello` with node info,
// an agent streams `metrics`/`batch` samples, and periodically `processes`,
// `logs`, `containers`, `jobs` (collector job results) and `services`. The
// server pushes `config` with the node's collector jobs.
import { METRICS } from '../db/index.js';

const CHART_RE = /^[a-z0-9_.]{1,64}$/;
const str = (v, max) => (v == null ? '' : String(v).slice(0, max));
const num = (v) => (v != null && Number.isFinite(Number(v)) ? Number(v) : null);

function sanitizeCharts(d) {
  if (!Array.isArray(d)) return [];
  const out = [];
  for (const entry of d.slice(0, 500)) {
    if (!Array.isArray(entry) || entry.length !== 3) continue;
    const [chart, instance, dims] = entry;
    if (typeof chart !== 'string' || !CHART_RE.test(chart)) continue;
    if (typeof instance !== 'string' || instance.length > 128) continue;
    if (!dims || typeof dims !== 'object') continue;
    const clean = {};
    for (const [k, v] of Object.entries(dims).slice(0, 256)) {
      if (k.length <= 64 && typeof v === 'number' && Number.isFinite(v)) clean[k] = v;
    }
    if (Object.keys(clean).length) out.push([chart, instance, clean]);
  }
  return out;
}

export function sanitizeNode(n) {
  const s = (v) => (v == null ? null : String(v).slice(0, 200));
  if (typeof n?.id !== 'string' || !/^[\w-]{8,64}$/.test(n.id)) return null;
  return {
    id: n.id,
    hostname: s(n.hostname) || 'unknown',
    os: s(n.os),
    platform: s(n.platform),
    kernel: s(n.kernel),
    arch: s(n.arch),
    cpuModel: s(n.cpuModel),
    cores: num(n.cores),
    memTotal: num(n.memTotal),
    ip: s(n.ip),
    agentVersion: s(n.agentVersion),
    bootTime: num(n.bootTime),
    fs: Array.isArray(n.fs)
      ? n.fs.slice(0, 32).map((f) => ({
        mount: s(f.mount), type: s(f.type), size: num(f.size), used: num(f.used), pct: num(f.pct),
      }))
      : [],
  };
}

function sanitizeProcesses(msg, now) {
  const counts = msg.counts ?? {};
  return {
    ts: num(msg.ts) ?? now,
    counts: { all: num(counts.all), running: num(counts.running), blocked: num(counts.blocked), sleeping: num(counts.sleeping) },
    list: (Array.isArray(msg.list) ? msg.list.slice(0, 100) : []).map((p) => ({
      pid: num(p.pid),
      name: str(p.name, 100),
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

export function createAgentProtocol(core) {
  const { db, config, alerts, anomalies, broadcast, now } = core;

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
        for (const [chart, instance, dims] of d) db.insertChart(nodeId, ts, chart, instance, dims);
      }
      db.touchNode(nodeId, samples.at(-1).ts);
    });

    const wasFresh = core.isFresh(nodeId);
    core.lastSeen.set(nodeId, now());
    const fresh = now() - 10;
    for (const { ts, m } of samples) {
      alerts.onSample(nodeId, ts, m);
      anomalies.observe(nodeId, ts, m);
      if (ts >= (core.latest.get(nodeId)?.ts ?? 0)) core.latest.set(nodeId, { ts, ...m });
      if (ts >= fresh) broadcast({ type: 'sample', nodeId, ts, m });
    }
    if (!wasFresh) {
      alerts.setOnline(nodeId, true, now());
      core.broadcastNode(nodeId);
    }
  }

  function ingestLogs(nodeId, entries) {
    const nowMs = Date.now();
    const clean = entries.slice(0, 5000).map((e) => {
      const ts = Number(e?.ts);
      const priority = Math.trunc(Number(e?.priority));
      return {
        ts: Number.isFinite(ts) && ts > nowMs - 7 * 86400_000 && ts < nowMs + 60_000 ? Math.trunc(ts) : nowMs,
        priority: priority >= 0 && priority <= 7 ? priority : 6,
        source: str(e?.source, 20) || 'file',
        service: str(e?.service, 100) || 'unknown',
        message: str(e?.message, 8000),
      };
    }).filter((e) => e.message);
    if (!clean.length) return;
    core.logs.insert(nodeId, clean);
    broadcast({ type: 'logs', nodeId, count: clean.length });
  }

  function jobResults(nodeId, list) {
    const t = now();
    for (const s of (Array.isArray(list) ? list : []).slice(0, 500)) {
      const job = db.getJob(Number(s?.id));
      if (!job || job.node_id !== nodeId) continue;
      const status = {
        ok: Boolean(s.ok), error: str(s.error, 300) || null, latency: num(s.latency),
        failures: num(s.failures) ?? 0, lastRun: num(s.lastRun) ?? t,
      };
      core.jobStatus.set(job.id, status);
      const failing = !status.ok && status.failures >= 2;
      alerts.setState(nodeId, `check:${job.id}`, failing ? 'critical' : 'clear', status.latency,
        failing ? `${job.name} (${job.type}) failed ${status.failures} times: ${status.error ?? 'unknown error'}` : '', t);
    }
  }

  function serviceUnits(nodeId, msg) {
    const list = (Array.isArray(msg.list) ? msg.list : []).slice(0, 2000).map((u) => ({
      unit: str(u?.unit, 200), load: str(u?.load, 20), active: str(u?.active, 20), sub: str(u?.sub, 30), description: str(u?.description, 200),
    }));
    core.services.set(nodeId, { ts: now(), available: msg.available !== false, error: str(msg.error, 300) || null, list });
    const failed = list.filter((u) => u.active === 'failed');
    alerts.setState(nodeId, 'systemd_failed', failed.length ? 'warning' : 'clear', failed.length,
      failed.length ? `${failed.length} failed: ${failed.slice(0, 5).map((u) => u.unit).join(', ')}${failed.length > 5 ? '…' : ''}` : '', now());
  }

  /** Handles one agent WebSocket for its lifetime. */
  return function handleAgent(ws) {
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
          const previous = core.agents.get(nodeId);
          if (previous && previous !== ws) previous.close(4001, 'replaced by a newer connection');
          core.agents.set(nodeId, ws);
          console.log(`agent connected: ${node.hostname} (${nodeId})`);
          if (isNew) core.addEvent(nodeId, 'node.created', 'info', `New node ${node.hostname} joined the workspace`);
          core.addEvent(nodeId, 'node.connected', 'info', `Agent connected (${node.agentVersion ?? 'unknown version'})`);
          core.pushJobs(nodeId);
        }
        core.broadcastNode(nodeId);
      } else if (!nodeId) {
        ws.close(4000, 'hello required');
      } else if (msg.type === 'metrics') {
        ingest(nodeId, [msg]);
      } else if (msg.type === 'batch' && Array.isArray(msg.samples)) {
        ingest(nodeId, msg.samples.slice(0, 5000));
      } else if (msg.type === 'processes') {
        core.processes.set(nodeId, sanitizeProcesses(msg, now()));
      } else if (msg.type === 'logs' && Array.isArray(msg.entries)) {
        ingestLogs(nodeId, msg.entries);
      } else if (msg.type === 'containers') {
        core.containers.set(nodeId, { ts: now(), docker: sanitizeInventory(msg.docker), k8s: sanitizeInventory(msg.k8s) });
      } else if (msg.type === 'jobs') {
        jobResults(nodeId, msg.list);
      } else if (msg.type === 'services') {
        serviceUnits(nodeId, msg);
      }
    });

    ws.on('close', () => {
      if (nodeId && core.agents.get(nodeId) === ws) {
        core.agents.delete(nodeId);
        console.log(`agent disconnected: ${nodeId}`);
        core.addEvent(nodeId, 'node.disconnected', 'warning', 'Agent disconnected');
        core.broadcastNode(nodeId);
      }
    });
  };
}
