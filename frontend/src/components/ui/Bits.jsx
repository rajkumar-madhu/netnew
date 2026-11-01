import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { pct } from '../../lib/format.js';
import Icon from './Icon.jsx';

export function StatusDot({ online, label }) {
  return (
    <span className={`status-dot ${online ? 'online' : 'offline'}`} title={label ?? (online ? 'Live' : 'Offline')} />
  );
}

export function Meter({ label, value, detail, compact, neutral }) {
  const level = neutral ? 'neutral' : value >= 95 ? 'crit' : value >= 80 ? 'warn' : 'ok';
  return (
    <div className={`meter ${compact ? 'compact' : ''}`}>
      {label != null && (
        <div className="meter-label">
          <span>{label}</span>
          <span>{detail ?? pct(value)}</span>
        </div>
      )}
      <div className="meter-track">
        <div className={`meter-fill ${level}`} style={{ width: `${Math.min(100, Math.max(0, value ?? 0))}%` }} />
      </div>
    </div>
  );
}

// A circular gauge for a percentage, coloured by how full it is.
export function Ring({ value, label, size = 76 }) {
  const r = 30;
  const c = 2 * Math.PI * r;
  const v = value == null ? null : Math.min(100, Math.max(0, value));
  const level = v == null ? 'none' : v >= 95 ? 'crit' : v >= 80 ? 'warn' : 'ok';
  return (
    <div className={`ring ${level}`} role="img" aria-label={`${label}: ${v == null ? 'no data' : pct(v)}`}>
      <svg viewBox="0 0 76 76" width={size} height={size} aria-hidden="true">
        <circle cx="38" cy="38" r={r} className="ring-track" />
        {v != null && (
          <circle cx="38" cy="38" r={r} className="ring-fill" strokeDasharray={`${(v / 100) * c} ${c}`} transform="rotate(-90 38 38)" />
        )}
      </svg>
      <div className="ring-text">
        <strong>{v == null ? '–' : `${Math.round(v)}%`}</strong>
        <span>{label}</span>
      </div>
    </div>
  );
}

// A table cell meter: value text plus a thin bar.
export function CellMeter({ value, text }) {
  return (
    <div className="cell-meter">
      <span>{text ?? pct(value)}</span>
      <Meter value={value} compact />
    </div>
  );
}

export function Severity({ severity, cleared }) {
  if (cleared) return <span className="badge clear">cleared</span>;
  return <span className={`badge ${severity}`}>{severity}</span>;
}

