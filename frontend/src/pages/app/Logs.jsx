import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { api, qs, useLive } from '../../lib/api.js';
import { Empty, Loading, SearchInput } from '../../components/ui/Bits.jsx';
import Chart from '../../components/charts/Chart.jsx';
import Icon from '../../components/ui/Icon.jsx';
import { useIntegrations } from '../../components/IntegrationsModal.jsx';
import { compact } from '../../lib/format.js';
import { useTime } from '../../state/time.jsx';

const LEVELS = [
  { id: 'error', label: 'Error', color: '#ff4d4f' },
  { id: 'warning', label: 'Warning', color: '#f5a623' },
  { id: 'info', label: 'Info', color: '#3f8fe0' },
  { id: 'debug', label: 'Debug', color: '#8d949e' },
];
const PRIORITY = ['emerg', 'alert', 'crit', 'error', 'warning', 'notice', 'info', 'debug'];
const levelOf = (p) => (p <= 3 ? 'error' : p === 4 ? 'warning' : p <= 6 ? 'info' : 'debug');
const MAX_ROWS = 2000;

function fmtTime(ms) {
  const d = new Date(ms);
  return `${d.toLocaleTimeString(undefined, { hour12: false })}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

function useDebounced(value, ms) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function Facet({ title, items, selected, onToggle, colors, searchable }) {
  const [q, setQ] = useState('');
  const shown = items.filter((i) => !q || (i.label ?? i.id).toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="facet">
      <h4>{title}</h4>
      {searchable && items.length > 8 && <SearchInput value={q} onChange={setQ} placeholder={`Filter ${title.toLowerCase()}`} />}
      {shown.map((i) => (
        <label key={i.id} className="check-row facet-row">
          <input type="checkbox" checked={selected.includes(i.id)} onChange={() => onToggle(i.id)} />
          {colors && <span className="facet-swatch" style={{ background: colors[i.id] }} />}
          <span className="truncate">{i.label ?? i.id}</span>
          <span className="muted small push">{compact(i.count)}</span>
        </label>
      ))}
      {!shown.length && <p className="muted small">None in range.</p>}
    </div>
  );
}

/** Log explorer for a group, or for one node when `single` is set. */
export function LogExplorer({ groupId, nodes, single = false }) {
  const time = useTime();
  const integrations = useIntegrations();
  const [query, setQuery] = useState('');
  const q = useDebounced(query, 300);
  const [levels, setLevels] = useState([]);
  const [services, setServices] = useState([]);
  const [nodeFilter, setNodeFilter] = useState([]);
  const [follow, setFollow] = useState(true);
  const [rows, setRows] = useState(null);
  const [facets, setFacets] = useState(null);
  const [histogram, setHistogram] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [error, setError] = useState(null);
  const [more, setMore] = useState(true);
  const pending = useRef(null);
  const nodeIds = useMemo(() => new Set(nodes.map((n) => n.id)), [nodes]);

  const params = {
    group: groupId, nodes: single ? [nodes[0].id] : undefined,
    q, level: levels, service: services, node: nodeFilter,
  };
  const key = JSON.stringify({ ...params, ...time.query });

  // Full reload when filters or the time window change.
  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setExpanded(null);
    Promise.all([
      api(`/logs${qs({ ...params, ...time.query, limit: 200 })}`),
      api(`/logs/facets${qs({ ...params, ...time.query })}`),
      api(`/logs/histogram${qs({ ...params, ...time.query, points: 90 })}`),
    ]).then(([r, f, h]) => {
      if (cancelled) return;
      setRows(r);
      setFacets(f);
      setHistogram(h);
      setMore(r.length === 200);
      setError(null);
    }).catch((err) => !cancelled && setError(err));
    return () => { cancelled = true; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  // Follow mode: new lines are announced over the WebSocket; fetch what is
  // newer than the newest row we have (at most once a second).
  const latest = useRef({});
  latest.current = { rows, params, follow, live: time.live };
  useLive((msg) => {
    if (msg.type !== 'logs' || !nodeIds.has(msg.nodeId) || pending.current) return;
    const { follow: on, live } = latest.current;
    if (!on || !live) return;
    pending.current = setTimeout(async () => {
      pending.current = null;
      const { rows: current, params: p } = latest.current;
      if (!current) return;
      const afterId = current.reduce((m, r) => Math.max(m, r.id), 0);
      try {
        const fresh = await api(`/logs${qs({ ...p, after: -300, after_id: afterId, limit: 500 })}`);
        if (fresh.length) {
          setRows((cur) => [...fresh.reverse(), ...(cur ?? [])].slice(0, MAX_ROWS));
          setFacets((f) => f && { ...f, total: f.total + fresh.length });
        }
      } catch {}
    }, 1000);
  });
  useEffect(() => () => clearTimeout(pending.current), []);

  async function loadOlder() {
    const oldest = rows.at(-1);
    const older = await api(`/logs${qs({ ...params, ...time.query, before_id: oldest.id, limit: 200 })}`);
    setRows((cur) => [...cur, ...older].slice(0, MAX_ROWS * 2));
    setMore(older.length === 200);
  }

  const toggle = (setter) => (id) => setter((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  const histData = useMemo(() => (histogram
    ? [histogram.ts, histogram.error, histogram.warning, histogram.info, histogram.debug] : [[]]), [histogram]);
  const levelColors = Object.fromEntries(LEVELS.map((l) => [l.id, l.color]));
  const filtersOn = levels.length + services.length + nodeFilter.length > 0 || q;

  return (
    <div className="logs-layout">
      <aside className="panel logs-facets">
        <Facet title="Level" items={(facets?.level ?? LEVELS.map((l) => ({ ...l, count: 0 })))} selected={levels} onToggle={toggle(setLevels)} colors={levelColors} />
        <Facet title="Service" items={facets?.service ?? []} selected={services} onToggle={toggle(setServices)} searchable />
        {nodes.length > 1 && (
          <Facet title="Node" items={facets?.node ?? []} selected={nodeFilter} onToggle={toggle(setNodeFilter)} searchable />
        )}
        {filtersOn && (
          <button type="button" className="ghost small" onClick={() => { setLevels([]); setServices([]); setNodeFilter([]); setQuery(''); }}>Clear filters</button>
        )}
      </aside>

      <div className="logs-main">
        <div className="toolbar">
          <SearchInput value={query} onChange={setQuery} placeholder="Search log messages (all words, prefix match)" />
          <button type="button" className={`ghost follow ${follow && time.live ? 'on' : ''}`} disabled={!time.live}
            title={time.live ? 'Show new lines as they arrive' : 'Follow is available in live mode'}
            onClick={() => setFollow((f) => !f)}>
            <span className="live-dot on" /> {follow && time.live ? 'Following' : 'Follow'}
          </button>
          <span className="muted small push">{facets ? `${compact(facets.total)} lines in range` : ''}</span>
        </div>

        <section className="panel net-chart">
          {histogram && (
            <Chart data={histData} type="stacked" height={110} legend={false} syncKey="logs"
              series={LEVELS.map((l) => ({ label: l.label, color: l.color }))}
              format={(v) => compact(v)} onZoom={(a, b) => time.setFixed(a, b)} />
          )}
        </section>

        {error && <p className="error">{error.message}</p>}
        {!rows && !error && <Loading />}
        {rows?.length === 0 && (
          <Empty icon="logs" title={filtersOn ? 'No log lines match' : 'No logs in this time range'}
            action={!filtersOn && <button type="button" className="ghost" onClick={() => integrations.show('collect.logs')}>How to collect logs</button>}>
            {filtersOn ? 'Try fewer filters or a longer time range.' : 'Agents read the systemd journal automatically, and any files listed in NETNEW_LOG_FILES.'}
          </Empty>
        )}
        {rows?.length > 0 && (
          <div className="table-wrap log-table">
            {rows.map((r) => {
              const level = levelOf(r.priority);
              const open = expanded === r.id;
              return (
                <div key={r.id} className={`log-row lvl-${level} ${open ? 'open' : ''}`} onClick={() => setExpanded(open ? null : r.id)}>
                  <span className="mono muted log-time" title={new Date(r.ts).toLocaleString()}>{fmtTime(r.ts)}</span>
                  <span className={`log-level ${level}`}>{PRIORITY[r.priority]}</span>
                  {nodes.length > 1 && <span className="log-node truncate">{r.hostname}</span>}
                  <span className="log-service truncate" title={r.service}>{r.service}</span>
                  <span className="log-message mono">{r.message}</span>
                  {open && (
                    <div className="log-details" onClick={(e) => e.stopPropagation()}>
                      <div><span className="muted">Time</span> {new Date(r.ts).toISOString()}</div>
                      <div><span className="muted">Node</span> <Link to={`/app/nodes/${r.node_id}/logs`}>{r.hostname}</Link></div>
                      <div><span className="muted">Source</span> {r.source}</div>
                      <div><span className="muted">Service</span> {r.service}</div>
                      <div><span className="muted">Priority</span> {r.priority} ({PRIORITY[r.priority]})</div>
                      <div className="actions-row">
                        <button type="button" className="ghost small" onClick={() => setServices([r.service])}>Only this service</button>
                        <button type="button" className="ghost small" onClick={() => navigator.clipboard?.writeText(r.message)}><Icon name="copy" size={13} /> Copy message</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            {more && <button type="button" className="ghost block load-more" onClick={loadOlder}>Load older lines</button>}
          </div>
        )}
      </div>
    </div>
  );
}

export default function Logs() {
  const { group, nodes } = useOutletContext();
  if (!nodes.length) return <Empty icon="logs" title="No nodes in this group" />;
  return <LogExplorer groupId={group.id} nodes={nodes} />;
}
