import { NavLink, Outlet, useParams } from 'react-router-dom';
import { useGroup } from '../../state/workspace.jsx';
import { Empty, Loading } from '../ui/Bits.jsx';
import Icon from '../ui/Icon.jsx';
import TimePicker from './TimePicker.jsx';

export const GROUP_TABS = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'nodes', label: 'Nodes', icon: 'nodes' },
  { id: 'metrics', label: 'Metrics', icon: 'metrics' },
  { id: 'dashboards', label: 'Dashboards', icon: 'dashboard' },
  { id: 'logs', label: 'Logs', icon: 'logs' },
  { id: 'containers', label: 'Containers', icon: 'container' },
  { id: 'services', label: 'Services', icon: 'services' },
  { id: 'processes', label: 'Processes', icon: 'top' },
  { id: 'events', label: 'Events', icon: 'events' },
  { id: 'alerts', label: 'Alerts', icon: 'alerts' },
  { id: 'anomalies', label: 'Anomalies', icon: 'anomalies' },
];

export function PageHeader({ title, subtitle, children, tabs }) {
  return (
    <header className="page-header">
      <div className="page-title-row">
        <div className="page-title">
          <h1>{title}</h1>
          {subtitle && <span className="muted">{subtitle}</span>}
        </div>
        <div className="page-actions">{children}</div>
      </div>
      {tabs}
    </header>
  );
}

export default function GroupLayout() {
  const { groupId } = useParams();
  const { group, loading, nodes, alerts } = useGroup(groupId);

  if (loading) return <div className="page"><Loading /></div>;
  if (!group) {
    return (
      <div className="page">
        <Empty icon="group" title="Group not found" action={<NavLink className="button primary" to="/app/groups/all/home">Go to All nodes</NavLink>}>
          It may have been deleted.
        </Empty>
      </div>
    );
  }

  const live = nodes.filter((n) => n.online).length;
  const critical = alerts.filter((a) => a.severity === 'critical').length;

  return (
    <>
      <PageHeader
        title={group.name}
        subtitle={`${live} of ${nodes.length} nodes live${group.description ? ` · ${group.description}` : ''}`}
        tabs={(
          <nav className="tabs" aria-label="Group views">
            {GROUP_TABS.map((t) => (
              <NavLink key={t.id} to={`/app/groups/${group.id}/${t.id}`} className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}>
                <Icon name={t.icon} size={15} /> {t.label}
                {t.id === 'alerts' && alerts.length > 0 && (
                  <span className={`tab-count ${critical ? 'critical' : 'warning'}`}>{alerts.length}</span>
                )}
              </NavLink>
            ))}
          </nav>
        )}>
        <TimePicker />
      </PageHeader>
      <div className="page">
        <Outlet context={{ group, nodes, alerts }} />
      </div>
    </>
  );
}
