import express from 'express';
import { describeRules } from './alerts.js';
import { ANOMALY_METRICS } from './anomalies.js';
import { describeContext, SECTIONS } from './contexts.js';
import { validateChannel } from './notify.js';
import { AGGREGATIONS, GROUPINGS, shapeContext } from './shape.js';

export const ALL_NODES_ROOM = 'all';

// Netdata-style time ranges: after/before are absolute unix seconds, or
// relative to now when <= 0 (after=-900&before=0 is "the last 15 minutes").
export function parseRange(q, now, defaultPoints) {
  const after = Number(q.after ?? -900);
  const before = Number(q.before ?? 0);
  const to = Math.floor(before <= 0 ? now + before : before);
  let from = Math.floor(after <= 0 ? now + after : after);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  if (from >= to) from = to - 1;
  const points = Math.min(2000, Math.max(10, Number(q.points) || defaultPoints));
  return { from, to, points };
}

const csv = (v) => (v ? String(v).split(',').map((s) => s.trim()).filter(Boolean) : null);

export function createApi(core) {
  const { db, config } = core;
  const api = express.Router();
  api.use(express.json({ limit: '100kb' }));

  const bad = (res, error, status = 400) => res.status(status).json({ error });

  function rooms() {
    const nodeIds = db.listNodes().map((n) => n.id);
    return [
      {
        id: ALL_NODES_ROOM,
        name: 'All nodes',
        description: 'Every node connected to this space.',
        builtin: true,
        nodeIds,
      },
      ...db.listRooms().map((r) => ({ ...r, builtin: false, nodeIds: r.nodeIds.filter((id) => nodeIds.includes(id)) })),
    ];
  }

  // The node IDs a request is about: a room (default: all nodes), optionally
  // narrowed with ?nodes=a,b. Returns null for an unknown room.
  function scope(q) {
    const room = rooms().find((r) => r.id === (q.room || ALL_NODES_ROOM));
    if (!room) return null;
    const wanted = csv(q.nodes);
    return wanted ? room.nodeIds.filter((id) => wanted.includes(id)) : room.nodeIds;
  }

  function withScope(handler) {
    return (req, res) => {
      const ids = scope(req.query);
      if (!ids) return bad(res, 'room not found', 404);
      return handler(req, res, ids);
    };
  }

  const nodeNames = () => Object.fromEntries(db.listNodes().map((n) => [n.id, n.hostname]));
  const range = (req, points) => parseRange(req.query, core.now(), points);

  // ------------------------------------------------------------ space & rooms

  api.get('/health', (req, res) => {
    res.json({ ok: true, uptime: core.now() - core.startedAt, agents: core.agents.size });
  });

  api.get('/space', (req, res) => {
    res.json({
      name: config.spaceName,
      version: core.version,
      retentionHours: config.retentionHours,
      offlineAfterSec: config.offlineAfterSec,
      authEnabled: Boolean(config.dashboardPassword),
      agentTokenFromEnv: config.agentTokenFromEnv,
      nodes: db.listNodes().length,
      connectedAgents: core.agents.size,
    });
  });

  api.get('/rooms', (req, res) => res.json(rooms()));

  function roomInput(body) {
    const name = String(body?.name ?? '').trim().slice(0, 60);
    const description = String(body?.description ?? '').trim().slice(0, 200);
    return name ? { name, description } : null;
  }

  api.post('/rooms', (req, res) => {
    const input = roomInput(req.body);
    if (!input) return bad(res, 'name is required');
    const room = db.createRoom(input.name, input.description, core.now());
    if (Array.isArray(req.body.nodeIds)) db.setRoomNodes(room.id, req.body.nodeIds.map(String));
    core.broadcast({ type: 'rooms' });
    res.status(201).json(rooms().find((r) => r.id === room.id));
  });

  api.patch('/rooms/:id', (req, res) => {
    if (!db.getRoom(req.params.id)) return bad(res, 'room not found', 404);
    const input = roomInput(req.body);
    if (!input) return bad(res, 'name is required');
    db.updateRoom(req.params.id, input.name, input.description);
    core.broadcast({ type: 'rooms' });
    res.json(rooms().find((r) => r.id === req.params.id));
  });

  api.delete('/rooms/:id', (req, res) => {
    if (!db.getRoom(req.params.id)) return bad(res, 'room not found', 404);
    db.deleteRoom(req.params.id);
    core.broadcast({ type: 'rooms' });
    res.status(204).end();
  });

  api.put('/rooms/:id/nodes', (req, res) => {
    if (!db.getRoom(req.params.id)) return bad(res, 'room not found', 404);
    if (!Array.isArray(req.body?.nodeIds)) return bad(res, 'nodeIds must be an array');
    const known = new Set(db.listNodes().map((n) => n.id));
    db.setRoomNodes(req.params.id, req.body.nodeIds.map(String).filter((id) => known.has(id)));
    core.broadcast({ type: 'rooms' });
    res.json(rooms().find((r) => r.id === req.params.id));
  });

  // ------------------------------------------------------------ nodes

  api.get('/nodes', withScope((req, res, ids) => {
    const set = new Set(ids);
    res.json(db.listNodes().filter((n) => set.has(n.id)).map(core.nodeSummary));
  }));

  api.get('/nodes/:id', (req, res) => {
    const node = core.nodeSummary(db.getNode(req.params.id));
    if (!node) return bad(res, 'node not found', 404);
    res.json(node);
  });

  api.delete('/nodes/:id', (req, res) => {
    const { id } = req.params;
    const node = db.getNode(id);
    if (!node) return bad(res, 'node not found', 404);
    if (core.agents.has(id)) return bad(res, 'node is connected; stop its agent first', 409);
    core.removeNode(node);
    res.status(204).end();
  });

  api.get('/nodes/:id/metrics', (req, res) => {
    if (!db.getNode(req.params.id)) return bad(res, 'node not found', 404);
    const r = range(req, 900);
    if (!r) return bad(res, 'invalid after/before');
    res.json({ ...r, ...db.history(req.params.id, r.from, r.to, r.points) });
  });

  api.get('/nodes/:id/processes', (req, res) => {
    if (!db.getNode(req.params.id)) return bad(res, 'node not found', 404);
    const snapshot = core.processes.get(req.params.id);
    if (!snapshot) return bad(res, 'no process data yet; the agent sends it every few seconds', 404);
    res.json(snapshot);
  });

  // ------------------------------------------------------------ metrics

  api.get('/overview', withScope((req, res, ids) => {
    const r = range(req, 300);
    if (!r) return bad(res, 'invalid after/before');
    const data = db.overview(String(req.query.metric || 'cpu'), ids, r.from, r.to, r.points);
    if (!data) return bad(res, 'unknown metric');
    res.json({ ...r, ...data });
  }));

  api.get('/contexts', withScope((req, res, ids) => {
    const r = range(req, 300);
    if (!r) return bad(res, 'invalid after/before');
    const byContext = new Map();
    for (const row of db.contexts(ids, r.from)) {
      if (!byContext.has(row.context)) {
        byContext.set(row.context, { nodes: new Set(), instances: new Set(), dimensions: new Set() });
      }
      const c = byContext.get(row.context);
      c.nodes.add(row.node_id);
      if (row.instance) c.instances.add(row.instance);
      c.dimensions.add(row.dim);
    }
    const contexts = [...byContext].map(([context, c]) => ({
      ...describeContext(context),
      nodes: c.nodes.size,
      instances: [...c.instances].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
      dimensions: [...c.dimensions],
    })).sort((a, b) => a.priority - b.priority);
    const sections = [...SECTIONS, 'Other'].filter((s) => contexts.some((c) => c.section === s));
    res.json({ sections, contexts });
  }));

  api.get('/data', withScope((req, res, ids) => {
    const context = String(req.query.context || '');
    if (!context) return bad(res, 'context is required');
    const r = range(req, 300);
    if (!r) return bad(res, 'invalid after/before');
    const meta = describeContext(context);
    const groupBy = GROUPINGS.includes(req.query.group_by) ? req.query.group_by : meta.groupBy;
    const agg = AGGREGATIONS.includes(req.query.agg) ? req.query.agg : meta.agg;
    const { bucket, rows } = db.contextData(context, ids, r.from, r.to, r.points);
    const shaped = shapeContext({ rows, bucket, groupBy, agg, nodeNames: nodeNames(), dimFilter: csv(req.query.dims) });
    res.json({ ...r, ...meta, groupBy, agg, ...shaped });
  }));

  // ------------------------------------------------------------ alerts, events, anomalies

  api.get('/alerts', withScope((req, res, ids) => {
    const set = new Set(ids);
    const rows = req.query.state === 'active' ? db.activeAlerts() : db.recentAlerts(500);
    res.json(rows.filter((a) => set.has(a.node_id)).map(core.decorateAlert));
  }));

  api.get('/alert-rules', (req, res) => res.json(describeRules(config.offlineAfterSec)));

  api.get('/events', withScope((req, res, ids) => {
    const r = range(req, 300);
    if (!r) return bad(res, 'invalid after/before');
    const limit = Math.min(1000, Math.max(1, Number(req.query.limit) || 300));
    // Space-wide events (no node) are only shown in the "All nodes" room.
    const allRoom = !req.query.room || req.query.room === ALL_NODES_ROOM;
    const events = db.events({ nodeIds: ids, from: r.from, to: r.to, types: csv(req.query.type), limit })
      .filter((e) => e.node_id || allRoom);
    res.json(events);
  }));

  api.get('/anomalies', withScope((req, res, ids) => {
    const r = range(req, 200);
    if (!r) return bad(res, 'invalid after/before');
    const names = nodeNames();
    const metricIds = Object.keys(ANOMALY_METRICS);
    const seconds = db.secondsCollected(ids, r.from, r.to);
    const counts = db.anomalyCounts(ids, r.from, r.to);

    const nodes = ids.map((id) => {
      const metrics = {};
      let total = 0;
      for (const c of counts.filter((x) => x.node_id === id)) {
        metrics[c.metric] = { count: c.n, rate: seconds[id] ? (c.n / seconds[id]) * 100 : 0, lastTs: c.last_ts };
        total += c.n;
      }
      const observed = (seconds[id] ?? 0) * metricIds.length;
      return { id, hostname: names[id], seconds: seconds[id] ?? 0, count: total, rate: observed ? (total / observed) * 100 : 0, metrics };
    }).sort((a, b) => b.rate - a.rate);

    const activeNodes = Math.max(1, nodes.filter((n) => n.seconds > 0).length);
    const { bucket, rows } = db.anomalyTimeline(ids, r.from, r.to, r.points);
    const bucketCounts = new Map(rows.map((x) => [x.t, x.n]));
    const timeline = { bucket, ts: [], rate: [] };
    for (let t = Math.floor(r.from / bucket) * bucket; t <= r.to; t += bucket) {
      timeline.ts.push(t);
      timeline.rate.push(Math.round(((bucketCounts.get(t) ?? 0) / (bucket * activeNodes * metricIds.length)) * 100 * 1000) / 1000);
    }
    const recent = db.recentAnomalies(ids, r.from, r.to, 30)
      .map((a) => ({ ...a, name: ANOMALY_METRICS[a.metric]?.name ?? a.metric, units: ANOMALY_METRICS[a.metric]?.units }));

    res.json({
      ...r,
      metrics: metricIds.map((id) => ({ id, name: ANOMALY_METRICS[id].name, units: ANOMALY_METRICS[id].units })),
      nodes,
      timeline,
      recent,
    });
  }));

  // ------------------------------------------------------------ notification channels

  api.get('/channels', (req, res) => res.json(db.listChannels()));

  api.post('/channels', (req, res) => {
    const { channel, error } = validateChannel(req.body);
    if (error) return bad(res, error);
    res.status(201).json(db.createChannel(channel, core.now()));
  });

  api.patch('/channels/:id', (req, res) => {
    const existing = db.getChannel(Number(req.params.id));
    if (!existing) return bad(res, 'channel not found', 404);
    const { channel, error } = validateChannel({ ...existing, enabled: Boolean(existing.enabled), ...req.body });
    if (error) return bad(res, error);
    res.json(db.updateChannel(existing.id, channel));
  });

  api.delete('/channels/:id', (req, res) => {
    if (!db.getChannel(Number(req.params.id))) return bad(res, 'channel not found', 404);
    db.deleteChannel(Number(req.params.id));
    res.status(204).end();
  });

  api.post('/channels/:id/test', async (req, res) => {
    const channel = db.getChannel(Number(req.params.id));
    if (!channel) return bad(res, 'channel not found', 404);
    try {
      await core.notifier.test(channel);
      res.json({ ok: true });
    } catch (err) {
      bad(res, `delivery failed: ${err.message}`, 502);
    }
  });

  api.use((req, res) => bad(res, 'not found', 404));
  return api;
}
