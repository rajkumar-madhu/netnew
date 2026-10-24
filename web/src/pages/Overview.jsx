import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, useLive, usePolling } from '../api.js';
import { useRange } from '../App.jsx';
import { Meter, Stat, StatusDot } from '../components/Bits.jsx';
import Chart from '../components/Chart.jsx';
import { duration, memPct, nowSec, pct, rate } from '../format.js';

function OverviewChart({ title, metric, format, percent, names }) {
  const { range } = useRange();
  const { data } = usePolling(`/overview?metric=${metric}&after=-${range}&points=300`, range <= 3600 ? 5000 : 30000);

  const nodes = useMemo(
    () => (data?.nodes ?? []).filter((n) => names[n.id]).sort((a, b) => names[a.id].localeCompare(names[b.id])),
    [data, names],
  );
  const series = useMemo(() => nodes.map((n) => ({ label: names[n.id] })), [nodes, names]);
  const plotData = useMemo(() => [data?.ts ?? [], ...nodes.map((n) => n.values)], [data, nodes]);

  return (
    <Chart title={title} subtitle="per node" data={plotData} series={series} format={format}
      percent={percent} fill={false} syncKey="overview" />
  );
}

function NodeCard({ node }) {
  const m = node.latest;
  const hasAlerts = node.alerts.critical + node.alerts.warning > 0;
  return (
    <Link to={`/nodes/${node.id}`} className={`panel node-card ${node.online ? '' : 'is-offline'}`}>
      <div className="node-card-head">
        <StatusDot online={node.online} />
        <strong className="truncate">{node.hostname}</strong>
        {hasAlerts && (
          <span className={`badge ${node.alerts.critical ? 'critical' : 'warning'}`}>
            {node.alerts.critical + node.alerts.warning} alert{node.alerts.critical + node.alerts.warning > 1 ? 's' : ''}
          </span>
        )}
      </div>
      <div className="muted small truncate">{node.os || node.platform} · {node.cores} cores · {node.ip ?? 'no ip'}</div>
      <Meter label="CPU" value={m?.cpu} />
      <Meter label="RAM" value={memPct(m)} />
      <Meter label="Disk" value={m?.disk_pct} />
      <div className="node-card-foot small muted">
        <span>↓ {rate(m?.net_rx)}</span>
        <span>↑ {rate(m?.net_tx)}</span>
        <span>{node.online ? `up ${duration(nowSec() - node.bootTime)}` : 'offline'}</span>
      </div>
    </Link>
  );
}

export default function Overview() {
  const [nodes, setNodes] = useState(null);
  const [error, setError] = useState(null);
  const alerts = usePolling('/alerts?state=active');

  useEffect(() => {
    api('/nodes').then(setNodes).catch(setError);
  }, []);

  useLive((msg) => {
    if (msg.type === 'sample') {
      setNodes((list) => list?.map((n) => (n.id === msg.nodeId ? { ...n, latest: { ts: msg.ts, ...msg.m } } : n)));
    } else if (msg.type === 'node') {
      setNodes((list) => {
        if (!list) return list;
        const exists = list.some((n) => n.id === msg.node.id);
        return exists ? list.map((n) => (n.id === msg.node.id ? msg.node : n)) : [...list, msg.node];
      });
    } else if (msg.type === 'node_removed') {
      setNodes((list) => list?.filter((n) => n.id !== msg.id));
    } else if (msg.type === 'alert') {
      alerts.reload();
    } else if (msg.type === '_status' && msg.connected) {
      api('/nodes').then(setNodes).catch(() => {});
    }
  });

  const names = useMemo(() => Object.fromEntries((nodes ?? []).map((n) => [n.id, n.hostname])), [nodes]);

  if (error) return <p className="error">Could not load nodes: {error.message}</p>;
  if (!nodes) return <p className="muted">Loading…</p>;

  const online = nodes.filter((n) => n.online);
  const active = alerts.data ?? [];
  const critical = active.filter((a) => a.severity === 'critical').length;
  const avg = (fn) => {
    const values = online.map((n) => fn(n.latest)).filter((v) => v != null && Number.isFinite(v));
    return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  };
  const totalNet = online.reduce((sum, n) => sum + (n.latest?.net_rx ?? 0) + (n.latest?.net_tx ?? 0), 0);

  if (!nodes.length) {
    return (
      <div className="empty panel">
        <h2>No nodes yet</h2>
        <p className="muted">Install the agent on a server to start streaming its metrics here.</p>
        <Link to="/add-nodes" className="button">Add your first node</Link>
      </div>
    );
  }

  return (
    <>
      <h1>Overview</h1>
      <div className="stats">
        <Stat label="Nodes online" value={`${online.length} / ${nodes.length}`}
          tone={online.length < nodes.length ? 'warn' : 'ok'} />
        <Stat label="Active alerts" value={active.length}
          sub={active.length ? `${critical} critical · ${active.length - critical} warning` : 'all clear'}
          tone={critical ? 'crit' : active.length ? 'warn' : 'ok'} />
        <Stat label="Avg CPU" value={pct(avg((m) => m?.cpu))} />
        <Stat label="Avg RAM" value={pct(avg(memPct))} />
        <Stat label="Total network" value={rate(totalNet)} />
      </div>

      <div className="charts two">
        <OverviewChart title="CPU utilization" metric="cpu" format={(v) => pct(v, 0)} percent names={names} />
        <OverviewChart title="RAM usage" metric="ram" format={(v) => pct(v, 0)} percent names={names} />
        <OverviewChart title="Network traffic (in + out)" metric="net" format={rate} names={names} />
        <OverviewChart title="Load average (1m)" metric="load" format={(v) => v.toFixed(2)} names={names} />
      </div>

      <h2>Nodes</h2>
      <div className="node-grid">
        {nodes.map((n) => <NodeCard key={n.id} node={n} />)}
      </div>
    </>
  );
}
