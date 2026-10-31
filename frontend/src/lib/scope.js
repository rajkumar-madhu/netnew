import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

// The group every view is scoped to lives in the URL as ?group=<id>, so links
// and reloads keep it. No parameter means the built-in "All nodes" group.
export const ALL_GROUP = 'all';

export function useScopeId() {
  const [params] = useSearchParams();
  return params.get('group') || ALL_GROUP;
}

// Adds the scope to an in-app path ("/app/logs" → "/app/logs?group=web").
export function withScope(path, groupId) {
  if (!groupId || groupId === ALL_GROUP) return path;
  const [base, hash] = path.split('#');
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}group=${encodeURIComponent(groupId)}${hash ? `#${hash}` : ''}`;
}

export function useScopedPath() {
  const groupId = useScopeId();
  return useCallback((path) => withScope(path, groupId), [groupId]);
}
