// Test helpers: an isolated server per test file, and a small HTTP client
// that keeps the session cookie like a browser would.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { loadConfig } from '../src/config.js';
import { startServer } from '../src/server.js';

export async function startTestServer(env = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'netnew-test-'));
  const config = loadConfig({ DATA_DIR: dir, PORT: '0', HOST: '127.0.0.1', OFFLINE_AFTER_SEC: '5', ...env });
  const app = await startServer(config);
  const base = `http://127.0.0.1:${app.port}`;
  return {
    ...app,
    config,
    base,
    async stop() {
      await app.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export function client(base) {
  let cookie = '';
  async function request(method, path, body) {
    const res = await fetch(base + path, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: res.status, data };
  }
  return {
    get: (p) => request('GET', p),
    post: (p, b) => request('POST', p, b ?? {}),
    put: (p, b) => request('PUT', p, b ?? {}),
    patch: (p, b) => request('PATCH', p, b ?? {}),
    del: (p) => request('DELETE', p),
    get cookie() { return cookie; },
  };
}

/** A fake agent speaking the agent protocol. */
export async function fakeAgent(server, { id = 'node-test-0001', hostname = 'test-01' } = {}) {
  const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws/agent`, { headers: { Authorization: `Bearer ${server.config.agentToken}` } });
  const received = [];
  ws.on('message', (raw) => received.push(JSON.parse(raw)));
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  const send = (msg) => ws.send(JSON.stringify(msg));
  send({ type: 'hello', node: { id, hostname, os: 'TestOS 1', platform: 'linux', cores: 4, memTotal: 8e9, agentVersion: 'test', fs: [] } });
  return {
    ws,
    received,
    send,
    sample(ts, cpu = 10, charts = []) {
      send({
        type: 'metrics',
        ts,
        m: { cpu, cpu_user: cpu / 2, cpu_system: cpu / 2, mem_used: 2e9, mem_total: 8e9, load1: 0.5, net_rx: 1000, net_tx: 2000, disk_pct: 40 },
        d: charts,
      });
    },
    close: () => new Promise((resolve) => { ws.once('close', resolve); ws.close(); }),
  };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function waitFor(fn, { timeout = 3000, interval = 50 } = {}) {
  const end = Date.now() + timeout;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > end) throw new Error('timed out waiting for condition');
    await sleep(interval);
  }
}
