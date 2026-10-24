import { NavLink, Outlet, useParams } from 'react-router-dom';
import { useRoom } from '../state/space.jsx';
import { Empty, Loading } from './Bits.jsx';
import Icon from './Icon.jsx';
import TimePicker from './TimePicker.jsx';

export const ROOM_TABS = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'nodes', label: 'Nodes', icon: 'nodes' },
  { id: 'metrics', label: 'Metrics', icon: 'metrics' },
  { id: 'top', label: 'Top', icon: 'top' },
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

export default function RoomLayout() {
  const { roomId } = useParams();
  const { room, loading, nodes, alerts } = useRoom(roomId);

  if (loading) return <div className="page"><Loading /></div>;
  if (!room) {
    return (
      <div className="page">
        <Empty icon="room" title="Room not found" action={<NavLink className="button primary" to="/rooms/all/home">Go to All nodes</NavLink>}>
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
        title={room.name}
        subtitle={`${live} of ${nodes.length} nodes live${room.description ? ` · ${room.description}` : ''}`}
        tabs={(
          <nav className="tabs" aria-label="Room views">
            {ROOM_TABS.map((t) => (
              <NavLink key={t.id} to={`/rooms/${room.id}/${t.id}`} className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}>
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
        <Outlet context={{ room, nodes, alerts }} />
      </div>
    </>
  );
}
