// Chart catalog, the charts available for a scope, and chart data.
import { CHARTS, describeChart, SECTIONS } from '../services/catalog.js';
import { AGGREGATIONS, GROUPINGS, shapeSeries } from '../services/series.js';
import { bad, csv } from './helpers.js';

export function registerChartRoutes(api, { db, withScope, range, nodeNames }) {
  // Every known chart, whether or not any node reports it yet.
  api.get('/charts/catalog', (req, res) => {
    res.json({ sections: SECTIONS, charts: Object.keys(CHARTS).map(describeChart) });
  });

  // Charts with data for the scope in the time range, grouped into sections.
  api.get('/charts', withScope((req, res, ids) => {
    const r = range(req, 300);
    if (!r) return bad(res, 'invalid after/before');
    const byChart = new Map();
    for (const row of db.availableCharts(ids, r.from)) {
      if (!byChart.has(row.chart)) byChart.set(row.chart, { nodes: new Set(), instances: new Set(), dimensions: new Set() });
      const c = byChart.get(row.chart);
      c.nodes.add(row.node_id);
      if (row.instance) c.instances.add(row.instance);
      c.dimensions.add(row.dim);
    }
    const charts = [...byChart].map(([chart, c]) => ({
      ...describeChart(chart),
      nodes: c.nodes.size,
      instances: [...c.instances].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
      dimensions: [...c.dimensions],
    })).sort((a, b) => a.priority - b.priority);
    const sections = [...SECTIONS, 'Other'].filter((s) => charts.some((c) => c.section === s));
    res.json({ sections, charts });
  }));

  api.get('/charts/data', withScope((req, res, ids) => {
    const chart = String(req.query.chart || '');
    if (!chart) return bad(res, 'chart is required');
    const r = range(req, 300);
    if (!r) return bad(res, 'invalid after/before');
    const meta = describeChart(chart);
    const groupBy = GROUPINGS.includes(req.query.group_by) ? req.query.group_by : meta.groupBy;
    const agg = AGGREGATIONS.includes(req.query.agg) ? req.query.agg : meta.agg;
    const { bucket, rows } = db.chartData(chart, ids, r.from, r.to, r.points);
    const shaped = shapeSeries({ rows, bucket, groupBy, agg, nodeNames: nodeNames(), dimFilter: csv(req.query.dims) });
    res.json({ ...r, ...meta, groupBy, agg, ...shaped });
  }));
}
