import { useState } from 'react';
import { Link, NavLink, useParams } from 'react-router-dom';
import { api, usePolling } from '../../lib/api.js';
import { CopyButton, Empty, Loading, Modal } from '../../components/ui/Bits.jsx';
import Icon from '../../components/ui/Icon.jsx';
import { useIntegrations } from '../../components/IntegrationsModal.jsx';
import { JobDialog, JobsTable, NoJobs, useJobNodes } from '../../components/Jobs.jsx';
import GroupDialog from '../../components/GroupDialog.jsx';
import { PageHeader } from '../../components/layout/GroupLayout.jsx';
import { ago, dateTime } from '../../lib/format.js';
import { useAuth } from '../../state/auth.jsx';
import { useWorkspace } from '../../state/workspace.jsx';

const SECTIONS = [
  { id: 'general', label: 'General' },
  { id: 'account', label: 'Account' },
  { id: 'users', label: 'Users', admin: true },
  { id: 'groups', label: 'Groups' },
  { id: 'collectors', label: 'Collectors' },
  { id: 'notifications', label: 'Alert notifications' },
];

function ReadOnlyNote() {
  return <p className="readonly-note"><Icon name="lock" size={14} /> You have read-only access. Ask an admin to make changes.</p>;
}

function General() {
  const { workspace, nodes, loadWorkspace } = useWorkspace();
  const { isAdmin } = useAuth();
  const integrations = useIntegrations();
  const [name, setName] = useState(null);
  const [token, setToken] = useState(null);
  const [message, setMessage] = useState(null);
  if (!workspace) return <Loading />;

  async function rename(e) {
    e.preventDefault();
    try {
      await api('/workspace', { method: 'PATCH', body: { name } });
      setName(null);
      setMessage('Workspace renamed.');
      loadWorkspace();
    } catch (err) {
      setMessage(err.message);
    }
  }

  return (
    <>
      <section className="panel">
        <h3>Workspace</h3>
        {isAdmin && name != null ? (
          <form className="inline-form" onSubmit={rename}>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} aria-label="Workspace name" autoFocus />
            <button type="submit" className="primary" disabled={!name.trim()}>Save</button>
            <button type="button" className="ghost" onClick={() => setName(null)}>Cancel</button>
          </form>
        ) : (
          <div className="info-row">
            <span className="muted">Name</span>
            <span>{workspace.name} {isAdmin && <button type="button" className="ghost small" onClick={() => setName(workspace.name)}><Icon name="edit" size={13} /> Rename</button>}</span>
          </div>
        )}
        {message && <p className="muted small">{message}</p>}
        <div className="info-row"><span className="muted">Version</span><span>{workspace.version}</span></div>
        <div className="info-row"><span className="muted">Nodes</span><span>{nodes?.length ?? 0} ({workspace.connectedAgents} connected)</span></div>
        <div className="info-row"><span className="muted">Users</span><span>{workspace.users}</span></div>
        <div className="info-row"><span className="muted">Metric retention</span><span>{workspace.retentionHours} hours per-second (<code>RETENTION_HOURS</code>)</span></div>
        <div className="info-row"><span className="muted">Log retention</span><span>{workspace.logRetentionHours} hours (<code>LOG_RETENTION_HOURS</code>)</span></div>
        <div className="info-row"><span className="muted">Offline after</span><span>{workspace.offlineAfterSec}s without data (<code>OFFLINE_AFTER_SEC</code>)</span></div>
      </section>
      <section className="panel">
        <h3>Connecting agents</h3>
        <p className="muted">
          Agents authenticate with the workspace's agent token.{' '}
          {workspace.agentTokenFromEnv
            ? <>It is set by the <code>AGENT_TOKEN</code> environment variable on the server.</>
            : <>It was generated on first start and is stored in the server's data directory (<code>agent-token</code>).</>}
        </p>
        {isAdmin && (token ? (
          <div className="token-row"><code>{token}</code><CopyButton text={token} /></div>
        ) : (
          <button type="button" className="ghost" onClick={() => api('/workspace/agent-token').then((r) => setToken(r.token))}>
            <Icon name="lock" size={15} /> Show agent token
          </button>
        ))}
        <p>
          <button type="button" className="primary" onClick={() => integrations.show('deploy.servers')}><Icon name="plug" size={15} /> Connect nodes</button>
        </p>
      </section>
    </>
  );
}

