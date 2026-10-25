import { useState } from 'react';
import { Link, NavLink, useParams } from 'react-router-dom';
import { api, usePolling } from '../api.js';
import { CodeBlock, Empty, Loading } from '../components/Bits.jsx';
import Icon from '../components/Icon.jsx';
import { useIntegrations } from '../components/IntegrationsModal.jsx';
import { JobDialog, JobsTable, NoJobs, useJobNodes } from '../components/Jobs.jsx';
import RoomDialog from '../components/RoomDialog.jsx';
import { PageHeader } from '../components/RoomLayout.jsx';
import { useSpace } from '../state/space.jsx';

const SECTIONS = [
  { id: 'general', label: 'General' },
  { id: 'rooms', label: 'Rooms' },
  { id: 'collectors', label: 'Collectors' },
  { id: 'notifications', label: 'Alert notifications' },
];

function General() {
  const { space, nodes } = useSpace();
  const integrations = useIntegrations();
  if (!space) return <Loading />;
  return (
    <>
      <section className="panel">
        <h3>Space</h3>
        <div className="info-row"><span className="muted">Name</span><span>{space.name} <span className="muted small">(set with <code>SPACE_NAME</code>)</span></span></div>
        <div className="info-row"><span className="muted">Server version</span><span>{space.version}</span></div>
        <div className="info-row"><span className="muted">Nodes</span><span>{nodes?.length ?? 0} ({space.connectedAgents} connected)</span></div>
        <div className="info-row"><span className="muted">Metric retention</span><span>{space.retentionHours} hours, per-second (<code>RETENTION_HOURS</code>)</span></div>
        <div className="info-row"><span className="muted">Offline after</span><span>{space.offlineAfterSec}s without data (<code>OFFLINE_AFTER_SEC</code>)</span></div>
        <div className="info-row">
          <span className="muted">Dashboard login</span>
          <span>{space.authEnabled ? <span className="badge clear">enabled</span> : <span className="badge warning">disabled</span>}</span>
        </div>
        {!space.authEnabled && (
          <p className="muted small">Anyone who can reach this server can see the dashboard. Set <code>DASHBOARD_PASSWORD</code> (and optionally <code>DASHBOARD_USER</code>) to require a login.</p>
        )}
      </section>
      <section className="panel">
        <h3>Connecting agents</h3>
        <p className="muted">
          Agents authenticate with the space's agent token.{' '}
          {space.agentTokenFromEnv
            ? <>It is set by the <code>AGENT_TOKEN</code> environment variable on the server.</>
            : <>It was generated on first start and is stored on the server in <code>data/agent-token</code>:</>}
        </p>
        {!space.agentTokenFromEnv && <CodeBlock>cat server/data/agent-token</CodeBlock>}
        <button type="button" className="primary" onClick={() => integrations.show('deploy.operating-systems')}><Icon name="plug" size={15} /> Connect nodes</button>
      </section>
    </>
  );
}

