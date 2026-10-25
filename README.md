# NetNew

Real-time infrastructure monitoring modeled on the [Netdata](https://www.netdata.cloud/) Cloud experience. A
lightweight agent on each server streams per-second metrics to a central server. The server stores them, evaluates
alerts, detects anomalies and pushes everything live to a React dashboard.

**The dashboard** follows Netdata Cloud's layout: a space with **rooms** of nodes, and room tabs for
**Home, Nodes, Metrics, Dashboards, Logs, Containers, Services, Top, Events, Alerts and Anomalies**. It has a global time picker with live/paused modes and
drag-to-zoom, light and dark themes, and an **Integrations** catalog. It also opens from the same URL parameters
Netdata uses, e.g. `?integrationsModalOpen=true&selectedIntegrationCategory=deploy.operating-systems`.

| Area | What you get |
|------|--------------|
| Metrics | Per-second CPU breakdown (user/system/iowait/softirq/steal…), per-core CPU, RAM, swap, load, context switches, interrupts, per-interface traffic/packets/errors, per-disk bandwidth/ops/busy time, per-mount disk space, process counts, CPU temperature. 19 chart types grouped into sections with a table of contents. |
| Charts | Netdata-style toolbar on every chart: **group by** dimension/node/instance, **aggregate** avg/sum/min/max, line/area/stacked, expand to full screen, shared hover cursor, drag to zoom. Charts refresh only while on screen. |
| Rooms | Group nodes by environment or team. Each room has its own view of every tab. The built-in "All nodes" room holds everything. |
| Nodes | Sortable, searchable table with live CPU/RAM/disk/load/network. Create rooms from a selection, delete offline nodes. |
| Top | Live `top`-style process list per node (CPU, memory, RSS, state, command), refreshed every 3s. |
| Alerts | CPU, RAM and disk-space thresholds (warning/critical, with hysteresis) and node-offline detection. Raised, history and configuration views. |
| Notifications | Slack, Discord and generic webhook channels, with a minimum severity, enable/disable and a test button. |
| Anomalies | Every metric is compared each second with a learned baseline (EWMA mean ± 4σ). Shows anomaly rate over time, a node × metric heat map and recent anomalies. |
| Dashboards | Build boards per room from any chart (any nodes, grouping, aggregation, type) plus text notes. Drag to reorder, resize width and height. "Add to dashboard" on every chart. |
| Logs | systemd journal (automatic on Linux) and any log files you list. Full-text search (SQLite FTS5), level/service/node facets with counts, a level histogram, live follow, paging to older lines. |
| Containers | Per-container CPU, memory, network and disk I/O from the Docker Engine API, plus Kubernetes pods (phase, restarts, CPU, memory, I/O) when deployed as a DaemonSet. |
| Services | Service checks (HTTP, TCP, ping) and application collectors (Nginx, Redis, PostgreSQL, MySQL), configured from the dashboard and run by the node's agent. Plus systemd unit states with a failed-unit alert. |
| Events | Feed of node created/connected/disconnected/removed events, alert transitions and notification failures. |
| Storage | SQLite via Node's built-in `node:sqlite` (nothing to compile). Per-second data plus a per-minute tier, so 24-hour charts stay fast. |

```
 ┌──────────────┐  WebSocket /ws/agent   ┌──────────────────────────────┐  WebSocket /ws/live  ┌───────────────┐
 │ agent (each  │ ─────────────────────▶ │ server (Express + ws)        │ ───────────────────▶ │ React         │
 │ server)      │  1 sample / second     │ SQLite · alerts · anomalies  │  REST /api/*         │ dashboard     │
 └──────────────┘  + process lists       │ notifications · rollups      │ ◀─────────────────── └───────────────┘
                                         └──────────────────────────────┘
```

## Project layout

| Path      | What it is |
|-----------|------------|
| `agent/`  | Node.js agent. `index.js` collects system metrics (reading `/proc` directly on Linux, `systeminformation` elsewhere) and buffers up to 15 minutes of samples while disconnected. `logs.js`, `containers.js`, `jobs.js` and `services.js` are the log, container, collector-job and systemd modules. |
| `server/` | Express API, agent and dashboard WebSockets, SQLite storage, alert engine, anomaly detector, notifier, `/install.sh`. |
| `web/`    | React + Vite dashboard with [uPlot](https://github.com/leeoniya/uPlot) charts. |

Server modules: `db.js` (schema, queries, retention and rollups), `api.js` (REST routes), `contexts.js` (chart
catalog: titles, units, sections, defaults), `shape.js` (group-by/aggregation), `logstore.js` (log storage and
search), `jobs.js` (collector job types and validation), `alerts.js`, `anomalies.js`, `notify.js`.

## Quick start (development)

The server needs **Node.js 22.13+**; the agent runs on Node 18+.

```bash
npm install

# 1. Server on :3000. It prints the agent token and saves it to server/data/agent-token.
npm run dev:server

# 2. Dashboard dev server on :5173 (proxies /api and /ws to :3000).
npm run dev:web

# 3. An agent for this machine.
cp agent/.env.example agent/.env   # paste the token into NETNEW_TOKEN
npm run dev:agent
```

Open http://localhost:5173.

## Production

```bash
npm install
npm run build        # builds web/dist, which the server serves
npm start            # http://0.0.0.0:3000
```

Or with Docker:

```bash
echo "DASHBOARD_PASSWORD=change-me" > .env
docker compose up -d --build
docker compose logs netnew | grep "Agent token"
```

For internet-facing deployments, put the server behind a TLS-terminating reverse proxy (nginx, Caddy). Agents
then use `https://` URLs and connect over `wss://` automatically. Make sure the proxy forwards WebSocket upgrades
for `/ws/`.

### Server configuration

Set these as environment variables or in `server/.env` (see `server/.env.example`).

| Variable             | Default  | Description |
|----------------------|----------|-------------|
| `PORT` / `HOST`      | `3000` / `0.0.0.0` | Listen address. |
| `DATA_DIR`           | `./data` | SQLite database and generated agent token. |
| `AGENT_TOKEN`        | generated | Shared secret agents must present. |
| `RETENTION_HOURS`    | `24`     | How long per-second and per-minute metrics are kept. Events and alert history are kept 7 days. |
| `LOG_RETENTION_HOURS` / `LOG_MAX_ROWS` | `72` / `2000000` | How long log lines are kept, and the cap on stored lines. |
| `OFFLINE_AFTER_SEC`  | `15`     | Silence before a node is marked offline and alerted on. |
| `SPACE_NAME`         | `My Space` | Name shown in the sidebar. |
| `PUBLIC_URL`         | unset    | Dashboard URL, used for links in notifications. |
| `DASHBOARD_USER`     | `admin`  | Basic-auth user for the dashboard and API. |
| `DASHBOARD_PASSWORD` | unset    | Enables basic auth. **Set this for any non-local deployment.** |

Storage needs are roughly 20 bytes per value. A typical 4-core VM reports about 50 values per second, which is
about 75 MB per node per day of retention.

## Adding nodes

In the dashboard, click **Connect nodes** for copy-paste instructions with your server URL filled in. The
Integrations window covers Linux, Ubuntu/Debian, RHEL/Fedora, macOS (with a LaunchAgent), Windows, FreeBSD, Docker,
Docker Compose and a Kubernetes DaemonSet.

**Linux with systemd:**

```bash
curl -fsSL https://monitor.example.com/install.sh | sudo sh -s -- --token <TOKEN>
systemctl status netnew-agent
```

This installs to `/opt/netnew-agent`, writes `/etc/netnew-agent.env` and registers the `netnew-agent` service.
Remove it with `… | sudo sh -s -- --uninstall`.

| Agent variable        | Default | Description |
|-----------------------|---------|-------------|
| `NETNEW_URL`          | `http://localhost:3000` | Server URL. |
| `NETNEW_TOKEN`        | required | Agent token. |
| `NETNEW_HOSTNAME`     | machine hostname | Display name in the dashboard. |
| `NETNEW_INTERVAL_MS`  | `1000`  | Collection interval. |
| `NETNEW_STATE_DIR`    | `~/.netnew-agent` | Where the persistent node ID is stored. |
| `NETNEW_LOG_FILES`    | none    | Comma-separated log files to tail. The systemd journal is read automatically. |
| `NETNEW_DISABLE`      | none    | Modules to turn off: `logs`, `journal`, `containers`, `services`, `processes`. |
| `NETNEW_DOCKER_SOCKET` | `/var/run/docker.sock` | Docker Engine API socket. |
| `NETNEW_CGROUP_ROOT` / `NETNEW_K8S_NODE` | `/sys/fs/cgroup` / hostname | Where pod cgroups live, and this node's Kubernetes name (both set by the DaemonSet manifest). |

The agent is several files; installers fetch the list from `GET /agent/manifest`. The PostgreSQL (`pg`) and
MySQL (`mysql2`) drivers are optional dependencies, loaded only when such a job runs.

## Logs

On Linux the agent follows the systemd journal (`journalctl -o json -f`) from the moment it connects, keeping
each entry's unit and syslog priority. Plain files listed in `NETNEW_LOG_FILES` are tailed with rotation
handling, and each line's level is guessed from words like ERROR and WARN. The agent sends at most 300 lines per
second and reports how many it dropped. On the server, lines go into SQLite with an FTS5 index. The Logs tab
searches all words as prefixes, filters by level, service and node, and follows new lines live.

## Containers and Kubernetes

If the agent can read the Docker socket, it reports every container's state, plus CPU (as a percentage of one
core), memory (excluding page cache), network and block I/O every 5 seconds. Deployed with the Kubernetes
manifest from the Integrations window, it also reports the pods on its node: names, phase and restarts from the
API server (read-only RBAC), and CPU/memory/I/O from the host's cgroup v2 tree.

## Service checks and application collectors

Add jobs from **Services → Add check or collector**, **Space settings → Collectors**, or the Integrations window.
The server stores them and pushes each node's jobs to its agent, which starts them within seconds.

| Type | Settings | Charts |
|------|----------|--------|
| HTTP | URL, method, expected status (e.g. `200-399`), body text, timeout | status, response time |
| TCP | host, port, timeout | status, connect time |
| Ping | host, packets per run (uses the system `ping`) | status, round-trip time, packet loss |
| Nginx | `stub_status` URL | connections by state, requests/s |
| Redis | host, port, password | clients, memory, ops/s, hits/misses, keys |
| PostgreSQL | connection string | connections, transactions/s, cache hit ratio, database size |
| MySQL / MariaDB | connection string | connections, queries/s, slow queries, traffic |

A job that fails twice in a row raises a critical alert naming the error, which clears on the next success.
Passwords and connection strings are stored on the server and sent only to the agent that runs the job. The API
never returns them to the browser.

## Alerts and notifications

Rules live in `server/src/alerts.js`. Each averages its value over a window, and an alert clears only once the
value drops 5 points below the threshold, so alerts don't flap.

| Alert            | Window | Warning | Critical |
|------------------|--------|---------|----------|
| CPU utilization  | 60s    | ≥ 80%   | ≥ 95%    |
| RAM usage        | 60s    | ≥ 85%   | ≥ 95%    |
| Disk space usage | 10s    | ≥ 85%   | ≥ 95%    |
| Node offline     | no data for `OFFLINE_AFTER_SEC` | | critical |
| Service check failed | 2 consecutive failed runs | | critical |
| Failed systemd units | any unit in the `failed` state | warning | |

Add Slack, Discord or webhook channels under **Space settings → Alert notifications**. Notifications are sent
when an alert is raised, changes severity or clears. Webhook channels receive the full alert as JSON:

```json
{ "kind": "raised", "status": "warning", "text": "🟠 [WARNING] web-01: CPU utilization is 82.3% (60s average)",
  "alert": { "rule": "cpu_usage", "severity": "warning", "value": 82.3, "node_id": "…", "started_at": 1792874231 },
  "node": { "id": "…", "hostname": "web-01" }, "ts": 1792874231 }
```

## API

Time-ranged endpoints take Netdata-style `after`/`before`: unix seconds, or relative to now when ≤ 0
(`after=-900&before=0` means the last 15 minutes). Scoped endpoints take `room=<id>` (default: all nodes) and/or
`nodes=id1,id2`.

| Endpoint | Description |
|----------|-------------|
| `GET /api/space` | Space name, version, retention, auth status. |
| `GET/POST /api/rooms`, `PATCH/DELETE /api/rooms/:id`, `PUT /api/rooms/:id/nodes` | Rooms and their members. |
| `GET /api/nodes` | Nodes with status, latest summary sample and alert counts. |
| `GET/DELETE /api/nodes/:id` | One node; delete an offline node and its data. |
| `GET /api/nodes/:id/processes` | Latest process snapshot (top 60 by CPU). |
| `GET /api/contexts` | Charts available for the scope, with sections, instances and dimensions. |
| `GET /api/data?context=system.cpu&group_by=node&agg=sum&dims=user,system&points=600` | Chart data for one context. |
| `GET /api/nodes/:id/metrics`, `GET /api/overview?metric=cpu\|ram\|net\|load\|disk` | Summary-metric history. |
| `GET /api/alerts[?state=active]`, `GET /api/alert-rules` | Alerts and rule definitions. |
| `GET /api/events?type=node,alert,notification` | Event feed. |
| `GET /api/anomalies` | Anomaly rates per node and metric, timeline, recent anomalies. |
| `GET /api/logs?q=&level=error,warning&service=&node=&before_id=&after_id=` | Log lines, newest first (`after_id` returns newer lines, oldest first). |
| `GET /api/logs/facets`, `GET /api/logs/histogram` | Facet counts and per-level histogram for the same filters. |
| `GET/POST /api/dashboards`, `GET/PUT/DELETE /api/dashboards/:id` | Custom dashboards (`?room=` to list a room's). |
| `GET /api/catalog` | Every chart context with title, units and defaults. |
| `GET /api/containers`, `GET /api/services` | Latest Docker/Kubernetes and systemd inventories per node. |
| `GET /api/job-types`, `GET/POST /api/jobs`, `PATCH/DELETE /api/jobs/:id` | Collector jobs (secrets masked) with their latest status. |
| `GET/POST /api/channels`, `PATCH/DELETE /api/channels/:id`, `POST /api/channels/:id/test` | Notification channels. |
| `GET /api/health` | Liveness check. |
| `WS /ws/live` | Live stream of `sample`, `node`, `node_removed`, `alert`, `event`, `logs` and `rooms` messages. |
