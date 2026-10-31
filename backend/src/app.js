// The HTTP application: agent installer and files (public), the /api router,
// and the built frontend (landing page and app) for every other path.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createApi } from './routes/index.js';

const FRONTEND_DIST = fileURLToPath(new URL('../../frontend/dist', import.meta.url));
const AGENT_DIR = fileURLToPath(new URL('../../agent', import.meta.url));
const INSTALL_SCRIPT = fileURLToPath(new URL('../install/install.sh', import.meta.url));

// The files an installer downloads: package.json and the agent's sources.
export function agentFiles() {
  const src = readdirSync(join(AGENT_DIR, 'src')).filter((f) => /^[a-z]+\.js$/.test(f)).sort();
  return ['package.json', ...src.map((f) => `src/${f}`)];
}

export function createApp(core) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');

  // The installer and agent files hold no secrets, so remote machines can
  // fetch them without signing in.
  app.get('/install.sh', (req, res) => {
    const script = readFileSync(INSTALL_SCRIPT, 'utf8')
      .replaceAll('__NETNEW_URL__', `${req.protocol}://${req.get('host')}`);
    res.type('text/x-shellscript').send(script);
  });
  app.get('/agent/manifest', (req, res) => res.type('text').send(`${agentFiles().join('\n')}\n`));
  app.get('/agent/{*file}', (req, res) => {
    const file = [].concat(req.params.file).join('/');
    if (!agentFiles().includes(file)) return res.sendStatus(404);
    res.sendFile(file, { root: AGENT_DIR });
  });

  app.use('/api', createApi(core));

  if (existsSync(FRONTEND_DIST)) {
    app.use(express.static(FRONTEND_DIST, { index: false }));
    app.get('/{*path}', (req, res) => res.sendFile('index.html', { root: FRONTEND_DIST }));
  } else {
    app.get('/', (req, res) => {
      res.type('text').send('Frontend not built. Run `npm run build` (or `npm run dev:frontend` for development).');
    });
  }
  return app;
}
