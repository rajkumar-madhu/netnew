#!/usr/bin/env node
// NetNew agent: collects system metrics every second and streams them to the
// NetNew server over a WebSocket. Samples are buffered while disconnected and
// flushed on reconnect, so short network blips don't leave holes in charts.
//
// Each sample carries a fixed summary (`m`, used for overview cards and
// alerts) and Netdata-style dimensional charts (`d`), as
// [context, instance, { dimension: value }] tuples.
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import si from 'systeminformation';
import WebSocket from 'ws';
import { createContainerCollector } from './containers.js';
import { createJobRunner } from './jobs.js';
import { createLogCollector } from './logs.js';
import { createServiceCollector } from './services.js';

const VERSION = '0.3.0';
const SERVER_URL = process.env.NETNEW_URL || 'http://localhost:3000';
const TOKEN = process.env.NETNEW_TOKEN;
const INTERVAL_MS = Math.max(250, Number(process.env.NETNEW_INTERVAL_MS) || 1000);
const STATE_DIR = process.env.NETNEW_STATE_DIR || join(os.homedir(), '.netnew-agent');
const HOSTNAME = process.env.NETNEW_HOSTNAME || os.hostname();
const MAX_BUFFER = 900; // ~15 minutes of samples at 1/s
const INFO_EVERY_MS = 60_000;
const FS_EVERY_MS = 30_000;
const PROCESSES_EVERY_MS = 3_000;
const SENSORS_EVERY_MS = 10_000;
const TOP_PROCESSES = 60;
const IS_LINUX = process.platform === 'linux';
// Comma-separated log files to tail, e.g. /var/log/nginx/error.log,/var/log/app.log
const LOG_FILES = (process.env.NETNEW_LOG_FILES || '').split(',').map((s) => s.trim()).filter(Boolean);
// Modules to turn off: any of logs, journal, containers, services, processes.
const DISABLED = new Set((process.env.NETNEW_DISABLE || '').split(',').map((s) => s.trim()).filter(Boolean));

// Virtual and pseudo filesystems/interfaces/disks that would double count or add noise.
const IGNORED_FS = /^(tmpfs|devtmpfs|squashfs|proc|sysfs|cgroup2?|devpts|mqueue|efivarfs|nsfs|autofs|tracefs|debugfs|securityfs|fusectl|configfs|pstore|bpf|hugetlbfs|ramfs|binfmt_misc)$/;
const IGNORED_IFACE = /^(lo|veth|docker|br-|virbr|cni|flannel|cali|vxlan|tun|utun|awdl|llw|bridge|ifb)/;
const IGNORED_DISK = /^(loop|ram|zram|fd|sr)/;

const log = (...args) => console.log(new Date().toISOString(), ...args);

if (!TOKEN) {
  console.error('NETNEW_TOKEN is required (find it in the server\'s data/agent-token file).');
  process.exit(1);
}

function wsUrl() {
  const base = SERVER_URL.endsWith('/') ? SERVER_URL : `${SERVER_URL}/`;
  const url = new URL('ws/agent', base);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

function loadNodeId() {
  if (process.env.NETNEW_NODE_ID) return process.env.NETNEW_NODE_ID;
  const file = join(STATE_DIR, 'node-id');
  try {
    const id = readFileSync(file, 'utf8').trim();
    if (id) return id;
  } catch {}
  const id = randomUUID();
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(file, `${id}\n`);
  return id;
}

function primaryIp() {
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    if (IGNORED_IFACE.test(name)) continue;
    const v4 = addrs?.find((a) => a.family === 'IPv4' && !a.internal);
    if (v4) return v4.address;
  }
  return null;
}

const round = (v, digits = 2) => (Number.isFinite(v) ? Math.round(v * 10 ** digits) / 10 ** digits : null);
const sumOf = (values) => {
  const finite = values.filter(Number.isFinite);
  return finite.length ? finite.reduce((a, b) => a + b, 0) : null;
};

// Turns monotonically increasing counters into per-second rates.
function rateTracker() {
  let prev = null;
  return (counters, now) => {
    const last = prev;
    prev = { counters, now };
    if (!last) return null;
    const dt = (now - last.now) / 1000;
    if (dt <= 0) return null;
    const rates = {};
    for (const [key, value] of Object.entries(counters)) {
      const before = last.counters[key];
      if (before == null) continue;
      rates[key] = Math.max(0, value - before) / dt;
    }
    return { rates, dt };
  };
}

