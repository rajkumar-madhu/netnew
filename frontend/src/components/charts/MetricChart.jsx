import { useEffect, useMemo, useRef, useState } from 'react';
import { api, qs } from '../../lib/api.js';
import { formatterFor, plural } from '../../lib/format.js';
import { shouldRefresh, useTime } from '../../state/time.jsx';
import AddToDashboard from '../AddToDashboard.jsx';
import { Dropdown, MenuAction, MenuDivider, MenuHeading, MenuItem, Modal } from '../ui/Bits.jsx';
import Chart from './Chart.jsx';
import Icon from '../ui/Icon.jsx';
import { useAuth } from '../../state/auth.jsx';

const GROUP_LABELS = { dimension: 'dimension', node: 'node', instance: 'instance' };
const AGG_LABELS = { avg: 'Average', sum: 'Sum', min: 'Min', max: 'Max' };
const TYPES = ['line', 'area', 'stacked'];

// Starts fetching only once the chart is near the viewport, and stops live
// refreshes while it's scrolled away, so long pages stay cheap.
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
 * A chart card for one chart: fetches /api/charts/data for the given
 * scope (group and/or node IDs) and the global time window. Group-by,
 * aggregation and chart type are in the card's options menu.
 *
 * `settings` overrides the chart's defaults (title, groupBy, agg, type) and
 * `onSettingsChange` reports changes, which is how dashboards persist them.
 * `actions` adds buttons to the header; `canAddToDashboard` shows the
 * "Add to dashboard" button.
 */
export default function MetricChart({
  meta, scope, height = 200, settings = {}, onSettingsChange, actions, canAddToDashboard = true, className = '',
}) {
  const time = useTime();
  const { isAdmin } = useAuth();
  const ref = useRef(null);
  const visible = useVisible(ref);
  const [groupBy, setGroupByState] = useState(settings.groupBy ?? meta.groupBy);
  const [agg, setAggState] = useState(settings.agg ?? meta.agg);
  const [type, setTypeState] = useState(settings.type ?? meta.type);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const [adding, setAdding] = useState(false);
  const inflight = useRef(false);

  const change = (key, setter) => (value) => {
    setter(value);
    onSettingsChange?.({ [key]: value });
  };
  const setGroupBy = change('groupBy', setGroupByState);
  const setAgg = change('agg', setAggState);
  const setType = change('type', setTypeState);
  const title = settings.title || meta.title;

  const points = expanded ? 900 : 600;
  const path = `/charts/data${qs({
    chart: meta.chart, group: scope.group, nodes: scope.nodes, dims: meta.dims, group_by: groupBy, agg, points, ...time.query,
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

  // All of a chart's settings live in one menu, so cards stay compact.
  const options = (
    <Dropdown className="chart-options" align="right" chevron={false} ariaLabel="Chart options" label={<Icon name="more" size={16} />}>
      <MenuHeading>Group by</MenuHeading>
      {Object.entries(GROUP_LABELS).map(([id, label]) => (
        <MenuItem key={id} active={groupBy === id} onClick={() => setGroupBy(id)}>{label}</MenuItem>
      ))}
      <MenuHeading>Combine with</MenuHeading>
      {Object.entries(AGG_LABELS).map(([id, label]) => (
        <MenuItem key={id} active={agg === id} onClick={() => setAgg(id)}>{label}</MenuItem>
      ))}
      <MenuHeading>Draw as</MenuHeading>
      {TYPES.map((t) => <MenuItem key={t} active={type === t} onClick={() => setType(t)}>{t}</MenuItem>)}
      {canAddToDashboard && isAdmin && (
        <>
          <MenuDivider />
          <MenuAction icon="dashboard" onClick={() => setAdding(true)}>Add to dashboard</MenuAction>
        </>
      )}
    </Dropdown>
  );

  const summary = result && (
    <span className="chart-summary muted small">
      {plural(result.nodes, 'node')}
      {result.instances > result.nodes && ` · ${plural(result.instances, 'instance')}`}
      {` · by ${GROUP_LABELS[groupBy]} · ${AGG_LABELS[agg].toLowerCase()}`}
    </span>
  );

  const chart = (h) => (
    <Chart data={data} series={series} format={format} type={type} percent={percent} height={h} minSpan={time.live ? 60 : 0}
      onZoom={(after, before) => time.setFixed(after, before)} />
  );

  return (
    <section className={`panel net-chart ${className}`} ref={ref} id={`chart-${meta.chart}`}>
      <header className="chart-head">
        <div className="chart-title">
          <h3 title={meta.help || undefined}>{title}</h3>
          <span className="chart-unit">{meta.units}</span>
        </div>
        <div className="chart-actions">
          {actions}
          <button type="button" className="icon-button" aria-label="Expand chart" title="Expand" onClick={() => setExpanded(true)}>
            <Icon name="expand" size={14} />
          </button>
          {options}
        </div>
      </header>
      {summary}
      {error && <p className="error small">{error.message}</p>}
      {result && result.ts.length === 0 && <div className="chart-empty muted" style={{ height }}>No data in this time range</div>}
      {result && result.ts.length > 0 && !expanded && chart(height)}
      {!result && !error && <div className="chart-empty" style={{ height }}><span className="spinner" /></div>}
      {adding && (
        <AddToDashboard groupId={scope.group} onClose={() => setAdding(false)}
          item={{ kind: 'chart', chart: meta.chart, title: settings.title, groupBy, agg, type, nodes: scope.nodes ?? undefined, dims: meta.dims }} />
      )}
      {expanded && (
        <Modal title={title} wide onClose={() => setExpanded(false)}>
          <div className="expanded-bar">{summary}{options}</div>
          {result && chart(Math.round(window.innerHeight * 0.55))}
          {meta.help && <p className="muted small">{meta.help}</p>}
          <p className="muted small"><code>{meta.chart}</code></p>
        </Modal>
      )}
    </section>
  );
}
