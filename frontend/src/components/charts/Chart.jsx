import { useEffect, useMemo, useRef } from 'react';
import uPlot from 'uplot';
import { cssVar, useTheme } from '../../state/theme.jsx';

export const PALETTE = [
  '#6366f1', '#22c55e', '#f59e0b', '#ec4899', '#06b6d4', '#a855f7',
  '#84cc16', '#f97316', '#3b82f6', '#14b8a6', '#e11d48', '#eab308',
];

// Size the y axis to fit its widest label (pattern from the uPlot demos).
function axisSize(u, values, axisIdx, cycleNum) {
  const axis = u.axes[axisIdx];
  if (cycleNum > 1) return axis._size;
  let size = axis.ticks.size + axis.gap;
  if (values?.length) {
    u.ctx.font = axis.font[0];
    size += Math.max(...values.map((v) => u.ctx.measureText(v).width)) / devicePixelRatio;
  }
  return Math.ceil(size);
}

function lastIndex(col) {
  for (let i = col.length - 1; i >= 0; i--) if (col[i] != null) return i;
  return -1;
}

function withAlpha(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${alpha})`;
}

// Cumulative sums for a stacked chart. Nulls stay null so gaps still show.
function stack(data) {
  const acc = new Array(data[0].length).fill(0);
  const stacked = [data[0]];
  for (let s = 1; s < data.length; s++) {
    stacked.push(data[s].map((v, i) => (v == null ? null : (acc[i] += v))));
  }
  return stacked;
}

/**
 * Time-series chart. `data` is uPlot's column format: [timestamps, ...series]
 * with timestamps in unix seconds. Charts sharing a `syncKey` share the hover
 * cursor; dragging across a chart calls onZoom(after, before). `minSpan` is
 * the narrowest time axis, in seconds (used while following live data).
 */
export default function Chart({
  data, series, format = (v) => String(v), type = 'line', percent = false,
  height = 200, syncKey = 'netnew', onZoom, legend = true, minSpan = 0,
}) {
  const { theme } = useTheme();
  const el = useRef(null);
  const plot = useRef(null);
  const raw = useRef(data);
  raw.current = data;
  const zoom = useRef(onZoom);
  zoom.current = onZoom;
  const fmt = useRef(format);
  fmt.current = format;
  const minSpanRef = useRef(minSpan);
  minSpanRef.current = minSpan;

  const stacked = type === 'stacked';
  const plotted = useMemo(() => (stacked ? stack(data) : data), [data, stacked]);
  const plottedRef = useRef(plotted);
  plottedRef.current = plotted;
  const seriesKey = JSON.stringify(series.map((s) => [s.label, s.color]));

  useEffect(() => {
    const target = el.current;
    const axis = cssVar('--chart-axis');
    const grid = cssVar('--chart-grid');
    const show = (v) => (v == null ? '–' : fmt.current(v));
    // Legend shows the hovered value, or the latest one when not hovering.
    const legendValue = (u, v, s, idx) => {
      const col = raw.current[s];
      const i = idx ?? lastIndex(col);
      return i < 0 ? '–' : show(col[i]);
    };

    const opts = {
      width: target.clientWidth,
      height,
      cursor: {
        sync: { key: syncKey },
        points: { size: 6 },
        drag: { x: true, y: false, setScale: false },
      },
      select: { show: true },
      legend: { show: legend, live: true },
      scales: {
        // While live, a brand-new node's point or two are shown in a window
        // of at least `minSpan` seconds. In any mode a single point gets a
        // small window: uPlot would pad it by 86400/ms, which for timestamps
        // in seconds is about three years.
        x: {
          time: true,
          range: (u, min, max) => {
            const xs = u.data[0];
            if (!xs?.length) return [min, max];
            const first = xs[0];
            const last = xs[xs.length - 1];
            if (last - first < minSpanRef.current) return [last - minSpanRef.current, last];
            if (first === last) return [last - 5, last + 5];
            return [min, max];
          },
        },
        y: { range: percent && stacked ? [0, 100] : percent ? (u, min, max) => [0, Math.max(100, max)] : (u, min, max) => [Math.min(0, min), max > 0 ? max * 1.1 : 1] },
      },
      axes: [
        { stroke: axis, grid: { stroke: grid, width: 1 }, ticks: { stroke: grid, width: 1 } },
        { stroke: axis, grid: { stroke: grid, width: 1 }, ticks: { stroke: grid, width: 1 }, size: axisSize, values: (u, vals) => vals.map(show) },
      ],
      series: [
        {
          value: (u, v, s, idx) => {
            const i = idx ?? lastIndex(raw.current[0]);
            return i < 0 ? '–' : new Date(raw.current[0][i] * 1000).toLocaleTimeString();
          },
        },
        ...series.map((s, i) => {
          const color = s.color || PALETTE[i % PALETTE.length];
          const filled = stacked || (type === 'area');
          return {
            label: s.label,
            stroke: color,
            width: stacked ? 1 : 1.5,
            fill: filled ? withAlpha(color, stacked ? 0.55 : 0.15) : undefined,
            spanGaps: false,
            // Dots only while there are too few points to draw a line.
            points: { show: (u, si, i0, i1) => i1 - i0 < 2 },
            value: legendValue,
          };
        }),
      ],
      // Each stacked layer fills down to the one below it.
      bands: stacked ? series.slice(1).map((s, i) => ({ series: [i + 2, i + 1] })) : undefined,
      hooks: {
        setSelect: [(u) => {
          if (u.select.width > 8 && zoom.current) {
            const after = u.posToVal(u.select.left, 'x');
            const before = u.posToVal(u.select.left + u.select.width, 'x');
            zoom.current(after, before);
          }
          u.setSelect({ left: 0, top: 0, width: 0, height: 0 }, false);
        }],
      },
    };
    plot.current = new uPlot(opts, plottedRef.current, target);

    const ro = new ResizeObserver(() => {
      if (target.clientWidth > 0) plot.current?.setSize({ width: target.clientWidth, height });
    });
    ro.observe(target);
    return () => {
      ro.disconnect();
      plot.current.destroy();
      plot.current = null;
    };
  }, [seriesKey, height, syncKey, theme, type, percent, legend]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const u = plot.current;
    if (!u) return;
    u.setData(plotted);
    if (u.cursor.idx == null) u.setLegend({ idx: null });
  }, [plotted]);

  return <div ref={el} className="chart-body" />;
}
