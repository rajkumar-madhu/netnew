import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

// Every per-second summary sample an agent sends has exactly these numeric fields.
export const METRICS = [
  'cpu', 'cpu_user', 'cpu_system',
  'mem_used', 'mem_cached', 'mem_total', 'swap_used',
  'load1', 'load5', 'load15',
  'net_rx', 'net_tx',
  'disk_read', 'disk_write', 'disk_pct',
];

// Cross-node charts on the overview page, as SQL expressions over one sample.
const OVERVIEW_METRICS = {
  cpu: 'cpu',
  ram: 'mem_used * 100.0 / NULLIF(mem_total, 0)',
  load: 'load1',
  net: 'COALESCE(net_rx, 0) + COALESCE(net_tx, 0)',
  disk: 'disk_pct',
};

// How often a dimension's last_ts is persisted; it only needs to be accurate
// enough to hide instances (interfaces, disks) that disappeared.
const DIM_TOUCH_EVERY = 60;

// Charts whose buckets are at least this many seconds read the per-minute tier.
const TIER1_BUCKET = 60;
// Each rollup re-aggregates this much recent history, so samples an agent
// buffered while disconnected (up to 15 minutes) still make it into tier 1.
const ROLLUP_LOOKBACK = 20 * 60;

const round = (v) => (v == null ? null : Math.round(v * 1000) / 1000);
const placeholders = (n) => new Array(n).fill('?').join(', ');

