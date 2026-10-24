import { useMemo } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { qs, usePolling } from '../api.js';
import { Empty, Loading, Stat } from '../components/Bits.jsx';
import Chart from '../components/Chart.jsx';
import { ago, bytes, formatterFor, num, pct, rate } from '../format.js';
import { useTime } from '../state/time.jsx';

function heat(rate) {
  if (!rate) return undefined;
  const alpha = Math.min(0.85, 0.15 + Math.log10(1 + rate * 10) / 2.5);
  return { background: `rgba(255, 77, 79, ${alpha})` };
}

function valueText(a) {
  if (a.units === 'bytes/s') return rate(a.value);
  if (a.units === '%') return pct(a.value);
  if (a.units === 'bytes') return bytes(a.value);
  return num(a.value);
}

export default function Anomalies() {
  const { room } = useOutletContext();
  const time = useTime();
  const { data, error } = usePolling(`/anomalies${qs({ room: room.id, points: 200, ...time.query })}`, time.live ? 15_000 : 0);
  const chartData = useMemo(() => [data?.timeline.ts ?? [], data?.timeline.rate ?? []], [data]);
  const format = useMemo(() => formatterFor('%'), []);

  if (error && !data) return <p className="error">{error.message}</p>;
  if (!data) return <Loading />;

  const totalSeconds = data.nodes.reduce((a, n) => a + n.seconds, 0) * data.metrics.length;
  const totalAnomalies = data.nodes.reduce((a, n) => a + n.count, 0);
  const affected = data.nodes.filter((n) => n.count > 0).length;

  return (
    <div className="anomalies">
      <p className="muted">
        Each node's CPU, RAM, load, network and disk metrics are compared every second against a learned baseline
        (a rolling mean and deviation over the last ~10 minutes). Values far outside it are flagged as anomalous.
        The <em>anomaly rate</em> is the share of collected seconds that were flagged.
      </p>
      <div className="stats">
        <Stat label="Anomaly rate" value={pct(totalSeconds ? (totalAnomalies / totalSeconds) * 100 : 0, 2)} sub="of metric-seconds in range"
          tone={totalAnomalies ? 'warn' : 'ok'} />
        <Stat label="Anomalous samples" value={totalAnomalies} sub="in the selected range" />
        <Stat label="Nodes affected" value={`${affected} / ${data.nodes.length}`} />
      </div>

      <section className="panel net-chart">
        <header className="chart-head"><div className="chart-title"><h3>Anomaly rate over time</h3><span className="muted small">% of metrics flagged per interval</span></div></header>
        {data.timeline.ts.length
          ? <Chart data={chartData} series={[{ label: 'Anomaly rate', color: '#ff4d4f' }]} format={format} type="area" height={170}
            onZoom={(a, b) => time.setFixed(a, b)} />
          : <div className="chart-empty muted" style={{ height: 120 }}>No anomalies detected in this time range</div>}
      </section>

      <h2>Anomaly rate by node and metric</h2>
      <div className="table-wrap">
        <table className="data-table heat-table">
          <thead>
            <tr>
              <th>Node</th>
              <th className="num">Overall</th>
              {data.metrics.map((m) => <th key={m.id} className="num">{m.name}</th>)}
            </tr>
          </thead>
          <tbody>
            {data.nodes.map((n) => (
              <tr key={n.id}>
                <td><Link to={`/nodes/${n.id}`}>{n.hostname ?? n.id}</Link></td>
                <td className="num heat" style={heat(n.rate)}>{pct(n.rate, 2)}</td>
                {data.metrics.map((m) => {
                  const cell = n.metrics[m.id];
                  return (
                    <td key={m.id} className="num heat" style={heat(cell?.rate)} title={cell ? `${cell.count} anomalous seconds, last ${ago(cell.lastTs)}` : 'none'}>
                      {cell ? pct(cell.rate, 2) : <span className="muted">0</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Recent anomalies</h2>
      {data.recent.length ? (
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>When</th><th>Node</th><th>Metric</th><th className="num">Value</th><th className="num">Deviation</th></tr></thead>
            <tbody>
              {data.recent.map((a) => (
                <tr key={`${a.node_id}-${a.metric}-${a.ts}`}>
                  <td>{ago(a.ts)}</td>
                  <td><Link to={`/nodes/${a.node_id}`}>{a.hostname}</Link></td>
                  <td>{a.name}</td>
                  <td className="num">{valueText(a)}</td>
                  <td className="num">{a.score != null ? `${a.score}σ` : 'new'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <Empty icon="anomalies" title="Nothing unusual">No anomalies in the selected time range.</Empty>}
    </div>
  );
}
