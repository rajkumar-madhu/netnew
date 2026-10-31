import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { openDb } from '../src/db/index.js';
import { createLogStore } from '../src/db/logs.js';

const dir = mkdtempSync(join(tmpdir(), 'netnew-db-'));
after(() => rmSync(dir, { recursive: true, force: true }));

describe('migrations', () => {
  it('renames tables and columns from the prototype schema in place', () => {
    const path = join(dir, 'legacy.db');
    const legacy = new DatabaseSync(path);
    legacy.exec(`
      CREATE TABLE rooms (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, created_at INTEGER NOT NULL);
      CREATE TABLE room_nodes (room_id TEXT NOT NULL, node_id TEXT NOT NULL, PRIMARY KEY (room_id, node_id)) WITHOUT ROWID;
      CREATE TABLE dims (id INTEGER PRIMARY KEY, node_id TEXT NOT NULL, context TEXT NOT NULL, instance TEXT NOT NULL,
        dim TEXT NOT NULL, last_ts INTEGER NOT NULL, UNIQUE (node_id, context, instance, dim));
      CREATE INDEX dims_context ON dims (context, node_id);
      CREATE TABLE dashboards (id TEXT PRIMARY KEY, room_id TEXT NOT NULL, name TEXT NOT NULL, description TEXT,
        items TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      INSERT INTO rooms VALUES ('r1', 'Production', '', 1);
      INSERT INTO room_nodes VALUES ('r1', 'n1');
      INSERT INTO dims VALUES (1, 'n1', 'system.cpu', '', 'user', 1);
      INSERT INTO dashboards VALUES ('d1', 'r1', 'Main', '', '[{"kind":"chart","context":"system.cpu"}]', 1, 1);
    `);
    legacy.close();

    const db = openDb(path);
    assert.deepEqual(db.listGroups().map((g) => [g.name, g.nodeIds]), [['Production', ['n1']]]);
    assert.equal(db.getDashboard('d1').group_id, 'r1');
    assert.equal(db.getDashboard('d1').items[0].chart, 'system.cpu');
    assert.deepEqual(db.availableCharts(['n1'], 0).map((r) => r.chart), ['system.cpu']);
    assert.equal(db.raw.prepare('PRAGMA user_version').get().user_version, 1);
    db.close();
    // Opening again is a no-op.
    openDb(path).close();
  });
});

describe('chart storage', () => {
  it('stores samples and serves bucketed data from both tiers', () => {
    const db = openDb(join(dir, 'charts.db'));
    const now = 1_800_000_000;
    db.transaction(() => {
      for (let ts = now - 7200; ts <= now; ts++) db.insertChart('n1', ts, 'system.load', '', { load1: ts % 2 ? 1 : 3 });
    });
    const short = db.chartData('system.load', ['n1'], now - 59, now, 600);
    assert.equal(short.bucket, 1);
    assert.equal(short.rows.length, 60);

    db.rollup(now);
    const long = db.chartData('system.load', ['n1'], now - 7200, now, 60);
    assert.equal(long.bucket, 120);
    assert.ok(long.rows.length >= 59 && long.rows.length <= 62, `rows ${long.rows.length}`);
    for (const r of long.rows.slice(1, -1)) assert.ok(Math.abs(r.v - 2) < 0.05, `avg ${r.v}`);
    db.close();
  });
});

describe('log store', () => {
  const db = openDb(join(dir, 'logs.db'));
  const logs = createLogStore(db.raw, db.transaction);
  const t = Date.now();
  logs.insert('n1', [
    { ts: t - 3000, priority: 3, source: 'journal', service: 'nginx.service', message: 'connect() failed (111: Connection refused) while connecting to upstream' },
    { ts: t - 2000, priority: 6, source: 'journal', service: 'sshd.service', message: 'Accepted publickey for deploy' },
    { ts: t - 1000, priority: 4, source: 'file', service: 'app.log', message: 'WARN slow query took 1200ms' },
  ]);
  const base = { nodeIds: ['n1'], from: t - 60_000, to: t, limit: 50 };

  it('searches messages with prefix matching', () => {
    assert.deepEqual(logs.query({ ...base, q: 'refus upstr' }).map((r) => r.service), ['nginx.service']);
    assert.equal(logs.query({ ...base, q: 'nothing-matches' }).length, 0);
  });

  it('filters by level and service, newest first', () => {
    assert.deepEqual(logs.query({ ...base, levels: ['error', 'warning'] }).map((r) => r.priority), [4, 3]);
    assert.deepEqual(logs.query({ ...base, services: ['sshd.service'] }).map((r) => r.priority), [6]);
  });

  it('counts facets ignoring their own filter', () => {
    const f = logs.facets({ ...base, levels: ['error'] });
    assert.equal(f.total, 1);
    assert.deepEqual(Object.fromEntries(f.level.map((l) => [l.id, l.count])), { error: 1, warning: 1, info: 1, debug: 0 });
  });

  it('builds a per-level histogram and follows new lines', () => {
    const h = logs.histogram({ ...base }, 6);
    assert.equal(h.error.reduce((a, b) => a + b, 0), 1);
    const newest = logs.query(base)[0].id;
    logs.insert('n1', [{ ts: t, priority: 6, source: 'file', service: 'app.log', message: 'later line' }]);
    assert.deepEqual(logs.query({ ...base, to: t + 1000, afterId: newest }).map((r) => r.message), ['later line']);
  });
});
