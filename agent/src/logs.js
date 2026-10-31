// Log collection: follows the systemd journal (via `journalctl -o json -f`)
// and tails plain log files, batching lines to the server once a second.
import { spawn } from 'node:child_process';
import { closeSync, openSync, readSync, statSync } from 'node:fs';
import { basename } from 'node:path';
import { createInterface } from 'node:readline';

const MAX_RATE = 300; // lines per second per agent; the rest are counted and dropped
const MAX_QUEUE = 5000; // lines kept while disconnected
const MAX_LINE = 8000;
const READ_CHUNK = 1024 * 1024;

// Syslog priority guessed from a plain-text line.
function guessPriority(line) {
  if (/\b(emerg|panic)\b/i.test(line)) return 0;
  if (/\b(crit|critical|fatal)\b/i.test(line)) return 2;
  if (/\b(err|error|exception|fail(ed|ure)?)\b/i.test(line)) return 3;
  if (/\bwarn(ing)?\b/i.test(line)) return 4;
  if (/\bnotice\b/i.test(line)) return 5;
  if (/\b(debug|trace)\b/i.test(line)) return 7;
  return 6;
}

function journalMessage(m) {
  if (Array.isArray(m)) return Buffer.from(m).toString('utf8'); // binary-safe journal field
  return m == null ? '' : String(m);
}

export function createLogCollector({ send, log, files = [], journal = true }) {
  const queue = [];
  let dropped = 0;
  let windowStart = 0;
  let windowCount = 0;
  let stopping = false;
  let journalProc = null;
  const timers = [];

  function push(entry) {
    const now = Date.now();
    if (now - windowStart >= 1000) {
      windowStart = now;
      windowCount = 0;
    }
    if (++windowCount > MAX_RATE) {
      dropped++;
      return;
    }
    entry.message = entry.message.slice(0, MAX_LINE);
    queue.push(entry);
    if (queue.length > MAX_QUEUE) queue.shift();
  }

  function flush() {
    if (dropped) {
      queue.push({ ts: Date.now(), priority: 4, source: 'agent', service: 'netnew-agent', message: `Dropped ${dropped} log lines (limit ${MAX_RATE}/s)` });
      dropped = 0;
    }
    while (queue.length) {
      const batch = queue.slice(0, 1000);
      if (!send({ type: 'logs', entries: batch })) return; // keep them until we reconnect
      queue.splice(0, batch.length);
    }
  }

  // ---------------------------------------------------------- systemd journal
  let journalBackoff = 5000;
  function startJournal() {
    if (stopping) return;
    journalProc = spawn('journalctl', ['-o', 'json', '-f', '-n', '0', '--no-pager'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let started = Date.now();
    let stderr = '';
    journalProc.on('error', (err) => {
      if (err.code === 'ENOENT') log('journalctl not found; journal logs disabled');
      else log('journalctl failed:', err.message);
      journalProc = null;
    });
    journalProc.stderr.on('data', (d) => { stderr = (stderr + d).slice(-500); });
    createInterface({ input: journalProc.stdout }).on('line', (line) => {
      let e;
      try { e = JSON.parse(line); } catch { return; }
      push({
        ts: Math.floor(Number(e.__REALTIME_TIMESTAMP) / 1000) || Date.now(),
        priority: e.PRIORITY != null ? Number(e.PRIORITY) : 6,
        source: 'journal',
        service: e._SYSTEMD_UNIT || e.SYSLOG_IDENTIFIER || e._COMM || 'journal',
        message: journalMessage(e.MESSAGE),
      });
    });
    journalProc.on('close', (code) => {
      journalProc = null;
      if (stopping || code == null) return;
      // Exited straight away: no journal on this machine, or no permission.
      if (Date.now() - started < 2000) {
        log(`journalctl exited (${code})${stderr ? `: ${stderr.trim().split('\n').pop()}` : ''}; retrying in ${journalBackoff / 1000}s`);
        journalBackoff = Math.min(journalBackoff * 2, 5 * 60_000);
      } else {
        journalBackoff = 5000;
      }
      setTimeout(startJournal, journalBackoff);
    });
  }

  // ---------------------------------------------------------- plain files
  // Starts at the end of each file, follows appends, and reopens on rotation
  // (inode change) or truncation.
  function tailFile(path) {
    const state = { pos: null, ino: null, rest: '' };
    const service = basename(path);
    return () => {
      let st;
      try { st = statSync(path); } catch { state.pos = null; return; }
      if (state.pos == null) { state.pos = st.size; state.ino = st.ino; return; }
      if (st.ino !== state.ino || st.size < state.pos) { state.pos = 0; state.ino = st.ino; state.rest = ''; }
      if (st.size === state.pos) return;
      const length = Math.min(READ_CHUNK, st.size - state.pos);
      const buf = Buffer.alloc(length);
      let fd;
      try {
        fd = openSync(path, 'r');
        readSync(fd, buf, 0, length, state.pos);
      } catch (err) {
        log(`reading ${path} failed: ${err.message}`);
        return;
      } finally {
        if (fd != null) closeSync(fd);
      }
      state.pos += length;
      const lines = (state.rest + buf.toString('utf8')).split('\n');
      state.rest = lines.pop();
      for (const line of lines) {
        if (line.trim()) push({ ts: Date.now(), priority: guessPriority(line), source: 'file', service, message: line });
      }
    };
  }

  return {
    start() {
      if (journal) startJournal();
      const tails = files.map(tailFile);
      for (const t of tails) t(); // remember the current end of each file
      timers.push(setInterval(() => tails.forEach((t) => t()), 1000));
      timers.push(setInterval(flush, 1000));
      if (files.length) log(`tailing ${files.length} log file(s): ${files.join(', ')}`);
    },
    stop() {
      stopping = true;
      timers.forEach(clearInterval);
      journalProc?.kill();
    },
  };
}