// ---------------------------------------------------------------- Linux /proc readers

const CPU_FIELDS = ['user', 'nice', 'system', 'idle', 'iowait', 'irq', 'softirq', 'steal'];
let prevCpu = null;

function readProcStat() {
  const text = readFileSync('/proc/stat', 'utf8');
  const cpus = {};
  const out = { cpus };
  for (const line of text.split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (parts[0].startsWith('cpu')) {
      cpus[parts[0]] = parts.slice(1, 1 + CPU_FIELDS.length).map(Number);
    } else if (parts[0] === 'ctxt') out.ctxt = Number(parts[1]);
    else if (parts[0] === 'intr') out.intr = Number(parts[1]);
    else if (parts[0] === 'processes') out.forks = Number(parts[1]);
    else if (parts[0] === 'procs_running') out.running = Number(parts[1]);
    else if (parts[0] === 'procs_blocked') out.blocked = Number(parts[1]);
  }
  return out;
}

function cpuPercents(now, prev) {
  const delta = now.map((v, i) => Math.max(0, v - (prev?.[i] ?? 0)));
  const total = delta.reduce((a, b) => a + b, 0);
  if (!prev || total <= 0) return null;
  return Object.fromEntries(CPU_FIELDS.map((f, i) => [f, (delta[i] / total) * 100]));
}

const statRates = rateTracker();

function linuxCpu(now) {
  const stat = readProcStat();
  const last = prevCpu;
  prevCpu = stat;
  const counters = statRates({ ctxt: stat.ctxt, intr: stat.intr, forks: stat.forks }, now);
  if (!last) return null;

  const total = cpuPercents(stat.cpus.cpu, last.cpus.cpu);
  const cores = {};
  for (const [name, values] of Object.entries(stat.cpus)) {
    if (name === 'cpu') continue;
    const p = cpuPercents(values, last.cpus[name]);
    if (p) cores[name] = 100 - p.idle;
  }
  return { total, cores, stat, rates: counters?.rates };
}

const netRates = rateTracker();

function linuxNet(now) {
  const counters = {};
  const ifaces = [];
  for (const line of readFileSync('/proc/net/dev', 'utf8').split('\n').slice(2)) {
    const [name, rest] = line.split(':');
    if (!rest) continue;
    const iface = name.trim();
    if (IGNORED_IFACE.test(iface)) continue;
    const f = rest.trim().split(/\s+/).map(Number);
    ifaces.push(iface);
    Object.assign(counters, {
      [`${iface}|rxb`]: f[0], [`${iface}|rxp`]: f[1], [`${iface}|rxe`]: f[2], [`${iface}|rxd`]: f[3],
      [`${iface}|txb`]: f[8], [`${iface}|txp`]: f[9], [`${iface}|txe`]: f[10], [`${iface}|txd`]: f[11],
    });
  }
  const r = netRates(counters, now)?.rates;
  if (!r) return null;
  return ifaces.map((iface) => {
    const g = (k) => r[`${iface}|${k}`] ?? null;
    return {
      iface,
      rx: g('rxb'), tx: g('txb'), rxPackets: g('rxp'), txPackets: g('txp'),
      errors: sumOf([g('rxe'), g('txe')]), drops: sumOf([g('rxd'), g('txd')]),
    };
  });
}

const diskRates = rateTracker();

function linuxDisks(now) {
  const counters = {};
  const disks = [];
  for (const line of readFileSync('/proc/diskstats', 'utf8').split('\n')) {
    const f = line.trim().split(/\s+/);
    const name = f[2];
    if (!name || IGNORED_DISK.test(name) || !existsSync(`/sys/block/${name}`)) continue;
    const reads = Number(f[3]);
    const writes = Number(f[7]);
    if (reads + writes === 0) continue; // never used: skip the noise
    disks.push(name);
    Object.assign(counters, {
      [`${name}|r`]: reads, [`${name}|rs`]: Number(f[5]),
      [`${name}|w`]: writes, [`${name}|ws`]: Number(f[9]),
      [`${name}|busy`]: Number(f[12]),
    });
  }
  const result = diskRates(counters, now);
  if (!result) return null;
  const r = result.rates;
  return disks.map((disk) => ({
    disk,
    read: (r[`${disk}|rs`] ?? 0) * 512,
    write: (r[`${disk}|ws`] ?? 0) * 512,
    reads: r[`${disk}|r`] ?? 0,
    writes: r[`${disk}|w`] ?? 0,
    util: Math.min(100, (r[`${disk}|busy`] ?? 0) / 10), // ms busy per second -> %
  }));
}

