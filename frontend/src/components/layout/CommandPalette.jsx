import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useScopedPath, withScope } from '../../lib/scope.js';
import { useWorkspace } from '../../state/workspace.jsx';
import Icon from '../ui/Icon.jsx';
import { NAV_ITEMS } from './nav.js';

const EXTRA = [
  { id: 'connect', label: 'Connect a server', icon: 'plug', path: '/app/connect', kind: 'Action' },
  { id: 'settings', label: 'Settings', icon: 'settings', path: '/app/settings', kind: 'Page' },
  { id: 'notifications', label: 'Alert notifications', icon: 'alerts', path: '/app/settings/notifications', kind: 'Settings' },
  { id: 'users', label: 'Users', icon: 'user', path: '/app/settings/users', kind: 'Settings' },
  { id: 'groups', label: 'Groups', icon: 'group', path: '/app/settings/groups', kind: 'Settings' },
];

/** ⌘K / Ctrl+K: jump to any page, node or group. */
export default function CommandPalette({ open, onClose }) {
  const navigate = useNavigate();
  const scoped = useScopedPath();
  const { nodes, groups } = useWorkspace();
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const listRef = useRef(null);

  useEffect(() => {
    if (open) { setQuery(''); setIndex(0); }
  }, [open]);

  const results = useMemo(() => {
    const all = [
      ...NAV_ITEMS.map((i) => ({ key: `p-${i.id}`, label: i.label, icon: i.icon, kind: 'Page', hint: i.description, path: scoped(`/app/${i.id}`) })),
      ...EXTRA.map((i) => ({ key: `x-${i.id}`, ...i })),
      ...(nodes ?? []).map((n) => ({ key: `n-${n.id}`, label: n.hostname, icon: 'nodes', kind: 'Node', hint: n.online ? n.os : 'offline', path: `/app/nodes/${n.id}` })),
      ...(groups ?? []).map((g) => ({ key: `g-${g.id}`, label: g.name, icon: 'group', kind: 'Group', hint: `Show ${g.nodeIds.length} nodes`, path: withScope('/app/overview', g.id) })),
    ];
    const q = query.trim().toLowerCase();
    if (!q) return all.filter((r) => r.kind === 'Page' || r.kind === 'Action').slice(0, 14);
    return all
      .map((r) => {
        const label = r.label.toLowerCase();
        const score = label.startsWith(q) ? 0 : label.includes(q) ? 1 : `${r.kind} ${r.hint ?? ''}`.toLowerCase().includes(q) ? 2 : -1;
        return { r, score };
      })
      .filter((x) => x.score >= 0)
      .sort((a, b) => a.score - b.score)
      .slice(0, 14)
      .map((x) => x.r);
  }, [query, nodes, groups, scoped]);

  useEffect(() => setIndex(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  if (!open) return null;

  const go = (r) => {
    onClose();
    if (r) navigate(r.path);
  };
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setIndex((i) => Math.min(i + 1, results.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setIndex((i) => Math.max(i - 1, 0)); }
    if (e.key === 'Enter') { e.preventDefault(); go(results[index]); }
    if (e.key === 'Escape') onClose();
  };

  return createPortal(
    <div className="modal-backdrop palette-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Search">
        <label className="palette-input">
          <Icon name="search" size={18} />
          <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onKey}
            placeholder="Search pages, nodes and groups…" aria-label="Search pages, nodes and groups"
            role="combobox" aria-expanded="true" aria-controls="palette-list" />
          <kbd>Esc</kbd>
        </label>
        <div className="palette-list" id="palette-list" role="listbox" ref={listRef}>
          {results.map((r, i) => (
            <button key={r.key} type="button" role="option" aria-selected={i === index}
              className={`palette-item ${i === index ? 'active' : ''}`}
              onMouseEnter={() => setIndex(i)} onClick={() => go(r)}>
              <span className="palette-icon"><Icon name={r.icon} size={16} /></span>
              <span className="palette-label truncate">{r.label}</span>
              {r.hint && <span className="muted small truncate palette-hint">{r.hint}</span>}
              <span className="palette-kind">{r.kind}</span>
            </button>
          ))}
          {!results.length && <p className="muted pad">Nothing matches “{query}”.</p>}
        </div>
      </div>
    </div>,
    document.body,
  );
}
