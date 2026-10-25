import { useEffect, useMemo, useState } from 'react';
import { qs, usePolling } from '../api.js';
import { bytes, memPct, pct, rate } from '../format.js';
import { useTime } from '../state/time.jsx';
import { Empty, Loading, SearchInput, Stat, StatusDot } from './Bits.jsx';
import NetChart from './NetChart.jsx';

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');

// Live summary strip above the charts, from each node's latest sample.
function SummaryStrip({ nodes }) {
  const live = nodes.filter((n) => n.online && n.latest);
  const sum = (fn) => live.reduce((a, n) => a + (fn(n.latest) ?? 0), 0);
  const avg = (fn) => (live.length ? sum(fn) / live.length : null);
  return (
    <div className="stats">
      <Stat label="CPU" value={pct(avg((m) => m.cpu))} sub={`avg of ${live.length} live nodes`} />
      <Stat label="RAM used" value={pct(avg(memPct))} sub={`${bytes(sum((m) => m.mem_used))} of ${bytes(sum((m) => m.mem_total))}`} />
      <Stat label="Load (1m)" value={avg((m) => m.load1)?.toFixed(2) ?? '–'} sub="average" />
      <Stat label="Network" value={`↓ ${rate(sum((m) => m.net_rx))}`} sub={`↑ ${rate(sum((m) => m.net_tx))}`} />
      <Stat label="Disk I/O" value={`R ${rate(sum((m) => m.disk_read))}`} sub={`W ${rate(sum((m) => m.disk_write))}`} />
    </div>
  );
}

function useActiveSection(sections) {
  const [active, setActive] = useState(null);
  useEffect(() => {
    const io = new IntersectionObserver((entries) => {
      const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible[0]) setActive(visible[0].target.dataset.section);
    }, { rootMargin: '-80px 0px -60% 0px' });
    for (const s of sections) {
      const el = document.getElementById(`section-${slug(s)}`);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, [sections]);
  return active;
}

/**
 * All charts for a scope, grouped into sections with a table of contents on
 * the right. With `filterNodes`, the right panel also lets you narrow the
 * charts to some of the scope's nodes.
 */
export default function MetricsBoard({ room, nodes, filterNodes = true, summary = true, sections: only }) {
  const time = useTime();
  const [selected, setSelected] = useState(null); // null = all nodes in scope
  const [nodeQuery, setNodeQuery] = useState('');
  const nodeIds = selected ? [...selected] : null;
  const scope = useMemo(() => ({ room, nodes: nodeIds ?? (filterNodes ? null : nodes.map((n) => n.id)) }),
    [room, nodeIds?.join(','), filterNodes, nodes.map((n) => n.id).join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  // The chart list only changes when nodes/instances come and go: refresh it
  // when the window changes and once a minute while live.
  const { data, error } = usePolling(`/contexts${qs({ room: scope.room, nodes: scope.nodes, after: time.query.after, before: time.query.before })}`, time.live ? 60_000 : 0);
  const sections = (data?.sections ?? []).filter((s) => !only || only.includes(s));
  const active = useActiveSection(sections);

  const toggleNode = (id) => setSelected((cur) => {
    const next = new Set(cur ?? nodes.map((n) => n.id));
    if (next.has(id)) next.delete(id); else next.add(id);
    return next.size === nodes.length ? null : next;
  });

  if (error && !data) return <p className="error">Could not load charts: {error.message}</p>;
  if (!data) return <Loading label="Loading charts…" />;

  const summaryNodes = selected ? nodes.filter((n) => selected.has(n.id)) : nodes;

  return (
    <div className="metrics-layout">
      <div className="metrics-main">
        {summary && <SummaryStrip nodes={summaryNodes} />}
        {!data.contexts.some((c) => sections.includes(c.section)) && (
          <Empty icon="metrics" title="No metrics in this time range">
            Charts appear as soon as a node in this scope sends data.
          </Empty>
        )}
        {sections.map((section) => (
          <section key={section} className="metrics-section" id={`section-${slug(section)}`} data-section={section}>
            <h2>{section}</h2>
            <div className="charts two">
              {data.contexts.filter((c) => c.section === section).map((meta) => (
                <NetChart key={`${meta.context}-${scope.nodes?.join(',') ?? ''}`} meta={meta} scope={scope} />
              ))}
            </div>
          </section>
        ))}
      </div>

      <aside className="metrics-side">
        <div className="panel side-panel">
          <h3>Contents</h3>
          <nav className="toc">
            {sections.map((section) => (
              <div key={section}>
                <a href={`#section-${slug(section)}`} className={`toc-section ${active === section ? 'active' : ''}`}>{section}</a>
                {data.contexts.filter((c) => c.section === section).map((c) => (
                  <a key={c.context} href={`#chart-${c.context}`} className="toc-item">{c.title}</a>
                ))}
              </div>
            ))}
          </nav>
        </div>
        {filterNodes && nodes.length > 1 && (
          <div className="panel side-panel">
            <h3>
              Nodes <span className="muted small">{selected ? `${selected.size} of ${nodes.length}` : `all ${nodes.length}`}</span>
            </h3>
            <SearchInput value={nodeQuery} onChange={setNodeQuery} placeholder="Filter nodes" />
            <div className="check-list compact">
              {nodes.filter((n) => n.hostname.toLowerCase().includes(nodeQuery.toLowerCase())).map((n) => (
                <label key={n.id} className="check-row">
                  <input type="checkbox" checked={!selected || selected.has(n.id)} onChange={() => toggleNode(n.id)} />
                  <StatusDot online={n.online} />
                  <span className="truncate">{n.hostname}</span>
                </label>
              ))}
            </div>
            {selected && <button type="button" className="ghost small" onClick={() => setSelected(null)}>Select all</button>}
          </div>
        )}
      </aside>
    </div>
  );
}
