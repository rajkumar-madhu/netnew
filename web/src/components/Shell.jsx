import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useMatch } from 'react-router-dom';
import { useLiveStatus } from '../api.js';
import { useSpace } from '../state/space.jsx';
import { useTheme } from '../state/theme.jsx';
import Icon, { Logo } from './Icon.jsx';
import IntegrationsModal, { useIntegrations } from './IntegrationsModal.jsx';
import RoomDialog from './RoomDialog.jsx';

const REPO_URL = 'https://github.com/rajkumar-madhu/netnew';

function IconBar() {
  const { space } = useSpace();
  const { theme, toggle } = useTheme();
  const integrations = useIntegrations();
  const initial = (space?.name ?? 'S').trim().charAt(0).toUpperCase();

  return (
    <nav className="iconbar" aria-label="Space">
      <Link to="/" className="iconbar-logo" aria-label="NetNew home"><Logo size={30} /></Link>
      <Link to="/rooms/all/home" className="space-avatar" title={space?.name}>{initial}</Link>
      <div className="iconbar-spacer" />
      <button type="button" className="iconbar-btn" title="Integrations" aria-label="Integrations" onClick={() => integrations.show()}>
        <Icon name="puzzle" size={20} />
      </button>
      <button type="button" className="iconbar-btn" title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
        aria-label="Toggle theme" onClick={toggle}>
        <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={20} />
      </button>
      <NavLink to="/settings" className="iconbar-btn" title="Space settings" aria-label="Space settings">
        <Icon name="settings" size={20} />
      </NavLink>
      <a className="iconbar-btn" href={REPO_URL} target="_blank" rel="noreferrer" title="Source code" aria-label="Source code">
        <Icon name="github" size={20} />
      </a>
    </nav>
  );
}

function Sidebar({ onNavigate }) {
  const { space, rooms, nodes, alerts } = useSpace();
  // The shell sits above the room routes, so read the room/tab from the URL.
  const match = useMatch('/rooms/:roomId/:tab');
  const { roomId, tab } = match?.params ?? {};
  const integrations = useIntegrations();
  const [creating, setCreating] = useState(false);
  const live = useLiveStatus();
  const online = (nodes ?? []).filter((n) => n.online).length;

  return (
    <aside className="sidebar">
      <div className="space-head">
        <div>
          <div className="space-name">{space?.name ?? 'Space'}</div>
          <div className="muted small">
            <span className={`live-dot ${live ? 'on' : ''}`} /> {online} of {nodes?.length ?? 0} nodes live
          </div>
        </div>
        <Link to="/settings" className="icon-button" aria-label="Space settings" onClick={onNavigate}>
          <Icon name="settings" size={16} />
        </Link>
      </div>

      <div className="side-section">
        <div className="side-heading">
          <span>Rooms</span>
          <button type="button" className="icon-button" aria-label="Create room" title="Create room" onClick={() => setCreating(true)}>
            <Icon name="plus" size={16} />
          </button>
        </div>
        {(rooms ?? []).map((room) => {
          const ids = new Set(room.nodeIds);
          const roomAlerts = alerts.filter((a) => ids.has(a.node_id));
          const critical = roomAlerts.some((a) => a.severity === 'critical');
          return (
            <NavLink key={room.id} to={`/rooms/${room.id}/${roomId ? tab ?? 'home' : 'home'}`} onClick={onNavigate}
              className={({ isActive }) => `room-link ${isActive || room.id === roomId ? 'active' : ''}`}>
              <Icon name={room.builtin ? 'nodes' : 'room'} size={15} />
              <span className="truncate">{room.name}</span>
              {roomAlerts.length > 0 && <span className={`alert-pip ${critical ? 'critical' : 'warning'}`} title={`${roomAlerts.length} active alerts`} />}
              <span className="count">{room.nodeIds.length}</span>
            </NavLink>
          );
        })}
      </div>

      <div className="side-foot">
        <button type="button" className="primary block" onClick={() => { integrations.show('deploy.operating-systems'); onNavigate?.(); }}>
          <Icon name="plug" size={16} /> Connect nodes
        </button>
        <button type="button" className="ghost block" onClick={() => { integrations.show('notify.alerts'); onNavigate?.(); }}>
          <Icon name="puzzle" size={16} /> Integrations
        </button>
      </div>
      {creating && <RoomDialog onClose={() => setCreating(false)} />}
    </aside>
  );
}

export default function Shell() {
  const [navOpen, setNavOpen] = useState(false);
  const location = useLocation();
  const integrations = useIntegrations();
  const { space } = useSpace();

  useEffect(() => setNavOpen(false), [location.pathname]);

  return (
    <div className={`app ${navOpen ? 'nav-open' : ''}`}>
      <div className="mobile-bar">
        <button type="button" className="icon-button" aria-label="Open navigation" onClick={() => setNavOpen(true)}>
          <Icon name="menu" />
        </button>
        <Logo size={24} />
        <strong>{space?.name ?? 'NetNew'}</strong>
      </div>
      <div className="nav-panels">
        <IconBar />
        <Sidebar onNavigate={() => setNavOpen(false)} />
      </div>
      <div className="nav-scrim" onClick={() => setNavOpen(false)} />
      <main className="main">
        <Outlet />
      </main>
      {integrations.open && <IntegrationsModal />}
    </div>
  );
}
