// The /api router. Order matters:
//   1. public: health and the account endpoints used before sign-in
//   2. signed-in users: everything else (viewers read, admins also write)
import express from 'express';
import { registerAlertRoutes } from './alerts.js';
import {
  adminForWrites, registerAccountRoutes, registerAuthRoutes, requireUser, sameOrigin,
} from './auth.js';
import { registerChartRoutes } from './charts.js';
import { registerDashboardRoutes } from './dashboards.js';
import { bad, createRouteContext } from './helpers.js';
import { registerJobRoutes } from './jobs.js';
import { registerLogRoutes } from './logs.js';
import { registerNodeRoutes } from './nodes.js';
import { registerWorkspaceRoutes } from './workspace.js';

export function createApi(core) {
  const ctx = createRouteContext(core);
  const api = express.Router();
  api.use(express.json({ limit: '100kb' }));
  api.use(sameOrigin);

  api.get('/health', (req, res) => {
    // `time` is the server's clock (unix seconds), so clients can compare server timestamps without trusting their own clock.
    res.json({ ok: true, version: core.version, time: core.now(), uptime: core.now() - core.startedAt, agents: core.agents.size });
  });
  registerAuthRoutes(api, ctx);

  api.use(requireUser(ctx));
  registerAccountRoutes(api, ctx);
  api.use(adminForWrites);

  registerWorkspaceRoutes(api, ctx);
  registerNodeRoutes(api, ctx);
  registerChartRoutes(api, ctx);
  registerAlertRoutes(api, ctx);
  registerLogRoutes(api, ctx);
  registerDashboardRoutes(api, ctx);
  registerJobRoutes(api, ctx);

  api.use((req, res) => bad(res, 'not found', 404));
  return api;
}
