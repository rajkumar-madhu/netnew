import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, useLive } from '../api.js';

// Space-wide state shared by every page: space info, rooms, nodes (kept live
// over the WebSocket) and active alerts.
const SpaceContext = createContext(null);
export const useSpace = () => useContext(SpaceContext);

export function SpaceProvider({ children }) {
  const [space, setSpace] = useState(null);
  const [rooms, setRooms] = useState(null);
  const [nodes, setNodes] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [error, setError] = useState(null);

  const loadRooms = useCallback(() => api('/rooms').then(setRooms).catch(setError), []);
  const loadNodes = useCallback(() => api('/nodes').then(setNodes).catch(setError), []);
  const loadAlerts = useCallback(() => api('/alerts?state=active').then(setAlerts).catch(() => {}), []);
  const loadSpace = useCallback(() => api('/space').then(setSpace).catch(setError), []);

  useEffect(() => {
    loadSpace();
    loadRooms();
    loadNodes();
    loadAlerts();
  }, [loadSpace, loadRooms, loadNodes, loadAlerts]);

  useLive((msg) => {
    switch (msg.type) {
      case 'sample':
        setNodes((list) => list?.map((n) => (n.id === msg.nodeId ? { ...n, latest: { ts: msg.ts, ...msg.m } } : n)));
        break;
      case 'node':
        setNodes((list) => {
          if (!list) return list;
          const exists = list.some((n) => n.id === msg.node.id);
          if (!exists) loadRooms(); // the "All nodes" room gained a member
          return exists ? list.map((n) => (n.id === msg.node.id ? msg.node : n)) : [...list, msg.node];
        });
        break;
      case 'node_removed':
        setNodes((list) => list?.filter((n) => n.id !== msg.id));
        loadRooms();
        break;
      case 'alert':
        loadAlerts();
        break;
      case 'rooms':
        loadRooms();
        break;
      case '_status':
        if (msg.connected) {
          loadNodes();
          loadAlerts();
          loadRooms();
        }
        break;
      default:
    }
  });

  const value = useMemo(() => ({
    space, rooms, nodes, alerts, error, loadRooms, loadNodes, loadAlerts, loadSpace,
  }), [space, rooms, nodes, alerts, error, loadRooms, loadNodes, loadAlerts, loadSpace]);

  return <SpaceContext.Provider value={value}>{children}</SpaceContext.Provider>;
}

// Room helpers: the room object and the nodes in it.
export function useRoom(roomId) {
  const { rooms, nodes, alerts } = useSpace();
  return useMemo(() => {
    const room = rooms?.find((r) => r.id === roomId) ?? null;
    const ids = new Set(room?.nodeIds ?? []);
    return {
      room,
      loading: !rooms || !nodes,
      nodes: (nodes ?? []).filter((n) => ids.has(n.id)),
      alerts: alerts.filter((a) => ids.has(a.node_id)),
    };
  }, [rooms, nodes, alerts, roomId]);
}
