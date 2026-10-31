// Collector jobs pushed by the server: service checks (HTTP, TCP, ping) and
// application collectors (Nginx, Redis, PostgreSQL, MySQL). Each job runs on
// its own interval; its charts are merged into the next per-second sample and
// its status is reported back so the server can alert on failures.
import { spawn } from 'node:child_process';
import net from 'node:net';

// Per-job counter -> rate, remembering the previous reading.
function rateFn() {
  let prev = new Map();
  return {
    rate(key, value, now) {
      const p = prev.get(key);
      prev.set(key, { value, now });
      if (!p || value < p.value || now <= p.now) return null;
      return (value - p.value) / ((now - p.now) / 1000);
    },
    reset() { prev = new Map(); },
  };
}

function statusMatches(code, expect) {
  return String(expect || '200-399').split(',').some((part) => {
    const [lo, hi] = part.trim().split('-').map(Number);
    return hi ? code >= lo && code <= hi : code === lo;
  });
}

function withTimeout(promise, ms, what) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms}ms`)), ms); }),
  ]).finally(() => clearTimeout(timer));
}

// ------------------------------------------------------------------ job types

async function http(job) {
  const c = job.config;
  const started = performance.now();
  const res = await fetch(c.url, { method: c.method || 'GET', redirect: 'follow', signal: AbortSignal.timeout(c.timeout_ms || 5000) });
  const latency = performance.now() - started;
  const body = c.match ? await res.text() : (await res.arrayBuffer(), '');
  if (!statusMatches(res.status, c.expect_status)) throw Object.assign(new Error(`HTTP ${res.status}`), { latency });
  if (c.match && !body.includes(c.match)) throw Object.assign(new Error(`body does not contain "${c.match}"`), { latency });
  return { latency };
}

function tcpConnect(host, port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const socket = net.connect({ host, port });
    socket.setTimeout(timeoutMs, () => socket.destroy(new Error(`connect timed out after ${timeoutMs}ms`)));
    socket.once('connect', () => {
      const latency = performance.now() - started;
      socket.destroy();
      resolve({ latency });
    });
    socket.once('error', reject);
  });
}

const tcp = (job) => tcpConnect(job.config.host, job.config.port, job.config.timeout_ms || 3000);

function ping(job) {
  const count = job.config.count || 3;
  return new Promise((resolve, reject) => {
    const proc = spawn('ping', ['-n', '-c', String(count), '-i', '0.3', '-W', '2', job.config.host]);
    let out = '';
    proc.stdout.on('data', (d) => { out += d; });
    proc.stderr.on('data', (d) => { out += d; });
    proc.on('error', (err) => reject(err.code === 'ENOENT' ? new Error('ping command not found on this node') : err));
    proc.on('close', () => {
      const times = [...out.matchAll(/time[=<]([\d.]+)\s*ms/g)].map((m) => Number(m[1]));
      const loss = Number(out.match(/([\d.]+)% packet loss/)?.[1] ?? (times.length ? 100 - (times.length / count) * 100 : 100));
      const latency = times.length ? times.reduce((a, b) => a + b, 0) / times.length : null;
      const charts = [['ping.loss', job.name, { loss }]];
      if (!times.length) return reject(Object.assign(new Error(out.trim().split('\n').pop() || 'no reply'), { charts }));
      resolve({ latency, charts });
    });
  });
}

async function nginx(job, r) {
  const started = performance.now();
  const res = await fetch(job.config.url, { signal: AbortSignal.timeout(5000) });
  const latency = performance.now() - started;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  const active = Number(text.match(/Active connections:\s*(\d+)/)?.[1]);
  const totals = text.match(/\n\s*(\d+)\s+(\d+)\s+(\d+)\s*\n/);
  const rw = text.match(/Reading:\s*(\d+)\s+Writing:\s*(\d+)\s+Waiting:\s*(\d+)/);
  if (!Number.isFinite(active) || !totals || !rw) throw new Error('not an nginx stub_status page');
  const now = Date.now();
  const charts = [['nginx.connections', job.name, { active, reading: Number(rw[1]), writing: Number(rw[2]), waiting: Number(rw[3]) }]];
  const requests = r.rate('requests', Number(totals[3]), now);
  if (requests != null) charts.push(['nginx.requests', job.name, { requests }]);
  return { latency, charts };
}

// Minimal RESP client: AUTH (optional) and INFO, then parse the bulk reply.
function redisInfo(host, port, password) {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const socket = net.connect({ host, port });
    let buf = '';
    socket.setTimeout(5000, () => socket.destroy(new Error('Redis timed out')));
    socket.once('connect', () => {
      if (password) socket.write(`*2\r\n$4\r\nAUTH\r\n$${Buffer.byteLength(password)}\r\n${password}\r\n`);
      socket.write('*1\r\n$4\r\nINFO\r\n');
    });
    socket.on('data', (d) => {
      buf += d;
      // Replies before the INFO bulk string are +OK (AUTH) or -ERR lines.
      const errLine = buf.split('$')[0].split('\r\n').find((l) => l.startsWith('-'));
      if (errLine) {
        socket.destroy();
        return reject(new Error(errLine.slice(1)));
      }
      const m = buf.match(/\$(\d+)\r\n/);
      if (!m) return;
      const start = buf.indexOf(m[0]) + m[0].length;
      if (Buffer.byteLength(buf.slice(start)) < Number(m[1])) return;
      socket.end();
      resolve({ info: buf.slice(start, start + Number(m[1])), latency: performance.now() - started });
    });
    socket.once('error', reject);
  });
}

async function redis(job, r) {
  const c = job.config;
  const { info, latency } = await redisInfo(c.host || '127.0.0.1', c.port || 6379, c.password);
  const v = Object.fromEntries(info.split('\r\n').filter((l) => l.includes(':')).map((l) => [l.slice(0, l.indexOf(':')), l.slice(l.indexOf(':') + 1)]));
  const n = (k) => Number(v[k] ?? 0);
  const now = Date.now();
  const keys = Object.entries(v).filter(([k]) => /^db\d+$/.test(k)).reduce((a, [, s]) => a + Number(s.match(/keys=(\d+)/)?.[1] ?? 0), 0);
  const charts = [
    ['redis.clients', job.name, { connected: n('connected_clients'), blocked: n('blocked_clients') }],
    ['redis.memory', job.name, { used: n('used_memory') }],
    ['redis.keys', job.name, { keys }],
  ];
  const ops = r.rate('ops', n('total_commands_processed'), now);
  if (ops != null) charts.push(['redis.ops', job.name, { operations: ops }]);
  const hits = r.rate('hits', n('keyspace_hits'), now);
  const misses = r.rate('misses', n('keyspace_misses'), now);
  if (hits != null && misses != null) charts.push(['redis.hits', job.name, { hits, misses }]);
  return { latency, charts };
}

// Database drivers are optional dependencies, loaded only when a job needs them.
async function optionalImport(name) {
  try {
    return await import(name);
  } catch {
    throw new Error(`the "${name}" package is not installed on this agent (run npm install in the agent directory)`);
  }
}

async function postgres(job, r) {
  const { default: pg } = await optionalImport('pg');
  const client = new pg.Client({ connectionString: job.config.dsn, connectionTimeoutMillis: 5000, statement_timeout: 5000 });
  const started = performance.now();
  try {
    await client.connect();
    const latency = performance.now() - started;
    const { rows: [s] } = await client.query(`
      SELECT sum(numbackends)::float8 AS conns, sum(xact_commit)::float8 AS commits, sum(xact_rollback)::float8 AS rollbacks,
             sum(blks_hit)::float8 AS hit, sum(blks_read)::float8 AS read FROM pg_stat_database`);
    const { rows: [size] } = await client.query('SELECT sum(pg_database_size(datname))::float8 AS bytes FROM pg_database');
    const now = Date.now();
    const charts = [
      ['postgres.connections', job.name, { connections: s.conns }],
      ['postgres.size', job.name, { size: size.bytes }],
    ];
    const commits = r.rate('commits', s.commits, now);
    const rollbacks = r.rate('rollbacks', s.rollbacks, now);
    if (commits != null) charts.push(['postgres.transactions', job.name, { commits, rollbacks: rollbacks ?? 0 }]);
    const hit = r.rate('hit', s.hit, now);
    const read = r.rate('read', s.read, now);
    if (hit != null && hit + read > 0) charts.push(['postgres.cache', job.name, { hit_ratio: (hit / (hit + read)) * 100 }]);
    return { latency, charts };
  } finally {
    client.end().catch(() => {});
  }
}

async function mysql(job, r) {
  const driver = await optionalImport('mysql2/promise');
  const started = performance.now();
  const conn = await driver.createConnection({ uri: job.config.dsn, connectTimeout: 5000 });
  try {
    const latency = performance.now() - started;
    const [rows] = await conn.query(`SHOW GLOBAL STATUS WHERE Variable_name IN
      ('Threads_connected','Threads_running','Questions','Slow_queries','Bytes_received','Bytes_sent')`);
    const v = Object.fromEntries(rows.map((x) => [x.Variable_name, Number(x.Value)]));
    const now = Date.now();
    const charts = [['mysql.connections', job.name, { connected: v.Threads_connected, running: v.Threads_running }]];
    const queries = r.rate('q', v.Questions, now);
    const slow = r.rate('slow', v.Slow_queries, now);
    if (queries != null) charts.push(['mysql.queries', job.name, { queries, slow: slow ?? 0 }]);
    const rx = r.rate('rx', v.Bytes_received, now);
    const tx = r.rate('tx', v.Bytes_sent, now);
    if (rx != null) charts.push(['mysql.net', job.name, { received: rx, sent: tx ?? 0 }]);
    return { latency, charts };
  } finally {
    conn.end().catch(() => {});
  }
}

const RUNNERS = { http, tcp, ping, nginx, redis, postgres, mysql };

// ------------------------------------------------------------------ scheduler

export function createJobRunner({ send, log }) {
  const jobs = new Map(); // id -> { def, timer, failures, rates }
  const statuses = new Map();
  let charts = [];

  async function run(entry) {
    const { def } = entry;
    const runner = RUNNERS[def.type];
    const started = Date.now();
    let result;
    try {
      if (!runner) throw new Error(`unknown job type ${def.type}`);
      result = await withTimeout(runner(def, entry.rates), 30_000, def.type);
      entry.failures = 0;
    } catch (err) {
      entry.failures++;
      result = { error: err.message, latency: err.latency ?? null, charts: err.charts };
    }
    if (!jobs.has(def.id) || jobs.get(def.id) !== entry) return; // reconfigured while running
    const ok = !result.error;
    charts.push(['check.up', def.name, { up: ok ? 1 : 0 }]);
    if (result.latency != null) charts.push(['check.latency', def.name, { latency: Math.round(result.latency * 10) / 10 }]);
    charts.push(...(result.charts ?? []));
    const status = { id: def.id, ok, error: result.error ?? null, latency: result.latency ?? null, failures: entry.failures, lastRun: Math.floor(started / 1000) };
    statuses.set(def.id, status);
    send({ type: 'jobs', list: [status] });
  }

  return {
    // Replaces the running set with the server's current job list.
    configure(list) {
      for (const entry of jobs.values()) clearInterval(entry.timer);
      jobs.clear();
      statuses.clear();
      for (const def of Array.isArray(list) ? list : []) {
        const entry = { def, failures: 0, rates: rateFn() };
        entry.timer = setInterval(() => run(entry), Math.max(1, def.config?.interval_s || 10) * 1000);
        jobs.set(def.id, entry);
        run(entry);
      }
      log(`collector jobs: ${jobs.size} configured${jobs.size ? ` (${[...jobs.values()].map((j) => `${j.def.type}:${j.def.name}`).join(', ')})` : ''}`);
    },
    // Re-report statuses after a reconnect.
    resend() {
      if (statuses.size) send({ type: 'jobs', list: [...statuses.values()] });
    },
    drainCharts() {
      const out = charts;
      charts = [];
      return out;
    },
    stop() {
      for (const entry of jobs.values()) clearInterval(entry.timer);
    },
  };
}
