import { useEffect, useRef, useState } from 'react';

export async function api(path, options) {
  const res = await fetch(`/api${path}`, options);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `${res.status} ${res.statusText}`);
  }
  return res.status === 204 ? null : res.json();
}

// One shared WebSocket for the whole app; components subscribe with useLive.
const listeners = new Set();
let socket = null;
let connected = false;

function setConnected(value) {
  connected = value;
  for (const fn of listeners) fn({ type: '_status', connected });
}

function connect() {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  socket = new WebSocket(`${proto}://${window.location.host}/ws/live`);
  socket.onopen = () => setConnected(true);
  socket.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    for (const fn of listeners) fn(msg);
  };
  socket.onclose = () => {
    setConnected(false);
    setTimeout(connect, 2000);
  };
}

export function useLive(handler) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!socket) connect();
    const fn = (msg) => ref.current(msg);
    listeners.add(fn);
    return () => listeners.delete(fn);
  }, []);
}

export function useLiveStatus() {
  const [value, setValue] = useState(connected);
  useLive((msg) => {
    if (msg.type === '_status') setValue(msg.connected);
  });
  return value;
}

// Fetches `path` and refetches every `intervalMs` (if given) or when deps change.
export function usePolling(path, intervalMs, deps = []) {
  const [state, setState] = useState({ data: null, error: null });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!path) return undefined;
    let cancelled = false;
    api(path)
      .then((data) => !cancelled && setState({ data, error: null }))
      .catch((error) => !cancelled && setState((s) => ({ data: s.data, error })));
    return () => { cancelled = true; };
  }, [path, tick, ...deps]);

  useEffect(() => {
    if (!intervalMs) return undefined;
    const id = setInterval(() => setTick((t) => t + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return { ...state, reload: () => setTick((t) => t + 1) };
}
