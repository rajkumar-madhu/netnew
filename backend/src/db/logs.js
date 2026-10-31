// Log storage: one row per log line, with an FTS5 index on the message for
// fast full-text search. Timestamps are unix milliseconds.
const LEVELS = [
  { id: 'error', label: 'Error', max: 3 }, // emerg, alert, crit, err
  { id: 'warning', label: 'Warning', max: 4 },
  { id: 'info', label: 'Info', max: 6 }, // notice, info
  { id: 'debug', label: 'Debug', max: 7 },
];
export const PRIORITY_NAMES = ['emerg', 'alert', 'crit', 'err', 'warning', 'notice', 'info', 'debug'];

export const levelOf = (priority) => LEVELS.find((l) => priority <= l.max)?.id ?? 'debug';

// Turns free text into an FTS5 query: every word must match, as a prefix.
function ftsQuery(q) {
  const words = String(q).match(/[\p{L}\p{N}_./:@-]+/gu) ?? [];
  return words.slice(0, 12).map((w) => `"${w.replaceAll('"', '')}"*`).join(' AND ');
}

export function createLogStore(db, transaction) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS logs (
      id       INTEGER PRIMARY KEY,
      node_id  TEXT NOT NULL,
      ts       INTEGER NOT NULL,
      priority INTEGER NOT NULL,
      source   TEXT NOT NULL,
      service  TEXT NOT NULL,
      message  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS logs_ts ON logs (ts);
    CREATE INDEX IF NOT EXISTS logs_node_ts ON logs (node_id, ts);
    CREATE VIRTUAL TABLE IF NOT EXISTS logs_fts USING fts5(message, content='logs', content_rowid='id');
    CREATE TRIGGER IF NOT EXISTS logs_ai AFTER INSERT ON logs BEGIN
      INSERT INTO logs_fts (rowid, message) VALUES (new.id, new.message);
    END;
    CREATE TRIGGER IF NOT EXISTS logs_ad AFTER DELETE ON logs BEGIN
      INSERT INTO logs_fts (logs_fts, rowid, message) VALUES ('delete', old.id, old.message);
    END;
  `);

  const insert = db.prepare('INSERT INTO logs (node_id, ts, priority, source, service, message) VALUES (?, ?, ?, ?, ?, ?)');

  // Shared WHERE clause. `skip` leaves out one filter, so each facet counts
  // its values as if its own filter weren't applied.
  function where(f, skip) {
    const clauses = ['l.ts BETWEEN :from AND :to', 'l.node_id IN (SELECT value FROM json_each(:ids))'];
    const params = { from: f.from, to: f.to, ids: JSON.stringify(f.nodeIds) };
    if (f.q && ftsQuery(f.q)) {
      clauses.push('l.id IN (SELECT rowid FROM logs_fts WHERE logs_fts MATCH :q)');
      params.q = ftsQuery(f.q);
    }
    if (f.levels?.length && skip !== 'level') {
      const ranges = f.levels.map((id) => LEVELS.findIndex((l) => l.id === id)).filter((i) => i >= 0)
        .map((i) => `(l.priority > ${i ? LEVELS[i - 1].max : -1} AND l.priority <= ${LEVELS[i].max})`);
      if (ranges.length) clauses.push(`(${ranges.join(' OR ')})`);
    }
    if (f.services?.length && skip !== 'service') {
      clauses.push('l.service IN (SELECT value FROM json_each(:services))');
      params.services = JSON.stringify(f.services);
    }
    if (f.nodes?.length && skip !== 'node') {
      clauses.push('l.node_id IN (SELECT value FROM json_each(:nodes))');
      params.nodes = JSON.stringify(f.nodes);
    }
    return { sql: clauses.join(' AND '), params };
  }

  return {
    insert(nodeId, entries) {
      transaction(() => {
        for (const e of entries) insert.run(nodeId, e.ts, e.priority, e.source, e.service, e.message);
      });
    },

    // Newest first; `beforeId` pages backwards, `afterId` fetches only newer
    // lines (for follow mode, returned oldest first).
    query(f) {
      const { sql, params } = where(f);
      if (f.afterId) {
        return db.prepare(`
          SELECT l.*, n.hostname FROM logs l LEFT JOIN nodes n ON n.id = l.node_id
          WHERE ${sql} AND l.id > :afterId ORDER BY l.id ASC LIMIT :limit`)
          .all({ ...params, afterId: f.afterId, limit: f.limit });
      }
      return db.prepare(`
        SELECT l.*, n.hostname FROM logs l LEFT JOIN nodes n ON n.id = l.node_id
        WHERE ${sql} ${f.beforeId ? 'AND l.id < :beforeId' : ''}
        ORDER BY l.ts DESC, l.id DESC LIMIT :limit`)
        .all({ ...params, limit: f.limit, ...(f.beforeId ? { beforeId: f.beforeId } : {}) });
    },

    histogram(f, points) {
      const bucket = Math.max(1000, Math.ceil((f.to - f.from) / points / 1000) * 1000);
      const { sql, params } = where(f);
      const rows = db.prepare(`
        SELECT (l.ts / ${bucket}) * ${bucket} AS t,
          SUM(l.priority <= 3) AS error, SUM(l.priority = 4) AS warning,
          SUM(l.priority BETWEEN 5 AND 6) AS info, SUM(l.priority = 7) AS debug
        FROM logs l WHERE ${sql} GROUP BY t ORDER BY t`).all(params);
      const byT = new Map(rows.map((r) => [r.t, r]));
      const out = { bucket, ts: [], error: [], warning: [], info: [], debug: [] };
      for (let t = Math.floor(f.from / bucket) * bucket; t <= f.to; t += bucket) {
        const r = byT.get(t);
        out.ts.push(t / 1000);
        for (const k of ['error', 'warning', 'info', 'debug']) out[k].push(r?.[k] ?? 0);
      }
      return out;
    },

    facets(f) {
      const level = (() => {
        const { sql, params } = where(f, 'level');
        const r = db.prepare(`
          SELECT SUM(l.priority <= 3) AS error, SUM(l.priority = 4) AS warning,
            SUM(l.priority BETWEEN 5 AND 6) AS info, SUM(l.priority = 7) AS debug, COUNT(*) AS total
          FROM logs l WHERE ${sql}`).get(params);
        return LEVELS.map((l) => ({ id: l.id, label: l.label, count: r[l.id] ?? 0 }));
      })();
      const service = (() => {
        const { sql, params } = where(f, 'service');
        return db.prepare(`SELECT l.service AS id, COUNT(*) AS count FROM logs l WHERE ${sql}
          GROUP BY l.service ORDER BY count DESC LIMIT 50`).all(params);
      })();
      const node = (() => {
        const { sql, params } = where(f, 'node');
        return db.prepare(`SELECT l.node_id AS id, n.hostname AS label, COUNT(*) AS count
          FROM logs l LEFT JOIN nodes n ON n.id = l.node_id WHERE ${sql}
          GROUP BY l.node_id ORDER BY count DESC`).all(params);
      })();
      const { sql, params } = where(f);
      const total = db.prepare(`SELECT COUNT(*) AS n FROM logs l WHERE ${sql}`).get(params).n;
      return { total, level, service, node };
    },

    maxId: () => db.prepare('SELECT MAX(id) AS id FROM logs').get().id ?? 0,

    deleteNode: (nodeId) => db.prepare('DELETE FROM logs WHERE node_id = ?').run(nodeId),

    prune(beforeMs, maxRows) {
      db.prepare('DELETE FROM logs WHERE ts < ?').run(beforeMs);
      const { n } = db.prepare('SELECT COUNT(*) AS n FROM logs').get();
      if (n > maxRows) {
        db.prepare('DELETE FROM logs WHERE id IN (SELECT id FROM logs ORDER BY id LIMIT ?)').run(n - maxRows);
      }
    },
  };
}
