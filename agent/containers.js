// Container monitoring:
//  - Docker: per-container CPU, memory, network and block I/O from the Docker
//    Engine API on its unix socket (one-shot stats, rates computed here).
//  - Kubernetes: pods on this node from the API server (when running in a pod
//    with a service account) and their CPU/memory/I/O from cgroup v2 files.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { join } from 'node:path';

const DOCKER_SOCKET = process.env.NETNEW_DOCKER_SOCKET || '/var/run/docker.sock';
const CGROUP_ROOT = process.env.NETNEW_CGROUP_ROOT || '/sys/fs/cgroup';
const K8S_NODE = process.env.NETNEW_K8S_NODE || null;
const SA_DIR = '/var/run/secrets/kubernetes.io/serviceaccount';
const INTERVAL_MS = 5000;
const POD_LIST_EVERY_MS = 15_000;

function dockerGet(path) {
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath: DOCKER_SOCKET, path, timeout: 5000 }, (res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => {
        if (res.statusCode >= 400) return reject(new Error(`Docker API ${res.statusCode}: ${body.slice(0, 200)}`));
        try { resolve(JSON.parse(body)); } catch (err) { reject(err); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('Docker API timeout')));
    req.on('error', reject);
    req.end();
  });
}

function k8sGet(path) {
  const host = process.env.KUBERNETES_SERVICE_HOST;
  const port = process.env.KUBERNETES_SERVICE_PORT || 443;
  const token = readFileSync(join(SA_DIR, 'token'), 'utf8').trim();
  return new Promise((resolve, reject) => {
    const req = https.request({
      host, port, path, timeout: 8000,
      ca: readFileSync(join(SA_DIR, 'ca.crt')),
      headers: { Authorization: `Bearer ${token}` },
    }, (res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => {
        if (res.statusCode >= 400) return reject(new Error(`Kubernetes API ${res.statusCode}: ${body.slice(0, 200)}`));
        try { resolve(JSON.parse(body)); } catch (err) { reject(err); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('Kubernetes API timeout')));
    req.on('error', reject);
    req.end();
  });
}

// Per-key counter -> rate, remembering the previous reading.
function rates() {
  const prev = new Map();
  return (key, value, now) => {
    const p = prev.get(key);
    prev.set(key, { value, now });
    if (!p || value < p.value || now <= p.now) return null;
    return (value - p.value) / ((now - p.now) / 1000);
  };
}

const sum = (xs) => xs.reduce((a, b) => a + (Number(b) || 0), 0);

// ------------------------------------------------------------------ Docker

const dockerRate = rates();

async function collectDocker(now) {
  if (!existsSync(DOCKER_SOCKET)) return { available: false, error: null, list: [] };
  const all = await dockerGet('/containers/json?all=1');
  const running = all.filter((c) => c.State === 'running');
  const stats = new Map();
  // Fetch stats a few at a time; one-shot avoids the API's 1s sampling delay.
  for (let i = 0; i < running.length; i += 8) {
    const chunk = running.slice(i, i + 8);
    const results = await Promise.allSettled(chunk.map((c) => dockerGet(`/containers/${c.Id}/stats?stream=false&one-shot=true`)));
    results.forEach((r, j) => { if (r.status === 'fulfilled') stats.set(chunk[j].Id, r.value); });
  }

  const list = all.map((c) => {
    const name = (c.Names?.[0] ?? c.Id.slice(0, 12)).replace(/^\//, '');
    const s = stats.get(c.Id);
    const entry = {
      id: c.Id.slice(0, 12),
      name,
      image: c.Image,
      state: c.State,
      status: c.Status,
      created: c.Created,
      pod: c.Labels?.['io.kubernetes.pod.name'] ?? null,
      namespace: c.Labels?.['io.kubernetes.pod.namespace'] ?? null,
      compose: c.Labels?.['com.docker.compose.project'] ?? null,
    };
    if (!s) return entry;
    const memStats = s.memory_stats?.stats ?? {};
    const cache = memStats.inactive_file ?? memStats.total_inactive_file ?? memStats.cache ?? 0;
    const nets = Object.values(s.networks ?? {});
    const io = s.blkio_stats?.io_service_bytes_recursive ?? [];
    const cpuNs = s.cpu_stats?.cpu_usage?.total_usage;
    const cpuRate = cpuNs != null ? dockerRate(`${c.Id}:cpu`, cpuNs, now) : null;
    return {
      ...entry,
      cpu: cpuRate != null ? (cpuRate / 1e9) * 100 : null, // % of one core
      mem: s.memory_stats?.usage != null ? Math.max(0, s.memory_stats.usage - cache) : null,
      memLimit: s.memory_stats?.limit ?? null,
      netRx: dockerRate(`${c.Id}:rx`, sum(nets.map((n) => n.rx_bytes)), now),
      netTx: dockerRate(`${c.Id}:tx`, sum(nets.map((n) => n.tx_bytes)), now),
      ioRead: dockerRate(`${c.Id}:rd`, sum(io.filter((e) => /^read$/i.test(e.op)).map((e) => e.value)), now),
      ioWrite: dockerRate(`${c.Id}:wr`, sum(io.filter((e) => /^write$/i.test(e.op)).map((e) => e.value)), now),
      pids: s.pids_stats?.current ?? null,
    };
  });
  return { available: true, error: null, list };
}

// ------------------------------------------------------------------ Kubernetes

const cgroupRate = rates();
let podMeta = new Map(); // pod uid -> metadata from the API server
let podMetaAt = 0;
let podMetaError = null;

// Finds pod cgroup directories (systemd or cgroupfs driver) up to a few levels deep.
function findPodCgroups() {
  const found = [];
  const walk = (dir, depth) => {
    if (depth > 4) return;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const m = e.name.match(/pod([0-9a-f]{8}[-_][0-9a-f]{4}[-_][0-9a-f]{4}[-_][0-9a-f]{4}[-_][0-9a-f]{12})/);
      if (m) found.push({ uid: m[1].replaceAll('_', '-'), path: join(dir, e.name) });
      else if (e.name.startsWith('kubepods')) walk(join(dir, e.name), depth + 1);
    }
  };
  walk(CGROUP_ROOT, 0);
  return found;
}

function readCgroup(path) {
  const read = (f) => { try { return readFileSync(join(path, f), 'utf8'); } catch { return null; } };
  const cpu = read('cpu.stat')?.match(/usage_usec (\d+)/);
  const mem = read('memory.current');
  let rbytes = 0;
  let wbytes = 0;
  for (const line of (read('io.stat') ?? '').split('\n')) {
    rbytes += Number(line.match(/rbytes=(\d+)/)?.[1] ?? 0);
    wbytes += Number(line.match(/wbytes=(\d+)/)?.[1] ?? 0);
  }
  return { cpuUsec: cpu ? Number(cpu[1]) : null, mem: mem != null ? Number(mem) : null, rbytes, wbytes };
}

async function refreshPodMeta(now, nodeName) {
  if (!process.env.KUBERNETES_SERVICE_HOST || !existsSync(join(SA_DIR, 'token'))) return;
  if (now - podMetaAt < POD_LIST_EVERY_MS) return;
  podMetaAt = now;
  try {
    const res = await k8sGet(`/api/v1/pods?fieldSelector=${encodeURIComponent(`spec.nodeName=${nodeName}`)}`);
    podMeta = new Map(res.items.map((p) => [p.metadata.uid, {
      name: p.metadata.name,
      namespace: p.metadata.namespace,
      phase: p.status?.phase ?? 'Unknown',
      restarts: sum((p.status?.containerStatuses ?? []).map((c) => c.restartCount)),
      containers: p.spec?.containers?.length ?? 0,
      started: p.status?.startTime ?? null,
      owner: p.metadata.ownerReferences?.[0]?.kind ?? null,
    }]));
    podMetaError = null;
  } catch (err) {
    podMetaError = err.message;
  }
}

async function collectK8s(now, nodeName) {
  await refreshPodMeta(now, nodeName);
  const cgroups = findPodCgroups();
  if (!cgroups.length && !podMeta.size) return { available: false, error: podMetaError, pods: [] };

  const seen = new Set();
  const pods = cgroups.map(({ uid, path }) => {
    seen.add(uid);
    const c = readCgroup(path);
    const meta = podMeta.get(uid);
    const cpuRate = c.cpuUsec != null ? cgroupRate(`${uid}:cpu`, c.cpuUsec, now) : null;
    return {
      uid,
      name: meta?.name ?? uid.slice(0, 8),
      namespace: meta?.namespace ?? null,
      phase: meta?.phase ?? 'Running',
      restarts: meta?.restarts ?? null,
      containers: meta?.containers ?? null,
      owner: meta?.owner ?? null,
      cpu: cpuRate != null ? (cpuRate / 1e6) * 100 : null,
      mem: c.mem,
      ioRead: cgroupRate(`${uid}:rd`, c.rbytes, now),
      ioWrite: cgroupRate(`${uid}:wr`, c.wbytes, now),
    };
  });
  // Pods the API knows about but without a cgroup (pending, completed).
  for (const [uid, meta] of podMeta) if (!seen.has(uid)) pods.push({ uid, ...meta, cpu: null, mem: null });
  return { available: true, error: podMetaError, pods };
}

// ------------------------------------------------------------------ collector

export function createContainerCollector({ send, log, nodeName }) {
  let charts = [];
  let timer = null;
  let running = false;
  let lastError = null;

  async function refresh() {
    if (running) return;
    running = true;
    try {
      await collect();
    } finally {
      running = false;
    }
  }

  async function collect() {
    const now = Date.now();
    const out = [];
    let docker;
    let k8s;
    try {
      docker = await collectDocker(now);
    } catch (err) {
      docker = { available: true, error: err.message, list: [] };
    }
    try {
      k8s = await collectK8s(now, K8S_NODE || nodeName);
    } catch (err) {
      k8s = { available: false, error: err.message, pods: [] };
    }
    const error = docker.error || k8s.error;
    if (error && error !== lastError) log('container collection:', error);
    lastError = error;

    if (docker.available && !docker.error) {
      const states = { running: 0, paused: 0, restarting: 0, exited: 0, other: 0 };
      for (const c of docker.list) states[c.state in states ? c.state : 'other']++;
      out.push(['docker.containers', '', states]);
      for (const c of docker.list.filter((x) => x.state === 'running')) {
        if (c.cpu != null) out.push(['container.cpu', c.name, { cpu: c.cpu }]);
        if (c.mem != null) out.push(['container.mem', c.name, { used: c.mem }]);
        if (c.netRx != null) out.push(['container.net', c.name, { received: c.netRx, sent: c.netTx }]);
        if (c.ioRead != null) out.push(['container.io', c.name, { read: c.ioRead, write: c.ioWrite }]);
      }
    }
    if (k8s.available) {
      const phases = { running: 0, pending: 0, succeeded: 0, failed: 0, unknown: 0 };
      for (const p of k8s.pods) {
        const key = String(p.phase).toLowerCase();
        phases[key in phases ? key : 'unknown']++;
        const instance = p.namespace ? `${p.namespace}/${p.name}` : p.name;
        if (p.cpu != null) out.push(['k8s.pod.cpu', instance, { cpu: p.cpu }]);
        if (p.mem != null) out.push(['k8s.pod.mem', instance, { used: p.mem }]);
        if (p.ioRead != null) out.push(['k8s.pod.io', instance, { read: p.ioRead, write: p.ioWrite }]);
      }
      out.push(['k8s.pods', '', phases]);
    }
    charts = out;
    if (docker.available || k8s.available) send({ type: 'containers', docker, k8s });
  }

  return {
    start() {
      refresh();
      timer = setInterval(refresh, INTERVAL_MS);
    },
    stop() { clearInterval(timer); },
    // Charts from the latest refresh, included once in the next sample.
    drainCharts() {
      const out = charts;
      charts = [];
      return out;
    },
  };
}
