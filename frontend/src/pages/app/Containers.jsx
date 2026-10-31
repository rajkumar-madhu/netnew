import { useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { qs, usePolling } from '../../lib/api.js';
import { CellMeter, Empty, Loading, SearchInput, SortTh, sortBy, Stat } from '../../components/ui/Bits.jsx';
import Icon from '../../components/ui/Icon.jsx';
import { useIntegrations } from '../../components/IntegrationsModal.jsx';
import MetricsBoard from '../../components/charts/MetricsBoard.jsx';
import { ago, bytes, pct, rate } from '../../lib/format.js';

const CONTAINER_GETTERS = {
  name: (c) => c.name, node: (c) => c.hostname, image: (c) => c.image, state: (c) => c.state,
  cpu: (c) => c.cpu, mem: (c) => c.mem, net: (c) => (c.netRx ?? 0) + (c.netTx ?? 0), io: (c) => (c.ioRead ?? 0) + (c.ioWrite ?? 0),
};
const POD_GETTERS = {
  name: (p) => p.name, namespace: (p) => p.namespace, node: (p) => p.hostname, phase: (p) => p.phase,
  restarts: (p) => p.restarts, cpu: (p) => p.cpu, mem: (p) => p.mem,
};

function DockerTable({ containers, showNode }) {
  const [query, setQuery] = useState('');
  const [state, setState] = useState('running');
  const [sort, setSort] = useState({ key: 'cpu', dir: -1 });
  const q = query.toLowerCase();
  const list = sortBy(containers.filter((c) => (state === 'all' || (state === 'running' ? c.state === 'running' : c.state !== 'running'))
    && (!q || `${c.name} ${c.image} ${c.compose ?? ''} ${c.hostname}`.toLowerCase().includes(q))), sort, CONTAINER_GETTERS);
  const maxCpu = Math.max(100, ...containers.map((c) => c.cpu ?? 0));

  return (
    <>
      <div className="toolbar">
        <SearchInput value={query} onChange={setQuery} placeholder="Filter by name, image or compose project" />
        <div className="seg" role="group" aria-label="Container state">
          {['running', 'stopped', 'all'].map((s) => <button key={s} type="button" className={state === s ? 'active' : ''} onClick={() => setState(s)}>{s}</button>)}
        </div>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <SortTh id="name" sort={sort} setSort={setSort}>Container</SortTh>
              {showNode && <SortTh id="node" sort={sort} setSort={setSort}>Node</SortTh>}
              <SortTh id="image" sort={sort} setSort={setSort}>Image</SortTh>
              <SortTh id="state" sort={sort} setSort={setSort}>State</SortTh>
              <SortTh id="cpu" sort={sort} setSort={setSort}>CPU</SortTh>
              <SortTh id="mem" sort={sort} setSort={setSort}>Memory</SortTh>
              <SortTh id="net" sort={sort} setSort={setSort}>Network</SortTh>
              <SortTh id="io" sort={sort} setSort={setSort}>Disk I/O</SortTh>
            </tr>
          </thead>
          <tbody>
            {list.map((c) => (
              <tr key={`${c.nodeId}-${c.id}`} className={c.state === 'running' ? '' : 'is-offline'}>
                <td><strong>{c.name}</strong><div className="muted small mono">{c.id}{c.compose ? ` · ${c.compose}` : ''}</div></td>
                {showNode && <td><Link to={`/app/nodes/${c.nodeId}/containers`}>{c.hostname}</Link></td>}
                <td className="mono small">{c.image}</td>
                <td><span className={`unit-state ${c.state === 'running' ? 'active' : c.state === 'exited' ? 'inactive' : 'activating'}`}>{c.state}</span><div className="muted small">{c.status}</div></td>
                <td className="meter-cell">{c.cpu != null ? <CellMeter value={(c.cpu / maxCpu) * 100} text={pct(c.cpu)} /> : '—'}</td>
                <td className="meter-cell">{c.mem != null ? <CellMeter value={c.memLimit ? (c.mem / c.memLimit) * 100 : 0} text={bytes(c.mem)} /> : '—'}</td>
                <td className="small">{c.netRx != null ? <>↓ {rate(c.netRx)}<br />↑ {rate(c.netTx)}</> : '—'}</td>
                <td className="small">{c.ioRead != null ? <>R {rate(c.ioRead)}<br />W {rate(c.ioWrite)}</> : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!list.length && <p className="muted pad">No containers match.</p>}
      </div>
    </>
  );
}

function PodTable({ pods, showNode }) {
  const [query, setQuery] = useState('');
  const [namespace, setNamespace] = useState('');
  const [sort, setSort] = useState({ key: 'cpu', dir: -1 });
  const namespaces = [...new Set(pods.map((p) => p.namespace).filter(Boolean))].sort();
  const q = query.toLowerCase();
  const list = sortBy(pods.filter((p) => (!namespace || p.namespace === namespace) && (!q || `${p.name} ${p.namespace}`.toLowerCase().includes(q))), sort, POD_GETTERS);

  return (
    <>
      <div className="toolbar">
        <SearchInput value={query} onChange={setQuery} placeholder="Filter pods" />
        {namespaces.length > 0 && (
          <select value={namespace} onChange={(e) => setNamespace(e.target.value)} aria-label="Namespace">
            <option value="">All namespaces</option>
            {namespaces.map((n) => <option key={n}>{n}</option>)}
          </select>
        )}
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <SortTh id="name" sort={sort} setSort={setSort}>Pod</SortTh>
              <SortTh id="namespace" sort={sort} setSort={setSort}>Namespace</SortTh>
              {showNode && <SortTh id="node" sort={sort} setSort={setSort}>Node</SortTh>}
              <SortTh id="phase" sort={sort} setSort={setSort}>Phase</SortTh>
              <SortTh id="restarts" sort={sort} setSort={setSort} className="num">Restarts</SortTh>
              <SortTh id="cpu" sort={sort} setSort={setSort}>CPU</SortTh>
              <SortTh id="mem" sort={sort} setSort={setSort}>Memory</SortTh>
              <th>Disk I/O</th>
            </tr>
          </thead>
          <tbody>
            {list.map((p) => (
              <tr key={`${p.nodeId}-${p.uid}`}>
                <td><strong>{p.name}</strong><div className="muted small mono">{p.uid?.slice(0, 8)}{p.owner ? ` · ${p.owner}` : ''}</div></td>
                <td>{p.namespace ?? <span className="muted">—</span>}</td>
                {showNode && <td><Link to={`/app/nodes/${p.nodeId}/containers`}>{p.hostname}</Link></td>}
                <td><span className={`unit-state ${p.phase === 'Running' ? 'active' : p.phase === 'Failed' ? 'failed' : 'inactive'}`}>{p.phase}</span></td>
                <td className="num">{p.restarts ?? '—'}</td>
                <td className="small">{p.cpu != null ? pct(p.cpu) : '—'}</td>
                <td className="small">{p.mem != null ? bytes(p.mem) : '—'}</td>
                <td className="small">{p.ioRead != null ? <>R {rate(p.ioRead)}<br />W {rate(p.ioWrite)}</> : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!list.length && <p className="muted pad">No pods match.</p>}
      </div>
    </>
  );
}

/** Docker containers and Kubernetes pods for a set of nodes. */
export function ContainersView({ groupId, nodes, single = false }) {
  const integrations = useIntegrations();
  const { data, error } = usePolling(`/containers${qs({ group: groupId, nodes: single ? [nodes[0].id] : undefined })}`, 5000);

  if (error && !data) return <p className="error">{error.message}</p>;
  if (!data) return <Loading />;

  const withHost = (list, n) => list.map((x) => ({ ...x, nodeId: n.nodeId, hostname: n.hostname }));
  const containers = data.filter((n) => n.docker?.available).flatMap((n) => withHost(n.docker.list ?? [], n));
  const pods = data.filter((n) => n.k8s?.available).flatMap((n) => withHost(n.k8s.pods ?? [], n));
  const errors = data.flatMap((n) => [n.docker?.error, n.k8s?.error].filter(Boolean).map((e) => `${n.hostname}: ${e}`));

  if (!containers.length && !pods.length) {
    return (
      <Empty icon="container" title="No containers found"
        action={<button type="button" className="ghost" onClick={() => integrations.show('collect.containers')}>How container monitoring works</button>}>
        Agents read Docker through /var/run/docker.sock (the agent's user needs access to it), and Kubernetes pods when deployed as the DaemonSet.
        {errors.length > 0 && <><br />{errors.join(' · ')}</>}
      </Empty>
    );
  }

  const running = containers.filter((c) => c.state === 'running');
  const sum = (xs, k) => xs.reduce((a, x) => a + (x[k] ?? 0), 0);

  return (
    <div className="containers">
      <div className="stats">
        <Stat label="Containers" value={`${running.length} / ${containers.length}`} sub="running" />
        <Stat label="Container CPU" value={pct(sum(running, 'cpu'))} sub="% of one core, total" />
        <Stat label="Container memory" value={bytes(sum(running, 'mem'))} />
        {pods.length > 0 && <Stat label="Pods" value={`${pods.filter((p) => p.phase === 'Running').length} / ${pods.length}`} sub="running" />}
        <Stat label="Updated" value={ago(Math.max(...data.map((n) => n.ts)))} />
      </div>
      {errors.length > 0 && <p className="error small"><Icon name="info" size={14} /> {errors.join(' · ')}</p>}
      {containers.length > 0 && (
        <>
          <div className="section-head"><h2>Docker containers</h2></div>
          <DockerTable containers={containers} showNode={!single} />
        </>
      )}
      {pods.length > 0 && (
        <>
          <div className="section-head"><h2>Kubernetes pods</h2></div>
          <PodTable pods={pods} showNode={!single} />
        </>
      )}
      <div className="section-head"><h2>Charts</h2></div>
      <MetricsBoard group={groupId} nodes={nodes} filterNodes={!single} summary={false} sections={['Containers', 'Kubernetes']} />
    </div>
  );
}

export default function Containers() {
  const { group, nodes } = useOutletContext();
  if (!nodes.length) return <Empty icon="container" title="No nodes in this group" />;
  return <ContainersView groupId={group.id} nodes={nodes} />;
}
