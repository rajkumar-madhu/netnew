import { Link, useNavigate, useOutletContext } from 'react-router-dom';
import { qs, usePolling } from '../../lib/api.js';
import { useScopedPath } from '../../lib/scope.js';
import { CellMeter, Empty, Meter, Severity, StatusDot } from '../../components/ui/Bits.jsx';
import Icon from '../../components/ui/Icon.jsx';
import MetricChart from '../../components/charts/MetricChart.jsx';
import { ago, memPct, pct, plural, rate } from '../../lib/format.js';

const CHARTS = [
  { chart: 'system.cpu', title: 'CPU utilization by node', units: '%', type: 'line', agg: 'sum', groupBy: 'node' },
  { chart: 'mem.usage', title: 'RAM used by node', units: 'bytes', type: 'line', agg: 'sum', groupBy: 'node', dims: ['used'] },
];

const avg = (list) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : null);

function HealthBanner({ nodes, alerts }) {
  const offline = nodes.filter((n) => !n.online).length;
  const critical = alerts.filter((a) => a.severity === 'critical').length;
  const issues = offline + alerts.length;
  const tone = critical || offline ? 'crit' : alerts.length ? 'warn' : 'ok';
  const headline = issues === 0
    ? 'Everything looks healthy'
    : [offline && `${plural(offline, 'node')} offline`, alerts.length && plural(alerts.length, 'active alert')].filter(Boolean).join(' and ');
  return (
    <section className={`health-banner ${tone}`}>
      <span className="health-icon"><Icon name={issues ? 'alerts' : 'check'} size={22} /></span>
      <div>
        <h2>{headline}</h2>
        <p className="muted">
          {nodes.length - offline} of {plural(nodes.length, 'node')} reporting every second
          {critical > 0 && ` · ${critical} critical`}
        </p>
      </div>
    </section>
  );
}

function Kpi({ label, value, children, tone }) {
  return (
    <div className={`kpi ${tone ?? ''}`}>
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">{value}</span>
      {children}
    </div>
  );
}

