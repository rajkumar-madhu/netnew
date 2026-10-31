import { Link, NavLink, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { Empty, Loading, Meter, Severity, StatusDot } from '../../components/ui/Bits.jsx';
import Icon from '../../components/ui/Icon.jsx';
import MetricsBoard from '../../components/charts/MetricsBoard.jsx';
import ProcessTable from '../../components/ProcessTable.jsx';
import { PageHeader } from '../../components/layout/GroupLayout.jsx';
import TimePicker from '../../components/layout/TimePicker.jsx';
import { ContainersView } from './Containers.jsx';
import { LogExplorer } from './Logs.jsx';
import { ServicesView } from './Services.jsx';
import { ago, bytes, dateTime, duration, nowSec, pct } from '../../lib/format.js';
import { useWorkspace } from '../../state/workspace.jsx';
import { useAuth } from '../../state/auth.jsx';

const TABS = [
  { id: 'metrics', label: 'Metrics', icon: 'metrics' },
  { id: 'logs', label: 'Logs', icon: 'logs' },
  { id: 'containers', label: 'Containers', icon: 'container' },
  { id: 'services', label: 'Services', icon: 'services' },
  { id: 'processes', label: 'Processes', icon: 'top' },
  { id: 'alerts', label: 'Alerts', icon: 'alerts' },
  { id: 'info', label: 'Info', icon: 'info' },
];

function InfoRow({ label, children }) {
  return (
    <div className="info-row">
      <span className="muted">{label}</span>
      <span>{children ?? '–'}</span>
    </div>
  );
}

export default function NodeView() {
  const { nodeId, tab = 'metrics' } = useParams();
  const navigate = useNavigate();
  const { nodes, groups, alerts } = useWorkspace();
  const { isAdmin } = useAuth();

  if (!nodes) return <div className="page"><Loading /></div>;
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) {
    return (
      <div className="page">
        <Empty icon="nodes" title="Node not found" action={<Link className="button primary" to="/app/groups/all/nodes">All nodes</Link>}>
          It may have been deleted.
        </Empty>
      </div>
    );
  }

  const nodeAlerts = alerts.filter((a) => a.node_id === nodeId);
  const memberOf = (groups ?? []).filter((r) => !r.builtin && r.nodeIds.includes(nodeId));

  async function remove() {
    if (!window.confirm(`Delete ${node.hostname} and all of its data? This can't be undone.`)) return;
    try {
      await api(`/nodes/${nodeId}`, { method: 'DELETE' });
      navigate('/app/groups/all/nodes');
    } catch (err) {
      window.alert(err.message);
    }
  }

  return (
    <>
      <PageHeader
        title={<><StatusDot online={node.online} /> {node.hostname}</>}
        subtitle={node.online ? `${node.os} · ${node.arch} · up ${duration(nowSec() - node.bootTime)}` : `offline · last seen ${ago(node.lastSeen)}`}
        tabs={(
          <nav className="tabs" aria-label="Node views">
            <Link to="/app/groups/all/nodes" className="tab back"><Icon name="back" size={15} /> Nodes</Link>
            {TABS.map((t) => (
              <NavLink key={t.id} to={`/app/nodes/${nodeId}/${t.id}`} className={() => `tab ${tab === t.id ? 'active' : ''}`}>
                <Icon name={t.icon} size={15} /> {t.label}
                {t.id === 'alerts' && nodeAlerts.length > 0 && <span className="tab-count warning">{nodeAlerts.length}</span>}
              </NavLink>
            ))}
          </nav>
        )}>
        <TimePicker />
      </PageHeader>

      <div className="page">
        {nodeAlerts.length > 0 && tab !== 'alerts' && (
          <div className="panel alert-strip">
            {nodeAlerts.map((a) => (
              <div key={a.id}><Severity severity={a.severity} /> <strong>{a.name}</strong> <span className="muted">{a.message} · {ago(a.started_at)}</span></div>
            ))}
          </div>
        )}

        {tab === 'metrics' && <MetricsBoard nodes={[node]} filterNodes={false} />}
        {tab === 'logs' && <LogExplorer groupId="all" nodes={[node]} single />}
        {tab === 'containers' && <ContainersView groupId="all" nodes={[node]} single />}
        {tab === 'services' && <ServicesView groupId="all" nodes={[node]} single />}

        {tab === 'processes' && (node.online
          ? <ProcessTable nodeId={nodeId} />
          : <Empty icon="top" title="Node is offline">Processes are shown live, so the node must be connected.</Empty>)}

        {tab === 'alerts' && (nodeAlerts.length ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Status</th><th>Alert</th><th>Details</th><th>Triggered</th></tr></thead>
              <tbody>
                {nodeAlerts.map((a) => (
                  <tr key={a.id}>
                    <td><Severity severity={a.severity} /></td>
                    <td><strong>{a.name}</strong></td>
                    <td className="muted wrap">{a.message}</td>
                    <td title={dateTime(a.started_at)}>{ago(a.started_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty icon="check" title="No active alerts on this node" />)}

        {tab === 'info' && (
          <div className="grid-2">
            <section className="panel">
              <h3>System</h3>
              <InfoRow label="Hostname">{node.hostname}</InfoRow>
              <InfoRow label="Operating system">{node.os}</InfoRow>
              <InfoRow label="Kernel">{node.kernel}</InfoRow>
              <InfoRow label="Architecture">{node.arch}</InfoRow>
              <InfoRow label="CPU">{node.cpuModel}</InfoRow>
              <InfoRow label="Cores">{node.cores}</InfoRow>
              <InfoRow label="Memory">{bytes(node.memTotal)}</InfoRow>
              <InfoRow label="IP address">{node.ip}</InfoRow>
              <InfoRow label="Booted">{node.bootTime ? dateTime(node.bootTime) : '–'}</InfoRow>
              <InfoRow label="Agent version">{node.agentVersion}</InfoRow>
              <InfoRow label="First seen">{dateTime(node.firstSeen)}</InfoRow>
              <InfoRow label="Groups">{memberOf.length ? memberOf.map((r) => r.name).join(', ') : 'All nodes only'}</InfoRow>
              <InfoRow label="Node ID"><code>{node.id}</code></InfoRow>
            </section>
            <section className="panel">
              <h3>Filesystems</h3>
              {!node.fs.length && <p className="muted">No filesystems reported.</p>}
              {node.fs.map((f) => (
                <Meter key={f.mount} label={<><code>{f.mount}</code> <span className="muted">{f.type}</span></>}
                  value={f.pct} detail={`${bytes(f.used)} / ${bytes(f.size)} · ${pct(f.pct, 0)}`} />
              ))}
              {isAdmin && !node.connected && (
                <div className="danger-zone">
                  <h3>Danger zone</h3>
                  <p className="muted small">This node's agent is not connected. Deleting it removes its metrics, alerts and group memberships.</p>
                  <button type="button" className="danger" onClick={remove}><Icon name="trash" size={15} /> Delete node</button>
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </>
  );
}