function Account() {
  const auth = useAuth();
  const [form, setForm] = useState({ current: '', next: '', confirm: '' });
  const [message, setMessage] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function change(e) {
    e.preventDefault();
    if (form.next !== form.confirm) return setMessage({ error: true, text: 'The new passwords do not match.' });
    try {
      await api('/auth/password', { method: 'POST', body: { current: form.current, next: form.next } });
      setForm({ current: '', next: '', confirm: '' });
      setMessage({ text: 'Password changed.' });
    } catch (err) {
      setMessage({ error: true, text: err.message });
    }
  }

  return (
    <>
      <section className="panel">
        <h3>Profile</h3>
        <div className="info-row"><span className="muted">Name</span><span>{auth.user.name}</span></div>
        <div className="info-row"><span className="muted">Email</span><span>{auth.user.email}</span></div>
        <div className="info-row"><span className="muted">Role</span><span><span className="role-badge">{auth.user.role}</span></span></div>
      </section>
      <section className="panel">
        <h3>Change password</h3>
        <form className="form narrow" onSubmit={change}>
          <label><span>Current password</span><input type="password" autoComplete="current-password" value={form.current} onChange={set('current')} required /></label>
          <label><span>New password</span><input type="password" autoComplete="new-password" minLength={8} value={form.next} onChange={set('next')} required /></label>
          <label><span>Confirm new password</span><input type="password" autoComplete="new-password" minLength={8} value={form.confirm} onChange={set('confirm')} required /></label>
          {message && <p className={message.error ? 'error small' : 'ok-text small'}>{message.text}</p>}
          <div><button type="submit" className="primary">Change password</button></div>
        </form>
      </section>
      <section className="panel">
        <h3>Sign out</h3>
        <p className="muted">Signs you out of this browser.</p>
        <button type="button" className="ghost" onClick={() => auth.logout()}><Icon name="logout" size={15} /> Sign out</button>
      </section>
    </>
  );
}

const EMPTY_USER = { name: '', email: '', role: 'viewer', password: '' };

