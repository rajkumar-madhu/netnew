# NetNew

**Self-hosted, real-time infrastructure monitoring.** A lightweight agent on each server streams per-second
metrics, logs, container stats and service health to a NetNew server. The server stores them, raises alerts,
detects anomalies and pushes everything live to a web app your whole team can sign in to.

| | |
|---|---|
| **Metrics** | CPU by state and per core, memory, swap, load, per-interface network, per-disk I/O and busy time, disk space per mount, processes, context switches, interrupts, temperatures. One-second resolution, 40+ built-in charts. |
| **Groups** | Organize nodes by environment, team or service. Every view, dashboard and alert list can be scoped to a group. |
| **Dashboards** | Build boards from any chart and any nodes, choose how series are grouped (by dimension, node or instance) and aggregated (avg, sum, min, max), add notes, drag to arrange. |
| **Logs** | The systemd journal and any log file, with full-text search, level/service/node facets, a level histogram and live follow. |
| **Containers** | Per-container CPU, memory, network and disk from Docker; pods with phase, restarts and resource use on Kubernetes. |
| **Services** | HTTP, TCP and ping checks plus Nginx, Redis, PostgreSQL and MySQL collectors, configured in the browser and run by the node's agent. systemd unit states. |
| **Alerts** | CPU, RAM, disk space, node offline, failed checks and failed systemd units, delivered to Slack, Discord or any webhook. |
| **Anomalies** | Every metric is compared each second with its own learned baseline; the rate of anomalies is charted per node and metric. |
| **Accounts** | First-run setup, sign-in, admin and read-only viewer roles, user management. |

## Product structure

```
netnew/
├── frontend/   React web app: landing page, sign-in/setup, and the monitoring app (Vite)
├── backend/    Node.js server: REST API, WebSockets, SQLite storage, alerting, notifications
├── agent/      Node.js agent that runs on every monitored machine
├── e2e/        End-to-end browser tests (Playwright)
└── docs/       Architecture notes
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the pieces fit together, the data model and the agent
protocol.

## Quick start

Requires **Node.js 22.13+** for the server; the agent runs on Node.js 18+.

```bash
npm install
npm run build        # builds frontend/dist, which the backend serves
npm start            # http://localhost:3000
```

Open http://localhost:3000, click **Get started**, name your workspace and create the admin account. The app
then opens **Connect a server**: pick the platform, copy the command (as an admin you can fill your agent token
into it with one click), and the page shows the server as soon as its agent reports.

### Docker

```bash
docker compose up -d --build
```

To skip the setup page in automated deployments, set `ADMIN_EMAIL` and `ADMIN_PASSWORD` (for example in a
`.env` file next to `docker-compose.yml`); that account is created on first start.

For internet-facing deployments, put the server behind a TLS-terminating reverse proxy (nginx, Caddy) that
forwards WebSocket upgrades for `/ws/`. Agents then connect over `wss://`, and session cookies are marked
`Secure` automatically.

## Development

```bash
npm install
npm run dev:backend    # API + WebSockets on :3000 (restarts on changes)
npm run dev:frontend   # Vite dev server on :5173, proxying /api and /ws to :3000
cp agent/.env.example agent/.env   # paste the agent token (Settings → General)
npm run dev:agent      # an agent for this machine
```

### Tests

```bash
npm test               # backend unit and API tests (node:test)
npm run build && npm run test:e2e   # end-to-end: real backend, real agent, browser (needs Playwright + Chromium)
```

The end-to-end suite goes through the product the way a new customer does: landing page → setup → install
command with the real token → the agent arriving live → its node page and charts → the overview → the ⌘K
palette → a group and the group switcher → the metrics explorer → a dashboard → log search → an HTTP check →
inviting a viewer and checking their access is read-only. Set `E2E_ARTIFACTS=<dir>` to keep its
screenshots. CI (`.github/workflows/ci.yml`) runs both suites on every push and pull request.

## Configuration

