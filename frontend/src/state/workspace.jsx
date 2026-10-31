import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, useLive } from '../lib/api.js';

// Workspace-wide state shared by every page: workspace info, groups, nodes (kept live
// over the WebSocket) and active alerts.
const WorkspaceContext = createContext(null);
export const useWorkspace = () => useContext(WorkspaceContext);

export function WorkspaceProvider({ children }) {
  const [workspace, setWorkspace] = useState(null);
  const [groups, setGroups] = useState(null);
  const [nodes, setNodes] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [error, setError] = useState(null);

  const loadGroups = useCallback(() => api('/groups').then(setGroups).catch(setError), []);
  const loadNodes = useCallback(() => api('/nodes').then(setNodes).catch(setError), []);
  const loadAlerts = useCallback(() => api('/alerts?state=active').then(setAlerts).catch(() => {}), []);
  const loadWorkspace = useCallback(() => api('/workspace').then(setWorkspace).catch(setError), []);

  useEffect(() => {
    loadWorkspace();
    loadGroups();
    loadNodes();
    loadAlerts();
  }, [loadWorkspace, loadGroups, loadNodes, loadAlerts]);

  useLive((msg) => {
    switch (msg.type) {
      case 'sample':
        setNodes((list) => list?.map((n) => (n.id === msg.nodeId ? { ...n, latest: { ts: msg.ts, ...msg.m } } : n)));
        break;
      case 'node':
        setNodes((list) => {
          if (!list) return list;
          const exists = list.some((n) => n.id === msg.node.id);
          if (!exists) loadGroups(); // the "All nodes" group gained a member
          return exists ? list.map((n) => (n.id === msg.node.id ? msg.node : n)) : [...list, msg.node];
        });
        break;
      case 'node_removed':
        setNodes((list) => list?.filter((n) => n.id !== msg.id));
        loadGroups();
        break;
      case 'alert':
        loadAlerts();
        break;
      case 'groups':
        loadGroups();
        break;
      case 'workspace':
        loadWorkspace();
        break;
      case '_status':
        if (msg.connected) {
          loadNodes();
          loadAlerts();
          loadGroups();
        }
        break;
      default:
    }
  });

  const value = useMemo(() => ({
    workspace, groups, nodes, alerts, error, loadGroups, loadNodes, loadAlerts, loadWorkspace,
  }), [workspace, groups, nodes, alerts, error, loadGroups, loadNodes, loadAlerts, loadWorkspace]);

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

// Group helpers: the group object and the nodes in it.
export function useGroup(groupId) {
  const { groups, nodes, alerts } = useWorkspace();
  return useMemo(() => {
    const group = groups?.find((r) => r.id === groupId) ?? null;
    const ids = new Set(group?.nodeIds ?? []);
    return {
      group,
      loading: !groups || !nodes,
      nodes: (nodes ?? []).filter((n) => ids.has(n.id)),
      alerts: alerts.filter((a) => ids.has(a.node_id)),
    };
  }, [groups, nodes, alerts, groupId]);
}
