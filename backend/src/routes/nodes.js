// Nodes and the live inventories their agents report (processes, containers,
// systemd services).
import { bad } from './helpers.js';

export function registerNodeRoutes(api, { core, db, withScope, nodeNames }) {
  api.get('/nodes', withScope((req, res, ids) => {
    const set = new Set(ids);
    res.json(db.listNodes().filter((n) => set.has(n.id)).map(core.nodeSummary));
  }));

  api.get('/nodes/:id', (req, res) => {
    const node = core.nodeSummary(db.getNode(req.params.id));
    if (!node) return bad(res, 'node not found', 404);
    res.json(node);
  });

  api.delete('/nodes/:id', (req, res) => {
    const node = db.getNode(req.params.id);
    if (!node) return bad(res, 'node not found', 404);
    if (core.agents.has(node.id)) return bad(res, 'node is connected; stop its agent first', 409);
    core.removeNode(node);
    res.status(204).end();
  });

  api.get('/nodes/:id/processes', (req, res) => {
    if (!db.getNode(req.params.id)) return bad(res, 'node not found', 404);
    const snapshot = core.processes.get(req.params.id);
    if (!snapshot) return bad(res, 'no process data yet; the agent sends it every few seconds', 404);
    res.json(snapshot);
  });

  // Latest per-node inventories, kept in memory.
  function inventory(map, ids) {
    const names = nodeNames();
    return ids.filter((id) => map.has(id)).map((id) => ({
      nodeId: id, hostname: names[id], online: core.isOnline(id), ...map.get(id),
    }));
  }
  api.get('/containers', withScope((req, res, ids) => res.json(inventory(core.containers, ids))));
  api.get('/services', withScope((req, res, ids) => res.json(inventory(core.services, ids))));
}
