import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { ago, formatterFor } from '../format.js';
import { useSpace } from '../state/space.jsx';
import { Empty, Loading, Modal } from './Bits.jsx';
import Icon from './Icon.jsx';

const ms = formatterFor('ms');

let typesPromise = null;
export function useJobTypes() {
  const [types, setTypes] = useState(null);
  useEffect(() => {
    typesPromise ??= api('/job-types');
    typesPromise.then(setTypes).catch(() => { typesPromise = null; });
  }, []);
  return types;
}

// Short "what does this job look at" text for tables.
export function jobTarget(job) {
  const c = job.config;
  if (c.url) return c.url;
  if (c.host && c.port) return `${c.host}:${c.port}`;
  if (c.host) return c.host;
  if (c.dsn) return 'connection string (hidden)';
  return '';
}

/** Create or edit a collector job. `type` and `nodeId` can be preset. */
export function JobForm({ job, type: presetType, nodeId: presetNode, nodes, onSaved, onCancel, submitLabel }) {
  const types = useJobTypes();
  const [type, setType] = useState(job?.type ?? presetType ?? 'http');
  const [nodeId, setNodeId] = useState(job?.node_id ?? presetNode ?? nodes[0]?.id ?? '');
  const [name, setName] = useState(job?.name ?? '');
  const [config, setConfig] = useState(job?.config ?? {});
  const [enabled, setEnabled] = useState(job?.enabled ?? true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  if (!types) return <Loading />;
  const def = types[type];

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const body = { name, config, enabled, node_id: nodeId, type };
      const saved = job
        ? await api(`/jobs/${job.id}`, { method: 'PATCH', body })
        : await api('/jobs', { method: 'POST', body });
      onSaved?.(saved);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <form className="form job-form" onSubmit={submit}>
      <div className="form-grid">
        {!job && !presetType && (
          <label>
            <span>Type</span>
            <select value={type} onChange={(e) => { setType(e.target.value); setConfig({}); }}>
              {Object.entries(types).map(([id, t]) => <option key={id} value={id}>{t.name}</option>)}
            </select>
          </label>
        )}
        <label>
          <span>Runs on node</span>
          <select value={nodeId} onChange={(e) => setNodeId(e.target.value)} disabled={Boolean(job)}>
            {nodes.map((n) => <option key={n.id} value={n.id}>{n.hostname}{n.online ? '' : ' (offline)'}</option>)}
          </select>
        </label>
        <label>
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. checkout-api" maxLength={60} required />
        </label>
        {def.fields.map((f) => (
          <label key={f.key} className={f.type === 'url' || f.key === 'dsn' ? 'span-2' : ''}>
            <span>{f.label}{!f.required && f.default == null ? <em className="muted"> (optional)</em> : ''}</span>
            {f.type === 'select' ? (
              <select value={config[f.key] ?? f.default} onChange={(e) => setConfig({ ...config, [f.key]: e.target.value })}>
                {f.options.map((o) => <option key={o}>{o}</option>)}
              </select>
            ) : (
              <input type={f.type === 'number' ? 'number' : f.type === 'password' ? 'password' : 'text'}
                value={config[f.key] ?? ''} placeholder={f.placeholder ?? (f.default != null ? String(f.default) : '')}
                min={f.min} max={f.max} required={f.required && !job}
                autoComplete="off" onChange={(e) => setConfig({ ...config, [f.key]: e.target.value })} />
            )}
          </label>
        ))}
        <label className="check-row"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Enabled</label>
      </div>
      <p className="muted small">{def.description} The server sends this job to the node's agent, which starts running it within seconds.</p>
      {error && <p className="error small">{error}</p>}
      <div className="form-actions">
        {onCancel && <button type="button" className="ghost" onClick={onCancel}>Cancel</button>}
        <button type="submit" className="primary" disabled={saving || !nodeId}>{saving ? 'Saving…' : submitLabel ?? (job ? 'Save' : 'Add job')}</button>
      </div>
    </form>
  );
}

export function JobDialog({ job, nodes, presetType, onClose, onSaved }) {
  const types = useJobTypes();
  const title = job ? `Edit ${job.name}` : presetType && types ? `Add ${types[presetType].name}` : 'Add check or collector';
  return (
    <Modal title={title} onClose={onClose} wide>
      <JobForm job={job} type={presetType} nodes={nodes} onCancel={onClose} onSaved={(saved) => { onSaved?.(saved); onClose(); }} />
    </Modal>
  );
}

/** Table of collector jobs with their latest status. */
export function JobsTable({ jobs, nodes, onChanged, showNode = true }) {
  const types = useJobTypes();
  const [editing, setEditing] = useState(null);

  async function toggle(job) {
    await api(`/jobs/${job.id}`, { method: 'PATCH', body: { enabled: !job.enabled } });
    onChanged();
  }
  async function remove(job) {
    if (!window.confirm(`Delete ${job.name}? Its charts keep their history until retention removes it.`)) return;
    await api(`/jobs/${job.id}`, { method: 'DELETE' });
    onChanged();
  }

  if (!jobs) return <Loading />;
  if (!jobs.length) return null;
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Status</th>
            <th>Name</th>
            <th>Type</th>
            {showNode && <th>Node</th>}
            <th>Target</th>
            <th className="num">Response</th>
            <th>Last run</th>
            <th aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {jobs.map((j) => {
            const s = j.status;
            const state = !j.enabled ? 'disabled' : !s ? 'pending' : s.ok ? 'ok' : 'failing';
            return (
              <tr key={j.id} className={j.enabled ? '' : 'is-offline'}>
                <td>
                  <span className={`job-state ${state}`}>
                    {state === 'ok' && <Icon name="check" size={13} />} {state}
                  </span>
                </td>
                <td><strong>{j.name}</strong>{s?.error && <div className="error small wrap-text">{s.error}</div>}</td>
                <td>{types?.[j.type]?.name ?? j.type}</td>
                {showNode && <td><Link to={`/nodes/${j.node_id}/services`}>{j.hostname}</Link></td>}
                <td className="muted mono small truncate target">{jobTarget(j)}</td>
                <td className="num">{s?.latency != null ? ms(s.latency) : '—'}</td>
                <td className="small">{s ? ago(s.lastRun) : '—'}</td>
                <td className="actions">
                  <button type="button" className="ghost small" onClick={() => toggle(j)}>{j.enabled ? 'Disable' : 'Enable'}</button>
                  <button type="button" className="icon-button" aria-label={`Edit ${j.name}`} onClick={() => setEditing(j)}><Icon name="edit" size={15} /></button>
                  <button type="button" className="icon-button" aria-label={`Delete ${j.name}`} onClick={() => remove(j)}><Icon name="trash" size={15} /></button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {editing && <JobDialog job={editing} nodes={nodes} onClose={() => setEditing(null)} onSaved={onChanged} />}
    </div>
  );
}

// Nodes eligible to run jobs: every node in the space, live ones first.
export function useJobNodes(scopeNodes) {
  const { nodes } = useSpace();
  const list = scopeNodes ?? nodes ?? [];
  return [...list].sort((a, b) => Number(b.online) - Number(a.online) || a.hostname.localeCompare(b.hostname));
}

export function NoJobs({ onAdd }) {
  return (
    <Empty icon="services" title="No checks or collectors yet"
      action={<button type="button" className="primary" onClick={onAdd}><Icon name="plus" size={15} /> Add check or collector</button>}>
      Monitor HTTP endpoints, TCP ports and hosts, or collect metrics from Nginx, Redis, PostgreSQL and MySQL.
    </Empty>
  );
}

