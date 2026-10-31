import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { nowSec } from '../lib/format.js';

// The global time window: either "live" (the last N seconds,
// moving) or a fixed [after, before] window, set by pausing or by dragging
// across a chart to zoom.
export const PRESETS = [
  { label: '5m', seconds: 300 },
  { label: '15m', seconds: 900 },
  { label: '30m', seconds: 1800 },
  { label: '1h', seconds: 3600 },
  { label: '6h', seconds: 21600 },
  { label: '12h', seconds: 43200 },
  { label: '24h', seconds: 86400 },
];

const TimeContext = createContext(null);
export const useTime = () => useContext(TimeContext);

function storedDuration() {
  try {
    const v = Number(localStorage.getItem('netnew.duration'));
    if (PRESETS.some((p) => p.seconds === v)) return v;
  } catch {}
  return 900;
}

export function TimeProvider({ children }) {
  const [window, setWindow] = useState(() => ({ live: true, duration: storedDuration() }));
  const [tick, setTick] = useState(0);

  // A 1s heartbeat that live charts use to decide when to refresh.
  useEffect(() => {
    if (!window.live) return undefined;
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') setTick((t) => t + 1);
    }, 1000);
    return () => clearInterval(id);
  }, [window.live]);

  const setDuration = useCallback((duration) => {
    setWindow({ live: true, duration });
    try { localStorage.setItem('netnew.duration', String(duration)); } catch {}
  }, []);

  const setFixed = useCallback((after, before) => {
    setWindow({ live: false, after: Math.floor(after), before: Math.ceil(Math.max(before, after + 10)) });
  }, []);

  const pause = useCallback(() => {
    setWindow((w) => (w.live ? { live: false, after: nowSec() - w.duration, before: nowSec() } : w));
  }, []);

  const resume = useCallback(() => {
    setWindow((w) => {
      if (w.live) return w;
      const span = w.before - w.after;
      const preset = PRESETS.find((p) => p.seconds >= span) ?? PRESETS.at(-1);
      return { live: true, duration: preset.seconds };
    });
  }, []);

  const value = useMemo(() => {
    const span = window.live ? window.duration : window.before - window.after;
    return {
      ...window,
      span,
      tick,
      // Query params understood by every time-ranged API endpoint.
      query: window.live ? { after: -window.duration, before: 0 } : { after: window.after, before: window.before },
      setDuration,
      setFixed,
      pause,
      resume,
    };
  }, [window, tick, setDuration, setFixed, pause, resume]);

  return <TimeContext.Provider value={value}>{children}</TimeContext.Provider>;
}

// Refetch cadence for a chart in live mode: every bucket, between 1s and 30s.
export function shouldRefresh(time, bucket) {
  if (!time.live) return false;
  const every = Math.min(30, Math.max(1, Math.round(bucket || 1)));
  return time.tick % every === 0;
}
