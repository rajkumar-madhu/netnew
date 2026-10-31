// Wires everything together: database, core, HTTP app and WebSockets.
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { createApp } from './app.js';
import { createCore } from './core.js';
import { openDb } from './db/index.js';
import { createAgentProtocol } from './realtime/agents.js';
import { handleLive } from './realtime/live.js';
import { hashPassword, passwordProblem, safeEqual, sessionUser, validateEmail } from './services/auth.js';

// Creates the configured admin account when the workspace has no users yet.
async function bootstrapAdmin(core) {
  const { db, config } = core;
  if (!config.adminEmail || db.countUsers() > 0) return;
  const email = validateEmail(config.adminEmail);
  const problem = passwordProblem(config.adminPassword);
  if (!email || problem) {
    console.warn(`ADMIN_EMAIL/ADMIN_PASSWORD ignored: ${email ? problem : 'invalid email'}`);
    return;
  }
  db.createUser({ email, name: 'Admin', role: 'admin', passwordHash: await hashPassword(config.adminPassword) }, core.now());
  console.log(`Created admin account ${email}`);
}

/** Starts the server; resolves once it is listening. */
export async function startServer(config) {
  const db = openDb(config.dbPath);
  const core = createCore({ config, db });
  await bootstrapAdmin(core);
  const app = createApp(core);
  const server = createServer(app);
  const handleAgent = createAgentProtocol(core);

  const agentWss = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 * 1024 });
  const liveWss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

  server.on('upgrade', (req, socket, head) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    const reject = (status) => socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);

    if (pathname === '/ws/agent') {
      const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      if (!safeEqual(token, config.agentToken)) return reject('401 Unauthorized');
      agentWss.handleUpgrade(req, socket, head, handleAgent);
    } else if (pathname === '/ws/live') {
      if (!sessionUser(db, req.headers.cookie, core.now())) return reject('401 Unauthorized');
      liveWss.handleUpgrade(req, socket, head, (ws) => handleLive(core, ws));
    } else {
      reject('404 Not Found');
    }
  });

  // Drop agents that stopped answering pings (e.g. the machine lost power).
  const ping = setInterval(() => {
    for (const ws of agentWss.clients) {
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false;
      ws.ping();
    }
  }, 15_000);
  ping.unref();
  const stopTimers = core.startTimers();

  await new Promise((resolve) => server.listen(config.port, config.host, resolve));

  return {
    core,
    server,
    port: server.address().port,
    async close() {
      clearInterval(ping);
      stopTimers();
      for (const ws of [...agentWss.clients, ...liveWss.clients]) ws.terminate();
      await new Promise((resolve) => server.close(resolve));
      db.close();
    },
  };
}
