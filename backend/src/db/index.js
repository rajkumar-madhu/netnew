import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { migrate } from './migrations.js';

// Every per-second summary sample an agent sends has exactly these numeric fields.
export const METRICS = [
  'cpu', 'cpu_user', 'cpu_system',
  'mem_used', 'mem_cached', 'mem_total', 'swap_used',
  'load1', 'load5', 'load15',
  'net_rx', 'net_tx',
  'disk_read', 'disk_write', 'disk_pct',
];

// How often a dimension's last_ts is persisted; it only needs to be accurate
// enough to hide instances (interfaces, disks) that disappeared.
const DIM_TOUCH_EVERY = 60;

// Charts whose buckets are at least this many seconds read the per-minute tier.
const TIER1_BUCKET = 60;
// Each rollup re-aggregates this much recent history, so samples an agent
// buffered while disconnected (up to 15 minutes) still make it into tier 1.
const ROLLUP_LOOKBACK = 20 * 60;

const placeholders = (n) => new Array(n).fill('?').join(', ');
const newId = () => randomBytes(6).toString('hex');

/** Opens (and migrates) the database and returns its repository functions. */
export function openDb(path) {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;');
  migrate(db, METRICS);

  const stmts = {
    upsertNode: db.prepare(`
      INSERT INTO nodes (id, hostname, os, platform, kernel, arch, cpu_model, cores, mem_total,
                         ip, agent_version, boot_time, fs, first_seen, last_seen)
      VALUES (:id, :hostname, :os, :platform, :kernel, :arch, :cpu_model, :cores, :mem_total,
              :ip, :agent_version, :boot_time, :fs, :now, :now)
      ON CONFLICT (id) DO UPDATE SET
        hostname = excluded.hostname, os = excluded.os, platform = excluded.platform,
        kernel = excluded.kernel, arch = excluded.arch, cpu_model = excluded.cpu_model,
        cores = excluded.cores, mem_total = excluded.mem_total, ip = excluded.ip,
        agent_version = excluded.agent_version, boot_time = excluded.boot_time,
        fs = excluded.fs, last_seen = excluded.last_seen`),
    touchNode: db.prepare('UPDATE nodes SET last_seen = MAX(last_seen, ?) WHERE id = ?'),
    getNode: db.prepare('SELECT * FROM nodes WHERE id = ?'),
    listNodes: db.prepare('SELECT * FROM nodes ORDER BY hostname COLLATE NOCASE'),

    insertMetric: db.prepare(`
      INSERT OR REPLACE INTO metrics (node_id, ts, ${METRICS.join(', ')})
      VALUES (?, ?, ${placeholders(METRICS.length)})`),
    latestMetric: db.prepare('SELECT * FROM metrics WHERE node_id = ? ORDER BY ts DESC LIMIT 1'),

    allDims: db.prepare('SELECT id, node_id, chart, instance, dim, last_ts FROM dims'),
    insertDim: db.prepare(`
      INSERT INTO dims (node_id, chart, instance, dim, last_ts) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (node_id, chart, instance, dim) DO UPDATE SET last_ts = excluded.last_ts
      RETURNING id`),
    touchDim: db.prepare('UPDATE dims SET last_ts = ? WHERE id = ?'),
    insertSample: db.prepare('INSERT OR REPLACE INTO samples (dim_id, ts, v) VALUES (?, ?, ?)'),

    openAlert: db.prepare(`
      INSERT INTO alerts (node_id, rule, severity, value, message, started_at)
      VALUES (?, ?, ?, ?, ?, ?) RETURNING *`),
    clearAlert: db.prepare('UPDATE alerts SET cleared_at = ? WHERE id = ?'),
    activeAlerts: db.prepare(`
      SELECT a.*, n.hostname FROM alerts a LEFT JOIN nodes n ON n.id = a.node_id
      WHERE a.cleared_at IS NULL ORDER BY a.started_at DESC`),
    recentAlerts: db.prepare(`
      SELECT a.*, n.hostname FROM alerts a LEFT JOIN nodes n ON n.id = a.node_id
      ORDER BY a.started_at DESC LIMIT ?`),

    listGroups: db.prepare('SELECT * FROM node_groups ORDER BY name COLLATE NOCASE'),
    getGroup: db.prepare('SELECT * FROM node_groups WHERE id = ?'),
    insertGroup: db.prepare('INSERT INTO node_groups (id, name, description, created_at) VALUES (?, ?, ?, ?) RETURNING *'),
    updateGroup: db.prepare('UPDATE node_groups SET name = ?, description = ? WHERE id = ? RETURNING *'),
    deleteGroup: db.prepare('DELETE FROM node_groups WHERE id = ?'),
    groupMembers: db.prepare('SELECT group_id, node_id FROM node_group_members'),
    clearGroupNodes: db.prepare('DELETE FROM node_group_members WHERE group_id = ?'),
    addGroupNode: db.prepare('INSERT OR IGNORE INTO node_group_members (group_id, node_id) VALUES (?, ?)'),

    insertEvent: db.prepare('INSERT INTO events (ts, node_id, type, severity, message) VALUES (?, ?, ?, ?, ?) RETURNING *'),
    insertAnomaly: db.prepare('INSERT OR REPLACE INTO anomalies (node_id, metric, ts, value, score) VALUES (?, ?, ?, ?, ?)'),

    listChannels: db.prepare('SELECT * FROM channels ORDER BY id'),
    getChannel: db.prepare('SELECT * FROM channels WHERE id = ?'),
    insertChannel: db.prepare(`
      INSERT INTO channels (name, type, url, min_severity, enabled, created_at)
      VALUES (?, ?, ?, ?, ?, ?) RETURNING *`),
    updateChannel: db.prepare(`
      UPDATE channels SET name = ?, type = ?, url = ?, min_severity = ?, enabled = ? WHERE id = ? RETURNING *`),
    deleteChannel: db.prepare('DELETE FROM channels WHERE id = ?'),

    getSetting: db.prepare('SELECT value FROM settings WHERE key = ?'),
    setSetting: db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value'),

    countUsers: db.prepare('SELECT COUNT(*) AS n FROM users'),
    countAdmins: db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'"),
    listUsers: db.prepare('SELECT id, email, name, role, created_at, last_login FROM users ORDER BY name COLLATE NOCASE'),
    getUser: db.prepare('SELECT * FROM users WHERE id = ?'),
    getUserByEmail: db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE'),
    insertUser: db.prepare(`
      INSERT INTO users (email, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)
      RETURNING id, email, name, role, created_at, last_login`),
    updateUser: db.prepare(`
      UPDATE users SET name = ?, role = ? WHERE id = ? RETURNING id, email, name, role, created_at, last_login`),
    setPassword: db.prepare('UPDATE users SET password_hash = ? WHERE id = ?'),
    touchLogin: db.prepare('UPDATE users SET last_login = ? WHERE id = ?'),
    deleteUser: db.prepare('DELETE FROM users WHERE id = ?'),

    insertSession: db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'),
    getSession: db.prepare(`
      SELECT s.*, u.email, u.name, u.role FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ?`),
    deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    deleteUserSessions: db.prepare('DELETE FROM sessions WHERE user_id = ?'),
    pruneSessions: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),
  };

  function transaction(fn) {
    db.exec('BEGIN');
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  const bucketFor = (from, to, maxPoints) => Math.max(1, Math.ceil((to - from) / maxPoints));
  const BUCKET_SQL = '(ts / CAST(:bucket AS INTEGER)) * CAST(:bucket AS INTEGER)';

  // dim key -> { id, lastTouched }
  const dimCache = new Map();
  const dimKey = (nodeId, chart, instance, dim) => `${nodeId}\u0000${chart}\u0000${instance}\u0000${dim}`;
  for (const d of stmts.allDims.all()) {
    dimCache.set(dimKey(d.node_id, d.chart, d.instance, d.dim), { id: d.id, lastTouched: d.last_ts });
  }

  // Tier 1 is complete up to (not including) this timestamp. Resume from the
  // newest rolled-up minute; the first rollup after start fills any gap.
  const newestRollup = db.prepare('SELECT MAX(ts) AS ts FROM samples_1m').get().ts;
  let rolledUpTo = newestRollup == null ? 0 : newestRollup + TIER1_BUCKET;

  return {
    raw: db,
    transaction,
    close: () => db.close(),

    // ------------------------------------------------------------ settings
    getSetting: (key) => stmts.getSetting.get(key)?.value ?? null,
    setSetting: (key, value) => stmts.setSetting.run(key, String(value)),

    // ------------------------------------------------------------ nodes
    upsertNode(node, now) {
      const isNew = !stmts.getNode.get(node.id);
      stmts.upsertNode.run({
        id: node.id,
        hostname: node.hostname,
        os: node.os ?? null,
        platform: node.platform ?? null,
        kernel: node.kernel ?? null,
        arch: node.arch ?? null,
        cpu_model: node.cpuModel ?? null,
        cores: node.cores ?? null,
        mem_total: node.memTotal ?? null,
        ip: node.ip ?? null,
        agent_version: node.agentVersion ?? null,
        boot_time: node.bootTime ?? null,
        fs: JSON.stringify(node.fs ?? []),
        now,
      });
      return isNew;
    },
    touchNode: (id, ts) => stmts.touchNode.run(ts, id),
    getNode: (id) => stmts.getNode.get(id),
    listNodes: () => stmts.listNodes.all(),
    deleteNode(id) {
      transaction(() => {
        db.prepare('DELETE FROM samples WHERE dim_id IN (SELECT id FROM dims WHERE node_id = ?)').run(id);
        db.prepare('DELETE FROM samples_1m WHERE dim_id IN (SELECT id FROM dims WHERE node_id = ?)').run(id);
        for (const table of ['dims', 'metrics', 'alerts', 'anomalies', 'node_group_members', 'collector_jobs']) {
          db.prepare(`DELETE FROM ${table} WHERE node_id = ?`).run(id);
        }
        db.prepare('DELETE FROM nodes WHERE id = ?').run(id);
      });
      for (const key of dimCache.keys()) if (key.startsWith(`${id}\u0000`)) dimCache.delete(key);
    },

    // ------------------------------------------------------------ summary metrics
    insertMetric(nodeId, ts, m) {
      stmts.insertMetric.run(nodeId, ts, ...METRICS.map((k) => m[k] ?? null));
    },
    latestMetric: (nodeId) => stmts.latestMetric.get(nodeId),

    // Seconds of data each node has in a range (denominator for anomaly rates).
    secondsCollected(nodeIds, from, to) {
      const rows = db.prepare(`
        SELECT node_id, COUNT(*) AS n FROM metrics
        WHERE ts BETWEEN ? AND ? AND node_id IN (SELECT value FROM json_each(?))
        GROUP BY node_id`).all(from, to, JSON.stringify(nodeIds));
      return Object.fromEntries(rows.map((r) => [r.node_id, r.n]));
    },

    // ------------------------------------------------------------ chart data
    insertChart(nodeId, ts, chart, instance, dims) {
      for (const [dim, v] of Object.entries(dims)) {
        const key = dimKey(nodeId, chart, instance, dim);
        let entry = dimCache.get(key);
        if (!entry) {
          entry = { id: stmts.insertDim.get(nodeId, chart, instance, dim, ts).id, lastTouched: ts };
          dimCache.set(key, entry);
        } else if (ts - entry.lastTouched >= DIM_TOUCH_EVERY) {
          stmts.touchDim.run(ts, entry.id);
          entry.lastTouched = ts;
        }
        stmts.insertSample.run(entry.id, ts, v);
      }
    },

    // Which charts/instances/dimensions the given nodes reported since `since`.
    availableCharts(nodeIds, since) {
      return db.prepare(`
        SELECT chart, node_id, instance, dim FROM dims
        WHERE last_ts >= ? AND node_id IN (SELECT value FROM json_each(?)) ORDER BY id`)
        .all(since - DIM_TOUCH_EVERY, JSON.stringify(nodeIds));
    },

    // Bucketed samples for one chart: rows of { node_id, instance, dim, t, v }.
    // Short ranges read per-second samples. Long ranges read the per-minute
    // tier up to the last rolled-up minute, plus raw samples after it, merged
    // weighted by the seconds each row covers.
    chartData(chart, nodeIds, from, to, maxPoints) {
      let bucket = bucketFor(from, to, maxPoints);
      const params = { chart, since: from - DIM_TOUCH_EVERY, ids: JSON.stringify(nodeIds) };
      const query = (table, weight, lo, hi) => db.prepare(`
        SELECT d.id, d.node_id, d.instance, d.dim,
               (s.ts / CAST(:bucket AS INTEGER)) * CAST(:bucket AS INTEGER) AS t,
               AVG(s.v) AS v, COUNT(*) * ${weight} AS w
        FROM dims d JOIN ${table} s ON s.dim_id = d.id
        WHERE d.chart = :chart AND d.last_ts >= :since
          AND d.node_id IN (SELECT value FROM json_each(:ids))
          AND s.ts BETWEEN :lo AND :hi
        GROUP BY d.id, t ORDER BY d.id, t`).all({ ...params, bucket, lo, hi });

      if (bucket < TIER1_BUCKET) return { bucket, rows: query('samples', 1, from, to) };

      bucket = Math.ceil(bucket / TIER1_BUCKET) * TIER1_BUCKET;
      const cut = Math.min(rolledUpTo, to);
      const merged = new Map();
      for (const r of [...query('samples_1m', TIER1_BUCKET, from, cut - 1), ...query('samples', 1, Math.max(from, cut), to)]) {
        const key = `${r.id}|${r.t}`;
        const m = merged.get(key);
        if (!m) merged.set(key, { ...r, sum: r.v * r.w });
        else { m.sum += r.v * r.w; m.w += r.w; }
      }
      const rows = [...merged.values()]
        .map((r) => ({ node_id: r.node_id, instance: r.instance, dim: r.dim, t: r.t, v: r.sum / r.w, id: r.id }))
        .sort((a, b) => a.id - b.id || a.t - b.t);
      return { bucket, rows };
    },

    // Rebuilds per-minute averages for complete minutes in [from, now).
    rollup(nowTs) {
      const to = Math.floor(nowTs / TIER1_BUCKET) * TIER1_BUCKET;
      const from = rolledUpTo ? Math.max(rolledUpTo - ROLLUP_LOOKBACK, 0) : 0;
      const dims = db.prepare('SELECT id FROM dims WHERE last_ts >= ?').all(from - DIM_TOUCH_EVERY);
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO samples_1m (dim_id, ts, v)
        SELECT dim_id, (ts / ${TIER1_BUCKET}) * ${TIER1_BUCKET}, AVG(v) FROM samples
        WHERE dim_id = ? AND ts >= ? AND ts < ? GROUP BY 2`);
      transaction(() => {
        for (const { id } of dims) stmt.run(id, from, to);
      });
      rolledUpTo = to;
    },

    // ------------------------------------------------------------ alerts
    openAlert: (a) => stmts.openAlert.get(a.node_id, a.rule, a.severity, a.value, a.message, a.started_at),
    clearAlert: (id, ts) => stmts.clearAlert.run(ts, id),
    activeAlerts: () => stmts.activeAlerts.all(),
    recentAlerts: (limit = 200) => stmts.recentAlerts.all(limit),

    // ------------------------------------------------------------ groups
    listGroups() {
      const members = new Map();
      for (const { group_id: groupId, node_id: nodeId } of stmts.groupMembers.all()) {
        if (!members.has(groupId)) members.set(groupId, []);
        members.get(groupId).push(nodeId);
      }
      return stmts.listGroups.all().map((g) => ({ ...g, nodeIds: members.get(g.id) ?? [] }));
    },
    getGroup: (id) => stmts.getGroup.get(id),
    createGroup: (name, description, now) => stmts.insertGroup.get(newId(), name, description ?? '', now),
    updateGroup: (id, name, description) => stmts.updateGroup.get(name, description ?? '', id),
    deleteGroup(id) {
      transaction(() => {
        db.prepare('DELETE FROM dashboards WHERE group_id = ?').run(id);
        stmts.clearGroupNodes.run(id);
        stmts.deleteGroup.run(id);
      });
    },
    setGroupNodes(id, nodeIds) {
      transaction(() => {
        stmts.clearGroupNodes.run(id);
        for (const nodeId of nodeIds) stmts.addGroupNode.run(id, nodeId);
      });
    },

    // ------------------------------------------------------------ events
    addEvent: (ts, nodeId, type, severity, message) => stmts.insertEvent.get(ts, nodeId, type, severity, message),
    events({ nodeIds, from, to, types, limit }) {
      const where = ['e.ts BETWEEN :from AND :to'];
      const params = { from, to, limit };
      if (nodeIds) {
        where.push('(e.node_id IS NULL OR e.node_id IN (SELECT value FROM json_each(:ids)))');
        params.ids = JSON.stringify(nodeIds);
      }
      if (types?.length) {
        where.push(`(${types.map((t, i) => `e.type LIKE :t${i}`).join(' OR ')})`);
        types.forEach((t, i) => { params[`t${i}`] = `${t}%`; });
      }
      return db.prepare(`
        SELECT e.*, n.hostname FROM events e LEFT JOIN nodes n ON n.id = e.node_id
        WHERE ${where.join(' AND ')} ORDER BY e.ts DESC, e.id DESC LIMIT :limit`).all(params);
    },

    // ------------------------------------------------------------ anomalies
    insertAnomaly: (nodeId, metric, ts, value, score) => stmts.insertAnomaly.run(nodeId, metric, ts, value, score),
    anomalyCounts(nodeIds, from, to) {
      return db.prepare(`
        SELECT node_id, metric, COUNT(*) AS n, MAX(ts) AS last_ts FROM anomalies
        WHERE ts BETWEEN ? AND ? AND node_id IN (SELECT value FROM json_each(?))
        GROUP BY node_id, metric`).all(from, to, JSON.stringify(nodeIds));
    },
    anomalyTimeline(nodeIds, from, to, maxPoints) {
      const bucket = bucketFor(from, to, maxPoints);
      const rows = db.prepare(`
        SELECT ${BUCKET_SQL} AS t, COUNT(*) AS n FROM anomalies
        WHERE ts BETWEEN :from AND :to AND node_id IN (SELECT value FROM json_each(:ids))
        GROUP BY t ORDER BY t`).all({ bucket, from, to, ids: JSON.stringify(nodeIds) });
      return { bucket, rows };
    },
    recentAnomalies(nodeIds, from, to, limit = 100) {
      return db.prepare(`
        SELECT a.*, n.hostname FROM anomalies a LEFT JOIN nodes n ON n.id = a.node_id
        WHERE a.ts BETWEEN ? AND ? AND a.node_id IN (SELECT value FROM json_each(?))
        ORDER BY a.ts DESC LIMIT ?`).all(from, to, JSON.stringify(nodeIds), limit);
    },

    // ------------------------------------------------------------ notification channels
    listChannels: () => stmts.listChannels.all(),
    getChannel: (id) => stmts.getChannel.get(id),
    createChannel: (c, now) => stmts.insertChannel.get(c.name, c.type, c.url, c.min_severity, c.enabled ? 1 : 0, now),
    updateChannel: (id, c) => stmts.updateChannel.get(c.name, c.type, c.url, c.min_severity, c.enabled ? 1 : 0, id),
    deleteChannel: (id) => stmts.deleteChannel.run(id),

    // ------------------------------------------------------------ dashboards
    listDashboards: (groupId) => db.prepare(`
      SELECT id, group_id, name, description, json_array_length(items) AS charts, created_at, updated_at
      FROM dashboards WHERE group_id = ? ORDER BY name COLLATE NOCASE`).all(groupId),
    getDashboard(id) {
      const row = db.prepare('SELECT * FROM dashboards WHERE id = ?').get(id);
      return row && { ...row, items: JSON.parse(row.items) };
    },
    createDashboard(d, now) {
      const id = newId();
      db.prepare(`INSERT INTO dashboards (id, group_id, name, description, items, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, d.group_id, d.name, d.description, JSON.stringify(d.items), now, now);
      return this.getDashboard(id);
    },
    updateDashboard(id, d, now) {
      db.prepare('UPDATE dashboards SET name = ?, description = ?, items = ?, updated_at = ? WHERE id = ?')
        .run(d.name, d.description, JSON.stringify(d.items), now, id);
      return this.getDashboard(id);
    },
    deleteDashboard: (id) => db.prepare('DELETE FROM dashboards WHERE id = ?').run(id),

    // ------------------------------------------------------------ collector jobs
    listJobs: () => db.prepare('SELECT * FROM collector_jobs ORDER BY name COLLATE NOCASE').all(),
    jobsForNode: (nodeId) => db.prepare('SELECT * FROM collector_jobs WHERE node_id = ? AND enabled = 1').all(nodeId),
    getJob: (id) => db.prepare('SELECT * FROM collector_jobs WHERE id = ?').get(id),
    createJob: (j, now) => db.prepare(`
      INSERT INTO collector_jobs (node_id, name, type, config, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`)
      .get(j.node_id, j.name, j.type, JSON.stringify(j.config), j.enabled ? 1 : 0, now, now),
    updateJob: (id, j, now) => db.prepare(`
      UPDATE collector_jobs SET name = ?, config = ?, enabled = ?, updated_at = ? WHERE id = ? RETURNING *`)
      .get(j.name, JSON.stringify(j.config), j.enabled ? 1 : 0, now, id),
    deleteJob: (id) => db.prepare('DELETE FROM collector_jobs WHERE id = ?').run(id),

    // ------------------------------------------------------------ users and sessions
    countUsers: () => stmts.countUsers.get().n,
    countAdmins: () => stmts.countAdmins.get().n,
    listUsers: () => stmts.listUsers.all(),
    getUser: (id) => stmts.getUser.get(id),
    getUserByEmail: (email) => stmts.getUserByEmail.get(email),
    createUser: (u, now) => stmts.insertUser.get(u.email, u.name, u.passwordHash, u.role, now),
    updateUser: (id, u) => stmts.updateUser.get(u.name, u.role, id),
    setPassword: (id, hash) => stmts.setPassword.run(hash, id),
    touchLogin: (id, now) => stmts.touchLogin.run(now, id),
    deleteUser(id) {
      transaction(() => {
        stmts.deleteUserSessions.run(id);
        stmts.deleteUser.run(id);
      });
    },
    createSession: (tokenHash, userId, now, expiresAt) => stmts.insertSession.run(tokenHash, userId, now, expiresAt),
    getSession: (tokenHash, now) => stmts.getSession.get(tokenHash, now),
    deleteSession: (tokenHash) => stmts.deleteSession.run(tokenHash),
    deleteUserSessions: (userId) => stmts.deleteUserSessions.run(userId),

    // ------------------------------------------------------------ retention
    prune(metricsBefore, historyBefore, now) {
      db.prepare('DELETE FROM metrics WHERE ts < ?').run(metricsBefore);
      db.prepare('DELETE FROM anomalies WHERE ts < ?').run(metricsBefore);
      // Per-dimension deletes use the (dim_id, ts) primary key instead of a scan.
      const deleteOld = db.prepare('DELETE FROM samples WHERE dim_id = ? AND ts < ?');
      const deleteOld1m = db.prepare('DELETE FROM samples_1m WHERE dim_id = ? AND ts < ?');
      const deleteDim = db.prepare('DELETE FROM dims WHERE id = ?');
      for (const d of stmts.allDims.all()) {
        deleteOld.run(d.id, metricsBefore);
        deleteOld1m.run(d.id, metricsBefore);
        if (d.last_ts < metricsBefore) {
          deleteDim.run(d.id);
          dimCache.delete(dimKey(d.node_id, d.chart, d.instance, d.dim));
        }
      }
      db.prepare('DELETE FROM alerts WHERE cleared_at IS NOT NULL AND cleared_at < ?').run(historyBefore);
      db.prepare('DELETE FROM events WHERE ts < ?').run(historyBefore);
      stmts.pruneSessions.run(now);
    },
  };
}
