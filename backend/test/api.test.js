import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import WebSocket from 'ws';
import { client, fakeAgent, startTestServer, waitFor } from './helpers.js';

const now = () => Math.floor(Date.now() / 1000);

describe('API', () => {
  let server;
  let admin;
  before(async () => {
    server = await startTestServer();
    admin = client(server.base);
  });
  after(() => server.stop());

  describe('setup and sign-in', () => {
    it('requires setup and blocks the API until signed in', async () => {
      const state = await client(server.base).get('/api/auth/state');
      assert.equal(state.data.setupRequired, true);
      assert.equal((await client(server.base).get('/api/nodes')).status, 401);
      assert.equal((await client(server.base).get('/api/health')).status, 200);
    });

    it('validates and completes setup once', async () => {
      assert.equal((await admin.post('/api/auth/setup', { workspaceName: 'Acme', name: 'Ada', email: 'bad', password: 'longenough' })).status, 400);
      assert.equal((await admin.post('/api/auth/setup', { workspaceName: 'Acme', name: 'Ada', email: 'ada@acme.io', password: 'short' })).status, 400);
      const res = await admin.post('/api/auth/setup', { workspaceName: 'Acme', name: 'Ada', email: 'ada@acme.io', password: 'longenough' });
      assert.equal(res.status, 201);
      assert.equal(res.data.user.role, 'admin');
      assert.match(admin.cookie, /^netnew_session=/);
      assert.equal((await client(server.base).post('/api/auth/setup', { workspaceName: 'X', name: 'X', email: 'x@x.io', password: 'longenough' })).status, 409);
      assert.equal((await admin.get('/api/workspace')).data.name, 'Acme');
    });

    it('signs in and out', async () => {
      const c = client(server.base);
      assert.equal((await c.post('/api/auth/login', { email: 'ada@acme.io', password: 'wrong-password' })).status, 401);
      assert.equal((await c.post('/api/auth/login', { email: 'ADA@acme.io', password: 'longenough' })).status, 200);
      assert.equal((await c.get('/api/auth/me')).data.user.email, 'ada@acme.io');
      assert.equal((await c.post('/api/auth/logout')).status, 204);
      assert.equal((await c.get('/api/nodes')).status, 401);
    });

    it('rejects cross-origin writes', async () => {
      const res = await fetch(`${server.base}/api/groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: admin.cookie, Origin: 'https://evil.example' },
        body: JSON.stringify({ name: 'x' }),
      });
      assert.equal(res.status, 403);
    });
  });

  describe('users and roles', () => {
    let viewer;
    it('lets admins add users', async () => {
      const res = await admin.post('/api/users', { name: 'Vic', email: 'vic@acme.io', role: 'viewer', password: 'viewerpass' });
      assert.equal(res.status, 201);
      assert.equal((await admin.post('/api/users', { name: 'Vic', email: 'vic@acme.io', role: 'viewer', password: 'viewerpass' })).status, 409);
      viewer = client(server.base);
      assert.equal((await viewer.post('/api/auth/login', { email: 'vic@acme.io', password: 'viewerpass' })).status, 200);
    });

    it('gives viewers read-only access', async () => {
      assert.equal((await viewer.get('/api/groups')).status, 200);
      assert.equal((await viewer.post('/api/groups', { name: 'Nope' })).status, 403);
      assert.equal((await viewer.get('/api/users')).status, 403);
      assert.equal((await viewer.get('/api/workspace/agent-token')).status, 403);
      // ...but they can change their own password.
      assert.equal((await viewer.post('/api/auth/password', { current: 'viewerpass', next: 'newviewerpass' })).status, 200);
    });

    it('keeps at least one admin', async () => {
      const users = (await admin.get('/api/users')).data;
      const ada = users.find((u) => u.email === 'ada@acme.io');
      assert.equal((await admin.patch(`/api/users/${ada.id}`, { role: 'viewer' })).status, 409);
      assert.equal((await admin.del(`/api/users/${ada.id}`)).status, 409);
    });
  });

  describe('agents, nodes and charts', () => {
    let agent;
    it('rejects agents with a wrong token', async () => {
      const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws/agent`, { headers: { Authorization: 'Bearer wrong' } });
      const err = await new Promise((resolve) => ws.once('error', resolve));
      assert.match(err.message, /401/);
    });

    it('registers a node and stores its samples and charts', async () => {
      agent = await fakeAgent(server);
      const t = now();
      for (let i = 5; i >= 0; i--) agent.sample(t - i, 20 + i, [['system.cpu', '', { user: 10, system: 5 }], ['net.traffic', 'eth0', { received: 100, sent: 50 }]]);
      const nodes = await waitFor(async () => {
        const res = await admin.get('/api/nodes');
        return res.data.length && res.data[0].latest ? res.data : null;
      });
      assert.equal(nodes[0].hostname, 'test-01');
      assert.equal(nodes[0].online, true);

      const charts = (await admin.get('/api/charts?after=-60')).data;
      assert.deepEqual(charts.charts.map((c) => c.chart), ['system.cpu', 'net.traffic']);
      assert.deepEqual(charts.charts[1].instances, ['eth0']);

      const data = (await admin.get('/api/charts/data?chart=system.cpu&after=-60&group_by=node&agg=sum')).data;
      assert.equal(data.series.length, 1);
      assert.equal(data.series[0].label, 'test-01');
      assert.ok(data.series[0].values.every((v) => v === 15));
    });

    it('scopes data to groups', async () => {
      const group = (await admin.post('/api/groups', { name: 'Empty' })).data;
      assert.equal((await admin.get(`/api/nodes?group=${group.id}`)).data.length, 0);
      await admin.put(`/api/groups/${group.id}/nodes`, { nodeIds: ['node-test-0001', 'unknown'] });
      const groups = (await admin.get('/api/groups')).data;
      assert.deepEqual(groups.find((g) => g.id === group.id).nodeIds, ['node-test-0001']);
      assert.equal((await admin.get(`/api/nodes?group=${group.id}`)).data.length, 1);
      assert.equal((await admin.get('/api/nodes?group=missing')).status, 404);
    });

    it('stores logs sent by the agent and finds them', async () => {
      agent.send({ type: 'logs', entries: [{ ts: Date.now(), priority: 3, source: 'file', service: 'app.log', message: 'ERROR payment gateway timeout' }] });
      const rows = await waitFor(async () => (await admin.get('/api/logs?after=-60&q=gateway')).data.length && (await admin.get('/api/logs?after=-60&q=gateway')).data);
      assert.equal(rows[0].service, 'app.log');
      const facets = (await admin.get('/api/logs/facets?after=-60')).data;
      assert.equal(facets.total, 1);
    });

    it('pushes collector jobs to the agent and alerts on failures', async () => {
      const res = await admin.post('/api/jobs', { node_id: 'node-test-0001', type: 'tcp', name: 'db-port', config: { host: '127.0.0.1', port: 1 } });
      assert.equal(res.status, 201);
      const config = await waitFor(() => agent.received.findLast((m) => m.type === 'config' && m.jobs.length));
      assert.equal(config.jobs[0].name, 'db-port');

      agent.send({ type: 'jobs', list: [{ id: res.data.id, ok: false, error: 'connect ECONNREFUSED', failures: 2, lastRun: now() }] });
      const alert = await waitFor(async () => (await admin.get('/api/alerts?state=active')).data.find((a) => a.rule === `check:${res.data.id}`));
      assert.equal(alert.severity, 'critical');
      assert.equal(alert.name, 'Check failed: db-port');

      agent.send({ type: 'jobs', list: [{ id: res.data.id, ok: true, failures: 0, latency: 1.2, lastRun: now() }] });
      await waitFor(async () => !(await admin.get('/api/alerts?state=active')).data.some((a) => a.rule === `check:${res.data.id}`));
      const job = (await admin.get('/api/jobs')).data[0];
      assert.equal(job.status.ok, true);
    });

    it('saves dashboards and validates their items', async () => {
      assert.equal((await admin.post('/api/dashboards', { name: 'Bad', items: [{ kind: 'chart' }] })).status, 400);
      const d = (await admin.post('/api/dashboards', {
        name: 'Ops', items: [{ kind: 'chart', chart: 'system.cpu', width: 6, groupBy: 'node' }, { kind: 'note', text: 'hello', width: 99 }],
      })).data;
      assert.equal(d.items[1].width, 6);
      assert.equal((await admin.get('/api/dashboards?group=all')).data[0].charts, 2);
    });

    it('keeps connected nodes and deletes disconnected ones', async () => {
      assert.equal((await admin.del('/api/nodes/node-test-0001')).status, 409);
      await agent.close();
      await waitFor(async () => !(await admin.get('/api/nodes/node-test-0001')).data.connected);
      assert.equal((await admin.del('/api/nodes/node-test-0001')).status, 204);
      assert.equal((await admin.get('/api/nodes')).data.length, 0);
      const events = (await admin.get('/api/events?after=-300')).data.map((e) => e.type);
      for (const type of ['node.created', 'node.connected', 'node.disconnected', 'node.removed', 'alert.raised', 'alert.cleared']) {
        assert.ok(events.includes(type), `missing event ${type}`);
      }
    });
  });

  describe('public files', () => {
    it('serves the installer and agent files without signing in', async () => {
      const script = await (await fetch(`${server.base}/install.sh`)).text();
      assert.match(script, new RegExp(`URL="${server.base}"`));
      const manifest = (await (await fetch(`${server.base}/agent/manifest`)).text()).trim().split('\n');
      assert.ok(manifest.includes('package.json') && manifest.includes('src/index.js'));
      assert.equal((await fetch(`${server.base}/agent/src/index.js`)).status, 200);
      assert.equal((await fetch(`${server.base}/agent/src/..%2f..%2fbackend%2fpackage.json`)).status, 404);
    });
  });
});

describe('admin bootstrap from the environment', () => {
  it('creates the configured admin when there are no users', async () => {
    const server = await startTestServer({ ADMIN_EMAIL: 'ops@acme.io', ADMIN_PASSWORD: 'bootstrap-pass' });
    try {
      const c = client(server.base);
      assert.equal((await c.get('/api/auth/state')).data.setupRequired, false);
      assert.equal((await c.post('/api/auth/login', { email: 'ops@acme.io', password: 'bootstrap-pass' })).status, 200);
    } finally {
      await server.stop();
    }
  });
});