### Server (`backend/.env`, see `backend/.env.example`)

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` / `HOST` | `3000` / `0.0.0.0` | Listen address. |
| `DATA_DIR` | `./data` | SQLite database and the generated agent token. |
| `AGENT_TOKEN` | generated | Shared secret agents must present. |
| `WORKSPACE_NAME` | `My Workspace` | Default name until setup sets one. |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | unset | Create this admin on start when there are no users. |
| `COOKIE_SECURE` | `auto` | Mark session cookies `Secure`: `auto` (when the request is HTTPS), `true` or `false`. |
| `RETENTION_HOURS` | `24` | Per-second and per-minute metric retention. Events and alert history are kept 7 days. |
| `LOG_RETENTION_HOURS` / `LOG_MAX_ROWS` | `72` / `2000000` | Log retention by age and row count. |
| `OFFLINE_AFTER_SEC` | `15` | Silence before a node is marked offline and alerted on. |
| `PUBLIC_URL` | unset | App URL, used for links in notifications. |

Storage needs are roughly 20 bytes per value. A typical 4-core VM reports about 50 values per second, which is
about 75 MB per node per day of retention.

### Agent

Install on Linux with systemd (the app shows this command with your server URL and token):

```bash
curl -fsSL https://monitor.example.com/install.sh | sudo sh -s -- --token <TOKEN>
```

The **Connect a server** page also covers Ubuntu/Debian, RHEL/Fedora, macOS (LaunchAgent), Windows, FreeBSD, Docker,
Docker Compose and a Kubernetes DaemonSet.

| Variable | Default | Description |
|----------|---------|-------------|
| `NETNEW_URL` | `http://localhost:3000` | Server URL. |
| `NETNEW_TOKEN` | required | Agent token. |
| `NETNEW_HOSTNAME` | machine hostname | Display name. |
| `NETNEW_INTERVAL_MS` | `1000` | Collection interval. |
| `NETNEW_STATE_DIR` | `~/.netnew-agent` | Where the persistent node ID is stored. |
| `NETNEW_LOG_FILES` | none | Comma-separated log files to tail (the systemd journal is read automatically). |
| `NETNEW_DISABLE` | none | Modules to turn off: `logs`, `journal`, `containers`, `services`, `processes`. |
| `NETNEW_DOCKER_SOCKET` | `/var/run/docker.sock` | Docker Engine API socket. |
| `NETNEW_CGROUP_ROOT` / `NETNEW_K8S_NODE` | `/sys/fs/cgroup` / hostname | Pod cgroups and this node's Kubernetes name (set by the DaemonSet manifest). |

## Alerts

| Alert | Rule |
|-------|------|
| CPU utilization | 60s average ≥ 80% warning, ≥ 95% critical |
| RAM usage | 60s average ≥ 85% warning, ≥ 95% critical |
| Disk space usage | fullest filesystem ≥ 85% warning, ≥ 95% critical |
| Node offline | no data for `OFFLINE_AFTER_SEC` (critical) |
| Service check failed | 2 consecutive failed runs of a check or collector (critical) |
| Failed systemd units | any service unit in the `failed` state (warning) |

Alerts clear 5 points below their threshold so they don't flap. Thresholds live in
`backend/src/services/alerts.js`. Add Slack, Discord or webhook channels under **Settings → Alert
notifications**; webhooks receive the alert as JSON.

## API

All endpoints are under `/api` and need a signed-in session, except `/api/health` and `/api/auth/*`. Viewers
can read; changes need an admin. Time-ranged endpoints take `after`/`before` (unix seconds, or relative to now
when ≤ 0) and scoped endpoints take `group=<id>` (default: all nodes) and/or `nodes=id1,id2`.

| Endpoint | Description |
|----------|-------------|
| `GET /api/auth/state`, `POST /api/auth/setup`, `POST /api/auth/login`, `POST /api/auth/logout` | Setup and sessions. |
| `GET /api/auth/me`, `POST /api/auth/password` | Current user, change password. |
| `GET/PATCH /api/workspace`, `GET /api/workspace/agent-token` | Workspace info and name; the agent token (admins). |
| `GET/POST /api/users`, `PATCH/DELETE /api/users/:id` | Users and roles (admins). |
| `GET/POST /api/groups`, `PATCH/DELETE /api/groups/:id`, `PUT /api/groups/:id/nodes` | Groups and their members. |
| `GET /api/nodes`, `GET/DELETE /api/nodes/:id`, `GET /api/nodes/:id/processes` | Nodes and live process lists. |
| `GET /api/charts/catalog`, `GET /api/charts`, `GET /api/charts/data?chart=&group_by=&agg=&dims=` | Charts and chart data. |
| `GET /api/alerts`, `GET /api/alert-rules`, `GET /api/events`, `GET /api/anomalies` | Alerts, rules, event feed, anomalies. |
| `GET /api/logs`, `GET /api/logs/facets`, `GET /api/logs/histogram` | Log search (`q`, `level`, `service`, `node`, `before_id`, `after_id`). |
| `GET/POST /api/dashboards`, `GET/PUT/DELETE /api/dashboards/:id` | Dashboards. |
| `GET /api/containers`, `GET /api/services` | Latest container and systemd inventories. |
| `GET /api/job-types`, `GET/POST /api/jobs`, `PATCH/DELETE /api/jobs/:id` | Checks and collectors (secrets masked). |
| `GET/POST /api/channels`, `PATCH/DELETE /api/channels/:id`, `POST /api/channels/:id/test` | Notification channels. |
| `WS /ws/live` | Live updates for signed-in users. |
| `WS /ws/agent` | Agent connections (Bearer agent token). |
| `GET /install.sh`, `GET /agent/manifest`, `GET /agent/<file>` | Public agent installer and files. |
