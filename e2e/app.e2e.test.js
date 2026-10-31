// End-to-end test: the built web app, the backend and a real agent process,
// driven through a browser the way a new customer would use the product.
//
//   npm run build && npm run test:e2e
//
// Needs Playwright with Chromium (`require('playwright')` must resolve).
// Screenshots are written to $E2E_ARTIFACTS (default: a temp directory).
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../backend/src/config.js';
import { startServer } from '../backend/src/server.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const { chromium } = createRequire(import.meta.url)('playwright');

const ADMIN = { name: 'Ada Admin', email: 'ada@acme.io', password: 'ada-password-1' };
const VIEWER = { name: 'Vic Viewer', email: 'vic@acme.io', password: 'vic-password-1' };
const LOG_LINE = 'checkout failed: payment gateway timeout';

describe('NetNew end to end', { timeout: 180_000 }, () => {
  const tmp = mkdtempSync(join(tmpdir(), 'netnew-e2e-'));
  const shots = process.env.E2E_ARTIFACTS || join(tmp, 'screenshots');
  const logFile = join(tmp, 'app.log');
  let server;
  let base;
  let agent;
  let target;
  let appender;
  let browser;
  let page;
  const pageErrors = [];
  const shot = (name) => page.screenshot({ path: join(shots, `${name}.png`), fullPage: false });

  before(async () => {
    assert.ok(existsSync(join(ROOT, 'frontend/dist/index.html')), 'build the frontend first: npm run build');
    mkdirSync(shots, { recursive: true });
    server = await startServer(loadConfig({ DATA_DIR: join(tmp, 'data'), PORT: '0', HOST: '127.0.0.1' }));
    base = `http://127.0.0.1:${server.port}`;

    // A service for the HTTP check to watch.
    target = createServer((req, res) => res.end('{"status":"ok"}')).listen(0, '127.0.0.1');
    await new Promise((r) => target.once('listening', r));

    // An application log the agent tails.
    writeFileSync(logFile, '');
    appender = setInterval(() => appendFileSync(logFile, `${new Date().toISOString()} ERROR ${LOG_LINE}\n`), 500);

    agent = spawn(process.execPath, [join(ROOT, 'agent/src/index.js')], {
      env: {
        ...process.env,
        NETNEW_URL: base,
        NETNEW_TOKEN: server.core.config.agentToken,
        NETNEW_STATE_DIR: join(tmp, 'agent'),
        NETNEW_HOSTNAME: 'e2e-node',
        NETNEW_LOG_FILES: logFile,
        NETNEW_DISABLE: 'journal,services,containers',
      },
      stdio: 'ignore',
    });

    browser = await chromium.launch();
    page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    page.on('pageerror', (err) => pageErrors.push(String(err)));
  });

  after(async () => {
    clearInterval(appender);
    agent?.kill();
    target?.close();
    await browser?.close();
    await server?.close();
    if (!process.env.E2E_ARTIFACTS) rmSync(tmp, { recursive: true, force: true });
  });

  it('shows the landing page and starts setup', async () => {
    await page.goto(base);
    await page.getByRole('heading', { level: 1 }).waitFor();
    assert.match(await page.getByRole('heading', { level: 1 }).textContent(), /every second/);
    await shot('01-landing');
    await page.getByRole('link', { name: 'Get started' }).first().click();
    await page.waitForURL(/\/setup$/);
  });

  it('creates the workspace and the admin account', async () => {
    await page.getByLabel('Workspace name').fill('Acme Production');
    await page.getByLabel('Your name').fill(ADMIN.name);
    await page.getByLabel('Email').fill(ADMIN.email);
    await page.getByLabel('Password').fill(ADMIN.password);
    await shot('02-setup');
    await page.getByRole('button', { name: 'Create workspace' }).click();
    await page.waitForURL(/\/app\/groups\/all\/home/);
    // Setup lands on the "connect your servers" instructions.
    await page.getByRole('dialog', { name: 'Integrations' }).waitFor();
  });

  it('fills the real agent token into the install command', async () => {
    await page.locator('.int-card', { hasText: 'Linux' }).first().click();
    await page.getByRole('button', { name: 'Fill in my agent token' }).click();
    await page.locator('.code-block pre', { hasText: server.core.config.agentToken }).first().waitFor();
    await shot('03-install-command');
    await page.keyboard.press('Escape');
  });

  it('shows the connected node with live charts', async () => {
    await page.locator('.group-link', { hasText: 'All nodes' }).locator('.count', { hasText: '1' }).waitFor({ timeout: 20_000 });
    await page.getByRole('link', { name: 'Nodes', exact: true }).click();
    await page.locator('.nodes-table').getByRole('link', { name: 'e2e-node' }).click();
    await page.waitForURL(/\/app\/nodes\/.+/);
    await page.locator('.net-chart canvas').first().waitFor({ timeout: 20_000 });
    assert.ok(await page.locator('.metrics-section h2', { hasText: 'System' }).count());
    await shot('04-node-metrics');
  });

  it('creates a group with the node', async () => {
    await page.getByRole('button', { name: 'Create group' }).click();
    await page.getByPlaceholder('e.g. Production').fill('Web tier');
    await page.locator('.check-row', { hasText: 'e2e-node' }).locator('input').check();
    await page.getByRole('dialog').getByRole('button', { name: 'Create group' }).click();
    await page.locator('.group-link', { hasText: 'Web tier' }).click();
    await page.getByRole('heading', { name: 'Web tier' }).waitFor();
    assert.match(await page.locator('.page-title').textContent(), /1 of 1 nodes live/);
  });

  it('builds a dashboard', async () => {
    await page.getByRole('link', { name: 'Dashboards' }).click();
    await page.getByRole('button', { name: 'New dashboard' }).click();
    await page.locator('#new-dash input').first().fill('Checkout');
    await page.getByRole('button', { name: 'Create and add charts' }).click();
    await page.getByRole('button', { name: 'Add chart' }).first().click();
    await page.locator('.picker-option', { hasText: 'Total CPU utilization' }).click();
    await page.locator('.modal-foot').getByRole('button', { name: 'Add chart' }).click();
    await page.getByRole('button', { name: 'Save dashboard' }).click();
    await page.locator('.dash-item canvas').first().waitFor({ timeout: 15_000 });
    await shot('05-dashboard');
  });

  it('finds the agent\'s log lines', async () => {
    await page.getByRole('link', { name: 'Logs' }).click();
    await page.getByPlaceholder(/Search log messages/).fill('gateway timeout');
    await page.locator('.log-message', { hasText: LOG_LINE }).first().waitFor({ timeout: 20_000 });
    await shot('06-logs');
  });

  it('adds an HTTP check that turns OK', async () => {
    await page.getByRole('link', { name: 'Services' }).click();
    await page.getByRole('button', { name: 'Add check or collector' }).first().click();
    await page.getByPlaceholder('e.g. checkout-api').fill('checkout-health');
    await page.getByPlaceholder('https://example.com/health').fill(`http://127.0.0.1:${target.address().port}/health`);
    await page.getByRole('button', { name: 'Add job' }).click();
    await page.locator('tr', { hasText: 'checkout-health' }).locator('.job-state.ok').waitFor({ timeout: 20_000 });
    await shot('07-services');
  });

  it('invites a viewer who gets read-only access', async () => {
    await page.goto(`${base}/app/settings/users`);
    await page.getByRole('button', { name: 'Add user' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Name').fill(VIEWER.name);
    await dialog.getByLabel('Email').fill(VIEWER.email);
    await dialog.getByLabel('Initial password').fill(VIEWER.password);
    await dialog.getByRole('button', { name: 'Add user' }).click();
    await page.locator('td', { hasText: VIEWER.email }).waitFor();

    await page.locator('.user-menu .dropdown-trigger').click();
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.waitForURL(/\/login/);

    await page.getByLabel('Email').fill(VIEWER.email);
    await page.getByLabel('Password').fill(VIEWER.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL(/\/app\//);
    await page.goto(`${base}/app/groups/all/dashboards`);
    await page.locator('.dash-card', { hasText: 'Checkout' }).waitFor().catch(() => {});
    assert.equal(await page.getByRole('button', { name: 'New dashboard' }).count(), 0);
    await page.goto(`${base}/app/settings/general`);
    assert.equal(await page.getByRole('link', { name: 'Users', exact: true }).count(), 0);
    await shot('08-viewer');
  });

  it('had no browser errors', () => {
    assert.deepEqual(pageErrors, []);
  });
});
