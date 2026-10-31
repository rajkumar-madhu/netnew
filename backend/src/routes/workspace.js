// Workspace settings, users, and node groups.
import { hashPassword, passwordProblem, ROLES, validateEmail } from '../services/auth.js';
import { bad } from './helpers.js';

export function registerWorkspaceRoutes(api, { core, db, groups }) {
  // ------------------------------------------------------------ workspace
  api.get('/workspace', (req, res) => {
    res.json({
      name: core.workspaceName(),
      version: core.version,
      retentionHours: core.config.retentionHours,
      logRetentionHours: core.config.logRetentionHours,
      offlineAfterSec: core.config.offlineAfterSec,
      agentTokenFromEnv: core.config.agentTokenFromEnv,
      nodes: db.listNodes().length,
      connectedAgents: core.agents.size,
      users: db.countUsers(),
    });
  });

  api.patch('/workspace', (req, res) => {
    const name = String(req.body?.name ?? '').trim().slice(0, 80);
    if (!name) return bad(res, 'name is required');
    db.setSetting('workspace_name', name);
    core.broadcast({ type: 'workspace' });
    res.json({ name });
  });

  // Admins can reveal the agent token to fill in install commands.
  api.get('/workspace/agent-token', (req, res) => {
    if (req.user.role !== 'admin') return bad(res, 'only admins can view the agent token', 403);
    res.json({ token: core.config.agentToken });
  });

  // ------------------------------------------------------------ users
  api.get('/users', (req, res) => {
    if (req.user.role !== 'admin') return bad(res, 'only admins can manage users', 403);
    res.json(db.listUsers());
  });

  api.post('/users', async (req, res) => {
    const email = validateEmail(req.body?.email);
    const name = String(req.body?.name ?? '').trim().slice(0, 80);
    const role = ROLES.includes(req.body?.role) ? req.body.role : null;
    if (!name) return bad(res, 'Name is required');
    if (!email) return bad(res, 'A valid email is required');
    if (!role) return bad(res, `Role must be one of ${ROLES.join(', ')}`);
    if (db.getUserByEmail(email)) return bad(res, 'A user with that email already exists', 409);
    const problem = passwordProblem(req.body?.password);
    if (problem) return bad(res, problem);
    res.status(201).json(db.createUser({ email, name, role, passwordHash: await hashPassword(req.body.password) }, core.now()));
  });

  api.patch('/users/:id', async (req, res) => {
    const user = db.getUser(Number(req.params.id));
    if (!user) return bad(res, 'user not found', 404);
    const name = String(req.body?.name ?? user.name).trim().slice(0, 80);
    const role = req.body?.role ?? user.role;
    if (!name) return bad(res, 'Name is required');
    if (!ROLES.includes(role)) return bad(res, `Role must be one of ${ROLES.join(', ')}`);
    if (user.role === 'admin' && role !== 'admin' && db.countAdmins() === 1) return bad(res, 'The workspace needs at least one admin', 409);
    if (req.body?.password) {
      const problem = passwordProblem(req.body.password);
      if (problem) return bad(res, problem);
      db.setPassword(user.id, await hashPassword(req.body.password));
      if (user.id !== req.user.id) db.deleteUserSessions(user.id); // sign them out everywhere
    }
    res.json(db.updateUser(user.id, { name, role }));
  });

  api.delete('/users/:id', (req, res) => {
    const user = db.getUser(Number(req.params.id));
    if (!user) return bad(res, 'user not found', 404);
    if (user.id === req.user.id) return bad(res, "You can't delete your own account", 409);
    if (user.role === 'admin' && db.countAdmins() === 1) return bad(res, 'The workspace needs at least one admin', 409);
    db.deleteUser(user.id);
    res.status(204).end();
  });

  // ------------------------------------------------------------ groups
  api.get('/groups', (req, res) => res.json(groups()));

  function groupInput(body) {
    const name = String(body?.name ?? '').trim().slice(0, 60);
    const description = String(body?.description ?? '').trim().slice(0, 200);
    return name ? { name, description } : null;
  }
  const knownNodes = (ids) => {
    const known = new Set(db.listNodes().map((n) => n.id));
    return ids.map(String).filter((id) => known.has(id));
  };

  api.post('/groups', (req, res) => {
    const input = groupInput(req.body);
    if (!input) return bad(res, 'name is required');
    const group = db.createGroup(input.name, input.description, core.now());
    if (Array.isArray(req.body.nodeIds)) db.setGroupNodes(group.id, knownNodes(req.body.nodeIds));
    core.broadcast({ type: 'groups' });
    res.status(201).json(groups().find((g) => g.id === group.id));
  });

  api.patch('/groups/:id', (req, res) => {
    if (!db.getGroup(req.params.id)) return bad(res, 'group not found', 404);
    const input = groupInput(req.body);
    if (!input) return bad(res, 'name is required');
    db.updateGroup(req.params.id, input.name, input.description);
    core.broadcast({ type: 'groups' });
    res.json(groups().find((g) => g.id === req.params.id));
  });

  api.delete('/groups/:id', (req, res) => {
    if (!db.getGroup(req.params.id)) return bad(res, 'group not found', 404);
    db.deleteGroup(req.params.id);
    core.broadcast({ type: 'groups' });
    res.status(204).end();
  });

  api.put('/groups/:id/nodes', (req, res) => {
    if (!db.getGroup(req.params.id)) return bad(res, 'group not found', 404);
    if (!Array.isArray(req.body?.nodeIds)) return bad(res, 'nodeIds must be an array');
    db.setGroupNodes(req.params.id, knownNodes(req.body.nodeIds));
    core.broadcast({ type: 'groups' });
    res.json(groups().find((g) => g.id === req.params.id));
  });
}
