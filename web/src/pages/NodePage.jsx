import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, useLive, usePolling } from '../api.js';
import { useRange } from '../App.jsx';
import { Meter, Severity, Stat, StatusDot } from '../components/Bits.jsx';
import Chart from '../components/Chart.jsx';
import { ago, bytes, duration, memPct, nowSec, num, pct, rate } from '../format.js';

const METRICS = [
  'cpu', 'cpu_user', 'cpu_system', 'mem_used', 'mem_cached', 'mem_total', 'swap_used',
  'load1', 'load5', 'load15', 'net_rx', 'net_tx', 'disk_read', 'disk_write', 'disk_pct',
];

// Short ranges are per-second, so live samples are appended as they arrive.
// Longer ranges are averaged server-side and simply refetched periodically.
const LIVE_APPEND_MAX = 900;

function appendSample(hist, ts, m, range) {
  if (!hist) return hist;
  const last = hist.ts.at(-1);
  if (last != null && ts <= last) return hist;

  const cutoff = ts - range;
  let start = 0;
  while (start < hist.ts.length && hist.ts[start] < cutoff) start++;

  const gap = last != null && ts - last > 5;
  const next = { ts: hist.ts.slice(start), s: {} };
  if (gap) next.ts.push(last + 1);
  next.ts.push(ts);
  for (const k of METRICS) {
    next.s[k] = hist.s[k].slice(start);
    if (gap) next.s[k].push(null);
    next.s[k].push(m[k] ?? null);
  }
  return next;
}

function InfoRow({ label, children }) {
  return (
    <div className="info-row">
      <span className="muted">{label}</span>
      <span>{children ?? '–'}</span>
    </div>
  );
}

