import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  hashPassword, hashToken, parseCookies, passwordProblem, sessionCookie, validateEmail, verifyPassword,
} from '../src/services/auth.js';
import { describeChart } from '../src/services/catalog.js';
import { publicJob, SECRET_MASK, validateJob } from '../src/services/jobs.js';
import { shapeSeries } from '../src/services/series.js';

describe('series shaping', () => {
  const rows = [
    { node_id: 'a', instance: 'eth0', dim: 'received', t: 100, v: 10 },
    { node_id: 'a', instance: 'eth0', dim: 'sent', t: 100, v: 1 },
    { node_id: 'b', instance: 'eth0', dim: 'received', t: 100, v: 30 },
    { node_id: 'a', instance: 'eth0', dim: 'received', t: 101, v: 20 },
    { node_id: 'b', instance: 'eth0', dim: 'received', t: 101, v: 40 },
  ];
  const names = { a: 'web-01', b: 'web-02' };

  it('groups by dimension with the chosen aggregation', () => {
    const s = shapeSeries({ rows, bucket: 1, groupBy: 'dimension', agg: 'sum', nodeNames: names });
    assert.deepEqual(s.ts, [100, 101]);
    assert.deepEqual(s.series.map((x) => x.label), ['received', 'sent']);
    assert.deepEqual(s.series[0].values, [40, 60]);
    assert.deepEqual(s.series[1].values, [1, null]);
    assert.equal(s.nodes, 2);
  });

  it('groups by node with averages and natural sorting', () => {
    const s = shapeSeries({ rows, bucket: 1, groupBy: 'node', agg: 'avg', nodeNames: names });
    assert.deepEqual(s.series.map((x) => x.label), ['web-01', 'web-02']);
    assert.deepEqual(s.series[0].values, [5.5, 20]);
  });

  it('filters dimensions and labels instances with their node', () => {
    const s = shapeSeries({ rows, bucket: 1, groupBy: 'instance', agg: 'max', nodeNames: names, dimFilter: ['received'] });
    assert.deepEqual(s.series.map((x) => x.label), ['web-01 · eth0', 'web-02 · eth0']);
  });

  it('inserts a gap marker for missing data but not for a collector\'s regular spacing', () => {
    const regular = [0, 5, 10, 15].map((t) => ({ node_id: 'a', instance: '', dim: 'x', t, v: 1 }));
    assert.deepEqual(shapeSeries({ rows: regular, bucket: 1, groupBy: 'dimension', agg: 'avg', nodeNames: {} }).ts, [0, 5, 10, 15]);
    const gappy = [...regular, { node_id: 'a', instance: '', dim: 'x', t: 60, v: 1 }];
    const s = shapeSeries({ rows: gappy, bucket: 1, groupBy: 'dimension', agg: 'avg', nodeNames: {} });
    assert.deepEqual(s.ts, [0, 5, 10, 15, 20, 60]);
    assert.equal(s.series[0].values[4], null);
  });
});

describe('chart catalog', () => {
  it('describes known and unknown charts', () => {
    assert.equal(describeChart('system.cpu').units, '%');
    const unknown = describeChart('custom.thing');
    assert.equal(unknown.section, 'Other');
    assert.equal(unknown.title, 'custom.thing');
  });
});

describe('collector jobs', () => {
  it('validates required fields and applies defaults', () => {
    assert.match(validateJob({ type: 'http', name: 'x', node_id: 'n', config: {} }).error, /URL is required/);
    assert.match(validateJob({ type: 'http', name: 'x', node_id: 'n', config: { url: 'ftp://a' } }).error, /http/);
    assert.match(validateJob({ type: 'nope', name: 'x', node_id: 'n' }).error, /type must be/);
    const { job } = validateJob({ type: 'http', name: 'site', node_id: 'n', config: { url: 'https://example.com' } });
    assert.equal(job.config.timeout_ms, 5000);
    assert.equal(job.config.interval_s, 10);
    assert.equal(job.enabled, true);
  });

  it('masks secrets for the browser and keeps them on update', () => {
    const { job } = validateJob({ type: 'postgres', name: 'db', node_id: 'n', config: { dsn: 'postgres://u:secret@h/db' } });
    const row = { id: 1, ...job, config: JSON.stringify(job.config), enabled: 1 };
    assert.equal(publicJob(row).config.dsn, SECRET_MASK);
    const { job: updated } = validateJob({ name: 'db2', config: { dsn: SECRET_MASK } }, row);
    assert.equal(updated.config.dsn, 'postgres://u:secret@h/db');
    assert.equal(updated.name, 'db2');
  });
});

describe('auth helpers', () => {
  it('hashes and verifies passwords', async () => {
    const hash = await hashPassword('correct horse');
    assert.match(hash, /^scrypt\$/);
    assert.equal(await verifyPassword('correct horse', hash), true);
    assert.equal(await verifyPassword('wrong', hash), false);
    assert.equal(await verifyPassword('x', 'garbage'), false);
  });

  it('parses cookies and builds session cookies', () => {
    assert.deepEqual(parseCookies('a=1; netnew_session=abc%3D'), { a: '1', netnew_session: 'abc=' });
    const c = sessionCookie('tok', { secure: true });
    assert.match(c, /HttpOnly/);
    assert.match(c, /SameSite=Lax/);
    assert.match(c, /Secure/);
    assert.equal(hashToken('x').length, 64);
  });

  it('validates emails and passwords', () => {
    assert.equal(validateEmail(' Raj@Example.com '), 'raj@example.com');
    assert.equal(validateEmail('nope'), null);
    assert.match(passwordProblem('short'), /8 characters/);
    assert.equal(passwordProblem('long enough'), null);
  });
});
