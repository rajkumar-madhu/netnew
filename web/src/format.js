const UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];

export function bytes(v, digits = 1) {
  if (v == null || !Number.isFinite(v)) return '–';
  let x = Math.abs(v);
  let i = 0;
  while (x >= 1024 && i < UNITS.length - 1) {
    x /= 1024;
    i++;
  }
  const fixed = x >= 100 || i === 0 ? 0 : digits;
  return `${v < 0 ? '-' : ''}${x.toFixed(fixed)} ${UNITS[i]}`;
}

export const rate = (v) => (v == null ? '–' : `${bytes(v)}/s`);
export const pct = (v, digits = 1) => (v == null || !Number.isFinite(v) ? '–' : `${v.toFixed(digits)}%`);
export const num = (v, digits = 2) => (v == null || !Number.isFinite(v) ? '–' : v.toFixed(digits));

export function duration(sec) {
  if (sec == null || !Number.isFinite(sec)) return '–';
  sec = Math.max(0, Math.floor(sec));
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s}s`;
  return `${s}s`;
}

export const nowSec = () => Math.floor(Date.now() / 1000);
export const ago = (ts) => (ts ? `${duration(nowSec() - ts)} ago` : '–');

export function dateTime(ts) {
  return ts ? new Date(ts * 1000).toLocaleString() : '–';
}

export const memPct = (m) => (m?.mem_total ? (m.mem_used / m.mem_total) * 100 : null);
