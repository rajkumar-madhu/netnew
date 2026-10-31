// Alerts, alert rules, events, anomalies and notification channels.
import { describeRules } from '../services/alerts.js';
import { ANOMALY_METRICS } from '../services/anomalies.js';
import { validateChannel } from '../services/notifier.js';
import { ALL_NODES_GROUP, bad, csv } from './helpers.js';

export function registerAlertRoutes(api, { core, db, withScope, range, nodeNames }) {
  api.get('/alerts', withScope((req, res, ids) => {
    const set = new Set(ids);
    const rows = req.query.state === 'active' ? db.activeAlerts() : db.recentAlerts(500);
    res.json(rows.filter((a) => set.has(a.node_id)).map(core.decorateAlert));
  }));

  api.get('/alert-rules', (req, res) => res.json(describeRules(core.config.offlineAfterSec)));

  api.get('/events', withScope((req, res, ids) => {
    const r = range(req, 300);
    if (!r) return bad(res, 'invalid after/before');
    const limit = Math.min(1000, Math.max(1, Number(req.query.limit) || 300));
    // The "All nodes" view is the full history, including nodes that have
    // since been deleted and workspace-wide events (which have no node).
    const allNodes = (!req.query.group || req.query.group === ALL_NODES_GROUP) && !req.query.nodes;
    const events = db.events({ nodeIds: allNodes ? null : ids, from: r.from, to: r.to, types: csv(req.query.type), limit })
      .filter((e) => e.node_id || allNodes);
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

    // One point per bucket across the whole range, zero when nothing was flagged.
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
}
