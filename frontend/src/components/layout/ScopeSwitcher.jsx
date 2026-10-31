import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ALL_GROUP, useScopeId, withScope } from '../../lib/scope.js';
import { useAuth } from '../../state/auth.jsx';
import { useWorkspace } from '../../state/workspace.jsx';
import GroupDialog from '../GroupDialog.jsx';
import { Dropdown } from '../ui/Bits.jsx';
import Icon from '../ui/Icon.jsx';

// Pages that show one thing rather than a scope go back to their list when
// the scope changes.
function scopedPathname(pathname) {
  const m = pathname.match(/^\/app\/(dashboards|nodes)\/[^/]+/);
  if (m) return `/app/${m[1]}`;
  if (/^\/app\/(settings|connect)/.test(pathname)) return '/app/overview';
  return pathname;
}

/** Chooses the group of nodes every page is scoped to. */
export default function ScopeSwitcher() {
  const { groups, alerts } = useWorkspace();
  const { isAdmin } = useAuth();
  const scopeId = useScopeId();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [creating, setCreating] = useState(false);
  const current = groups?.find((g) => g.id === scopeId) ?? groups?.find((g) => g.id === ALL_GROUP);

  const choose = (id) => navigate(withScope(scopedPathname(pathname), id));

  return (
    <>
      <Dropdown className="scope-switcher" ariaLabel="Choose group" chevron={false} label={(
        <>
          <span className="scope-icon"><Icon name="group" size={15} /></span>
          <span className="scope-text">
            <span className="scope-kicker">Group</span>
            <span className="scope-name truncate">{current?.name ?? 'All nodes'}</span>
          </span>
          <Icon name="updown" size={14} />
        </>
      )}>
        <div className="menu-heading">Show data from</div>
        {(groups ?? []).map((g) => {
          const ids = new Set(g.nodeIds);
          const groupAlerts = alerts.filter((a) => ids.has(a.node_id));
          const critical = groupAlerts.some((a) => a.severity === 'critical');
          return (
            <button key={g.id} type="button" role="menuitemradio" aria-checked={g.id === current?.id}
              className={`menu-item scope-option ${g.id === current?.id ? 'active' : ''}`} onClick={() => choose(g.id)}>
              <span className="menu-check">{g.id === current?.id && <Icon name="check" size={14} />}</span>
              <span className="truncate">{g.name}</span>
              {groupAlerts.length > 0 && <span className={`alert-pip ${critical ? 'critical' : 'warning'}`} title={`${groupAlerts.length} active alerts`} />}
              <span className="count">{g.nodeIds.length}</span>
            </button>
          );
        })}
        <div className="menu-divider" />
        {isAdmin && (
          <button type="button" className="menu-item" onClick={() => setCreating(true)}>
            <span className="menu-check"><Icon name="plus" size={14} /></span>New group
          </button>
        )}
        <Link className="menu-item" to="/app/settings/groups">
          <span className="menu-check"><Icon name="settings" size={14} /></span>Manage groups
        </Link>
      </Dropdown>
      {creating && <GroupDialog onClose={() => setCreating(false)} onSaved={(g) => g && choose(g.id)} />}
    </>
  );
}
