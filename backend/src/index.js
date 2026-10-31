import { loadConfig } from './config.js';
import { startServer } from './server.js';

const config = loadConfig();
const app = await startServer(config);
const { core } = app;

console.log(`NetNew ${core.version} listening on http://${config.host}:${app.port}`);
if (!config.agentTokenFromEnv) {
  console.log(`Agent token (saved in ${config.dataDir}/agent-token): ${config.agentToken}`);
}
if (core.db.countUsers() === 0) {
  console.log(`No accounts yet: open http://localhost:${app.port}/setup to create the first admin.`);
}

async function shutdown() {
  setTimeout(() => process.exit(0), 3000).unref();
  await app.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