function Rooms() {
  const { rooms, nodes, loadRooms } = useSpace();
  const [editing, setEditing] = useState(null); // room object, or {} for a new room

  async function remove(room) {
    if (!window.confirm(`Delete room "${room.name}"? Its nodes stay in the space.`)) return;
    await api(`/rooms/${room.id}`, { method: 'DELETE' });
    loadRooms();
  }

  if (!rooms) return <Loading />;
  return (
    <>
      <div className="toolbar">
        <p className="muted">Rooms group nodes, for example by environment, team or service. A node can be in any number of rooms.</p>
        <button type="button" className="primary push" onClick={() => setEditing({})}><Icon name="plus" size={15} /> Create room</button>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th>Room</th><th>Description</th><th className="num">Nodes</th><th aria-label="Actions" /></tr></thead>
          <tbody>
            {rooms.map((r) => (
              <tr key={r.id}>
                <td><Link to={`/rooms/${r.id}/home`}><strong>{r.name}</strong></Link></td>
                <td className="muted wrap">{r.description}</td>
                <td className="num">{r.nodeIds.length}{r.builtin ? ` of ${nodes?.length ?? 0}` : ''}</td>
                <td className="actions">
                  {r.builtin ? <span className="muted small">built-in</span> : (
                    <>
                      <button type="button" className="icon-button" aria-label={`Edit ${r.name}`} onClick={() => setEditing(r)}><Icon name="edit" size={15} /></button>
                      <button type="button" className="icon-button" aria-label={`Delete ${r.name}`} onClick={() => remove(r)}><Icon name="trash" size={15} /></button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && <RoomDialog room={editing.id ? editing : null} onClose={() => setEditing(null)} />}
    </>
  );
}

function Collectors() {
  const { data, reload } = usePolling('/jobs', 5000);
  const nodes = useJobNodes();
  const [adding, setAdding] = useState(false);
  return (
    <>
      <div className="toolbar">
        <p className="muted">Service checks and application collectors for every node. Each job runs on the agent of the node it belongs to.</p>
        <button type="button" className="primary push" onClick={() => setAdding(true)}><Icon name="plus" size={15} /> Add check or collector</button>
      </div>
      {data?.length === 0 ? <NoJobs onAdd={() => setAdding(true)} /> : <JobsTable jobs={data} nodes={nodes} onChanged={reload} />}
      {adding && <JobDialog nodes={nodes} onClose={() => setAdding(false)} onSaved={reload} />}
    </>
  );
}

const EMPTY_CHANNEL = { name: '', type: 'slack', url: '', min_severity: 'warning', enabled: true };

function ChannelForm({ channel, onSaved, onCancel }) {
  const [form, setForm] = useState(channel ? { ...channel, enabled: Boolean(channel.enabled) } : EMPTY_CHANNEL);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setError(null);
    try {
      await (channel
        ? api(`/channels/${channel.id}`, { method: 'PATCH', body: form })
        : api('/channels', { method: 'POST', body: form }));
      onSaved();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <form className="panel form channel-form" onSubmit={submit}>
      <h3>{channel ? `Edit ${channel.name}` : 'Add a channel'}</h3>
      <div className="form-grid">
        <label><span>Name</span><input value={form.name} onChange={set('name')} placeholder="#ops-alerts" required /></label>
        <label>
          <span>Type</span>
          <select value={form.type} onChange={set('type')}>
            <option value="slack">Slack (incoming webhook)</option>
            <option value="discord">Discord (channel webhook)</option>
            <option value="webhook">Webhook (JSON POST)</option>
          </select>
        </label>
        <label className="span-2"><span>Webhook URL</span><input value={form.url} onChange={set('url')} placeholder="https://hooks.slack.com/services/…" required /></label>
        <label>
          <span>Send</span>
          <select value={form.min_severity} onChange={set('min_severity')}>
            <option value="warning">Warnings and criticals</option>
            <option value="critical">Criticals only</option>
          </select>
        </label>
        <label className="check-row"><input type="checkbox" checked={form.enabled} onChange={set('enabled')} /> Enabled</label>
      </div>
      {error && <p className="error small">{error}</p>}
      <div className="form-actions">
        <button type="button" className="ghost" onClick={onCancel}>Cancel</button>
        <button type="submit" className="primary">{channel ? 'Save' : 'Add channel'}</button>
      </div>
    </form>
  );
}

function Notifications() {
  const { data, reload } = usePolling('/channels');
  const [editing, setEditing] = useState(null); // channel, or 'new'
  const [status, setStatus] = useState({});

  async function test(c) {
    setStatus((s) => ({ ...s, [c.id]: 'Sending…' }));
    try {
      await api(`/channels/${c.id}/test`, { method: 'POST' });
      setStatus((s) => ({ ...s, [c.id]: '✓ Test sent' }));
    } catch (err) {
      setStatus((s) => ({ ...s, [c.id]: `✗ ${err.message}` }));
    }
  }

  async function remove(c) {
    if (!window.confirm(`Delete channel "${c.name}"?`)) return;
    await api(`/channels/${c.id}`, { method: 'DELETE' });
    reload();
  }

  async function toggle(c) {
    await api(`/channels/${c.id}`, { method: 'PATCH', body: { enabled: !c.enabled } });
    reload();
  }

  if (!data) return <Loading />;
  return (
    <>
      <div className="toolbar">
        <p className="muted">Alerts are sent when raised, when they change severity and when they clear. Failed deliveries are logged on the Events tab.</p>
        {!editing && <button type="button" className="primary push" onClick={() => setEditing('new')}><Icon name="plus" size={15} /> Add channel</button>}
      </div>
      {editing && (
        <ChannelForm channel={editing === 'new' ? null : editing}
          onSaved={() => { setEditing(null); reload(); }} onCancel={() => setEditing(null)} />
      )}
      {!data.length && !editing && (
        <Empty icon="alerts" title="No notification channels">Add a Slack, Discord or webhook channel to get alerts outside the dashboard.</Empty>
      )}
      {data.length > 0 && (
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>Channel</th><th>Type</th><th>Sends</th><th>Status</th><th aria-label="Actions" /></tr></thead>
            <tbody>
              {data.map((c) => (
                <tr key={c.id}>
                  <td><strong>{c.name}</strong><div className="muted small truncate url">{c.url}</div></td>
                  <td>{c.type}</td>
                  <td>{c.min_severity === 'critical' ? 'criticals' : 'warnings + criticals'}</td>
                  <td>
                    <button type="button" className={`badge-button ${c.enabled ? 'on' : ''}`} onClick={() => toggle(c)}>{c.enabled ? 'enabled' : 'disabled'}</button>
                    {status[c.id] && <div className="small muted">{status[c.id]}</div>}
                  </td>
                  <td className="actions">
                    <button type="button" className="ghost small" onClick={() => test(c)}>Send test</button>
                    <button type="button" className="icon-button" aria-label={`Edit ${c.name}`} onClick={() => setEditing(c)}><Icon name="edit" size={15} /></button>
                    <button type="button" className="icon-button" aria-label={`Delete ${c.name}`} onClick={() => remove(c)}><Icon name="trash" size={15} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export default function Settings() {
  const { section = 'general' } = useParams();
  return (
    <>
      <PageHeader title="Space settings" tabs={(
        <nav className="tabs" aria-label="Settings sections">
          {SECTIONS.map((s) => (
            <NavLink key={s.id} to={`/settings/${s.id}`} className={() => `tab ${section === s.id ? 'active' : ''}`}>{s.label}</NavLink>
          ))}
        </nav>
      )} />
      <div className="page settings">
        {section === 'general' && <General />}
        {section === 'rooms' && <Rooms />}
        {section === 'collectors' && <Collectors />}
        {section === 'notifications' && <Notifications />}
      </div>
    </>
  );
}
