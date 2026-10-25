import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { qs, usePolling } from '../api.js';
import { Empty, Loading, SearchInput, StatusDot } from '../components/Bits.jsx';
import Icon from '../components/Icon.jsx';
import { JobDialog, JobsTable, NoJobs, useJobNodes } from '../components/Jobs.jsx';
import MetricsBoard from '../components/MetricsBoard.jsx';
import { ago, plural } from '../format.js';

const APP_SECTIONS = ['Service checks', 'Systemd', 'Nginx', 'Redis', 'PostgreSQL', 'MySQL'];
const UNIT_ORDER = { failed: 0, activating: 1, deactivating: 2, active: 3, inactive: 4 };

function SystemdUnits({ inventory, single }) {
  const [nodeId, setNodeId] = useState(null);
  const [query, setQuery] = useState('');
  const [failedOnly, setFailedOnly] = useState(false);
  const available = inventory.filter((n) => n.available);
  const current = available.find((n) => n.nodeId === nodeId) ?? available[0];

  if (!available.length) {
    const reason = inventory[0]?.error;
    return (
      <p className="muted panel">
        No systemd units reported{reason ? ` (${reason})` : ''}. Units are collected on Linux nodes that boot with systemd.
      </p>
    );
  }

  const q = query.toLowerCase();
  const units = current.list
    .filter((u) => (!failedOnly || u.active === 'failed') && (!q || `${u.unit} ${u.description}`.toLowerCase().includes(q)))
    .sort((a, b) => (UNIT_ORDER[a.active] ?? 9) - (UNIT_ORDER[b.active] ?? 9) || a.unit.localeCompare(b.unit));
  const count = (state) => current.list.filter((u) => u.active === state).length;

  return (
    <>
      {!single && available.length > 1 && (
        <div className="node-picker">
          {available.map((n) => {
            const failed = n.list.filter((u) => u.active === 'failed').length;
            return (
              <button key={n.nodeId} type="button" className={`node-pill ${n.nodeId === current.nodeId ? 'active' : ''}`} onClick={() => setNodeId(n.nodeId)}>
                <StatusDot online={n.online} /> {n.hostname}
                {failed > 0 && <span className="badge critical">{failed} failed</span>}
              </button>
            );
          })}
        </div>
      )}
      <div className="toolbar">
        <SearchInput value={query} onChange={setQuery} placeholder="Filter units" />
        <label className="check-row"><input type="checkbox" checked={failedOnly} onChange={(e) => setFailedOnly(e.target.checked)} /> Failed only</label>
        <div className="chip-row push">
          <span className="chip">{count('active')} active</span>
          <span className={`chip ${count('failed') ? 'chip-crit' : ''}`}>{count('failed')} failed</span>
          <span className="chip">{count('inactive')} inactive</span>
          <span className="muted small">updated {ago(current.ts)}</span>
        </div>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th>Unit</th><th>State</th><th>Sub-state</th><th>Load</th><th>Description</th></tr></thead>
          <tbody>
            {units.map((u) => (
              <tr key={u.unit}>
                <td className="mono">{u.unit}</td>
                <td><span className={`unit-state ${u.active}`}>{u.active}</span></td>
                <td className="muted">{u.sub}</td>
                <td className="muted">{u.load}</td>
                <td className="muted wrap">{u.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!units.length && <p className="muted pad">No units match.</p>}
      </div>
    </>
  );
}

/** Service checks, application collectors and systemd units for a set of nodes. */
export function ServicesView({ roomId, nodes, single = false }) {
  const scope = { room: roomId, nodes: single ? [nodes[0].id] : undefined };
  const jobs = usePolling(`/jobs${qs(scope)}`, 5000);
  const units = usePolling(`/services${qs(scope)}`, 30_000);
  const jobNodes = useJobNodes(single ? nodes : undefined);
  const [adding, setAdding] = useState(false);

  const failing = (jobs.data ?? []).filter((j) => j.enabled && j.status && !j.status.ok).length;

  return (
    <div className="services">
      <div className="section-head">
        <h2>Checks and application collectors</h2>
        {jobs.data?.length > 0 && (
          <span className="muted small">{plural(jobs.data.length, 'job')}{failing ? ` · ${failing} failing` : ''}</span>
        )}
        <button type="button" className="primary push" onClick={() => setAdding(true)}><Icon name="plus" size={15} /> Add check or collector</button>
      </div>
      {jobs.data?.length === 0 ? <NoJobs onAdd={() => setAdding(true)} /> : (
        <JobsTable jobs={jobs.data} nodes={jobNodes} onChanged={jobs.reload} showNode={!single} />
      )}

      <div className="section-head"><h2>systemd services</h2></div>
      {!units.data ? <Loading /> : <SystemdUnits inventory={units.data} single={single} />}

      <div className="section-head"><h2>Charts</h2></div>
      <MetricsBoard room={roomId} nodes={nodes} filterNodes={!single} summary={false} sections={APP_SECTIONS} />

      {adding && <JobDialog nodes={jobNodes} onClose={() => setAdding(false)} onSaved={jobs.reload} />}
    </div>
  );
}

export default function Services() {
  const { room, nodes } = useOutletContext();
  if (!nodes.length) return <Empty icon="services" title="No nodes in this room" />;
  return <ServicesView roomId={room.id} nodes={nodes} />;
}
