# NetNew

Real-time infrastructure monitoring in the spirit of [Netdata](https://www.netdata.cloud/): a lightweight agent on
each server streams per-second metrics to a central server, which stores them, evaluates alerts and pushes
everything live to a React dashboard.

- **Per-second metrics**: CPU (total/user/system), memory and swap, load average, network traffic, disk I/O and
  filesystem usage
- **Live dashboard**: an overview of all nodes with cross-node charts, plus a detail page per node, all updated
  over WebSockets
- **Time ranges**: 5m, 15m, 1h, 6h and 24h, with server-side downsampling and synchronized chart cursors
- **Alerts**: CPU, RAM and disk-space thresholds with warning/critical levels, plus node-offline detection, active
  and history views
- **One-command agent install** for Linux/systemd (`curl … | sudo sh`), or run the agent manually on macOS/Windows
- **Zero external services**: SQLite storage via Node's built-in `node:sqlite`, nothing to compile

```
 ┌──────────────┐  WebSocket /ws/agent   ┌─────────────────────────┐  WebSocket /ws/live  ┌───────────────┐
 │ agent (each  │ ─────────────────────▶ │ server (Express + ws)   │ ───────────────────▶ │ React         │
 │ server)      │  1 sample / second     │ SQLite · alert engine   │  REST /api/*         │ dashboard     │
 └──────────────┘                        └─────────────────────────┘ ◀─────────────────── └───────────────┘
```

## Project layout

| Path      | What it is |
|-----------|------------|
| `agent/`  | Node.js agent (`systeminformation` + `ws`). Buffers up to 15 min of samples while disconnected. |
| `server/` | Express API, agent and dashboard WebSockets, SQLite storage, alert engine, `/install.sh`. |
| `web/`    | React + Vite dashboard with [uPlot](https://github.com/leeoniya/uPlot) charts. |

## Quick start (development)

Requires **Node.js 22.13+** for the server (the agent runs on Node 18+).

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

Put the server behind a TLS-terminating reverse proxy (nginx, Caddy) for internet-facing deployments. Agents then
use `https://` URLs and connect over `wss://` automatically. Make sure the proxy forwards WebSocket upgrades for
`/ws/`.

### Server configuration

Set these as environment variables or in `server/.env` (see `server/.env.example`).

| Variable             | Default  | Description |
|----------------------|----------|-------------|
| `PORT` / `HOST`      | `3000` / `0.0.0.0` | Listen address. |
| `DATA_DIR`           | `./data` | SQLite database and generated agent token. |
| `AGENT_TOKEN`        | generated | Shared secret agents must present. |
| `RETENTION_HOURS`    | `24`     | How long per-second metrics are kept. |
| `OFFLINE_AFTER_SEC`  | `15`     | Silence before a node is marked offline and alerted on. |
| `DASHBOARD_USER`     | `admin`  | Basic-auth user for the dashboard and API. |
| `DASHBOARD_PASSWORD` | unset    | Enables basic auth. **Set this for any non-local deployment.** |

## Adding nodes

The dashboard's **Add nodes** page shows these commands with your server's URL filled in.

**Linux with systemd:**

```bash
curl -fsSL https://monitor.example.com/install.sh | sudo sh -s -- --token <TOKEN>
systemctl status netnew-agent
```

This installs to `/opt/netnew-agent`, writes `/etc/netnew-agent.env` and registers the `netnew-agent` service.
Remove it with `… | sudo sh -s -- --uninstall`.

**Anywhere else (macOS, Windows, containers):**

```bash
curl -fsSL -O https://monitor.example.com/agent/index.js -O https://monitor.example.com/agent/package.json
npm install --omit=dev
NETNEW_URL=https://monitor.example.com NETNEW_TOKEN=<TOKEN> node index.js
```

| Agent variable        | Default | Description |
|-----------------------|---------|-------------|
| `NETNEW_URL`          | `http://localhost:3000` | Server URL. |
| `NETNEW_TOKEN`        | required | Agent token. |
| `NETNEW_HOSTNAME`     | machine hostname | Display name in the dashboard. |
| `NETNEW_INTERVAL_MS`  | `1000`  | Collection interval. |
| `NETNEW_STATE_DIR`    | `~/.netnew-agent` | Where the persistent node ID is stored. |

## Alerts

Rules live in `server/src/alerts.js`. Each rule averages its value over a window, and an alert clears only once
the value drops 5 points below the threshold, so alerts don't flap.

| Alert            | Window | Warning | Critical |
|------------------|--------|---------|----------|
| CPU utilization  | 60s    | ≥ 80%   | ≥ 95%    |
| RAM usage        | 60s    | ≥ 85%   | ≥ 95%    |
| Disk space usage | 10s    | ≥ 85%   | ≥ 95%    |
| Node offline     | no data for `OFFLINE_AFTER_SEC` | | critical |

## API

| Endpoint | Description |
|----------|-------------|
| `GET /api/nodes` | All nodes with status, latest sample and alert counts. |
| `GET /api/nodes/:id` | One node. |
| `DELETE /api/nodes/:id` | Remove an offline node and its data. |
| `GET /api/nodes/:id/metrics?after=-900&before=0&points=900` | Node history. `after`/`before` are unix seconds, or relative to now when ≤ 0. |
| `GET /api/overview?metric=cpu\|ram\|net\|load\|disk&after=-900` | One metric across all nodes. |
| `GET /api/alerts[?state=active]` | Active alerts, or the 200 most recent. |
| `GET /api/health` | Liveness check. |
| `WS /ws/live` | Live stream of `sample`, `node`, `node_removed` and `alert` events. |
