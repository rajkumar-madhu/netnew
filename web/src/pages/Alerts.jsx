import { Link } from 'react-router-dom';
import { useLive, usePolling } from '../api.js';
import { Severity } from '../components/Bits.jsx';
import { ago, dateTime, duration, nowSec } from '../format.js';

function AlertTable({ alerts, showCleared }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Status</th>
            <th>Node</th>
            <th>Alert</th>
            <th>Details</th>
            <th>Started</th>
            <th>Duration</th>
          </tr>
        </thead>
        <tbody>
          {alerts.map((a) => (
            <tr key={a.id}>
              <td><Severity severity={a.severity} cleared={showCleared && a.cleared_at} /></td>
              <td><Link to={`/nodes/${a.node_id}`}>{a.hostname ?? a.node_id}</Link></td>
              <td>{a.name}</td>
              <td className="muted">{a.message}</td>
              <td title={dateTime(a.started_at)}>{ago(a.started_at)}</td>
              <td>{duration((a.cleared_at ?? nowSec()) - a.started_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Alerts() {
  const { data, error, reload } = usePolling('/alerts', 30_000);

  useLive((msg) => {
    if (msg.type === 'alert' || (msg.type === '_status' && msg.connected)) reload();
  });

  if (error && !data) return <p className="error">Could not load alerts: {error.message}</p>;
  if (!data) return <p className="muted">Loading…</p>;

  const active = data.filter((a) => !a.cleared_at);
  const history = data.filter((a) => a.cleared_at);

  return (
    <>
      <h1>Alerts</h1>
      <p className="muted">
        Raised when CPU or RAM averages over 80/85% for a minute (critical at 95%), a filesystem is over 85% full
        (critical at 95%), or a node stops reporting. Thresholds live in <code>server/src/alerts.js</code>.
      </p>

      <h2>Active ({active.length})</h2>
      {active.length ? <AlertTable alerts={active} /> : <div className="panel muted">All clear. No active alerts.</div>}

      <h2>Recent history</h2>
      {history.length ? <AlertTable alerts={history} showCleared /> : <div className="panel muted">No resolved alerts yet.</div>}
    </>
  );
}
