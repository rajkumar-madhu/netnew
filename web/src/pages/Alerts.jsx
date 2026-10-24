import { useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { qs, useLive, usePolling } from '../api.js';
import { Empty, Loading, SearchInput, Severity } from '../components/Bits.jsx';
import { ago, dateTime, duration, nowSec } from '../format.js';

function AlertTable({ alerts, history }) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Status</th>
            <th>Alert</th>
            <th>Node</th>
            <th>Details</th>
            <th>{history ? 'Started' : 'Triggered'}</th>
            <th>Duration</th>
          </tr>
        </thead>
        <tbody>
          {alerts.map((a) => (
            <tr key={a.id}>
              <td><Severity severity={a.severity} cleared={history && a.cleared_at} /></td>
              <td><strong>{a.name}</strong><div className="muted small mono">{a.rule}</div></td>
              <td><Link to={`/nodes/${a.node_id}`}>{a.hostname ?? a.node_id}</Link></td>
              <td className="muted wrap">{a.message}</td>
              <td title={dateTime(a.started_at)}>{ago(a.started_at)}</td>
              <td>{duration((a.cleared_at ?? nowSec()) - a.started_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Configurations() {
  const { data } = usePolling('/alert-rules');
  if (!data) return <Loading />;
  return (
    <>
      <p className="muted">
        Every rule applies to every node. Thresholds are defined in <code>server/src/alerts.js</code>; edit them there and restart the server.
        Send alerts to Slack, Discord or webhooks from <Link to="/settings/notifications">notification settings</Link>.
      </p>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr><th>Alert</th><th>Window</th><th>Warning</th><th>Critical</th><th>Behaviour</th></tr>
          </thead>
          <tbody>
            {data.map((r) => (
              <tr key={r.id}>
                <td><strong>{r.name}</strong><div className="muted small mono">{r.id}</div></td>
                <td>{r.window}s</td>
                <td>{r.warn != null ? <span className="badge warning">≥ {r.warn}{r.units}</span> : '—'}</td>
                <td>{r.crit != null ? <span className="badge critical">≥ {r.crit}{r.units}</span> : <span className="badge critical">no data</span>}</td>
                <td className="muted wrap">{r.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default function Alerts() {
  const { room, alerts } = useOutletContext();
  const [view, setView] = useState('raised');
  const [severity, setSeverity] = useState('all');
  const [query, setQuery] = useState('');
  const history = usePolling(view === 'history' ? `/alerts${qs({ room: room.id })}` : null, 30_000);
  useLive((msg) => { if (msg.type === 'alert' && view === 'history') history.reload(); });

  const q = query.toLowerCase();
  const matches = (a) => (severity === 'all' || a.severity === severity)
    && (!q || `${a.name} ${a.hostname} ${a.message}`.toLowerCase().includes(q));

  return (
    <>
      <div className="toolbar">
        <div className="seg" role="group" aria-label="Alert view">
          <button type="button" className={view === 'raised' ? 'active' : ''} onClick={() => setView('raised')}>Raised ({alerts.length})</button>
          <button type="button" className={view === 'history' ? 'active' : ''} onClick={() => setView('history')}>History</button>
          <button type="button" className={view === 'config' ? 'active' : ''} onClick={() => setView('config')}>Configurations</button>
        </div>
        {view !== 'config' && (
          <>
            <div className="seg" role="group" aria-label="Severity">
              {['all', 'critical', 'warning'].map((s) => (
                <button key={s} type="button" className={severity === s ? 'active' : ''} onClick={() => setSeverity(s)}>{s}</button>
              ))}
            </div>
            <SearchInput value={query} onChange={setQuery} placeholder="Search alerts" />
          </>
        )}
      </div>

      {view === 'raised' && (alerts.filter(matches).length
        ? <AlertTable alerts={alerts.filter(matches)} />
        : <Empty icon="check" title="No raised alerts">Everything in this room is within its thresholds.</Empty>)}

      {view === 'history' && (!history.data ? <Loading /> : history.data.filter(matches).length
        ? <AlertTable alerts={history.data.filter(matches)} history />
        : <Empty icon="alerts" title="No alert history yet" />)}

      {view === 'config' && <Configurations />}
    </>
  );
}
