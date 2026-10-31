import { useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { CellMeter, Empty, SearchInput, SortTh, sortBy, StatusDot } from '../../components/ui/Bits.jsx';
import Icon from '../../components/ui/Icon.jsx';
import GroupDialog from '../../components/GroupDialog.jsx';
import { ago, duration, memPct, nowSec, num, rate } from '../../lib/format.js';
import { useWorkspace } from '../../state/workspace.jsx';
import { useAuth } from '../../state/auth.jsx';

const GETTERS = {
  name: (n) => n.hostname,
  status: (n) => (n.online ? 1 : 0),
  alerts: (n) => n.alerts.critical * 1000 + n.alerts.warning,
  cpu: (n) => n.latest?.cpu,
  ram: (n) => memPct(n.latest),
  disk: (n) => n.latest?.disk_pct,
  load: (n) => n.latest?.load1,
  net: (n) => (n.latest ? (n.latest.net_rx ?? 0) + (n.latest.net_tx ?? 0) : null),
  os: (n) => n.os,
  uptime: (n) => (n.online ? nowSec() - n.bootTime : null),
};

export default function Nodes() {
  const { group, nodes } = useOutletContext();
  const { loadGroups } = useWorkspace();
  const { isAdmin } = useAuth();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [sort, setSort] = useState({ key: 'name', dir: 1 });
  const [selected, setSelected] = useState(new Set());
  const [dialog, setDialog] = useState(null); // 'edit' | 'create'

  const q = query.toLowerCase();
  const visible = sortBy(nodes.filter((n) => {
    if (status === 'live' && !n.online) return false;
    if (status === 'offline' && n.online) return false;
    return !q || `${n.hostname} ${n.os} ${n.ip}`.toLowerCase().includes(q);
  }), sort, GETTERS);

  const toggle = (id) => setSelected((s) => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const allSelected = visible.length > 0 && visible.every((n) => selected.has(n.id));

  async function removeFromGroup() {
    await api(`/groups/${group.id}/nodes`, { method: 'PUT', body: { nodeIds: group.nodeIds.filter((id) => !selected.has(id)) } });
    setSelected(new Set());
    loadGroups();
  }

  async function deleteNode(node) {
    if (!window.confirm(`Delete ${node.hostname} and all of its data? This can't be undone.`)) return;
    try {
      await api(`/nodes/${node.id}`, { method: 'DELETE' });
    } catch (err) {
      window.alert(err.message);
    }
  }

  return (
    <>
      <div className="toolbar">
        <SearchInput value={query} onChange={setQuery} placeholder="Search nodes by name, OS or IP" />
        <div className="seg" role="group" aria-label="Status filter">
          {['all', 'live', 'offline'].map((s) => (
            <button key={s} type="button" className={status === s ? 'active' : ''} onClick={() => setStatus(s)}>{s}</button>
          ))}
        </div>
        <div className="push toolbar-actions">
          {isAdmin && selected.size > 0 && (
            <>
              <span className="muted small">{selected.size} selected</span>
              <button type="button" className="ghost" onClick={() => setDialog('create')}><Icon name="group" size={15} /> New group from selection</button>
              {!group.builtin && <button type="button" className="ghost" onClick={removeFromGroup}>Remove from group</button>}
            </>
          )}
          {isAdmin && !group.builtin && <button type="button" className="ghost" onClick={() => setDialog('edit')}><Icon name="edit" size={15} /> Manage group</button>}
          <Link className="button primary" to="/app/connect"><Icon name="plug" size={15} /> Connect a server</Link>
        </div>
      </div>

      {!nodes.length ? (
        <Empty icon="nodes" title="No nodes in this group"
          action={isAdmin && !group.builtin && <button type="button" className="primary" onClick={() => setDialog('edit')}>Add nodes</button>} />
      ) : (
        <div className="table-wrap">
          <table className="data-table nodes-table">
            <thead>
              <tr>
                <th className="check"><input type="checkbox" aria-label="Select all" checked={allSelected}
                  onChange={() => setSelected(allSelected ? new Set() : new Set(visible.map((n) => n.id)))} /></th>
                <SortTh id="name" sort={sort} setSort={setSort}>Node</SortTh>
                <SortTh id="alerts" sort={sort} setSort={setSort}>Alerts</SortTh>
                <SortTh id="cpu" sort={sort} setSort={setSort}>CPU</SortTh>
                <SortTh id="ram" sort={sort} setSort={setSort}>RAM</SortTh>
                <SortTh id="disk" sort={sort} setSort={setSort}>Disk</SortTh>
                <SortTh id="load" sort={sort} setSort={setSort} className="num">Load</SortTh>
                <SortTh id="net" sort={sort} setSort={setSort}>Network</SortTh>
                <SortTh id="os" sort={sort} setSort={setSort}>OS</SortTh>
                <SortTh id="uptime" sort={sort} setSort={setSort}>Uptime</SortTh>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {visible.map((n) => {
                const m = n.online ? n.latest : null;
                return (
                  <tr key={n.id} className={n.online ? '' : 'is-offline'}>
                    <td className="check"><input type="checkbox" aria-label={`Select ${n.hostname}`} checked={selected.has(n.id)} onChange={() => toggle(n.id)} /></td>
                    <td>
                      <div className="node-cell">
                        <StatusDot online={n.online} />
                        <div>
                          <Link to={`/app/nodes/${n.id}`}><strong>{n.hostname}</strong></Link>
                          <div className="muted small">{n.ip ?? '—'} · {n.cores} cores</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      {n.alerts.critical > 0 && <span className="badge critical">{n.alerts.critical}</span>}{' '}
                      {n.alerts.warning > 0 && <span className="badge warning">{n.alerts.warning}</span>}
                      {!n.alerts.critical && !n.alerts.warning && <span className="muted">—</span>}
                    </td>
                    <td className="meter-cell">{m ? <CellMeter value={m.cpu} /> : <span className="muted">—</span>}</td>
                    <td className="meter-cell">{m ? <CellMeter value={memPct(m)} /> : <span className="muted">—</span>}</td>
                    <td className="meter-cell">{m ? <CellMeter value={m.disk_pct} /> : <span className="muted">—</span>}</td>
                    <td className="num">{m ? num(m.load1) : '—'}</td>
                    <td className="small">{m ? <>↓ {rate(m.net_rx)}<br />↑ {rate(m.net_tx)}</> : '—'}</td>
                    <td className="small">{n.os}<div className="muted">{n.arch} · agent v{n.agentVersion}</div></td>
                    <td className="small">{n.online ? duration(nowSec() - n.bootTime) : <span className="muted">seen {ago(n.lastSeen)}</span>}</td>
                    <td>
                      {isAdmin && !n.connected && (
                        <button type="button" className="icon-button" title="Delete offline node" aria-label={`Delete ${n.hostname}`} onClick={() => deleteNode(n)}>
                          <Icon name="trash" size={15} />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!visible.length && <p className="muted pad">No nodes match the filters.</p>}
        </div>
      )}

      {dialog === 'edit' && <GroupDialog group={group} onClose={() => setDialog(null)} />}
      {dialog === 'create' && <GroupDialog initialNodeIds={[...selected]} onClose={() => setDialog(null)} onSaved={() => setSelected(new Set())} />}
    </>
  );
}
