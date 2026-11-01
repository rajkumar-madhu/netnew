import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ALL_GROUP, useScopeId, withScope } from '../../lib/scope.js';
import { useAuth } from '../../state/auth.jsx';
import { useWorkspace } from '../../state/workspace.jsx';
import GroupDialog from '../GroupDialog.jsx';
import { Dropdown, MenuAction, MenuDivider, MenuHeading, MenuLink } from '../ui/Bits.jsx';
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
        <MenuHeading>Show data from</MenuHeading>
        {(groups ?? []).map((g) => {
          const ids = new Set(g.nodeIds);
          const groupAlerts = alerts.filter((a) => ids.has(a.node_id));
          const critical = groupAlerts.some((a) => a.severity === 'critical');
          return (
            <button key={g.id} type="button" role="menuitemradio" aria-checked={g.id === current?.id} tabIndex={-1}
              className={`menu-item scope-option ${g.id === current?.id ? 'active' : ''}`} onClick={() => choose(g.id)}>
              <span className="menu-check">{g.id === current?.id && <Icon name="check" size={14} />}</span>
              <span className="truncate">{g.name}</span>
              {groupAlerts.length > 0 && <span className={`alert-pip ${critical ? 'critical' : 'warning'}`} title={`${groupAlerts.length} active alerts`} />}
              <span className="count">{g.nodeIds.length}</span>
            </button>
          );
        })}
        <MenuDivider />
        {isAdmin && <MenuAction icon="plus" onClick={() => setCreating(true)}>New group</MenuAction>}
        <MenuLink icon="settings" to="/app/settings/groups">Manage groups</MenuLink>
      </Dropdown>
      {creating && <GroupDialog onClose={() => setCreating(false)} onSaved={(g) => g && choose(g.id)} />}
    </>
  );
}
