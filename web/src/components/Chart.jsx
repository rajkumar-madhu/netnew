import { useEffect, useRef } from 'react';
import uPlot from 'uplot';

export const PALETTE = ['#00ab44', '#3f8fe0', '#f5a623', '#e0567a', '#9b6cf0', '#2bc0c9', '#c7d23b', '#ff7f50'];

const AXIS = '#8f959e';
const GRID = 'rgba(255,255,255,0.06)';

// Size the y axis to fit its widest label (pattern from the uPlot demos).
function axisSize(u, values, axisIdx, cycleNum) {
  const axis = u.axes[axisIdx];
  if (cycleNum > 1) return axis._size;
  let size = axis.ticks.size + axis.gap;
  const longest = (values ?? []).reduce((a, v) => (v.length > a.length ? v : a), '');
  if (longest) {
    u.ctx.font = axis.font[0];
    size += u.ctx.measureText(longest).width / devicePixelRatio;
  }
  return Math.ceil(size);
}

// When the cursor isn't over the chart, the legend shows each series' latest value.
function latest(u, seriesIdx) {
  const col = u.data[seriesIdx];
  for (let i = col.length - 1; i >= 0; i--) if (col[i] != null) return col[i];
  return null;
}

function withAlpha(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/**
 * Time-series chart. `data` is uPlot's column format: [timestamps, ...series],
 * timestamps in unix seconds. Charts sharing a `syncKey` share the hover cursor.
 */
export default function Chart({
  title, subtitle, data, series, format = (v) => String(v), percent = false,
  height = 180, syncKey = 'netnew', fill = true,
}) {
  const el = useRef(null);
  const plot = useRef(null);
  const dataRef = useRef(data);
  dataRef.current = data;
  const seriesKey = JSON.stringify(series.map((s) => [s.label, s.color]));

  useEffect(() => {
    const target = el.current;
    const fmt = (v) => (v == null ? '–' : format(v));
    const opts = {
      width: target.clientWidth,
      height,
      cursor: { sync: { key: syncKey }, points: { size: 6 } },
      legend: { live: true },
      scales: {
        x: { time: true },
        y: { range: percent ? [0, 100] : (u, min, max) => [0, max > 0 ? max * 1.15 : 1] },
      },
      axes: [
        { stroke: AXIS, grid: { stroke: GRID }, ticks: { stroke: GRID } },
        {
          stroke: AXIS,
          grid: { stroke: GRID },
          ticks: { stroke: GRID },
          size: axisSize,
          values: (u, vals) => vals.map(fmt),
        },
      ],
      series: [
        {
          value: (u, v, s, idx) => {
            const t = idx == null ? latest(u, 0) : v;
            return t == null ? '–' : new Date(t * 1000).toLocaleTimeString();
          },
        },
        ...series.map((s, i) => {
          const color = s.color || PALETTE[i % PALETTE.length];
          return {
            label: s.label,
            stroke: color,
            width: 1.5,
            fill: fill && i === 0 ? withAlpha(color, 0.12) : undefined,
            spanGaps: false,
            points: { show: false },
            value: (u, v, s, idx) => fmt(idx == null ? latest(u, s) : v),
          };
        }),
      ],
    };
    plot.current = new uPlot(opts, dataRef.current, target);

    const ro = new ResizeObserver(() => {
      plot.current?.setSize({ width: target.clientWidth, height });
    });
    ro.observe(target);
    return () => {
      ro.disconnect();
      plot.current.destroy();
      plot.current = null;
    };
    // format/percent are stable per chart; rebuild only when the series change.
  }, [seriesKey, height, syncKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const u = plot.current;
    if (!u) return;
    u.setData(data);
    if (u.cursor.idx == null) u.setLegend({ idx: null });
  }, [data]);

  return (
    <section className="panel chart">
      <header className="chart-head">
        <h3>{title}</h3>
        {subtitle && <span className="muted">{subtitle}</span>}
      </header>
      <div ref={el} className="chart-body" />
    </section>
  );
}
