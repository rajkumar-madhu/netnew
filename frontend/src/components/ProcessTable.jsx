import { useState } from 'react';
import { usePolling } from '../lib/api.js';
import { ago, bytes } from '../lib/format.js';
import { useTime } from '../state/time.jsx';
import { CellMeter, Empty, Loading, SearchInput, SortTh, sortBy } from './ui/Bits.jsx';

const GETTERS = {
  pid: (p) => p.pid,
  name: (p) => p.name,
  user: (p) => p.user,
  cpu: (p) => p.cpu,
  mem: (p) => p.mem,
  rss: (p) => p.rss,
  state: (p) => p.state,
};

/** Live `top`-style process list for one node, refreshed every 3 seconds. */
export default function ProcessTable({ nodeId }) {
  const time = useTime();
  const { data, error } = usePolling(nodeId ? `/nodes/${nodeId}/processes` : null, time.live ? 3000 : 0);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState({ key: 'cpu', dir: -1 });

  if (error && !data) return <Empty icon="top" title="No process data">{error.message}</Empty>;
  if (!data) return <Loading label="Loading processes…" />;

  const q = query.toLowerCase();
  const list = sortBy(
    data.list.filter((p) => !q || `${p.pid} ${p.name} ${p.user} ${p.command}`.toLowerCase().includes(q)),
    sort, GETTERS,
  );
  const maxCpu = Math.max(100, ...data.list.map((p) => p.cpu ?? 0));

  return (
    <div className="process-view">
      <div className="toolbar">
        <SearchInput value={query} onChange={setQuery} placeholder="Filter by name, user, PID or command" />
        <div className="chip-row">
          <span className="chip">{data.counts.all ?? '–'} processes</span>
          <span className="chip">{data.counts.running ?? '–'} running</span>
          <span className="chip">{data.counts.sleeping ?? '–'} sleeping</span>
          <span className="chip">{data.counts.blocked ?? '–'} blocked</span>
          <span className="muted small">top {data.list.length} by CPU · updated {ago(data.ts)}</span>
        </div>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <SortTh id="pid" sort={sort} setSort={setSort} className="num">PID</SortTh>
              <SortTh id="name" sort={sort} setSort={setSort}>Name</SortTh>
              <SortTh id="user" sort={sort} setSort={setSort}>User</SortTh>
              <SortTh id="cpu" sort={sort} setSort={setSort}>CPU</SortTh>
              <SortTh id="mem" sort={sort} setSort={setSort}>Memory</SortTh>
              <SortTh id="rss" sort={sort} setSort={setSort} className="num">RSS</SortTh>
              <SortTh id="state" sort={sort} setSort={setSort}>State</SortTh>
              <th>Command</th>
            </tr>
          </thead>
          <tbody>
            {list.map((p) => (
              <tr key={p.pid}>
                <td className="num mono">{p.pid}</td>
                <td><strong>{p.name}</strong></td>
                <td className="muted">{p.user}</td>
                <td className="meter-cell"><CellMeter value={((p.cpu ?? 0) / maxCpu) * 100} text={`${(p.cpu ?? 0).toFixed(1)}%`} /></td>
                <td className="meter-cell"><CellMeter value={p.mem} text={`${(p.mem ?? 0).toFixed(1)}%`} /></td>
                <td className="num">{bytes(p.rss)}</td>
                <td><span className={`state ${p.state}`}>{p.state}</span></td>
                <td className="command mono muted" title={p.command}>{p.command}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
