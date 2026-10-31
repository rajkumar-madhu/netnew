// systemd service units: state of every service unit, every 30 seconds.
import { execFile } from 'node:child_process';

const INTERVAL_MS = 30_000;

function listUnits() {
  return new Promise((resolve, reject) => {
    execFile('systemctl', ['list-units', '--type=service', '--all', '--no-legend', '--no-pager', '--plain'],
      { timeout: 10_000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) return reject(new Error((stderr || err.message).trim().split('\n').pop()));
        const list = stdout.split('\n').map((line) => line.trim().replace(/^[●*]\s*/, '')).filter(Boolean).map((line) => {
          const [unit, load, active, sub, ...rest] = line.split(/\s+/);
          return { unit, load, active, sub, description: rest.join(' ') };
        }).filter((u) => u.unit?.endsWith('.service'));
        resolve(list);
      });
  });
}

export function createServiceCollector({ send, log }) {
  let charts = [];
  let timer = null;
  let disabled = false;
  let last = null;

  async function refresh() {
    try {
      const list = await listUnits();
      const counts = { active: 0, activating: 0, deactivating: 0, inactive: 0, failed: 0 };
      for (const u of list) counts[u.active in counts ? u.active : 'inactive']++;
      charts = [['systemd.units', '', counts]];
      last = { type: 'services', available: true, list };
      send(last);
    } catch (err) {
      // No systemd here (containers, macOS, Windows): report once and stop.
      log(`systemd units unavailable: ${err.message}`);
      disabled = true;
      clearInterval(timer);
      last = { type: 'services', available: false, error: err.message, list: [] };
      send(last);
    }
  }

  return {
    start() {
      if (process.platform !== 'linux') return;
      refresh();
      timer = setInterval(refresh, INTERVAL_MS);
    },
    resend() { if (last) send(last); },
    drainCharts() {
      const out = disabled ? [] : charts;
      charts = [];
      return out;
    },
    stop() { clearInterval(timer); },
  };
}
