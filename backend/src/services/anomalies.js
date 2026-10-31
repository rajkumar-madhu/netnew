// Lightweight anomaly detection on each node's summary metrics. For every
// metric we track an exponentially weighted mean and variance (roughly the
// last 10 minutes). A sample is anomalous when it is more than Z_THRESHOLD
// standard deviations from that baseline *and* the absolute difference is
// large enough to matter, which filters out noise on near-constant series.
const ALPHA = 2 / (600 + 1);
const WARMUP = 120; // samples before a baseline is trusted
const Z_THRESHOLD = 4;

const memPct = (m) => (m.mem_total ? (m.mem_used / m.mem_total) * 100 : null);

export const ANOMALY_METRICS = {
  cpu: { name: 'CPU utilization', value: (m) => m.cpu, minDelta: 10, units: '%' },
  ram: { name: 'RAM usage', value: memPct, minDelta: 5, units: '%' },
  load: { name: 'Load average', value: (m) => m.load1, minDelta: 0.5, units: 'load' },
  net_in: { name: 'Network in', value: (m) => m.net_rx, minDelta: 64 * 1024, units: 'bytes/s' },
  net_out: { name: 'Network out', value: (m) => m.net_tx, minDelta: 64 * 1024, units: 'bytes/s' },
  disk_read: { name: 'Disk read', value: (m) => m.disk_read, minDelta: 1024 * 1024, units: 'bytes/s' },
  disk_write: { name: 'Disk write', value: (m) => m.disk_write, minDelta: 1024 * 1024, units: 'bytes/s' },
};

export function createAnomalyDetector(db) {
  const state = new Map(); // "node:metric" -> { mean, variance, n }

  return {
    observe(nodeId, ts, m) {
      for (const [metric, def] of Object.entries(ANOMALY_METRICS)) {
        const x = def.value(m);
        if (x == null || !Number.isFinite(x)) continue;

        const key = `${nodeId}:${metric}`;
        const s = state.get(key);
        if (!s) {
          state.set(key, { mean: x, variance: 0, n: 1 });
          continue;
        }

        const diff = x - s.mean;
        if (s.n >= WARMUP) {
          const std = Math.sqrt(s.variance);
          const z = std > 0 ? Math.abs(diff) / std : Infinity;
          if (z > Z_THRESHOLD && Math.abs(diff) > def.minDelta) {
            db.insertAnomaly(nodeId, metric, ts, x, Number.isFinite(z) ? Math.round(z * 10) / 10 : null);
          }
        }
        s.mean += ALPHA * diff;
        s.variance = (1 - ALPHA) * (s.variance + ALPHA * diff * diff);
        s.n++;
      }
    },

    forgetNode(nodeId) {
      for (const key of state.keys()) if (key.startsWith(`${nodeId}:`)) state.delete(key);
    },
  };
}
