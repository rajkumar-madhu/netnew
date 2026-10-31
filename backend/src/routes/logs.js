// Log search, facets and histogram.
import { bad, csv } from './helpers.js';

export function registerLogRoutes(api, { core, withScope, range }) {
  // Shared log filters. Time ranges come in seconds and are stored in ms.
  function filters(req, ids) {
    const r = range(req, 120);
    if (!r) return null;
    return {
      nodeIds: ids,
      from: r.from * 1000,
      to: r.to * 1000 + 999,
      q: String(req.query.q ?? '').slice(0, 200),
      levels: csv(req.query.level),
      services: csv(req.query.service),
      nodes: csv(req.query.node),
      points: r.points,
    };
  }

  api.get('/logs', withScope((req, res, ids) => {
    const f = filters(req, ids);
    if (!f) return bad(res, 'invalid after/before');
    const limit = Math.min(1000, Math.max(1, Number(req.query.limit) || 200));
    res.json(core.logs.query({
      ...f, limit, beforeId: Number(req.query.before_id) || null, afterId: Number(req.query.after_id) || null,
    }));
  }));

  api.get('/logs/histogram', withScope((req, res, ids) => {
    const f = filters(req, ids);
    if (!f) return bad(res, 'invalid after/before');
    res.json(core.logs.histogram(f, f.points));
  }));

  api.get('/logs/facets', withScope((req, res, ids) => {
    const f = filters(req, ids);
    if (!f) return bad(res, 'invalid after/before');
    res.json(core.logs.facets(f));
  }));
}
