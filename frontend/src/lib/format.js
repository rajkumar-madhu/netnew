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

// 1234 -> "1.23K"
export function compact(v) {
  if (v == null || !Number.isFinite(v)) return '–';
  const abs = Math.abs(v);
  if (abs >= 1e9) return `${(v / 1e9).toFixed(2)}G`;
  if (abs >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (abs >= 1e4) return `${(v / 1e3).toFixed(1)}K`;
  if (abs >= 100) return v.toFixed(0);
  if (abs >= 10) return v.toFixed(1);
  return v.toFixed(2);
}

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

// Formatter for a chart's units string (as defined by the server's chart catalog).
export function formatterFor(units) {
  switch (units) {
    case '%': return (v) => pct(v, v != null && Math.abs(v) < 10 ? 1 : 0);
    case 'bytes': return (v) => bytes(v);
    case 'bytes/s': return rate;
    case 'seconds': return duration;
    case 'load': return (v) => num(v);
    case '°C': return (v) => (v == null ? '–' : `${v.toFixed(1)} °C`);
    case 'ms': return (v) => (v == null ? '–' : v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${compact(v)} ms`);
    // Check status: 1 = up, 0 = down; in-between values are averages over a bucket.
    case 'up': return (v) => (v == null ? '–' : v === 1 ? 'up' : v === 0 ? 'down' : `${Math.round(v * 100)}% up`);
    default: return compact;
  }
}

export const nowSec = () => Math.floor(Date.now() / 1000);
export const ago = (ts) => (ts ? `${duration(nowSec() - ts)} ago` : '–');

export function dateTime(ts) {
  return ts ? new Date(ts * 1000).toLocaleString() : '–';
}

export function timeOnly(ts) {
  return ts ? new Date(ts * 1000).toLocaleTimeString() : '–';
}

export const memPct = (m) => (m?.mem_total ? (m.mem_used / m.mem_total) * 100 : null);

export function plural(n, word, pluralWord = `${word}s`) {
  return `${n} ${n === 1 ? word : pluralWord}`;
}
