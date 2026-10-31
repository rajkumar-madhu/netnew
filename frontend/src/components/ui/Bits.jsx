import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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

// Small dropdown menu used by chart toolbars and the time picker.
export function Dropdown({ label, children, align = 'left', className = '' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  return (
    <div className={`dropdown ${className}`} ref={ref}>
      <button type="button" className="dropdown-trigger" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {label} <Icon name="chevron" size={14} />
      </button>
      {open && (
        <div className={`dropdown-menu ${align}`} role="menu" onClick={() => setOpen(false)}>
          {children}
        </div>
      )}
    </div>
  );
}

export function MenuItem({ active, onClick, children }) {
  return (
    <button type="button" role="menuitemradio" aria-checked={Boolean(active)}
      className={`menu-item ${active ? 'active' : ''}`} onClick={onClick}>
      <span className="menu-check">{active && <Icon name="check" size={14} />}</span>
      {children}
    </button>
  );
}

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