function FleetTable({ nodes }) {
  const navigate = useNavigate();
  const scoped = useScopedPath();
  const rows = [...nodes].sort((a, b) => (b.alerts.critical * 100 + b.alerts.warning + (b.online ? 0 : 1000))
    - (a.alerts.critical * 100 + a.alerts.warning + (a.online ? 0 : 1000)) || a.hostname.localeCompare(b.hostname)).slice(0, 10);
  return (
    <section className="panel flush">
      <div className="panel-head">
        <h3>Fleet</h3>
        <Link className="small" to={scoped('/app/nodes')}>All nodes <Icon name="arrow" size={13} /></Link>
      </div>
      <div className="table-scroll">
        <table className="data-table fleet-table">
          <thead>
            <tr><th>Node</th><th className="meter-cell">CPU</th><th className="meter-cell">Memory</th><th className="meter-cell">Disk</th><th className="num">Network</th><th>Alerts</th></tr>
          </thead>
          <tbody>
            {rows.map((n) => {
              const m = n.online ? n.latest : null;
              return (
                <tr key={n.id} className={`clickable ${n.online ? '' : 'is-offline'}`} onClick={() => navigate(`/app/nodes/${n.id}`)}>
                  <td>
                    <div className="node-cell">
                      <StatusDot online={n.online} />
                      <div className="node-name">
                        <Link to={`/app/nodes/${n.id}`} onClick={(e) => e.stopPropagation()}><strong>{n.hostname}</strong></Link>
                        <span className="muted small truncate">{n.online ? n.os : `offline ${ago(n.lastSeen)}`}</span>
                      </div>
                    </div>
                  </td>
                  <td className="meter-cell">{m ? <CellMeter value={m.cpu} /> : '–'}</td>
                  <td className="meter-cell">{m ? <CellMeter value={memPct(m)} /> : '–'}</td>
                  <td className="meter-cell">{m?.disk_pct != null ? <CellMeter value={m.disk_pct} /> : '–'}</td>
                  <td className="num small">{m ? <>↓ {rate(m.net_rx)}<br />↑ {rate(m.net_tx)}</> : '–'}</td>
                  <td>
                    {n.alerts.critical > 0 && <span className="badge critical">{n.alerts.critical} critical</span>}{' '}
                    {n.alerts.warning > 0 && <span className="badge warning">{n.alerts.warning} warning</span>}
                    {!n.alerts.critical && !n.alerts.warning && <span className="muted small">None</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function Overview() {
  const { group, nodes, alerts } = useOutletContext();
  const scoped = useScopedPath();
  const events = usePolling(`/events${qs({ group: group.id, after: -86400, limit: 8 })}`, 15_000);

  if (!nodes.length) {
    return (
      <Empty icon="nodes" title={group.builtin ? 'Connect your first server' : 'This group has no nodes'}
        action={group.builtin
          ? <Link className="button primary" to="/app/connect"><Icon name="plug" size={16} /> Connect a server</Link>
          : <Link className="button primary" to="/app/settings/groups">Add nodes to this group</Link>}>
        {group.builtin
          ? 'Install the agent with one command and the server shows up here within seconds.'
          : 'Groups gather nodes so you can see their metrics, alerts and activity together.'}
      </Empty>
    );
  }

  const live = nodes.filter((n) => n.online && n.latest);
  const critical = alerts.filter((a) => a.severity === 'critical').length;
  const cpu = avg(live.map((n) => n.latest.cpu ?? 0));
  const mem = avg(live.map((n) => memPct(n.latest) ?? 0));
  const disk = live.length ? Math.max(...live.map((n) => n.latest.disk_pct ?? 0)) : null;
  const rx = live.reduce((a, n) => a + (n.latest.net_rx ?? 0), 0);
  const tx = live.reduce((a, n) => a + (n.latest.net_tx ?? 0), 0);
  const scope = { group: group.id };

  return (
    <div className="overview">
      <HealthBanner nodes={nodes} alerts={alerts} />

      <div className="kpis">
        <Kpi label="Average CPU" value={pct(cpu)}><Meter value={cpu} compact /></Kpi>
        <Kpi label="Average memory" value={pct(mem)}><Meter value={mem} compact /></Kpi>
        <Kpi label="Fullest disk" value={pct(disk)}><Meter value={disk} compact /></Kpi>
        <Kpi label="Network" value={rate(rx + tx)}><span className="muted small">↓ {rate(rx)} · ↑ {rate(tx)}</span></Kpi>
        <Kpi label="Active alerts" value={alerts.length} tone={critical ? 'crit' : alerts.length ? 'warn' : 'ok'}>
          <span className="muted small">{alerts.length ? `${critical} critical` : 'All clear'}</span>
        </Kpi>
      </div>

      <div className="overview-grid">
        <div className="overview-main">
          <FleetTable nodes={nodes} />
          <div className="charts two">
            {CHARTS.map((meta) => <MetricChart key={meta.chart} meta={meta} scope={scope} height={170} />)}
          </div>
        </div>

        <aside className="overview-side">
          <section className="panel">
            <div className="panel-head">
              <h3>Needs attention</h3>
              <Link className="small" to={scoped('/app/alerts')}>Alerts <Icon name="arrow" size={13} /></Link>
            </div>
            {!alerts.length && <p className="ok-text small"><Icon name="check" size={15} /> No active alerts.</p>}
            {alerts.slice(0, 6).map((a) => (
              <Link key={a.id} to={`/app/nodes/${a.node_id}/alerts`} className="attention-row">
                <Severity severity={a.severity} />
                <span className="truncate"><strong>{a.name}</strong> <span className="muted">on {a.hostname ?? 'a node'}</span></span>
              </Link>
            ))}
          </section>

          <section className="panel">
            <div className="panel-head">
              <h3>Recent activity</h3>
              <Link className="small" to={scoped('/app/activity')}>Activity <Icon name="arrow" size={13} /></Link>
            </div>
            <ol className="timeline">
              {(events.data ?? []).map((e) => (
                <li key={e.id} className={e.severity}>
                  <span className="timeline-text">{e.hostname ? <strong>{e.hostname} </strong> : null}{e.message}</span>
                  <span className="muted small">{ago(e.ts)}</span>
                </li>
              ))}
            </ol>
            {events.data?.length === 0 && <p className="muted small">Nothing happened in the last 24 hours.</p>}
          </section>
        </aside>
      </div>
    </div>
  );
}
