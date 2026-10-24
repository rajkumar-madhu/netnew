import { pct } from '../format.js';

export function StatusDot({ online }) {
  return <span className={`status-dot ${online ? 'online' : 'offline'}`} title={online ? 'Online' : 'Offline'} />;
}

export function Meter({ label, value, detail }) {
  const level = value >= 95 ? 'crit' : value >= 80 ? 'warn' : 'ok';
  return (
    <div className="meter">
      <div className="meter-label">
        <span>{label}</span>
        <span>{detail ?? pct(value)}</span>
      </div>
      <div className="meter-track">
        <div className={`meter-fill ${level}`} style={{ width: `${Math.min(100, Math.max(0, value ?? 0))}%` }} />
      </div>
    </div>
  );
}

export function Severity({ severity, cleared }) {
  if (cleared) return <span className="badge clear">cleared</span>;
  return <span className={`badge ${severity}`}>{severity}</span>;
}

export function Stat({ label, value, sub, tone }) {
  return (
    <div className={`panel stat ${tone ?? ''}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}
