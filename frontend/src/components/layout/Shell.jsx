import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useMatch } from 'react-router-dom';
import { useLiveStatus } from '../../lib/api.js';
import { useAuth } from '../../state/auth.jsx';
import { useWorkspace } from '../../state/workspace.jsx';
import { useTheme } from '../../state/theme.jsx';
import { Dropdown } from '../ui/Bits.jsx';
import Icon, { Logo } from '../ui/Icon.jsx';
import IntegrationsModal, { useIntegrations } from '../IntegrationsModal.jsx';
import GroupDialog from '../GroupDialog.jsx';

const REPO_URL = 'https://github.com/rajkumar-madhu/netnew';

function UserMenu() {
  const auth = useAuth();
  const user = auth.user;
  const initials = user.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  return (
    <Dropdown className="user-menu" label={<span className="user-avatar" title={user.name}>{initials}</span>}>
      <div className="user-card">
        <strong>{user.name}</strong>
        <span className="muted small">{user.email}</span>{' '}
        <span className="role-badge">{user.role}</span>
      </div>
      <Link className="menu-item" to="/app/settings/account"><span className="menu-check"><Icon name="user" size={14} /></span>Account</Link>
      <button type="button" className="menu-item" onClick={() => auth.logout()}>
        <span className="menu-check"><Icon name="logout" size={14} /></span>Sign out
      </button>
    </Dropdown>
  );
}

function IconBar() {
  const { workspace } = useWorkspace();
  const { theme, toggle } = useTheme();
  const integrations = useIntegrations();
  const initial = (workspace?.name ?? 'S').trim().charAt(0).toUpperCase();

  return (
    <nav className="iconbar" aria-label="Workspace">
      <Link to="/app" className="iconbar-logo" aria-label="NetNew home"><Logo size={30} /></Link>
      <Link to="/app/groups/all/home" className="workspace-avatar" title={workspace?.name}>{initial}</Link>
      <div className="iconbar-spacer" />
      <button type="button" className="iconbar-btn" title="Integrations" aria-label="Integrations" onClick={() => integrations.show()}>
        <Icon name="puzzle" size={20} />
      </button>
      <button type="button" className="iconbar-btn" title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
        aria-label="Toggle theme" onClick={toggle}>
        <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={20} />
      </button>
      <NavLink to="/app/settings" className="iconbar-btn" title="Workspace settings" aria-label="Workspace settings">
        <Icon name="settings" size={20} />
      </NavLink>
      <a className="iconbar-btn" href={REPO_URL} target="_blank" rel="noreferrer" title="Source code" aria-label="Source code">
        <Icon name="github" size={20} />
      </a>
      <UserMenu />
    </nav>
  );
}

function Sidebar({ onNavigate }) {
  const { isAdmin } = useAuth();
  const { workspace, groups, nodes, alerts } = useWorkspace();
  // The shell sits above the group routes, so read the group/tab from the URL.
  const match = useMatch('/app/groups/:groupId/:tab');
  const { groupId, tab } = match?.params ?? {};
  const integrations = useIntegrations();
  const [creating, setCreating] = useState(false);
  const live = useLiveStatus();
  const online = (nodes ?? []).filter((n) => n.online).length;

  return (
    <aside className="sidebar">
      <div className="workspace-head">
        <div>
          <div className="workspace-name">{workspace?.name ?? 'Workspace'}</div>
          <div className="muted small">
            <span className={`live-dot ${live ? 'on' : ''}`} /> {online} of {nodes?.length ?? 0} nodes live
          </div>
        </div>
        <Link to="/app/settings" className="icon-button" aria-label="Workspace settings" onClick={onNavigate}>
          <Icon name="settings" size={16} />
        </Link>
      </div>

      <div className="side-section">
        <div className="side-heading">
          <span>Groups</span>
          {isAdmin && (
            <button type="button" className="icon-button" aria-label="Create group" title="Create group" onClick={() => setCreating(true)}>
              <Icon name="plus" size={16} />
            </button>
          )}
        </div>
        {(groups ?? []).map((group) => {
          const ids = new Set(group.nodeIds);
          const groupAlerts = alerts.filter((a) => ids.has(a.node_id));
          const critical = groupAlerts.some((a) => a.severity === 'critical');
          return (
            <NavLink key={group.id} to={`/app/groups/${group.id}/${groupId ? tab ?? 'home' : 'home'}`} onClick={onNavigate}
              className={({ isActive }) => `group-link ${isActive || group.id === groupId ? 'active' : ''}`}>
              <Icon name={group.builtin ? 'nodes' : 'group'} size={15} />
              <span className="truncate">{group.name}</span>
              {groupAlerts.length > 0 && <span className={`alert-pip ${critical ? 'critical' : 'warning'}`} title={`${groupAlerts.length} active alerts`} />}
              <span className="count">{group.nodeIds.length}</span>
            </NavLink>
          );
        })}
      </div>

      <div className="side-foot">
        <button type="button" className="primary block" onClick={() => { integrations.show('deploy.servers'); onNavigate?.(); }}>
          <Icon name="plug" size={16} /> Connect nodes
        </button>
        <button type="button" className="ghost block" onClick={() => { integrations.show('notify.alerts'); onNavigate?.(); }}>
          <Icon name="puzzle" size={16} /> Integrations
        </button>
      </div>
      {creating && <GroupDialog onClose={() => setCreating(false)} />}
    </aside>
  );
}

export default function Shell() {
  const [navOpen, setNavOpen] = useState(false);
  const location = useLocation();
  const integrations = useIntegrations();
  const { workspace } = useWorkspace();

  useEffect(() => setNavOpen(false), [location.pathname]);

  return (
    <div className={`app ${navOpen ? 'nav-open' : ''}`}>
      <div className="mobile-bar">
        <button type="button" className="icon-button" aria-label="Open navigation" onClick={() => setNavOpen(true)}>
          <Icon name="menu" />
        </button>
        <Logo size={24} />
        <strong>{workspace?.name ?? 'NetNew'}</strong>
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