function UserDialog({ user, onClose, onSaved }) {
  const [form, setForm] = useState(user ? { ...user, password: '' } : EMPTY_USER);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save(e) {
    e.preventDefault();
    setError(null);
    try {
      const body = { name: form.name, role: form.role, ...(form.password ? { password: form.password } : {}) };
      await (user
        ? api(`/users/${user.id}`, { method: 'PATCH', body })
        : api('/users', { method: 'POST', body: { ...body, email: form.email } }));
      onSaved();
      onClose();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <Modal title={user ? `Edit ${user.name}` : 'Add user'} onClose={onClose} footer={(
      <>
        {error && <span className="error small">{error}</span>}
        <button type="button" className="ghost" onClick={onClose}>Cancel</button>
        <button type="submit" form="user-form" className="primary">{user ? 'Save' : 'Add user'}</button>
      </>
    )}>
      <form id="user-form" className="form" onSubmit={save}>
        <label><span>Name</span><input value={form.name} onChange={set('name')} required maxLength={80} autoFocus /></label>
        <label><span>Email</span><input type="email" value={form.email} onChange={set('email')} required disabled={Boolean(user)} /></label>
        <label>
          <span>Role</span>
          <select value={form.role} onChange={set('role')}>
            <option value="viewer">Viewer: can see everything, change nothing</option>
            <option value="admin">Admin: can also manage nodes, groups, jobs, users and settings</option>
          </select>
        </label>
        <label>
          <span>{user ? 'New password' : 'Initial password'}{user && <em className="muted"> (leave empty to keep)</em>}</span>
          <input type="password" autoComplete="new-password" minLength={8} value={form.password} onChange={set('password')} required={!user} />
        </label>
        {!user && <p className="muted small">Share the password with them securely; they can change it under Account.</p>}
      </form>
    </Modal>
  );
}

function Users() {
  const auth = useAuth();
  const { data, reload } = usePolling('/users');
  const [editing, setEditing] = useState(null); // user, or {} for new

  async function remove(u) {
    if (!window.confirm(`Remove ${u.name} (${u.email})? They will be signed out.`)) return;
    try {
      await api(`/users/${u.id}`, { method: 'DELETE' });
      reload();
    } catch (err) {
      window.alert(err.message);
    }
  }

  if (!auth.isAdmin) return <ReadOnlyNote />;
  if (!data) return <Loading />;
  return (
    <>
      <div className="toolbar">
        <p className="muted">Admins manage nodes, groups, collectors, users and settings. Viewers can see everything but change nothing.</p>
        <button type="button" className="primary push" onClick={() => setEditing({})}><Icon name="plus" size={15} /> Add user</button>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Last sign-in</th><th>Added</th><th aria-label="Actions" /></tr></thead>
          <tbody>
            {data.map((u) => (
              <tr key={u.id}>
                <td><strong>{u.name}</strong>{u.id === auth.user.id && <span className="muted small"> (you)</span>}</td>
                <td>{u.email}</td>
                <td><span className="role-badge">{u.role}</span></td>
                <td>{u.last_login ? ago(u.last_login) : <span className="muted">never</span>}</td>
                <td title={dateTime(u.created_at)}>{ago(u.created_at)}</td>
                <td className="actions">
                  <button type="button" className="icon-button" aria-label={`Edit ${u.name}`} onClick={() => setEditing(u)}><Icon name="edit" size={15} /></button>
                  {u.id !== auth.user.id && (
                    <button type="button" className="icon-button" aria-label={`Remove ${u.name}`} onClick={() => remove(u)}><Icon name="trash" size={15} /></button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && <UserDialog user={editing.id ? editing : null} onClose={() => setEditing(null)} onSaved={reload} />}
    </>
  );
}

function Groups() {
  const { groups, nodes, loadGroups } = useWorkspace();
  const { isAdmin } = useAuth();
  const [editing, setEditing] = useState(null); // group object, or {} for a new group

  async function remove(group) {
    if (!window.confirm(`Delete group "${group.name}"? Its nodes stay in the workspace; its dashboards are deleted.`)) return;
    await api(`/groups/${group.id}`, { method: 'DELETE' });
    loadGroups();
  }

  if (!groups) return <Loading />;
  return (
    <>
      <div className="toolbar">
        <p className="muted">Groups organize nodes, for example by environment, team or service. A node can be in any number of groups.</p>
        {isAdmin && <button type="button" className="primary push" onClick={() => setEditing({})}><Icon name="plus" size={15} /> Create group</button>}
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th>Group</th><th>Description</th><th className="num">Nodes</th><th aria-label="Actions" /></tr></thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g.id}>
                <td><Link to={`/app/groups/${g.id}/home`}><strong>{g.name}</strong></Link></td>
                <td className="muted wrap">{g.description}</td>
                <td className="num">{g.nodeIds.length}{g.builtin ? ` of ${nodes?.length ?? 0}` : ''}</td>
                <td className="actions">
                  {g.builtin ? <span className="muted small">built-in</span> : isAdmin && (
                    <>
                      <button type="button" className="icon-button" aria-label={`Edit ${g.name}`} onClick={() => setEditing(g)}><Icon name="edit" size={15} /></button>
                      <button type="button" className="icon-button" aria-label={`Delete ${g.name}`} onClick={() => remove(g)}><Icon name="trash" size={15} /></button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && <GroupDialog group={editing.id ? editing : null} onClose={() => setEditing(null)} />}
    </>
  );
}

function Collectors() {
  const { data, reload } = usePolling('/jobs', 5000);
  const { isAdmin } = useAuth();
  const nodes = useJobNodes();
  const [adding, setAdding] = useState(false);
  return (
    <>
      <div className="toolbar">
        <p className="muted">Service checks and application collectors for every node. Each job runs on the agent of the node it belongs to.</p>
        {isAdmin && <button type="button" className="primary push" onClick={() => setAdding(true)}><Icon name="plus" size={15} /> Add check or collector</button>}
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
  const { isAdmin } = useAuth();
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
        {isAdmin && !editing && <button type="button" className="primary push" onClick={() => setEditing('new')}><Icon name="plus" size={15} /> Add channel</button>}
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
                    <button type="button" className={`badge-button ${c.enabled ? 'on' : ''}`} disabled={!isAdmin} onClick={() => toggle(c)}>{c.enabled ? 'enabled' : 'disabled'}</button>
                    {status[c.id] && <div className="small muted">{status[c.id]}</div>}
                  </td>
                  <td className="actions">
                    {isAdmin && <>
                    <button type="button" className="ghost small" onClick={() => test(c)}>Send test</button>
                    <button type="button" className="icon-button" aria-label={`Edit ${c.name}`} onClick={() => setEditing(c)}><Icon name="edit" size={15} /></button>
                    <button type="button" className="icon-button" aria-label={`Delete ${c.name}`} onClick={() => remove(c)}><Icon name="trash" size={15} /></button>
                    </>}
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
  const { isAdmin } = useAuth();
  return (
    <>
      <PageHeader title="Workspace settings" tabs={(
        <nav className="tabs" aria-label="Settings sections">
          {SECTIONS.filter((s) => !s.admin || isAdmin).map((s) => (
            <NavLink key={s.id} to={`/app/settings/${s.id}`} className={() => `tab ${section === s.id ? 'active' : ''}`}>{s.label}</NavLink>
          ))}
        </nav>
      )} />
      <div className="page settings">
        {section === 'general' && <General />}
        {section === 'account' && <Account />}
        {section === 'users' && <Users />}
        {section === 'groups' && <Groups />}
        {section === 'collectors' && <Collectors />}
        {section === 'notifications' && <Notifications />}
      </div>
    </>
  );
}