export default function NodePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { range } = useRange();
  const [node, setNode] = useState(null);
  const [hist, setHist] = useState(null);
  const [error, setError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const alerts = usePolling('/alerts?state=active');
  const liveAppend = range <= LIVE_APPEND_MAX;

  useEffect(() => {
    setNode(null);
    setError(null);
    api(`/nodes/${id}`).then(setNode).catch(setError);
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    const load = () => api(`/nodes/${id}/metrics?after=-${range}&points=${LIVE_APPEND_MAX}`)
      .then((d) => !cancelled && setHist({ ts: d.ts, s: d.series }))
      .catch(() => {});
    load();
    const timer = liveAppend ? null : setInterval(load, 10_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [id, range, liveAppend, reloadKey]);

  useLive((msg) => {
    if (msg.type === 'sample' && msg.nodeId === id) {
      setNode((n) => n && { ...n, latest: { ts: msg.ts, ...msg.m } });
      if (liveAppend) setHist((h) => appendSample(h, msg.ts, msg.m, range));
    } else if (msg.type === 'node' && msg.node.id === id) {
      setNode(msg.node);
    } else if (msg.type === 'node_removed' && msg.id === id) {
      navigate('/');
    } else if (msg.type === 'alert' && msg.alert.node_id === id) {
      alerts.reload();
    } else if (msg.type === '_status' && msg.connected) {
      setReloadKey((k) => k + 1); // refill anything missed while disconnected
    }
  });

  const charts = useMemo(() => {
    if (!hist) return null;
    const cols = (...keys) => [hist.ts, ...keys.map((k) => hist.s[k])];
    return {
      cpu: cols('cpu', 'cpu_user', 'cpu_system'),
      load: cols('load1', 'load5', 'load15'),
      ram: cols('mem_used', 'mem_cached', 'swap_used'),
      net: cols('net_rx', 'net_tx'),
      io: cols('disk_read', 'disk_write'),
      disk: cols('disk_pct'),
    };
  }, [hist]);

  async function removeNode() {
    if (!window.confirm(`Remove ${node.hostname} and all of its metrics?`)) return;
    try {
      await api(`/nodes/${id}`, { method: 'DELETE' });
      navigate('/');
    } catch (err) {
      window.alert(err.message);
    }
  }

  if (error) return <p className="error">Could not load node: {error.message}. <Link to="/">Back to overview</Link></p>;
  if (!node) return <p className="muted">Loading…</p>;

  const m = node.latest;
  const nodeAlerts = (alerts.data ?? []).filter((a) => a.node_id === id);

  return (
    <>
      <div className="page-head">
        <h1><StatusDot online={node.online} /> {node.hostname}</h1>
        <span className="muted">{node.online ? 'online' : `offline · last seen ${ago(node.lastSeen)}`}</span>
        {!node.online && <button type="button" className="danger" onClick={removeNode}>Remove node</button>}
      </div>

      {nodeAlerts.length > 0 && (
        <div className="panel alert-strip">
          {nodeAlerts.map((a) => (
            <div key={a.id}><Severity severity={a.severity} /> <strong>{a.name}</strong> <span className="muted">{a.message} · {ago(a.started_at)}</span></div>
          ))}
        </div>
      )}

      <div className="stats">
        <Stat label="CPU" value={pct(m?.cpu)} sub={`${node.cores} cores`} />
        <Stat label="RAM" value={pct(memPct(m))} sub={`${bytes(m?.mem_used)} of ${bytes(node.memTotal)}`} />
        <Stat label="Load (1m)" value={num(m?.load1)} sub={`${num(m?.load5)} · ${num(m?.load15)}`} />
        <Stat label="Network" value={`↓ ${rate(m?.net_rx)}`} sub={`↑ ${rate(m?.net_tx)}`} />
        <Stat label="Disk I/O" value={`R ${rate(m?.disk_read)}`} sub={`W ${rate(m?.disk_write)}`} />
        <Stat label="Uptime" value={duration(nowSec() - node.bootTime)} />
      </div>

      {charts ? (
        <div className="charts two">
          <Chart title="CPU utilization" data={charts.cpu} percent format={(v) => pct(v, 0)}
            series={[{ label: 'Total' }, { label: 'User' }, { label: 'System' }]} />
          <Chart title="Load average" data={charts.load} format={(v) => v.toFixed(2)}
            series={[{ label: '1 min' }, { label: '5 min' }, { label: '15 min' }]} />
          <Chart title="Memory" subtitle={`of ${bytes(node.memTotal)}`} data={charts.ram} format={(v) => bytes(v, 1)}
            series={[{ label: 'Used' }, { label: 'Cache / buffers' }, { label: 'Swap' }]} />
          <Chart title="Network traffic" data={charts.net} format={rate}
            series={[{ label: 'In' }, { label: 'Out' }]} />
          <Chart title="Disk I/O" data={charts.io} format={rate}
            series={[{ label: 'Read' }, { label: 'Write' }]} />
          <Chart title="Disk space" subtitle="fullest filesystem" data={charts.disk} percent format={(v) => pct(v, 0)}
            series={[{ label: 'Used' }]} />
        </div>
      ) : <p className="muted">Loading charts…</p>}

      <div className="two-col">
        <section className="panel">
          <h3>System</h3>
          <InfoRow label="Operating system">{node.os}</InfoRow>
          <InfoRow label="Kernel">{node.kernel}</InfoRow>
          <InfoRow label="Architecture">{node.arch}</InfoRow>
          <InfoRow label="CPU">{node.cpuModel}</InfoRow>
          <InfoRow label="Cores">{node.cores}</InfoRow>
          <InfoRow label="Memory">{bytes(node.memTotal)}</InfoRow>
          <InfoRow label="IP address">{node.ip}</InfoRow>
          <InfoRow label="Agent version">{node.agentVersion}</InfoRow>
          <InfoRow label="First seen">{ago(node.firstSeen)}</InfoRow>
          <InfoRow label="Node ID"><code>{node.id}</code></InfoRow>
        </section>
        <section className="panel">
          <h3>Filesystems</h3>
          {node.fs.length === 0 && <p className="muted">No filesystems reported.</p>}
          {node.fs.map((f) => (
            <Meter key={f.mount} label={<><code>{f.mount}</code> <span className="muted">{f.type}</span></>}
              value={f.pct} detail={`${bytes(f.used)} / ${bytes(f.size)} · ${pct(f.pct, 0)}`} />
          ))}
        </section>
      </div>
    </>
  );
}
