import { Link, useOutletContext } from 'react-router-dom';
import { qs, usePolling } from '../../lib/api.js';
import { Empty, Meter, Stat, StatusDot } from '../../components/ui/Bits.jsx';
import Icon from '../../components/ui/Icon.jsx';
import { useIntegrations } from '../../components/IntegrationsModal.jsx';
import MetricChart from '../../components/charts/MetricChart.jsx';
import { ago, bytes, memPct, pct, plural } from '../../lib/format.js';
import { useTime } from '../../state/time.jsx';

const HOME_CHARTS = [
  { chart: 'system.cpu', title: 'CPU utilization per node', units: '%', type: 'line', agg: 'sum', groupBy: 'node' },
  { chart: 'mem.usage', title: 'RAM used per node', units: 'bytes', type: 'line', agg: 'sum', groupBy: 'node', dims: ['used'] },
  { chart: 'net.traffic', title: 'Network traffic per node', units: 'bytes/s', type: 'line', agg: 'sum', groupBy: 'node' },
  { chart: 'system.load', title: 'Load average (1m) per node', units: 'load', type: 'line', agg: 'max', groupBy: 'node', dims: ['load1'] },
];

function Distribution({ title, nodes, getter }) {
  const counts = {};
  for (const n of nodes) {
    const key = getter(n) || 'unknown';
    counts[key] = (counts[key] ?? 0) + 1;
  }
  const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 6);
  return (
    <section className="panel">
      <h3>{title}</h3>
      {rows.map(([label, n]) => (
        <Meter key={label} neutral label={<span className="truncate">{label}</span>} value={(n / nodes.length) * 100} detail={n} />
      ))}
    </section>
  );
}

function TopNodes({ title, nodes, value, format }) {
  const rows = nodes.filter((n) => n.online && value(n) != null).sort((a, b) => value(b) - value(a)).slice(0, 5);
  return (
    <section className="panel">
      <h3>{title}</h3>
      {!rows.length && <p className="muted small">No live nodes.</p>}
      {rows.map((n) => (
        <Meter key={n.id} label={<Link to={`/app/nodes/${n.id}`}>{n.hostname}</Link>} value={value(n)} detail={format(value(n))} />
      ))}
    </section>
  );
}

export default function Home() {
  const { group, nodes, alerts } = useOutletContext();
  const time = useTime();
  const integrations = useIntegrations();
  const events = usePolling(`/events${qs({ group: group.id, after: -86400, limit: 8 })}`, 15_000);

  if (!nodes.length) {
    return (
      <Empty icon="nodes" title={group.builtin ? 'No nodes yet' : 'This group has no nodes'}
        action={group.builtin
          ? <button type="button" className="primary" onClick={() => integrations.show('deploy.servers')}><Icon name="plug" size={16} /> Connect your first node</button>
          : <Link className="button primary" to={`/app/groups/${group.id}/nodes`}>Add nodes to this group</Link>}>
        {group.builtin
          ? 'Install the agent on a server and it will show up here within seconds.'
          : 'Groups group nodes so you can see their metrics, alerts and events together.'}
      </Empty>
    );
  }

  const live = nodes.filter((n) => n.online);
  const offline = nodes.length - live.length;
  const critical = alerts.filter((a) => a.severity === 'critical').length;
  const cores = nodes.reduce((a, n) => a + (n.cores ?? 0), 0);
  const ram = nodes.reduce((a, n) => a + (n.memTotal ?? 0), 0);
  const disk = nodes.reduce((a, n) => a + n.fs.reduce((s, f) => s + (f.size ?? 0), 0), 0);
  const needsAttention = nodes.filter((n) => !n.online || n.alerts.critical + n.alerts.warning > 0);
  const scope = { group: group.id };

  return (
    <div className="home">
      <div className="stats">
        <Stat label="Nodes" value={`${live.length} / ${nodes.length}`} sub={offline ? `${offline} offline` : 'all live'} tone={offline ? 'warn' : 'ok'} />
        <Stat label="Active alerts" value={alerts.length} sub={alerts.length ? `${critical} critical · ${alerts.length - critical} warning` : 'all clear'}
          tone={critical ? 'crit' : alerts.length ? 'warn' : 'ok'} />
        <Stat label="CPU cores" value={cores} sub={plural(nodes.length, 'node')} />
        <Stat label="Memory" value={bytes(ram)} sub="total RAM" />
        <Stat label="Storage" value={bytes(disk)} sub="total disk space" />
      </div>

      <div className="grid-3">
        <section className="panel">
          <h3>Needs attention</h3>
          {!needsAttention.length && <p className="ok-text"><Icon name="check" size={16} /> Every node is live with no active alerts.</p>}
          {needsAttention.slice(0, 6).map((n) => (
            <div key={n.id} className="list-row">
              <StatusDot online={n.online} />
              <Link to={`/app/nodes/${n.id}`} className="truncate">{n.hostname}</Link>
              <span className="muted small push">
                {!n.online ? `offline ${ago(n.lastSeen)}` : plural(n.alerts.critical + n.alerts.warning, 'alert')}
              </span>
            </div>
          ))}
          {alerts.length > 0 && <Link className="small" to={`/app/groups/${group.id}/alerts`}>View all alerts →</Link>}
        </section>
        <TopNodes title="Highest CPU" nodes={nodes} value={(n) => n.latest?.cpu} format={(v) => pct(v)} />
        <TopNodes title="Highest RAM" nodes={nodes} value={(n) => memPct(n.latest)} format={(v) => pct(v)} />
      </div>

      <div className="charts two">
        {HOME_CHARTS.map((meta) => <MetricChart key={meta.chart} meta={meta} scope={scope} height={180} />)}
      </div>

      <div className="grid-3">
        <Distribution title="Operating systems" nodes={nodes} getter={(n) => n.os} />
        <Distribution title="Agent versions" nodes={nodes} getter={(n) => n.agentVersion && `v${n.agentVersion}`} />
        <section className="panel">
          <h3>Recent events</h3>
          {(events.data ?? []).map((e) => (
            <div key={e.id} className="list-row">
              <span className={`sev-dot ${e.severity}`} />
              <span className="truncate">{e.hostname ? <strong>{e.hostname}</strong> : null} {e.message}</span>
              <span className="muted small push">{ago(e.ts)}</span>
            </div>
          ))}
          {events.data?.length === 0 && <p className="muted small">No events in the last 24 hours.</p>}
          <Link className="small" to={`/app/groups/${group.id}/events`}>View all events →</Link>
        </section>
      </div>
      {!time.live && <p className="muted small">Charts show the paused time window. Press play in the header to follow live data.</p>}
    </div>
  );
}