// ---------------------------------------------------------------- slower collectors

let filesystems = [];

async function refreshFilesystems() {
  try {
    const seen = new Set();
    filesystems = (await si.fsSize())
      .filter((f) => f.size > 0 && !IGNORED_FS.test(f.type) && !seen.has(f.mount) && seen.add(f.mount))
      .slice(0, 32)
      .map((f) => ({ mount: f.mount, type: f.type, size: f.size, used: f.used, pct: f.use }));
  } catch (err) {
    log('filesystem scan failed:', err.message);
  }
}

let processes = null; // latest process snapshot, sent separately for the Top view
let processCounts = null;

async function refreshProcesses() {
  try {
    const p = await si.processes();
    // systeminformation shells out to `ps`; don't report our own children.
    const ours = new Set([process.pid]);
    for (let grew = true; grew;) {
      grew = false;
      for (const x of p.list) if (ours.has(x.parentPid) && !ours.has(x.pid)) { ours.add(x.pid); grew = true; }
    }
    ours.delete(process.pid);
    p.list = p.list.filter((x) => !ours.has(x.pid));
    processCounts = { all: p.all, running: p.running, blocked: p.blocked, sleeping: p.sleeping };
    processes = {
      ts: Math.floor(Date.now() / 1000),
      counts: processCounts,
      list: p.list
        .sort((a, b) => b.cpu - a.cpu || b.memRss - a.memRss)
        .slice(0, TOP_PROCESSES)
        .map((x) => ({
          pid: x.pid,
          name: x.name,
          user: x.user,
          cpu: round(x.cpu, 1),
          mem: round(x.mem, 1),
          rss: x.memRss * 1024,
          state: x.state,
          started: x.started,
          command: [x.command, x.params].filter(Boolean).join(' ').slice(0, 300),
        })),
    };
    send({ type: 'processes', ...processes });
  } catch (err) {
    log('process scan failed:', err.message);
  }
  if (!stopping) setTimeout(refreshProcesses, PROCESSES_EVERY_MS);
}

let temperatures = null;

async function refreshSensors() {
  try {
    const t = await si.cpuTemperature();
    if (Number.isFinite(t.main)) {
      temperatures = { cpu: t.main };
      t.cores?.forEach((c, i) => { if (Number.isFinite(c)) temperatures[`core${i}`] = c; });
    }
  } catch {}
  if (!stopping) setTimeout(refreshSensors, SENSORS_EVERY_MS);
}

async function collectInfo(id) {
  const [osInfo, cpu, mem] = await Promise.all([si.osInfo(), si.cpu(), si.mem()]);
  return {
    id,
    hostname: HOSTNAME,
    os: [osInfo.distro, osInfo.release].filter(Boolean).join(' '),
    platform: osInfo.platform,
    kernel: osInfo.kernel,
    arch: osInfo.arch,
    cpuModel: [cpu.manufacturer, cpu.brand].filter(Boolean).join(' '),
    cores: os.cpus().length,
    memTotal: mem.total,
    ip: primaryIp(),
    agentVersion: VERSION,
    bootTime: Math.round(Date.now() / 1000 - os.uptime()),
    fs: filesystems,
  };
}

// ---------------------------------------------------------------- per-second sample

const portableNetRates = rateTracker();

