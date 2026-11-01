import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useSearchParams } from 'react-router-dom';
import { useLiveStatus } from '../../lib/api.js';
import { ALL_GROUP, useScopeId, useScopedPath } from '../../lib/scope.js';
import { useAuth } from '../../state/auth.jsx';
import { useTheme } from '../../state/theme.jsx';
import { useGroup, useWorkspace } from '../../state/workspace.jsx';
import { Dropdown, Empty, Loading, MenuAction, MenuDivider, MenuLink } from '../ui/Bits.jsx';
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
      <div className="user-card" role="presentation">
        <strong>{user.name}</strong>
        <span className="muted small">{user.email}</span>{' '}
        <span className="role-badge">{user.role}</span>
      </div>
      <MenuLink icon="user" to="/app/settings/account">Account</MenuLink>
      <MenuAction icon={theme === 'dark' ? 'sun' : 'moon'} onClick={toggle}>{theme === 'dark' ? 'Light theme' : 'Dark theme'}</MenuAction>
      <MenuDivider />
      <MenuAction icon="logout" onClick={() => auth.logout()}>Sign out</MenuAction>
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

  // A link to a group that no longer exists (or never did) shows All nodes;
  // drop the bad ?group= so every link on the page stops carrying it.
  const [, setParams] = useSearchParams();
  useEffect(() => {
    if (!known) setParams((p) => { p.delete('group'); return p; }, { replace: true });
  }, [known, setParams]);
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
