// Threshold alerts evaluated on every incoming sample. Each rule averages its
// value over `window` seconds; an alert clears only once the average drops
// HYSTERESIS points below the threshold, so it doesn't flap on the boundary.
export const RULES = [
  {
    id: 'cpu_usage',
    name: 'CPU utilization',
    window: 60,
    warn: 80,
    crit: 95,
    value: (m) => m.cpu,
  },
  {
    id: 'ram_usage',
    name: 'RAM usage',
    window: 60,
    warn: 85,
    crit: 95,
    value: (m) => (m.mem_total ? (m.mem_used / m.mem_total) * 100 : null),
  },
  {
    id: 'disk_space',
    name: 'Disk space usage',
    window: 10,
    warn: 85,
    crit: 95,
    value: (m) => m.disk_pct,
  },
];

const HYSTERESIS = 5;
const OFFLINE_RULE = { id: 'node_offline', name: 'Node offline' };

export const RULE_NAMES = Object.fromEntries(
  [...RULES, OFFLINE_RULE].map((r) => [r.id, r.name]),
);

// Rule definitions as shown on the Alerts tab's configuration view.
export function describeRules(offlineAfterSec) {
  return [
    ...RULES.map(({ id, name, window, warn, crit }) => ({
      id, name, window, warn, crit, units: '%', hysteresis: HYSTERESIS,
      description: `${window}s average; warning at ${warn}%, critical at ${crit}%. Clears ${HYSTERESIS} points below the threshold.`,
    })),
    {
      ...OFFLINE_RULE,
      window: offlineAfterSec,
      warn: null,
      crit: null,
      units: 's',
      description: `Critical when a node sends no data for ${offlineAfterSec}s.`,
    },
  ];
}

function level(avg, rule, current) {
  const critAt = current === 'critical' ? rule.crit - HYSTERESIS : rule.crit;
  const warnAt = current !== 'clear' ? rule.warn - HYSTERESIS : rule.warn;
  if (avg >= critAt) return 'critical';
  if (avg >= warnAt) return 'warning';
  return 'clear';
}

// onChange(kind, alert, previous) with kind 'raised' | 'changed' | 'cleared'.
export function createAlertEngine(db, onChange) {
  const windows = new Map(); // "node:rule" -> [{ ts, v }]
  const active = new Map(db.activeAlerts().map((a) => [`${a.node_id}:${a.rule}`, a]));

  function transition(nodeId, rule, severity, value, message, ts) {
    const key = `${nodeId}:${rule.id}`;
    const current = active.get(key);
    if ((current?.severity ?? 'clear') === severity) return;

    const previous = current ? { ...current, cleared_at: ts } : null;
    if (current) {
      db.clearAlert(current.id, ts);
      active.delete(key);
    }
    if (severity === 'clear') {
      onChange('cleared', previous, null);
      return;
    }
    const alert = db.openAlert({ node_id: nodeId, rule: rule.id, severity, value, message, started_at: ts });
    active.set(key, alert);
    onChange(previous ? 'changed' : 'raised', alert, previous);
  }

  return {
    onSample(nodeId, ts, m) {
      for (const rule of RULES) {
        const v = rule.value(m);
        if (v == null || !Number.isFinite(v)) continue;

        const key = `${nodeId}:${rule.id}`;
        const win = windows.get(key) ?? [];
        win.push({ ts, v });
        while (win.length && win[0].ts <= ts - rule.window) win.shift();
        windows.set(key, win);

        const avg = win.reduce((sum, p) => sum + p.v, 0) / win.length;
        const severity = level(avg, rule, active.get(key)?.severity ?? 'clear');
        const message = `${rule.name} is ${avg.toFixed(1)}% (${rule.window}s average)`;
        transition(nodeId, rule, severity, Math.round(avg * 10) / 10, message, ts);
      }
    },

    setOnline(nodeId, online, ts) {
      transition(nodeId, OFFLINE_RULE, online ? 'clear' : 'critical', null,
        online ? '' : 'Node stopped sending metrics', ts);
    },

    forgetNode(nodeId) {
      for (const key of [...windows.keys(), ...active.keys()]) {
        if (key.startsWith(`${nodeId}:`)) {
          windows.delete(key);
          active.delete(key);
        }
      }
    },

    countsFor(nodeId) {
      const counts = { warning: 0, critical: 0 };
      for (const [key, a] of active) if (key.startsWith(`${nodeId}:`)) counts[a.severity]++;
      return counts;
    },
  };
}