async function collect() {
  const now = Date.now();
  const charts = [];
  const chart = (context, instance, dims) => {
    const clean = Object.fromEntries(Object.entries(dims).filter(([, v]) => Number.isFinite(v)).map(([k, v]) => [k, round(v, 3)]));
    if (Object.keys(clean).length) charts.push([context, instance, clean]);
  };

  const [mem, load, nets, fsio] = await Promise.all([
    si.mem(),
    IS_LINUX ? null : si.currentLoad(),
    IS_LINUX ? null : si.networkStats('*').catch(() => []),
    IS_LINUX ? null : si.fsStats().catch(() => null),
  ]);

  // CPU
  let cpu = null;
  let cpuUser = null;
  let cpuSystem = null;
  if (IS_LINUX) {
    const c = linuxCpu(now);
    if (c?.total) {
      const t = c.total;
      cpu = 100 - t.idle;
      cpuUser = t.user + t.nice;
      cpuSystem = t.system + t.irq + t.softirq;
      chart('system.cpu', '', {
        user: t.user, system: t.system, nice: t.nice, iowait: t.iowait,
        irq: t.irq, softirq: t.softirq, steal: t.steal,
      });
      chart('cpu.core', '', c.cores);
    }
    if (c?.rates) {
      chart('system.ctxt', '', { switches: c.rates.ctxt });
      chart('system.intr', '', { interrupts: c.rates.intr });
      chart('system.forks', '', { started: c.rates.forks });
    }
    if (c?.stat) chart('system.processes', '', { running: c.stat.running, blocked: c.stat.blocked });
  } else if (load) {
    cpu = load.currentLoad;
    cpuUser = load.currentLoadUser + (load.currentLoadNice ?? 0);
    cpuSystem = load.currentLoadSystem + (load.currentLoadIrq ?? 0);
    chart('system.cpu', '', {
      user: load.currentLoadUser, system: load.currentLoadSystem, nice: load.currentLoadNice,
      irq: load.currentLoadIrq, steal: load.currentLoadSteal,
    });
    chart('cpu.core', '', Object.fromEntries((load.cpus ?? []).map((c, i) => [`cpu${i}`, c.load])));
    if (processCounts) chart('system.processes', '', { running: processCounts.running, blocked: processCounts.blocked });
  }
  if (processCounts) chart('system.active_processes', '', { active: processCounts.all });

  const [load1, load5, load15] = os.loadavg();
  chart('system.load', '', { load1, load5, load15 });
  chart('system.uptime', '', { uptime: os.uptime() });

  // Memory
  const cached = mem.buffcache ?? 0;
  const memUsed = mem.total - (mem.available ?? mem.free);
  chart('mem.usage', '', { used: Math.max(0, mem.total - mem.free - cached), cached, free: mem.free });
  chart('mem.available', '', { available: mem.available });
  if (mem.swaptotal > 0) chart('mem.swap', '', { used: mem.swapused, free: mem.swapfree });

  // Network
  let netRx = null;
  let netTx = null;
  if (IS_LINUX) {
    const ifaces = linuxNet(now) ?? [];
    for (const n of ifaces) {
      chart('net.traffic', n.iface, { received: n.rx, sent: n.tx });
      chart('net.packets', n.iface, { received: n.rxPackets, sent: n.txPackets });
      chart('net.errors', n.iface, { errors: n.errors, drops: n.drops });
    }
    netRx = sumOf(ifaces.map((n) => n.rx));
    netTx = sumOf(ifaces.map((n) => n.tx));
  } else {
    const ifaces = (nets ?? []).filter((n) => !IGNORED_IFACE.test(n.iface));
    const counters = {};
    for (const n of ifaces) Object.assign(counters, { [`${n.iface}|rx`]: n.rx_bytes, [`${n.iface}|tx`]: n.tx_bytes });
    const r = portableNetRates(counters, now)?.rates;
    if (r) {
      for (const n of ifaces) chart('net.traffic', n.iface, { received: r[`${n.iface}|rx`], sent: r[`${n.iface}|tx`] });
      netRx = sumOf(ifaces.map((n) => r[`${n.iface}|rx`]));
      netTx = sumOf(ifaces.map((n) => r[`${n.iface}|tx`]));
    }
  }

  // Disks
  let diskRead = null;
  let diskWrite = null;
  if (IS_LINUX) {
    const disks = linuxDisks(now) ?? [];
    for (const d of disks) {
      chart('disk.io', d.disk, { read: d.read, write: d.write });
      chart('disk.ops', d.disk, { reads: d.reads, writes: d.writes });
      chart('disk.util', d.disk, { utilization: d.util });
    }
    diskRead = sumOf(disks.map((d) => d.read));
    diskWrite = sumOf(disks.map((d) => d.write));
  } else if (fsio) {
    diskRead = Number.isFinite(fsio.rx_sec) ? Math.max(0, fsio.rx_sec) : null;
    diskWrite = Number.isFinite(fsio.wx_sec) ? Math.max(0, fsio.wx_sec) : null;
    chart('disk.io', 'all', { read: diskRead, write: diskWrite });
  }
  for (const f of filesystems) chart('disk.space', f.mount, { used: f.used, avail: f.size - f.used });

  if (temperatures) chart('sensors.temperature', '', temperatures);
  for (const m of modules) if (m.drainCharts) charts.push(...m.drainCharts());

  const pcts = filesystems.map((f) => f.pct).filter(Number.isFinite);
  return {
    m: {
      cpu: round(cpu),
      cpu_user: round(cpuUser),
      cpu_system: round(cpuSystem),
      mem_used: memUsed,
      mem_cached: cached,
      mem_total: mem.total,
      swap_used: mem.swapused,
      load1,
      load5,
      load15,
      net_rx: round(netRx),
      net_tx: round(netTx),
      disk_read: round(diskRead),
      disk_write: round(diskWrite),
      disk_pct: pcts.length ? Math.max(...pcts) : null,
    },
    d: charts,
  };
}

