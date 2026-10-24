import { DatabaseSync } from 'node:sqlite';

// Every per-second sample an agent sends has exactly these numeric fields.
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

const round = (v) => (v == null ? null : Math.round(v * 100) / 100);

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
    deleteNode: db.prepare('DELETE FROM nodes WHERE id = ?'),
    deleteNodeMetrics: db.prepare('DELETE FROM metrics WHERE node_id = ?'),
    deleteNodeAlerts: db.prepare('DELETE FROM alerts WHERE node_id = ?'),

    insertMetric: db.prepare(`
      INSERT OR REPLACE INTO metrics (node_id, ts, ${METRICS.join(', ')})
      VALUES (?, ?, ${METRICS.map(() => '?').join(', ')})`),
    latestMetric: db.prepare('SELECT * FROM metrics WHERE node_id = ? ORDER BY ts DESC LIMIT 1'),
    pruneMetrics: db.prepare('DELETE FROM metrics WHERE ts < ?'),

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
    pruneAlerts: db.prepare('DELETE FROM alerts WHERE cleared_at IS NOT NULL AND cleared_at < ?'),
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

  return {
    transaction,

    upsertNode(node, now) {
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
    },
    touchNode: (id, ts) => stmts.touchNode.run(ts, id),
    getNode: (id) => stmts.getNode.get(id),
    listNodes: () => stmts.listNodes.all(),
    deleteNode(id) {
      transaction(() => {
        stmts.deleteNodeMetrics.run(id);
        stmts.deleteNodeAlerts.run(id);
        stmts.deleteNode.run(id);
      });
    },

    insertMetric(nodeId, ts, m) {
      stmts.insertMetric.run(nodeId, ts, ...METRICS.map((k) => m[k] ?? null));
    },
    latestMetric: (nodeId) => stmts.latestMetric.get(nodeId),

    history(nodeId, from, to, maxPoints) {
      const bucket = Math.max(1, Math.ceil((to - from) / maxPoints));
      const rows = db.prepare(`
        SELECT (ts / CAST(:bucket AS INTEGER)) * CAST(:bucket AS INTEGER) AS t, ${METRICS.map((m) => `AVG(${m}) AS ${m}`).join(', ')}
        FROM metrics WHERE node_id = :nodeId AND ts BETWEEN :from AND :to
        GROUP BY t ORDER BY t`).all({ bucket, nodeId, from, to });
      return bucketed(rows, bucket, METRICS);
    },

    overview(metric, from, to, maxPoints) {
      const expr = OVERVIEW_METRICS[metric];
      if (!expr) return null;
      const bucket = Math.max(1, Math.ceil((to - from) / maxPoints));
      const rows = db.prepare(`
        SELECT node_id, (ts / CAST(:bucket AS INTEGER)) * CAST(:bucket AS INTEGER) AS t, AVG(${expr}) AS v
        FROM metrics WHERE ts BETWEEN :from AND :to
        GROUP BY node_id, t ORDER BY t`).all({ bucket, from, to });

      const ts = [...new Set(rows.map((r) => r.t))].sort((a, b) => a - b);
      const index = new Map(ts.map((t, i) => [t, i]));
      const nodes = new Map();
      for (const r of rows) {
        if (!nodes.has(r.node_id)) nodes.set(r.node_id, new Array(ts.length).fill(null));
        nodes.get(r.node_id)[index.get(r.t)] = round(r.v);
      }
      return { bucket, ts, nodes: [...nodes].map(([id, values]) => ({ id, values })) };
    },

    openAlert: (a) => stmts.openAlert.get(a.node_id, a.rule, a.severity, a.value, a.message, a.started_at),
    clearAlert: (id, ts) => stmts.clearAlert.run(ts, id),
    activeAlerts: () => stmts.activeAlerts.all(),
    recentAlerts: (limit = 200) => stmts.recentAlerts.all(limit),

    prune(metricsBefore, alertsBefore) {
      stmts.pruneMetrics.run(metricsBefore);
      stmts.pruneAlerts.run(alertsBefore);
    },
  };
}
