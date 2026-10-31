// Custom dashboards: per-group boards of charts and notes.
import { AGGREGATIONS, GROUPINGS } from '../services/series.js';
import { ALL_NODES_GROUP, bad } from './helpers.js';

const ITEM_KINDS = ['chart', 'note'];
const WIDTHS = [3, 4, 6, 8, 12];

export function validateDashboard(body, existing) {
  const name = String(body?.name ?? existing?.name ?? '').trim().slice(0, 80);
  if (!name) return { error: 'name is required' };
  const items = body?.items ?? existing?.items ?? [];
  if (!Array.isArray(items) || items.length > 60) return { error: 'items must be an array of at most 60 entries' };
  const clean = [];
  for (const it of items) {
    if (!ITEM_KINDS.includes(it?.kind)) return { error: 'each item needs kind chart or note' };
    const base = {
      id: String(it.id ?? Math.random().toString(36).slice(2, 10)).slice(0, 20),
      kind: it.kind,
      width: WIDTHS.includes(Number(it.width)) ? Number(it.width) : 6,
      height: Math.min(520, Math.max(120, Number(it.height) || 220)),
      title: String(it.title ?? '').slice(0, 100),
    };
    if (it.kind === 'note') {
      clean.push({ ...base, text: String(it.text ?? '').slice(0, 4000) });
      continue;
    }
    if (typeof it.chart !== 'string' || !/^[a-z0-9_.]{1,64}$/.test(it.chart)) return { error: 'chart items need a chart id' };
    clean.push({
      ...base,
      chart: it.chart,
      groupBy: GROUPINGS.includes(it.groupBy) ? it.groupBy : undefined,
      agg: AGGREGATIONS.includes(it.agg) ? it.agg : undefined,
      type: ['line', 'area', 'stacked'].includes(it.type) ? it.type : undefined,
      nodes: Array.isArray(it.nodes) ? it.nodes.map(String).slice(0, 100) : undefined,
      dims: Array.isArray(it.dims) ? it.dims.map(String).slice(0, 50) : undefined,
    });
  }
  return {
    dashboard: { name, description: String(body?.description ?? existing?.description ?? '').slice(0, 300), items: clean },
  };
}

export function registerDashboardRoutes(api, { core, db, groups }) {
  api.get('/dashboards', (req, res) => res.json(db.listDashboards(String(req.query.group || ALL_NODES_GROUP))));

  api.post('/dashboards', (req, res) => {
    const groupId = String(req.body?.group_id || ALL_NODES_GROUP);
    if (!groups().some((g) => g.id === groupId)) return bad(res, 'group not found', 404);
    const { dashboard, error } = validateDashboard(req.body);
    if (error) return bad(res, error);
    res.status(201).json(db.createDashboard({ ...dashboard, group_id: groupId }, core.now()));
  });

  api.get('/dashboards/:id', (req, res) => {
    const d = db.getDashboard(req.params.id);
    if (!d) return bad(res, 'dashboard not found', 404);
    res.json(d);
  });

  api.put('/dashboards/:id', (req, res) => {
    const existing = db.getDashboard(req.params.id);
    if (!existing) return bad(res, 'dashboard not found', 404);
    const { dashboard, error } = validateDashboard(req.body, existing);
    if (error) return bad(res, error);
    res.json(db.updateDashboard(existing.id, dashboard, core.now()));
  });

  api.delete('/dashboards/:id', (req, res) => {
    if (!db.getDashboard(req.params.id)) return bad(res, 'dashboard not found', 404);
    db.deleteDashboard(req.params.id);
    res.status(204).end();
  });
}