export function Stat({ label, value, sub, tone, children }) {
  return (
    <div className={`panel stat ${tone ?? ''}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
      {children}
    </div>
  );
}

export function Empty({ icon = 'info', title, children, action }) {
  return (
    <div className="empty">
      <Icon name={icon} size={28} />
      <h3>{title}</h3>
      {children && <p className="muted">{children}</p>}
      {action}
    </div>
  );
}

export function Loading({ label = 'Loading…' }) {
  return <div className="loading"><span className="spinner" /> {label}</div>;
}

export function SearchInput({ value, onChange, placeholder = 'Search' }) {
  return (
    <label className="search">
      <Icon name="search" size={15} />
      <input type="search" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

const ITEMS = '[role="menuitem"], [role="menuitemradio"]';

// Small dropdown. By default it is a menu (WAI-ARIA menu button pattern:
// arrow keys, Home/End and Escape); with `keepOpen` it is a small dialog
// whose contents stay open while used (a search box and checkboxes).
// `ariaLabel` names a trigger that has no text.
export function Dropdown({ label, children, align = 'left', className = '', keepOpen = false, ariaLabel, chevron = true }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const trigger = useRef(null);
  const focusFirst = useRef(false);
  const isMenu = !keepOpen;

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => {
      if (e.key !== 'Escape') return;
      const inside = ref.current?.contains(document.activeElement);
      setOpen(false);
      if (inside) trigger.current?.focus();
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  // Opening from the keyboard moves focus into the menu.
  useEffect(() => {
    if (open && focusFirst.current) {
      focusFirst.current = false;
      ref.current?.querySelector(isMenu ? ITEMS : 'input, button')?.focus();
    }
  }, [open, isMenu]);

  const onTriggerKey = (e) => {
    if (isMenu && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      focusFirst.current = true;
      if (open) ref.current?.querySelector(ITEMS)?.focus(); else setOpen(true);
    }
  };
  const onTriggerClick = (e) => {
    // A click from the keyboard (Enter/Space has detail 0) also moves focus in.
    if (!open && e.detail === 0) focusFirst.current = true;
    setOpen((o) => !o);
  };

  const onMenuKey = (e) => {
    if (!isMenu) return;
    const items = [...ref.current.querySelectorAll(ITEMS)];
    const i = items.indexOf(document.activeElement);
    const go = (n) => { e.preventDefault(); items[(n + items.length) % items.length]?.focus(); };
    if (e.key === 'ArrowDown') go(i + 1);
    else if (e.key === 'ArrowUp') go(i < 0 ? items.length - 1 : i - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(items.length - 1);
    else if (e.key === 'Tab') setOpen(false);
  };
  const onMenuClick = (e) => {
    if (keepOpen) return;
    const fromKeyboard = e.detail === 0 && e.target.closest?.(ITEMS);
    setOpen(false);
    if (fromKeyboard) trigger.current?.focus();
  };

  return (
    <div className={`dropdown ${className}`} ref={ref}>
      <button type="button" ref={trigger} className="dropdown-trigger" aria-expanded={open}
        aria-haspopup={isMenu ? 'menu' : 'dialog'} aria-label={ariaLabel}
        onClick={onTriggerClick} onKeyDown={onTriggerKey}>
        {label} {chevron && <Icon name="chevron" size={14} />}
      </button>
      {open && (
        <div className={`dropdown-menu ${align}`} role={isMenu ? 'menu' : 'dialog'} aria-label={ariaLabel}
          onKeyDown={onMenuKey} onClick={onMenuClick}>
          {children}
        </div>
      )}
    </div>
  );
}

// Menu contents. Items are buttons or links with menu roles; headings and
// dividers are announced as such rather than as stray text.
export function MenuItem({ active, onClick, children }) {
  return (
    <button type="button" role="menuitemradio" aria-checked={Boolean(active)} tabIndex={-1}
      className={`menu-item ${active ? 'active' : ''}`} onClick={onClick}>
      <span className="menu-check">{active && <Icon name="check" size={14} />}</span>
      {children}
    </button>
  );
}

export function MenuAction({ icon, onClick, children }) {
  return (
    <button type="button" role="menuitem" tabIndex={-1} className="menu-item plain" onClick={onClick}>
      <span className="menu-check">{icon && <Icon name={icon} size={14} />}</span>
      {children}
    </button>
  );
}

export function MenuLink({ icon, to, children }) {
  return (
    <Link role="menuitem" tabIndex={-1} className="menu-item plain" to={to}>
      <span className="menu-check">{icon && <Icon name={icon} size={14} />}</span>
      {children}
    </Link>
  );
}

export const MenuHeading = ({ children }) => <div className="menu-heading" role="presentation">{children}</div>;
export const MenuDivider = () => <div className="menu-divider" role="separator" />;

export function CopyButton({ text, label = 'Copy' }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };
  return (
    <button type="button" className="ghost small" onClick={copy}>
      <Icon name={copied ? 'check' : 'copy'} size={14} /> {copied ? 'Copied' : label}
    </button>
  );
}

// When set, code blocks show this agent token in place of the <TOKEN> placeholder.
export const AgentTokenContext = createContext(null);

export function CodeBlock({ title = 'bash', children }) {
  const token = useContext(AgentTokenContext);
  const text = token && typeof children === 'string' ? children.replaceAll('<TOKEN>', token) : children;
  return (
    <div className="code-block">
      <div className="code-head">
        <span>{title}</span>
        <CopyButton text={text} />
      </div>
      <pre><code>{text}</code></pre>
    </div>
  );
}

export function Modal({ title, onClose, children, wide, footer }) {
  useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', esc);
    document.body.classList.add('modal-open');
    return () => {
      document.removeEventListener('keydown', esc);
      document.body.classList.remove('modal-open');
    };
  }, [onClose]);

  // Rendered on <body> so no ancestor's stacking context can put it under the page.
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose}><Icon name="x" /></button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

// Click-to-sort table header cell.
export function SortTh({ id, sort, setSort, children, className = '' }) {
  const active = sort.key === id;
  return (
    <th className={`sortable ${className} ${active ? 'sorted' : ''}`}
      aria-sort={active ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
      <button type="button" onClick={() => setSort({ key: id, dir: active ? -sort.dir : -1 })}>
        {children}{active && <span className="sort-arrow">{sort.dir === 1 ? '▲' : '▼'}</span>}
      </button>
    </th>
  );
}

export function sortBy(list, sort, getters) {
  const get = getters[sort.key];
  if (!get) return list;
  return [...list].sort((a, b) => {
    const x = get(a);
    const y = get(b);
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    return (typeof x === 'string' ? x.localeCompare(y, undefined, { numeric: true }) : x - y) * sort.dir;
  });
}
