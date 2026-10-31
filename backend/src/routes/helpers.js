// Helpers shared by the route modules.
export const ALL_NODES_GROUP = 'all';

// Time ranges: after/before are absolute unix seconds, or relative to now
// when <= 0 (after=-900&before=0 is "the last 15 minutes").
export function parseRange(q, now, defaultPoints) {
  const after = Number(q.after ?? -900);
  const before = Number(q.before ?? 0);
  const to = Math.floor(before <= 0 ? now + before : before);
  let from = Math.floor(after <= 0 ? now + after : after);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  if (from >= to) from = to - 1;
  const points = Math.min(2000, Math.max(10, Number(q.points) || defaultPoints));
  return { from, to, points };
}

export const csv = (v) => (v ? String(v).split(',').map((s) => s.trim()).filter(Boolean) : null);

export const bad = (res, error, status = 400) => res.status(status).json({ error });

/** Context handed to every route module. */
export function createRouteContext(core) {
  const { db } = core;

  // The built-in "All nodes" group plus user-created groups.
  function groups() {
    const nodeIds = db.listNodes().map((n) => n.id);
    return [
      { id: ALL_NODES_GROUP, name: 'All nodes', description: 'Every node connected to this workspace.', builtin: true, nodeIds },
      ...db.listGroups().map((g) => ({ ...g, builtin: false, nodeIds: g.nodeIds.filter((id) => nodeIds.includes(id)) })),
    ];
  }

  // The node IDs a request is about: a group (default: all nodes), optionally
  // narrowed with ?nodes=a,b. Returns null for an unknown group.
  function scope(q) {
    const group = groups().find((g) => g.id === (q.group || ALL_NODES_GROUP));
    if (!group) return null;
    const wanted = csv(q.nodes);
    return wanted ? group.nodeIds.filter((id) => wanted.includes(id)) : group.nodeIds;
  }

  const withScope = (handler) => (req, res) => {
    const ids = scope(req.query);
    if (!ids) return bad(res, 'group not found', 404);
    return handler(req, res, ids);
  };

  return {
    core,
    db,
    groups,
    scope,
    withScope,
    nodeNames: () => Object.fromEntries(db.listNodes().map((n) => [n.id, n.hostname])),
    range: (req, points) => parseRange(req.query, core.now(), points),
  };
}
