// Turns raw bucketed rows for one chart into display series. Members
// (node × instance × dimension) are grouped by dimension, node or instance,
// and each group is combined with an aggregation (avg/sum/min/max).
const AGGREGATE = {
  avg: (xs) => xs.reduce((a, b) => a + b, 0) / xs.length,
  sum: (xs) => xs.reduce((a, b) => a + b, 0),
  min: (xs) => Math.min(...xs),
  max: (xs) => Math.max(...xs),
};
export const AGGREGATIONS = Object.keys(AGGREGATE);
export const GROUPINGS = ['dimension', 'node', 'instance'];

const natural = (a, b) => a.label.localeCompare(b.label, undefined, { numeric: true });
const round = (v) => Math.round(v * 1000) / 1000;

export function shapeSeries({ rows, bucket, groupBy, agg, nodeNames, dimFilter }) {
  const combine = AGGREGATE[agg] ?? AGGREGATE.avg;
  const nodeSet = new Set();
  const instanceSet = new Set();
  const dimOrder = [];
  for (const r of rows) {
    nodeSet.add(r.node_id);
    instanceSet.add(`${r.node_id}\u0000${r.instance}`);
    if (!dimOrder.includes(r.dim)) dimOrder.push(r.dim);
  }
  const multiNode = nodeSet.size > 1;
  const host = (id) => nodeNames[id] ?? id.slice(0, 8);

  const groups = new Map();
  for (const r of rows) {
    if (dimFilter && !dimFilter.includes(r.dim)) continue;
    let key;
    let label;
    if (groupBy === 'node') {
      key = r.node_id;
      label = host(r.node_id);
    } else if (groupBy === 'instance') {
      key = `${r.node_id}\u0000${r.instance}`;
      label = multiNode || !r.instance ? [host(r.node_id), r.instance].filter(Boolean).join(' · ') : r.instance;
    } else {
      key = r.dim;
      label = r.dim;
    }
    if (!groups.has(key)) groups.set(key, { id: key, label, points: new Map() });
    const points = groups.get(key).points;
    if (r.v == null) continue;
    if (!points.has(r.t)) points.set(r.t, []);
    points.get(r.t).push(r.v);
  }

  // Shared x axis: every bucket that has data, plus a null slot in long gaps
  // so lines break instead of drawing across missing data. Collectors that run
  // every few seconds (containers, service checks) leave regular holes in
  // per-second buckets, so only gaps well beyond the usual spacing count.
  const present = [...new Set(rows.map((r) => r.t))].sort((a, b) => a - b);
  const spacings = present.slice(1).map((t, i) => t - present[i]).sort((a, b) => a - b);
  const typical = Math.max(bucket, spacings[Math.floor(spacings.length / 2)] ?? bucket);
  const ts = [];
  for (let i = 0; i < present.length; i++) {
    if (i > 0 && present[i] - present[i - 1] > typical * 3) ts.push(present[i - 1] + typical);
    ts.push(present[i]);
  }

  let list = [...groups.values()];
  if (groupBy === 'dimension') list.sort((a, b) => dimOrder.indexOf(a.id) - dimOrder.indexOf(b.id));
  else list.sort(natural);

  const series = list.map((g) => ({
    id: g.id,
    label: g.label,
    values: ts.map((t) => {
      const xs = g.points.get(t);
      return xs?.length ? round(combine(xs)) : null;
    }),
  }));

  return {
    bucket,
    ts,
    series,
    nodes: nodeSet.size,
    instances: instanceSet.size,
    dimensions: dimOrder,
  };
}