export function openDb(path) {
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;

    CREATE TABLE IF NOT EXISTS nodes (
      id            TEXT PRIMARY KEY,
      hostname      TEXT NOT NULL,
      os            TEXT,
      platform      TEXT,
      kernel        TEXT,
      arch          TEXT,
      cpu_model     TEXT,
      cores         INTEGER,
      mem_total     REAL,
      ip            TEXT,
      agent_version TEXT,
      boot_time     INTEGER,
      fs            TEXT,
      first_seen    INTEGER NOT NULL,
      last_seen     INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS metrics (
      node_id TEXT NOT NULL,
      ts      INTEGER NOT NULL,
      ${METRICS.map((m) => `${m} REAL`).join(',\n      ')},
      PRIMARY KEY (node_id, ts)
    ) WITHOUT ROWID;
    CREATE INDEX IF NOT EXISTS metrics_ts ON metrics (ts);

    -- Dimensional data: one row per (node, context, instance, dimension), and
    -- one sample row per dimension per second.
    CREATE TABLE IF NOT EXISTS dims (
      id       INTEGER PRIMARY KEY,
      node_id  TEXT NOT NULL,
      context  TEXT NOT NULL,
      instance TEXT NOT NULL,
      dim      TEXT NOT NULL,
      last_ts  INTEGER NOT NULL,
      UNIQUE (node_id, context, instance, dim)
    );
    CREATE INDEX IF NOT EXISTS dims_context ON dims (context, node_id);

    CREATE TABLE IF NOT EXISTS samples (
      dim_id INTEGER NOT NULL,
      ts     INTEGER NOT NULL,
      v      REAL,
      PRIMARY KEY (dim_id, ts)
    ) WITHOUT ROWID;

    -- Tier 1: per-minute averages of samples, used for long time ranges.
    CREATE TABLE IF NOT EXISTS samples_1m (
      dim_id INTEGER NOT NULL,
      ts     INTEGER NOT NULL,
      v      REAL,
      PRIMARY KEY (dim_id, ts)
    ) WITHOUT ROWID;

    CREATE TABLE IF NOT EXISTS alerts (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      node_id    TEXT NOT NULL,
      rule       TEXT NOT NULL,
      severity   TEXT NOT NULL,
      value      REAL,
      message    TEXT,
      started_at INTEGER NOT NULL,
      cleared_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS alerts_open ON alerts (cleared_at);

    CREATE TABLE IF NOT EXISTS rooms (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      description TEXT,
      created_at  INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS room_nodes (
      room_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      PRIMARY KEY (room_id, node_id)
    ) WITHOUT ROWID;

    CREATE TABLE IF NOT EXISTS events (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      ts       INTEGER NOT NULL,
      node_id  TEXT,
      type     TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'info',
      message  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS events_ts ON events (ts);

    CREATE TABLE IF NOT EXISTS anomalies (
      node_id TEXT NOT NULL,
      metric  TEXT NOT NULL,
      ts      INTEGER NOT NULL,
      value   REAL,
      score   REAL,
      PRIMARY KEY (node_id, metric, ts)
    ) WITHOUT ROWID;
    CREATE INDEX IF NOT EXISTS anomalies_ts ON anomalies (ts);

    CREATE TABLE IF NOT EXISTS channels (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      name         TEXT NOT NULL,
      type         TEXT NOT NULL,
      url          TEXT NOT NULL,
      min_severity TEXT NOT NULL DEFAULT 'warning',
      enabled      INTEGER NOT NULL DEFAULT 1,
      created_at   INTEGER NOT NULL
    );
  `);

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

    allDims: db.prepare('SELECT id, node_id, context, instance, dim, last_ts FROM dims'),
    insertDim: db.prepare(`
      INSERT INTO dims (node_id, context, instance, dim, last_ts) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (node_id, context, instance, dim) DO UPDATE SET last_ts = excluded.last_ts
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

    listRooms: db.prepare('SELECT * FROM rooms ORDER BY name COLLATE NOCASE'),
    getRoom: db.prepare('SELECT * FROM rooms WHERE id = ?'),
    insertRoom: db.prepare('INSERT INTO rooms (id, name, description, created_at) VALUES (?, ?, ?, ?) RETURNING *'),
    updateRoom: db.prepare('UPDATE rooms SET name = ?, description = ? WHERE id = ? RETURNING *'),
    deleteRoom: db.prepare('DELETE FROM rooms WHERE id = ?'),
    roomMembers: db.prepare('SELECT room_id, node_id FROM room_nodes'),
    clearRoomNodes: db.prepare('DELETE FROM room_nodes WHERE room_id = ?'),
    addRoomNode: db.prepare('INSERT OR IGNORE INTO room_nodes (room_id, node_id) VALUES (?, ?)'),

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

  // Averages samples into buckets so a chart never gets more than ~maxPoints
  // points, and inserts a null where data is missing so lines show the gap.
  function bucketed(rows, bucket, columns) {
    const out = { bucket, ts: [], series: Object.fromEntries(columns.map((c) => [c, []])) };
    let prev = null;
    for (const row of rows) {
      if (prev !== null && row.t - prev > bucket * 3) {
        out.ts.push(prev + bucket);
        for (const c of columns) out.series[c].push(null);
      }
      out.ts.push(row.t);
      for (const c of columns) out.series[c].push(round(row[c]));
      prev = row.t;
    }
    return out;
  }

  const bucketFor = (from, to, maxPoints) => Math.max(1, Math.ceil((to - from) / maxPoints));
  const BUCKET_SQL = '(ts / CAST(:bucket AS INTEGER)) * CAST(:bucket AS INTEGER)';

  // dim key -> { id, lastTouched }
  const dimCache = new Map();
  const dimKey = (nodeId, context, instance, dim) => `${nodeId}\u0000${context}\u0000${instance}\u0000${dim}`;
  for (const d of stmts.allDims.all()) {
    dimCache.set(dimKey(d.node_id, d.context, d.instance, d.dim), { id: d.id, lastTouched: d.last_ts });
  }

  // Tier 1 is complete up to (not including) this timestamp. Resume from the
  // newest rolled-up minute; the first rollup after start fills any gap.
  const newestRollup = db.prepare('SELECT MAX(ts) AS ts FROM samples_1m').get().ts;
  let rolledUpTo = newestRollup == null ? 0 : newestRollup + TIER1_BUCKET;

  return {
    transaction,

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
        for (const table of ['dims', 'metrics', 'alerts', 'anomalies', 'room_nodes']) {
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

    history(nodeId, from, to, maxPoints) {
      const bucket = bucketFor(from, to, maxPoints);
      const rows = db.prepare(`
        SELECT ${BUCKET_SQL} AS t, ${METRICS.map((m) => `AVG(${m}) AS ${m}`).join(', ')}
        FROM metrics WHERE node_id = :nodeId AND ts BETWEEN :from AND :to
        GROUP BY t ORDER BY t`).all({ bucket, nodeId, from, to });
      return bucketed(rows, bucket, METRICS);
    },

    overview(metric, nodeIds, from, to, maxPoints) {
      const expr = OVERVIEW_METRICS[metric];
      if (!expr) return null;
      const bucket = bucketFor(from, to, maxPoints);
      if (!nodeIds.length) return { bucket, ts: [], nodes: [] };
      const rows = db.prepare(`
        SELECT node_id, ${BUCKET_SQL} AS t, AVG(${expr}) AS v
        FROM metrics WHERE ts BETWEEN :from AND :to
          AND node_id IN (SELECT value FROM json_each(:ids))
        GROUP BY node_id, t ORDER BY t`).all({ bucket, from, to, ids: JSON.stringify(nodeIds) });

      const ts = [...new Set(rows.map((r) => r.t))].sort((a, b) => a - b);
      const index = new Map(ts.map((t, i) => [t, i]));
      const nodes = new Map();
      for (const r of rows) {
        if (!nodes.has(r.node_id)) nodes.set(r.node_id, new Array(ts.length).fill(null));
        nodes.get(r.node_id)[index.get(r.t)] = round(r.v);
      }
      return { bucket, ts, nodes: [...nodes].map(([id, values]) => ({ id, values })) };
    },

    // Seconds of data each node has in a range (denominator for anomaly rates).
    secondsCollected(nodeIds, from, to) {
      const rows = db.prepare(`
        SELECT node_id, COUNT(*) AS n FROM metrics
        WHERE ts BETWEEN ? AND ? AND node_id IN (SELECT value FROM json_each(?))
        GROUP BY node_id`).all(from, to, JSON.stringify(nodeIds));
      return Object.fromEntries(rows.map((r) => [r.node_id, r.n]));
    },

    // ------------------------------------------------------------ dimensional metrics
    insertChart(nodeId, ts, context, instance, dims) {
      for (const [dim, v] of Object.entries(dims)) {
        const key = dimKey(nodeId, context, instance, dim);
        let entry = dimCache.get(key);
        if (!entry) {
          entry = { id: stmts.insertDim.get(nodeId, context, instance, dim, ts).id, lastTouched: ts };
          dimCache.set(key, entry);
        } else if (ts - entry.lastTouched >= DIM_TOUCH_EVERY) {
          stmts.touchDim.run(ts, entry.id);
          entry.lastTouched = ts;
        }
        stmts.insertSample.run(entry.id, ts, v);
      }
    },

    // Which contexts/instances/dimensions the given nodes reported since `since`.
    contexts(nodeIds, since) {
      return db.prepare(`
        SELECT context, node_id, instance, dim FROM dims
        WHERE last_ts >= ? AND node_id IN (SELECT value FROM json_each(?)) ORDER BY id`)
        .all(since - DIM_TOUCH_EVERY, JSON.stringify(nodeIds));
    },

    // Bucketed samples for one context: rows of { node_id, instance, dim, t, v }.
    // Short ranges read per-second samples. Long ranges read the per-minute
    // tier up to the last rolled-up minute, plus raw samples after it, and the
    // two are merged weighted by the seconds each row covers.
    contextData(context, nodeIds, from, to, maxPoints) {
      let bucket = bucketFor(from, to, maxPoints);
      const params = { context, since: from - DIM_TOUCH_EVERY, ids: JSON.stringify(nodeIds) };
      const query = (table, weight, lo, hi) => db.prepare(`
        SELECT d.id, d.node_id, d.instance, d.dim,
               (s.ts / CAST(:bucket AS INTEGER)) * CAST(:bucket AS INTEGER) AS t,
               AVG(s.v) AS v, COUNT(*) * ${weight} AS w
        FROM dims d JOIN ${table} s ON s.dim_id = d.id
        WHERE d.context = :context AND d.last_ts >= :since
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

    // ------------------------------------------------------------ rooms
    listRooms() {
      const members = new Map();
      for (const { room_id, node_id } of stmts.roomMembers.all()) {
        if (!members.has(room_id)) members.set(room_id, []);
        members.get(room_id).push(node_id);
      }
      return stmts.listRooms.all().map((r) => ({ ...r, nodeIds: members.get(r.id) ?? [] }));
    },
    getRoom: (id) => stmts.getRoom.get(id),
    createRoom(name, description, now) {
      return stmts.insertRoom.get(randomBytes(6).toString('hex'), name, description ?? '', now);
    },
    updateRoom: (id, name, description) => stmts.updateRoom.get(name, description ?? '', id),
    deleteRoom(id) {
      transaction(() => {
        stmts.clearRoomNodes.run(id);
        stmts.deleteRoom.run(id);
      });
    },
    setRoomNodes(id, nodeIds) {
      transaction(() => {
        stmts.clearRoomNodes.run(id);
        for (const nodeId of nodeIds) stmts.addRoomNode.run(id, nodeId);
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
        where.push('(' + types.map((t, i) => `e.type LIKE :t${i}`).join(' OR ') + ')');
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

    // ------------------------------------------------------------ retention
    prune(metricsBefore, historyBefore) {
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
          dimCache.delete(dimKey(d.node_id, d.context, d.instance, d.dim));
        }
      }
      db.prepare('DELETE FROM alerts WHERE cleared_at IS NOT NULL AND cleared_at < ?').run(historyBefore);
      db.prepare('DELETE FROM events WHERE ts < ?').run(historyBefore);
    },
  };
}
