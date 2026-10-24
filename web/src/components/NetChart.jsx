import { useEffect, useMemo, useRef, useState } from 'react';
import { api, qs } from '../api.js';
import { formatterFor, plural } from '../format.js';
import { shouldRefresh, useTime } from '../state/time.jsx';
import { Dropdown, MenuItem, Modal } from './Bits.jsx';
import Chart from './Chart.jsx';
import Icon from './Icon.jsx';

const GROUP_LABELS = { dimension: 'dimension', node: 'node', instance: 'instance' };
const AGG_LABELS = { avg: 'Average', sum: 'Sum', min: 'Min', max: 'Max' };
const TYPES = ['line', 'area', 'stacked'];

// Starts fetching only once the chart is near the viewport, and stops live
// refreshes while it's scrolled away (Netdata does the same).
function useVisible(ref) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const io = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: '300px 0px' });
    if (ref.current) io.observe(ref.current);
    return () => io.disconnect();
  }, [ref]);
  return visible;
}

/**
 * A Netdata-style chart card for one context: fetches /api/data for the given
 * scope (room and/or node IDs) and the global time window, with group-by,
 * aggregation and chart-type controls in its header.
 */
export default function NetChart({ meta, scope, height = 200 }) {
  const time = useTime();
  const ref = useRef(null);
  const visible = useVisible(ref);
  const [groupBy, setGroupBy] = useState(meta.groupBy);
  const [agg, setAgg] = useState(meta.agg);
  const [type, setType] = useState(meta.type);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const inflight = useRef(false);

  const points = expanded ? 900 : 600;
  const path = `/data${qs({
    context: meta.context, room: scope.room, nodes: scope.nodes, dims: meta.dims, group_by: groupBy, agg, points, ...time.query,
  })}`;

  const load = useRef(null);
  load.current = () => {
    if (inflight.current) return;
    inflight.current = true;
    api(path)
      .then((d) => { setResult(d); setError(null); })
      .catch(setError)
      .finally(() => { inflight.current = false; });
  };

  // Fetch when anything about the query changes...
  useEffect(() => {
    if (visible) load.current();
  }, [path, visible]);

  // ...and on the live heartbeat, at the chart's own resolution.
  useEffect(() => {
    if (visible && time.tick && shouldRefresh(time, result?.bucket)) load.current();
  }, [time.tick]); // eslint-disable-line react-hooks/exhaustive-deps

  const format = useMemo(() => formatterFor(meta.units), [meta.units]);
  const series = useMemo(() => (result?.series ?? []).map((s) => ({ label: s.label })), [result]);
  const data = useMemo(() => [result?.ts ?? [], ...(result?.series ?? []).map((s) => s.values)], [result]);
  const percent = meta.units === '%';

  const toolbar = (
    <div className="chart-toolbar">
      <Dropdown label={<><span className="muted">Group by</span> {GROUP_LABELS[groupBy]}</>}>
        {Object.entries(GROUP_LABELS).map(([id, label]) => (
          <MenuItem key={id} active={groupBy === id} onClick={() => setGroupBy(id)}>{label}</MenuItem>
        ))}
      </Dropdown>
      <Dropdown label={<><span className="muted">Aggregate</span> {AGG_LABELS[agg]}</>}>
        {Object.entries(AGG_LABELS).map(([id, label]) => (
          <MenuItem key={id} active={agg === id} onClick={() => setAgg(id)}>{label}</MenuItem>
        ))}
      </Dropdown>
      <div className="seg" role="group" aria-label="Chart type">
        {TYPES.map((t) => (
          <button key={t} type="button" className={type === t ? 'active' : ''} onClick={() => setType(t)}>{t}</button>
        ))}
      </div>
      {result && (
        <span className="chart-chips muted small">
          {plural(result.nodes, 'node')}
          {result.instances > result.nodes && ` · ${plural(result.instances, 'instance')}`}
          {` · ${plural(result.dimensions.length, 'dimension')}`}
        </span>
      )}
    </div>
  );

  const chart = (h) => (
    <Chart data={data} series={series} format={format} type={type} percent={percent} height={h}
      onZoom={(after, before) => time.setFixed(after, before)} />
  );

  return (
    <section className="panel net-chart" ref={ref} id={`chart-${meta.context}`}>
      <header className="chart-head">
        <div className="chart-title">
          <h3>{meta.title}</h3>
          <span className="muted small">{meta.context} · {meta.units}</span>
          {meta.help && <span className="help" title={meta.help}><Icon name="info" size={14} /></span>}
        </div>
        <button type="button" className="icon-button" aria-label="Expand chart" onClick={() => setExpanded(true)}>
          <Icon name="expand" size={15} />
        </button>
      </header>
      {toolbar}
      {error && <p className="error small">{error.message}</p>}
      {result && result.ts.length === 0 && <div className="chart-empty muted" style={{ height }}>No data in this time range</div>}
      {result && result.ts.length > 0 && !expanded && chart(height)}
      {!result && !error && <div className="chart-empty" style={{ height }}><span className="spinner" /></div>}
      {expanded && (
        <Modal title={meta.title} wide onClose={() => setExpanded(false)}>
          {toolbar}
          {result && chart(Math.round(window.innerHeight * 0.55))}
          {meta.help && <p className="muted small">{meta.help}</p>}
        </Modal>
      )}
    </section>
  );
}
