# NetNew architecture

```
 machines being monitored                 NetNew server (backend/)                      browsers (frontend/)
┌────────────────────────┐   /ws/agent   ┌──────────────────────────────────┐   /api    ┌─────────────────────┐
│ agent/                 │ ────────────▶ │ realtime/agents.js  (ingestion)  │ ◀──────── │ landing, sign-in,   │
│  system metrics (1s)   │   samples,    │ core.js  (state, alerts, events) │  /ws/live │ setup, and the app  │
│  logs, containers,     │   logs, ...   │ db/      (SQLite)                │ ────────▶ │ under /app          │
│  services, jobs        │ ◀──────────── │ routes/  (REST API)              │           └─────────────────────┘
└────────────────────────┘   config      └──────────────────────────────────┘
```

## Backend (`backend/src`)

| Path | Responsibility |
|------|----------------|
| `index.js` | Entry point: loads config, starts the server, handles signals. |
| `server.js` | `startServer(config)`: opens the database, creates the core and the HTTP app, routes WebSocket upgrades, bootstraps an admin from the environment. Returns `close()` for tests. |
| `app.js` | Express app: public installer and agent files, the `/api` router, and the built frontend for every other path. |
| `config.js` | `loadConfig(env)`: environment variables to a config object; generates the agent token on first start. |
| `core.js` | Monitoring state shared by routes and the agent protocol: connected agents, latest samples, inventories, the alert engine, anomaly detector, notifier, event hub and background timers. |
| `realtime/agents.js` | The agent protocol: validates and ingests samples, logs, inventories and job results. |
| `realtime/live.js` | Live updates to signed-in browsers. |
| `routes/` | REST API, one module per area (`auth`, `workspace`, `nodes`, `charts`, `alerts`, `logs`, `dashboards`, `jobs`), plus shared helpers for time ranges and group scoping. |
| `services/` | Domain logic without HTTP: `alerts` (threshold engine), `anomalies` (EWMA baselines), `notifier` (Slack/Discord/webhook), `jobs` (collector job types and validation), `catalog` (chart titles, units, defaults), `series` (group-by/aggregation), `auth` (password hashing, sessions). |
| `db/` | SQLite (`node:sqlite`): `migrations.js` (schema, versioned with `PRAGMA user_version`), `index.js` (repositories, rollups, retention), `logs.js` (log storage with FTS5 search). |

### Request pipeline

`/api` → JSON body parser → same-origin check for writes → public routes (`/health`, `/auth/*`) → session
required → account routes (any signed-in user) → admin required for writes → feature routes.

Sessions are random 256-bit tokens in an `HttpOnly`, `SameSite=Lax` cookie; only their SHA-256 hash is stored.
Passwords are hashed with scrypt. The live WebSocket checks the same session cookie on upgrade; agents
authenticate with the workspace agent token as a Bearer header.

### Data model

| Table | Contents |
|-------|----------|
| `nodes` | One row per agent: host details, filesystems, first/last seen. |
| `metrics` | One summary row per node per second (CPU, memory, load, network, disk). Drives node cards, alerts and anomaly detection. |
| `dims`, `samples`, `samples_1m` | Chart data. A *dim* is (node, chart, instance, dimension), e.g. (web-01, net.traffic, eth0, received). `samples` holds per-second values; `samples_1m` per-minute averages used when a chart's buckets are a minute or longer. |
| `node_groups`, `node_group_members` | Groups of nodes. |
| `dashboards` | Dashboards per group; items are stored as JSON. |
| `alerts`, `events`, `anomalies` | Alert history, the event feed, flagged anomalous samples. |
| `logs` (+ `logs_fts`) | Log lines with an FTS5 index on the message. |
| `collector_jobs`, `channels` | Checks/collectors pushed to agents; notification channels. |
| `users`, `sessions`, `settings` | Accounts, sign-in sessions, workspace settings. |

### Chart queries

`GET /api/charts/data` loads all rows for one chart in the scope, bucketed so a chart has at most `points`
points, then `services/series.js` groups the members (node × instance × dimension) by dimension, node or
instance and combines each group with avg/sum/min/max. Long ranges read the per-minute tier for completed
minutes and raw samples after that, merged weighted by the seconds each row covers.

## Agent protocol (`/ws/agent`)

After connecting with `Authorization: Bearer <agent token>`, the agent sends:

| Message | When | Contents |
|---------|------|----------|
| `hello` / `info` | on connect / every 60 s | Node ID (persisted on the machine), hostname, OS, CPU, memory, filesystems. |
| `metrics` / `batch` | every second / after a reconnect | `ts`, summary `m`, and chart data `d` as `[chart, instance, {dimension: value}]` tuples. Up to 15 minutes are buffered while disconnected. |
| `processes` | every 3 s | Top 60 processes by CPU and process counts. |
| `logs` | every second | Journal and file log lines (rate-limited to 300/s). |
| `containers` | every 5 s | Docker containers and Kubernetes pods with resource use. |
| `services` | every 30 s | systemd service units. |
| `jobs` | after each job run | Collector job results (ok, error, latency, consecutive failures). |

The server sends `config` with the node's collector jobs on connect and whenever they change.

## Frontend (`frontend/src`)

| Path | Responsibility |
|------|----------------|
| `app/App.jsx` | Routes: `/` landing, `/login`, `/setup`, and the signed-in app under `/app`. |
| `pages/marketing` | Public landing page. |
| `pages/auth` | Sign-in and first-run setup. |
| `pages/app` | The app's views: Overview, Nodes, Metrics, Dashboards, Logs, Containers, Services, Processes, Alerts, Anomalies, Activity, the node page, Connect a server, Settings. |
| `components/layout` | App frame: sectioned navigation sidebar, top bar with the group switcher, ⌘K command palette, time range and user menu; `nav.js` lists the pages. |
| `components/charts` | uPlot chart, the chart card (group-by, aggregation and chart type in its options menu), and the metrics explorer (category filter, chart search, node filter). |
| `components/ui` | Shared UI primitives and icons. |
| `components/connect` | Install instructions per platform and guides for logs and containers, used by the Connect a server page. |
| `components/*` | Feature components: group dialog, collector jobs, add-to-dashboard, process table. |
| `state/` | React contexts: auth (session and role), workspace (groups, nodes, alerts kept live), time window, theme. |
| `lib/` | API client and live WebSocket, formatting, and `scope.js`: the group every page is scoped to, kept in the URL as `?group=<id>`. |
| `styles/` | App and landing page styles, with light and dark themes. |