// ---------------------------------------------------------------- connection

const nodeId = loadNodeId();
const modules = [];
await refreshFilesystems();
let info = await collectInfo(nodeId);
let socket = null;
let backoff = 1000;
let stopping = false;
const buffer = [];

function send(msg) {
  if (socket?.readyState !== WebSocket.OPEN) return false;
  socket.send(JSON.stringify(msg));
  return true;
}

function connect() {
  socket = new WebSocket(wsUrl(), {
    headers: { Authorization: `Bearer ${TOKEN}` },
    handshakeTimeout: 10_000,
  });

  socket.on('open', () => {
    log(`connected to ${SERVER_URL} as ${info.hostname} (${nodeId})`);
    backoff = 1000;
    send({ type: 'hello', node: info });
    if (buffer.length) send({ type: 'batch', samples: buffer.splice(0) });
    if (processes) send({ type: 'processes', ...processes });
    for (const m of modules) m.resend?.();
  });

  // The server pushes configuration (collector jobs) after the hello.
  socket.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.type === 'config') jobs.configure(msg.jobs);
  });

  socket.on('close', (code, reason) => {
    if (stopping) return;
    const delay = Math.round(backoff * (0.8 + Math.random() * 0.4));
    log(`disconnected (${code}${reason.length ? ` ${reason}` : ''}), retrying in ${Math.round(delay / 1000)}s`);
    backoff = Math.min(backoff * 2, 30_000);
    setTimeout(connect, delay);
  });

  socket.on('error', (err) => {
    const hint = /401/.test(err.message) ? ' (check NETNEW_TOKEN)' : '';
    log(`connection error: ${err.message}${hint}`);
  });
}

async function tick() {
  const started = Date.now();
  try {
    const sample = { ts: Math.floor(started / 1000), ...(await collect()) };
    if (!send({ type: 'metrics', ...sample })) {
      buffer.push(sample);
      if (buffer.length > MAX_BUFFER) buffer.shift();
    }
  } catch (err) {
    log('collection failed:', err.message);
  }
  if (!stopping) setTimeout(tick, Math.max(0, INTERVAL_MS - (Date.now() - started)));
}

setInterval(refreshFilesystems, FS_EVERY_MS).unref();
setInterval(async () => {
  try {
    info = await collectInfo(nodeId);
    send({ type: 'info', node: info });
  } catch (err) {
    log('info refresh failed:', err.message);
  }
}, INFO_EVERY_MS).unref();

function stop() {
  stopping = true;
  for (const m of modules) m.stop();
  socket?.close(1000, 'agent stopping');
  setTimeout(() => process.exit(0), 500).unref();
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

const jobs = createJobRunner({ send, log });
modules.push(jobs);
if (!DISABLED.has('logs')) {
  modules.push(createLogCollector({ send, log, files: LOG_FILES, journal: IS_LINUX && !DISABLED.has('journal') }));
}
if (!DISABLED.has('containers')) modules.push(createContainerCollector({ send, log, nodeName: os.hostname() }));
if (!DISABLED.has('services')) modules.push(createServiceCollector({ send, log }));

log(`NetNew agent ${VERSION} starting`);
await collect(); // prime counters so the first real sample has rates
connect();
for (const m of modules) m.start?.();
if (!DISABLED.has('processes')) refreshProcesses();
refreshSensors();
setTimeout(tick, INTERVAL_MS);
