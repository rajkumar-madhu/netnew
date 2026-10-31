// Schema and migrations. The schema version lives in PRAGMA user_version.
//   0 -> 1: databases from the 0.x prototypes used different names
//           (rooms, room_nodes, dims.context, dashboards.room_id); they are
//           renamed in place so existing data is kept.
export const SCHEMA_VERSION = 1;

const schema = (metrics) => `
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name          TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('admin', 'viewer')),
    created_at    INTEGER NOT NULL,
    last_login    INTEGER
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );

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

  -- One summary row per node per second (cards, alerts, anomalies).
  CREATE TABLE IF NOT EXISTS metrics (
    node_id TEXT NOT NULL,
    ts      INTEGER NOT NULL,
    ${metrics.map((m) => `${m} REAL`).join(',\n    ')},
    PRIMARY KEY (node_id, ts)
  ) WITHOUT ROWID;
  CREATE INDEX IF NOT EXISTS metrics_ts ON metrics (ts);

  -- Chart data: one row per (node, chart, instance, dimension), and one
  -- sample row per dimension per second, plus a per-minute rollup tier.
  CREATE TABLE IF NOT EXISTS dims (
    id       INTEGER PRIMARY KEY,
    node_id  TEXT NOT NULL,
    chart    TEXT NOT NULL,
    instance TEXT NOT NULL,
    dim      TEXT NOT NULL,
    last_ts  INTEGER NOT NULL,
    UNIQUE (node_id, chart, instance, dim)
  );
  CREATE INDEX IF NOT EXISTS dims_chart ON dims (chart, node_id);

  CREATE TABLE IF NOT EXISTS samples (
    dim_id INTEGER NOT NULL,
    ts     INTEGER NOT NULL,
    v      REAL,
    PRIMARY KEY (dim_id, ts)
  ) WITHOUT ROWID;

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

  CREATE TABLE IF NOT EXISTS node_groups (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT,
    created_at  INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS node_group_members (
    group_id TEXT NOT NULL,
    node_id  TEXT NOT NULL,
    PRIMARY KEY (group_id, node_id)
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

  CREATE TABLE IF NOT EXISTS dashboards (
    id          TEXT PRIMARY KEY,
    group_id    TEXT NOT NULL,
    name        TEXT NOT NULL,
    description TEXT,
    items       TEXT NOT NULL DEFAULT '[]',
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS collector_jobs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    node_id    TEXT NOT NULL,
    name       TEXT NOT NULL,
    type       TEXT NOT NULL,
    config     TEXT NOT NULL,
    enabled    INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
`;

export function migrate(db, metrics) {
  const version = db.prepare('PRAGMA user_version').get().user_version;
  const hasTable = (name) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
  const hasColumn = (table, column) => db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);

  if (version < 1) {
    db.exec('BEGIN');
    try {
      if (hasTable('rooms') && !hasTable('node_groups')) db.exec('ALTER TABLE rooms RENAME TO node_groups');
      if (hasTable('room_nodes') && !hasTable('node_group_members')) {
        db.exec('ALTER TABLE room_nodes RENAME TO node_group_members');
        db.exec('ALTER TABLE node_group_members RENAME COLUMN room_id TO group_id');
      }
      if (hasTable('dims') && hasColumn('dims', 'context')) {
        db.exec('DROP INDEX IF EXISTS dims_context');
        db.exec('ALTER TABLE dims RENAME COLUMN context TO chart');
      }
      if (hasTable('dashboards') && hasColumn('dashboards', 'room_id')) {
        db.exec('ALTER TABLE dashboards RENAME COLUMN room_id TO group_id');
        db.exec(`UPDATE dashboards SET items = replace(items, '"context":', '"chart":')`);
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  db.exec(schema(metrics));
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}
