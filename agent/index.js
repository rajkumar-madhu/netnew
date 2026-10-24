#!/usr/bin/env node
// NetNew agent: collects system metrics every second and streams them to the
// NetNew server over a WebSocket. Samples are buffered while disconnected and
// flushed on reconnect, so short network blips don't leave holes in charts.
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import si from 'systeminformation';
import WebSocket from 'ws';

const VERSION = '0.1.0';
const SERVER_URL = process.env.NETNEW_URL || 'http://localhost:3000';
const TOKEN = process.env.NETNEW_TOKEN;
const INTERVAL_MS = Math.max(250, Number(process.env.NETNEW_INTERVAL_MS) || 1000);
const STATE_DIR = process.env.NETNEW_STATE_DIR || join(os.homedir(), '.netnew-agent');
const HOSTNAME = process.env.NETNEW_HOSTNAME || os.hostname();
const MAX_BUFFER = 900; // ~15 minutes of samples at 1/s
const INFO_EVERY_MS = 60_000;

// Virtual and pseudo filesystems/interfaces that would double count or add noise.
const IGNORED_FS = /^(tmpfs|devtmpfs|squashfs|proc|sysfs|cgroup2?|devpts|mqueue|efivarfs|nsfs|autofs|tracefs|debugfs|securityfs|fusectl|configfs|pstore|bpf|hugetlbfs|ramfs|binfmt_misc)$/;
const IGNORED_IFACE = /^(lo|veth|docker|br-|virbr|cni|flannel|cali|vxlan|tun|utun|awdl|llw|bridge)/;

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

async function collectInfo(id) {
  const [osInfo, cpu, mem] = await Promise.all([si.osInfo(), si.cpu(), si.mem()]);
  await refreshFilesystems();
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

const sum = (items, key) => {
  const values = items.map((i) => i[key]).filter((v) => Number.isFinite(v));
  return values.length ? values.reduce((a, b) => a + Math.max(0, b), 0) : null;
};

async function collectMetrics() {
  const [load, mem, nets, io] = await Promise.all([
    si.currentLoad(),
    si.mem(),
    si.networkStats('*').catch(() => []),
    si.fsStats().catch(() => null),
  ]);
  const ifaces = nets.filter((n) => !IGNORED_IFACE.test(n.iface));
  const [load1, load5, load15] = os.loadavg();
  const pcts = filesystems.map((f) => f.pct).filter(Number.isFinite);

  return {
    cpu: load.currentLoad,
    cpu_user: load.currentLoadUser,
    cpu_system: load.currentLoadSystem,
    mem_used: mem.total - (mem.available ?? mem.free),
    mem_cached: mem.buffcache,
    mem_total: mem.total,
    swap_used: mem.swapused,
    load1,
    load5,
    load15,
    net_rx: sum(ifaces, 'rx_sec'),
    net_tx: sum(ifaces, 'tx_sec'),
    disk_read: Number.isFinite(io?.rx_sec) ? Math.max(0, io.rx_sec) : null,
    disk_write: Number.isFinite(io?.wx_sec) ? Math.max(0, io.wx_sec) : null,
    disk_pct: pcts.length ? Math.max(...pcts) : null,
  };
}

const nodeId = loadNodeId();
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
    const sample = { ts: Math.floor(started / 1000), m: await collectMetrics() };
    if (!send({ type: 'metrics', ...sample })) {
      buffer.push(sample);
      if (buffer.length > MAX_BUFFER) buffer.shift();
    }
  } catch (err) {
    log('collection failed:', err.message);
  }
  if (!stopping) setTimeout(tick, Math.max(0, INTERVAL_MS - (Date.now() - started)));
}

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
  socket?.close(1000, 'agent stopping');
  setTimeout(() => process.exit(0), 500).unref();
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

log(`NetNew agent ${VERSION} starting`);
await collectMetrics(); // prime counters so the first real sample has rates
connect();
setTimeout(tick, INTERVAL_MS);
