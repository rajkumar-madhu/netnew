import { useEffect, useMemo, useState } from 'react';
import { qs, usePolling } from '../../lib/api.js';
import { useTime } from '../../state/time.jsx';
import { Dropdown, Empty, Loading, SearchInput, StatusDot } from '../ui/Bits.jsx';
import Icon from '../ui/Icon.jsx';
import MetricChart from './MetricChart.jsx';

function NodeFilter({ nodes, selected, setSelected }) {
  const [query, setQuery] = useState('');
  const toggle = (id) => setSelected((cur) => {
    const next = new Set(cur ?? nodes.map((n) => n.id));
    if (next.has(id)) next.delete(id); else next.add(id);
    return next.size === nodes.length || next.size === 0 ? null : next;
  });
  return (
    <Dropdown className="node-filter" keepOpen align="right" label={(
      <><Icon name="nodes" size={14} /> {selected ? `${selected.size} of ${nodes.length} nodes` : `All ${nodes.length} nodes`}</>
    )}>
      <div className="node-filter-body">
        <SearchInput value={query} onChange={setQuery} placeholder="Filter nodes" />
        <div className="check-list compact">
          {nodes.filter((n) => n.hostname.toLowerCase().includes(query.toLowerCase())).map((n) => (
            <label key={n.id} className="check-row">
              <input type="checkbox" checked={!selected || selected.has(n.id)} onChange={() => toggle(n.id)} />
              <StatusDot online={n.online} />
              <span className="truncate">{n.hostname}</span>
            </label>
          ))}
        </div>
        {selected && <button type="button" className="ghost small" onClick={() => setSelected(null)}>Show all nodes</button>}
      </div>
    </Dropdown>
  );
}

/**
 * The metrics explorer: every chart in a scope, filterable by category, by
 * a text search and (with `filterNodes`) by node. `sections` limits it to
 * some categories.
 */
export default function MetricsBoard({ group, nodes, filterNodes = true, sections: only }) {
  const time = useTime();
  const [selected, setSelected] = useState(null); // null = all nodes in scope
  const [category, setCategory] = useState(null); // null = all
  const [query, setQuery] = useState('');
  const [columns, setColumns] = useState(2);
  const nodeIds = selected ? [...selected] : null;
  const scope = useMemo(() => ({ group, nodes: nodeIds ?? (filterNodes ? null : nodes.map((n) => n.id)) }),
    [group, nodeIds?.join(','), filterNodes, nodes.map((n) => n.id).join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  // The chart list only changes when nodes/instances come and go: refresh it
  // when the window changes and once a minute while live (every few seconds
  // while it is still empty, e.g. right after a node connects).
  const [empty, setEmpty] = useState(false);
  const { data, error } = usePolling(`/charts${qs({ group: scope.group, nodes: scope.nodes, after: time.query.after, before: time.query.before })}`, time.live ? (empty ? 3000 : 60_000) : 0);
  useEffect(() => setEmpty(Boolean(data) && data.charts.length === 0), [data]);

  if (error && !data) return <p className="error">Could not load charts: {error.message}</p>;
  if (!data) return <Loading label="Loading charts…" />;

  const q = query.trim().toLowerCase();
  const matches = (c) => !q || `${c.title} ${c.chart} ${c.section}`.toLowerCase().includes(q);
  const available = data.sections.filter((s) => !only || only.includes(s));
  const counts = Object.fromEntries(available.map((s) => [s, data.charts.filter((c) => c.section === s && matches(c)).length]));
  const sections = available.filter((s) => (!category || s === category) && counts[s] > 0);
  const total = available.reduce((a, s) => a + counts[s], 0);

  return (
    <div className="explorer">
      <div className="explorer-bar">
        <SearchInput value={query} onChange={setQuery} placeholder="Find a chart, e.g. disk or network" />
        <div className="push toolbar-actions">
          {filterNodes && nodes.length > 1 && <NodeFilter nodes={nodes} selected={selected} setSelected={setSelected} />}
          <div className="seg" role="group" aria-label="Columns">
            <button type="button" className={columns === 1 ? 'active' : ''} aria-label="One column" title="One column" onClick={() => setColumns(1)}>
              <Icon name="menu" size={14} />
            </button>
            <button type="button" className={columns === 2 ? 'active' : ''} aria-label="Two columns" title="Two columns" onClick={() => setColumns(2)}>
              <Icon name="dashboard" size={14} />
            </button>
          </div>
        </div>
      </div>

      <div className="category-chips" role="tablist" aria-label="Chart categories">
        <button type="button" role="tab" aria-selected={!category} className={`cat-chip ${!category ? 'active' : ''}`} onClick={() => setCategory(null)}>
          All <span className="count">{total}</span>
        </button>
        {available.map((s) => (
          <button key={s} type="button" role="tab" aria-selected={category === s} disabled={!counts[s]}
            className={`cat-chip ${category === s ? 'active' : ''}`} onClick={() => setCategory(category === s ? null : s)}>
            {s} <span className="count">{counts[s]}</span>
          </button>
        ))}
      </div>

      {!sections.length && (
        <Empty icon="metrics" title={q ? `No charts match “${query}”` : 'No metrics in this time range'}>
          {q ? 'Try another word, or clear the search.' : 'Charts appear as soon as a node in this scope sends data.'}
        </Empty>
      )}
      {sections.map((section) => (
        <section key={section} className="metrics-section">
          {!category && <h2 className="section-title">{section}</h2>}
          <div className={`charts ${columns === 2 ? 'two' : ''}`}>
            {data.charts.filter((c) => c.section === section && matches(c)).map((meta) => (
              <MetricChart key={`${meta.chart}-${scope.nodes?.join(',') ?? ''}`} meta={meta} scope={scope} height={columns === 2 ? 190 : 230} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
