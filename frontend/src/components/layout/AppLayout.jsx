import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useLiveStatus } from '../../lib/api.js';
import { ALL_GROUP, useScopeId, useScopedPath } from '../../lib/scope.js';
import { useAuth } from '../../state/auth.jsx';
import { useTheme } from '../../state/theme.jsx';
import { useGroup, useWorkspace } from '../../state/workspace.jsx';
import { Dropdown, Empty, Loading } from '../ui/Bits.jsx';
import Icon, { Logo } from '../ui/Icon.jsx';
import CommandPalette from './CommandPalette.jsx';
import { NAV, NAV_ITEMS } from './nav.js';
import ScopeSwitcher from './ScopeSwitcher.jsx';
import TimeRange from './TimeRange.jsx';

export function PageHeader({ title, description, children, kicker }) {
  return (
    <header className="page-header">
      <div className="page-heading">
        {kicker && <div className="page-kicker">{kicker}</div>}
        <h1>{title}</h1>
        {description && <p className="page-description">{description}</p>}
      </div>
      {children && <div className="page-actions">{children}</div>}
    </header>
  );
}

function UserMenu() {
  const auth = useAuth();
  const { theme, toggle } = useTheme();
  const user = auth.user;
  const initials = user.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  return (
    <Dropdown className="user-menu" align="right" chevron={false} ariaLabel="Account menu"
      label={<span className="user-avatar" title={user.name}>{initials}</span>}>
      <div className="user-card">
        <strong>{user.name}</strong>
        <span className="muted small">{user.email}</span>{' '}
        <span className="role-badge">{user.role}</span>
      </div>
      <Link className="menu-item" to="/app/settings/account"><span className="menu-check"><Icon name="user" size={14} /></span>Account</Link>
      <button type="button" className="menu-item" onClick={toggle}>
        <span className="menu-check"><Icon name={theme === 'dark' ? 'sun' : 'moon'} size={14} /></span>
        {theme === 'dark' ? 'Light theme' : 'Dark theme'}
      </button>
      <div className="menu-divider" />
      <button type="button" className="menu-item" onClick={() => auth.logout()}>
        <span className="menu-check"><Icon name="logout" size={14} /></span>Sign out
      </button>
    </Dropdown>
  );
}

function Sidebar({ group, alerts }) {
  const { workspace, nodes } = useWorkspace();
  const scoped = useScopedPath();
  const live = useLiveStatus();
  const online = (nodes ?? []).filter((n) => n.online).length;
  const critical = alerts.some((a) => a.severity === 'critical');

  return (
    <aside className="sidebar" aria-label="Main navigation">
      <Link to={scoped('/app/overview')} className="brand">
        <Logo size={28} />
        <span className="brand-text">
          <span className="brand-name">NetNew</span>
          <span className="brand-workspace truncate">{workspace?.name ?? 'Workspace'}</span>
        </span>
      </Link>

      <nav className="nav">
        {NAV.map((section) => (
          <div key={section.section ?? 'top'} className="nav-section">
            {section.section && <div className="nav-heading">{section.section}</div>}
            {section.items.map((item) => (
              <NavLink key={item.id} to={scoped(`/app/${item.id}`)} className="nav-link">
                <Icon name={item.icon} size={17} />
                <span>{item.label}</span>
                {item.id === 'alerts' && alerts.length > 0 && (
                  <span className={`nav-count ${critical ? 'critical' : 'warning'}`}>{alerts.length}</span>
                )}
                {item.id === 'nodes' && group && <span className="nav-meta">{group.nodeIds.length}</span>}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      <div className="nav-foot">
        <NavLink to="/app/connect" className="connect-link">
          <Icon name="plug" size={16} /> Connect a server
        </NavLink>
        <NavLink to="/app/settings" className="nav-link">
          <Icon name="settings" size={17} /> <span>Settings</span>
        </NavLink>
        <div className="nav-status" title={live ? 'Receiving live updates' : 'Reconnecting to live updates…'}>
          <span className={`live-dot ${live ? 'on' : ''}`} /> {online} of {nodes?.length ?? 0} nodes reporting
        </div>
      </div>
    </aside>
  );
}

function TopBar({ onMenu, onSearch }) {
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
  return (
    <div className="topbar">
      <button type="button" className="icon-button menu-button" aria-label="Open navigation" onClick={onMenu}>
        <Icon name="menu" />
      </button>
      <ScopeSwitcher />
      <button type="button" className="search-trigger" onClick={onSearch} aria-label="Search">
        <Icon name="search" size={15} /> <span className="search-label">Search</span>
        <kbd>{isMac ? '⌘' : 'Ctrl'} K</kbd>
      </button>
      <div className="topbar-spacer" />
      <TimeRange />
      <UserMenu />
    </div>
  );
}

/**
 * The signed-in app frame: navigation on the left, the top bar with the group
 * scope, search and time range, and the page. Pages listed in the navigation
 * get their title from it and read `{ group, nodes, alerts }` for the current
 * scope with useOutletContext().
 */
export default function AppLayout() {
  const scopeId = useScopeId();
  const { groups, error, reload } = useWorkspace();
  const known = !groups || groups.some((g) => g.id === scopeId);
  const scope = useGroup(known ? scopeId : ALL_GROUP);
  const { pathname } = useLocation();
  const [navOpen, setNavOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => setNavOpen(false), [pathname]);
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const page = NAV_ITEMS.find((i) => pathname === `/app/${i.id}`);
  const live = scope.nodes.filter((n) => n.online).length;

  return (
    <div className={`app ${navOpen ? 'nav-open' : ''}`}>
      <Sidebar group={scope.group} alerts={scope.alerts} />
      <div className="nav-scrim" onClick={() => setNavOpen(false)} />
      <div className="main">
        <TopBar onMenu={() => setNavOpen(true)} onSearch={() => setPaletteOpen(true)} />
        <main className="content">
          {scope.loading && error ? (
            <Empty icon="info" title="Couldn't load your workspace"
              action={<button type="button" className="primary" onClick={reload}>Try again</button>}>
              {error.message}
            </Empty>
          ) : scope.loading ? <Loading /> : (
            <>
              {page && (
                <PageHeader title={page.label} description={page.description}
                  kicker={<><span className={`scope-dot ${live ? 'on' : ''}`} />{scope.group.name} · {live} of {scope.nodes.length} nodes live</>} />
              )}
              <Outlet context={scope} />
            </>
          )}
        </main>
      </div>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}
