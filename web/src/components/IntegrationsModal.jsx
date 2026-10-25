import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CodeBlock, Modal, SearchInput } from './Bits.jsx';
import Icon from './Icon.jsx';
import { JobForm, useJobNodes } from './Jobs.jsx';

const TOKEN = '<TOKEN>';

const CATEGORIES = [
  { id: 'deploy.operating-systems', group: 'Deploy', name: 'Operating Systems' },
  { id: 'deploy.docker', group: 'Deploy', name: 'Docker' },
  { id: 'deploy.kubernetes', group: 'Deploy', name: 'Kubernetes' },
  { id: 'notify.alerts', group: 'Alerts & Notifications', name: 'Notification channels' },
  { id: 'collect.apps', group: 'Data Collection', name: 'Applications & checks' },
  { id: 'collect.containers', group: 'Data Collection', name: 'Containers' },
  { id: 'collect.logs', group: 'Data Collection', name: 'Logs' },
  { id: 'collect.system', group: 'Data Collection', name: 'System metrics' },
];

const TokenNote = () => (
  <p className="muted small">
    Replace <code>{TOKEN}</code> with your agent token. The server prints it on start and saves it in{' '}
    <code>server/data/agent-token</code> (or set <code>AGENT_TOKEN</code>). The agent needs Node.js 18+.
  </p>
);

const manual = (o) => `mkdir -p netnew-agent && cd netnew-agent
for f in $(curl -fsSL ${o}/agent/manifest); do curl -fsSL -O ${o}/agent/$f; done
npm install --omit=dev
NETNEW_URL=${o} NETNEW_TOKEN=${TOKEN} node index.js`;

// Shell snippet for container images: download the agent's files, install, run.
const fetchAndRun = (o) => `mkdir -p /agent && cd /agent && for f in $(wget -qO- ${o}/agent/manifest); do wget -q ${o}/agent/$f; done && npm install --omit=dev --silent && node index.js`;

function AppJob({ type }) {
  const nodes = useJobNodes();
  const [saved, setSaved] = useState(null);
  if (!nodes.length) return <p className="muted">Connect a node first; jobs run on a node's agent.</p>;
  if (saved) {
    return (
      <p className="ok-text">
        <Icon name="check" size={16} /> {saved.name} was added. Its status and charts appear on the{' '}
        <Link to={`/nodes/${saved.node_id}/services`}>node's Services tab</Link> within a few seconds.
      </p>
    );
  }
  return <JobForm type={type} nodes={nodes} onSaved={setSaved} submitLabel="Add job" />;
}

const INTEGRATIONS = [
  {
    id: 'linux', category: 'deploy.operating-systems', name: 'Linux', badge: 'Lx', color: '#f5a623',
    description: 'One command for any systemd-based distribution.',
    render: (o) => (
      <>
        <p>Installs the agent to <code>/opt/netnew-agent</code> and runs it as the <code>netnew-agent</code> systemd service.</p>
        <CodeBlock>{`curl -fsSL ${o}/install.sh | sudo sh -s -- --token ${TOKEN}`}</CodeBlock>
        <TokenNote />
        <h4>Verify</h4>
        <CodeBlock>{'systemctl status netnew-agent\njournalctl -u netnew-agent -f'}</CodeBlock>
        <h4>Uninstall</h4>
        <CodeBlock>{`curl -fsSL ${o}/install.sh | sudo sh -s -- --uninstall`}</CodeBlock>
      </>
    ),
  },
  {
    id: 'debian', category: 'deploy.operating-systems', name: 'Ubuntu / Debian', badge: 'Ub', color: '#e95420',
    description: 'Install Node.js from apt, then run the installer.',
    render: (o) => (
      <>
        <CodeBlock>{`sudo apt-get update && sudo apt-get install -y nodejs npm curl
curl -fsSL ${o}/install.sh | sudo sh -s -- --token ${TOKEN}`}</CodeBlock>
        <TokenNote />
      </>
    ),
  },
  {
    id: 'rhel', category: 'deploy.operating-systems', name: 'RHEL / Fedora / Rocky', badge: 'Rh', color: '#cc0000',
    description: 'Install Node.js from dnf, then run the installer.',
    render: (o) => (
      <>
        <CodeBlock>{`sudo dnf install -y nodejs npm curl
curl -fsSL ${o}/install.sh | sudo sh -s -- --token ${TOKEN}`}</CodeBlock>
        <TokenNote />
      </>
    ),
  },
  {
    id: 'macos', category: 'deploy.operating-systems', name: 'macOS', badge: 'Ma', color: '#9b9b9b',
    description: 'Run the agent with Node.js, optionally as a LaunchAgent.',
    render: (o) => (
      <>
        <CodeBlock>{`brew install node\n${manual(o)}`}</CodeBlock>
        <TokenNote />
        <h4>Run at login (optional)</h4>
        <p className="muted small">Save as <code>~/Library/LaunchAgents/dev.netnew.agent.plist</code>, then run <code>launchctl load</code> on it.</p>
        <CodeBlock title="xml">{`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>dev.netnew.agent</string>
  <key>ProgramArguments</key><array>
    <string>/opt/homebrew/bin/node</string>
    <string>/Users/YOU/netnew-agent/index.js</string>
  </array>
  <key>EnvironmentVariables</key><dict>
    <key>NETNEW_URL</key><string>${o}</string>
    <key>NETNEW_TOKEN</key><string>${TOKEN}</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
</dict></plist>`}</CodeBlock>
      </>
    ),
  },
  {
    id: 'windows', category: 'deploy.operating-systems', name: 'Windows', badge: 'Wi', color: '#3f8fe0',
    description: 'Run the agent from PowerShell with Node.js installed.',
    render: (o) => (
      <>
        <CodeBlock title="powershell">{`winget install OpenJS.NodeJS.LTS
mkdir $env:ProgramData\\netnew-agent; cd $env:ProgramData\\netnew-agent
foreach ($f in (Invoke-RestMethod ${o}/agent/manifest).Trim() -split "\n") { Invoke-WebRequest ${o}/agent/$f -OutFile $f }
npm install --omit=dev
$env:NETNEW_URL="${o}"; $env:NETNEW_TOKEN="${TOKEN}"; node index.js`}</CodeBlock>
        <TokenNote />
        <p className="muted small">To keep it running, register <code>node index.js</code> as a service with a tool such as NSSM, or a Task Scheduler task that starts at boot.</p>
      </>
    ),
  },
  {
    id: 'freebsd', category: 'deploy.operating-systems', name: 'FreeBSD', badge: 'Fb', color: '#ab2b28',
    description: 'Install Node.js from pkg and run the agent.',
    render: (o) => (
      <>
        <CodeBlock>{`pkg install -y node npm curl\n${manual(o)}`}</CodeBlock>
        <TokenNote />
      </>
    ),
  },
  {
    id: 'docker', category: 'deploy.docker', name: 'Docker', badge: 'Dk', color: '#2496ed',
    description: 'Monitor a Docker host by running the agent in a container.',
    render: (o) => (
      <>
        <p>Host networking and PID namespace let the agent see the host's network interfaces and processes.</p>
        <CodeBlock>{`docker run -d --name netnew-agent --restart unless-stopped \\
  --network host --pid host \\
  -e NETNEW_URL=${o} -e NETNEW_TOKEN=${TOKEN} \\
  -e NETNEW_HOSTNAME=$(hostname) -e NETNEW_STATE_DIR=/state \\
  -v netnew-agent:/state \\
  -v /var/run/docker.sock:/var/run/docker.sock:ro \\
  node:22-alpine sh -c '${fetchAndRun(o)}'`}</CodeBlock>
        <p className="muted small">Mounting the Docker socket lets the agent report per-container CPU, memory, network and disk I/O.</p>
        <TokenNote />
      </>
    ),
  },
  {
    id: 'compose', category: 'deploy.docker', name: 'Docker Compose', badge: 'Dc', color: '#1d63ed',
    description: 'The same agent container as a Compose service.',
    render: (o) => (
      <>
        <CodeBlock title="yaml">{`services:
  netnew-agent:
    image: node:22-alpine
    network_mode: host
    pid: host
    restart: unless-stopped
    environment:
      NETNEW_URL: ${o}
      NETNEW_TOKEN: ${TOKEN}
      NETNEW_STATE_DIR: /state
    volumes:
      - netnew-agent:/state
      - /var/run/docker.sock:/var/run/docker.sock:ro
    # $$ escapes $ from Compose's variable interpolation.
    command: ["sh", "-c", "${fetchAndRun(o).replace(/\$/g, '$$$$')}"]
volumes:
  netnew-agent:`}</CodeBlock>
        <TokenNote />
      </>
    ),
  },
  {
    id: 'kubernetes', category: 'deploy.kubernetes', name: 'Kubernetes', badge: 'K8', color: '#326ce5',
    description: 'A DaemonSet runs one agent on every cluster node, with pod metrics.',
    render: (o) => (
      <>
        <p>Each agent reports its node's metrics, logs and the pods running on it. Pod names come from the API server (read-only access to pods); pod CPU, memory and I/O come from the host's cgroup v2 hierarchy.</p>
        <CodeBlock>{`kubectl create namespace netnew
kubectl -n netnew create secret generic netnew-agent --from-literal=token=${TOKEN}`}</CodeBlock>
        <CodeBlock title="yaml">{`apiVersion: v1
kind: ServiceAccount
metadata: { name: netnew-agent, namespace: netnew }
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata: { name: netnew-agent }
rules:
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["get", "list"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata: { name: netnew-agent }
roleRef: { apiGroup: rbac.authorization.k8s.io, kind: ClusterRole, name: netnew-agent }
subjects: [{ kind: ServiceAccount, name: netnew-agent, namespace: netnew }]
---
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: netnew-agent
  namespace: netnew
spec:
  selector:
    matchLabels: { app: netnew-agent }
  template:
    metadata:
      labels: { app: netnew-agent }
    spec:
      serviceAccountName: netnew-agent
      hostNetwork: true
      hostPID: true
      tolerations: [{ operator: Exists }]
      containers:
        - name: agent
          image: node:22-alpine
          command: ["sh", "-c"]
          args:
            - ${fetchAndRun(o)}
          env:
            - name: NETNEW_URL
              value: ${o}
            - name: NETNEW_TOKEN
              valueFrom: { secretKeyRef: { name: netnew-agent, key: token } }
            - name: NETNEW_HOSTNAME
              valueFrom: { fieldRef: { fieldPath: spec.nodeName } }
            - name: NETNEW_K8S_NODE
              valueFrom: { fieldRef: { fieldPath: spec.nodeName } }
            - name: NETNEW_STATE_DIR
              value: /state
            - name: NETNEW_CGROUP_ROOT
              value: /host/sys/fs/cgroup
          volumeMounts:
            - { name: state, mountPath: /state }
            - { name: cgroup, mountPath: /host/sys/fs/cgroup, readOnly: true }
          resources:
            requests: { cpu: 20m, memory: 64Mi }
            limits: { memory: 192Mi }
      volumes:
        - name: state
          hostPath: { path: /var/lib/netnew-agent, type: DirectoryOrCreate }
        - name: cgroup
          hostPath: { path: /sys/fs/cgroup }`}</CodeBlock>
      </>
    ),
  },
  ...[
    { id: 'slack', name: 'Slack', badge: 'Sl', color: '#4a154b', what: 'a Slack incoming webhook URL' },
    { id: 'discord', name: 'Discord', badge: 'Di', color: '#5865f2', what: 'a Discord channel webhook URL' },
    { id: 'webhook', name: 'Webhook', badge: 'Wh', color: '#00ab44', what: 'any HTTP endpoint; it receives the full alert as JSON' },
  ].map((n) => ({
    ...n,
    category: 'notify.alerts',
    description: `Send alert notifications to ${n.name}.`,
    render: () => (
      <>
        <p>Add a {n.name} channel with {n.what}. Each channel chooses whether it gets warnings and criticals, or criticals only. Clears are sent for alerts that were notified.</p>
        <Link className="button primary" to="/settings/notifications">Configure notification channels</Link>
      </>
    ),
  })),
  ...[
    { id: 'job-http', type: 'http', name: 'HTTP endpoint', badge: 'Ht', color: '#00ab44', description: 'Status code, response time and body checks for any URL.' },
    { id: 'job-tcp', type: 'tcp', name: 'TCP port', badge: 'Tc', color: '#3f8fe0', description: 'Is a port accepting connections, and how fast.' },
    { id: 'job-ping', type: 'ping', name: 'Ping', badge: 'Pi', color: '#9b6cf0', description: 'ICMP round-trip time and packet loss to a host.' },
    { id: 'job-nginx', type: 'nginx', name: 'Nginx', badge: 'Ng', color: '#009639', description: 'Connections and requests/s from stub_status.' },
    { id: 'job-redis', type: 'redis', name: 'Redis', badge: 'Re', color: '#d82c20', description: 'Clients, memory, ops/s, hit ratio and keys.' },
    { id: 'job-postgres', type: 'postgres', name: 'PostgreSQL', badge: 'Pg', color: '#336791', description: 'Connections, transactions, cache hit ratio, size.' },
    { id: 'job-mysql', type: 'mysql', name: 'MySQL / MariaDB', badge: 'My', color: '#00758f', description: 'Connections, queries, slow queries, traffic.' },
  ].map((j) => ({ ...j, category: 'collect.apps', render: () => <AppJob type={j.type} /> })),
  {
    id: 'docker-containers', category: 'collect.containers', name: 'Docker containers', badge: 'Dk', color: '#2496ed',
    description: 'Per-container CPU, memory, network and disk I/O. Automatic when the agent can reach the Docker socket.',
    render: () => (
      <>
        <p>The agent reads the Docker Engine API on <code>/var/run/docker.sock</code> every 5 seconds. No configuration is needed, but the agent's user must be able to read the socket:</p>
        <CodeBlock>{'sudo usermod -aG docker netnew   # or run the agent as root (the installer does)'}</CodeBlock>
        <p className="muted small">Use <code>NETNEW_DOCKER_SOCKET</code> for a non-standard socket path. Results appear on the Containers tab.</p>
      </>
    ),
  },
  {
    id: 'k8s-pods', category: 'collect.containers', name: 'Kubernetes pods', badge: 'K8', color: '#326ce5',
    description: 'Pod CPU, memory and I/O plus phase and restarts, when deployed as the DaemonSet.',
    render: () => (
      <p>Deploy the agent with the <strong>Kubernetes</strong> manifest under Deploy. It needs read access to pods and the host's <code>/sys/fs/cgroup</code> (cgroup v2), both included in that manifest.</p>
    ),
  },
  {
    id: 'journal', category: 'collect.logs', name: 'systemd journal', badge: 'Jr', color: '#7f8c99',
    description: 'Every journal entry, with unit and priority. Automatic on systemd Linux.',
    render: () => (
      <>
        <p>On Linux the agent follows the journal with <code>journalctl -o json -f</code>, starting from when it connects. Entries keep their unit name and syslog priority, so the Logs tab can filter by service and level.</p>
        <p className="muted small">Running as a non-root user? Add it to the <code>systemd-journal</code> group. Turn this off with <code>NETNEW_DISABLE=journal</code>.</p>
      </>
    ),
  },
  {
    id: 'logfiles', category: 'collect.logs', name: 'Log files', badge: 'Lf', color: '#5c7cfa',
    description: 'Tail any text log file, such as Nginx, application or syslog files.',
    render: () => (
      <>
        <p>List the files in <code>NETNEW_LOG_FILES</code>, separated by commas. The agent follows new lines (handling rotation) and guesses each line's level from words like ERROR and WARN.</p>
        <CodeBlock>{`# /etc/netnew-agent.env
NETNEW_LOG_FILES=/var/log/nginx/error.log,/var/log/myapp/app.log`}</CodeBlock>
        <CodeBlock>{'sudo systemctl restart netnew-agent'}</CodeBlock>
        <p className="muted small">The agent sends at most 300 lines per second; extra lines are counted and reported. Logs are kept for 72 hours by default (<code>LOG_RETENTION_HOURS</code> on the server).</p>
      </>
    ),
  },
  ...[
    { id: 'cpu', name: 'CPU', badge: 'Cp', contexts: 'system.cpu, cpu.core, system.load, system.ctxt, system.intr' },
    { id: 'memory', name: 'Memory', badge: 'Me', contexts: 'mem.usage, mem.available, mem.swap' },
    { id: 'disks', name: 'Disks', badge: 'Di', contexts: 'disk.io, disk.ops, disk.util, disk.space' },
    { id: 'network', name: 'Network interfaces', badge: 'Ne', contexts: 'net.traffic, net.packets, net.errors' },
    { id: 'processes', name: 'Processes', badge: 'Pr', contexts: 'system.processes, system.active_processes, system.forks, and the Top tab' },
    { id: 'sensors', name: 'Sensors', badge: 'Se', contexts: 'sensors.temperature (when the hardware exposes it)' },
  ].map((c) => ({
    ...c,
    category: 'collect.system',
    color: '#7f8c99',
    description: `Collected every second. Enabled by default.`,
    render: () => (
      <>
        <p>The agent collects this automatically, every second, with no configuration. On Linux it reads <code>/proc</code> directly; other systems use the portable <code>systeminformation</code> library.</p>
        <p className="muted">Charts: <code>{c.contexts}</code></p>
      </>
    ),
  })),
];

function Badge({ item }) {
  return <span className="int-badge" style={{ background: item.color }}>{item.badge}</span>;
}

export function useIntegrations() {
  const [params, setParams] = useSearchParams();
  return {
    open: params.get('integrationsModalOpen') === 'true',
    category: params.get('selectedIntegrationCategory') || CATEGORIES[0].id,
    show(category = CATEGORIES[0].id) {
      setParams((p) => {
        p.set('integrationsModalOpen', 'true');
        p.set('selectedIntegrationCategory', category);
        return p;
      });
    },
    setCategory(category) {
      setParams((p) => { p.set('selectedIntegrationCategory', category); return p; }, { replace: true });
    },
    close() {
      setParams((p) => {
        p.delete('integrationsModalOpen');
        p.delete('selectedIntegrationCategory');
        return p;
      });
    },
  };
}

export default function IntegrationsModal() {
  const integrations = useIntegrations();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(null);
  const origin = window.location.origin;

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q) return INTEGRATIONS.filter((i) => `${i.name} ${i.description}`.toLowerCase().includes(q));
    return INTEGRATIONS.filter((i) => i.category === integrations.category);
  }, [query, integrations.category]);

  const groups = [...new Set(CATEGORIES.map((c) => c.group))];
  const current = CATEGORIES.find((c) => c.id === integrations.category);

  return (
    <Modal title="Integrations" wide onClose={integrations.close}>
      <div className="integrations">
        <aside className="int-nav">
          <SearchInput value={query} onChange={(v) => { setQuery(v); setSelected(null); }} placeholder="Search integrations" />
          {groups.map((g) => (
            <div key={g}>
              <div className="int-group">{g}</div>
              {CATEGORIES.filter((c) => c.group === g).map((c) => (
                <button key={c.id} type="button"
                  className={`int-cat ${c.id === integrations.category && !query ? 'active' : ''}`}
                  onClick={() => { integrations.setCategory(c.id); setQuery(''); setSelected(null); }}>
                  {c.name}
                  <span className="count">{INTEGRATIONS.filter((i) => i.category === c.id).length}</span>
                </button>
              ))}
            </div>
          ))}
        </aside>
        <div className="int-main">
          {selected ? (
            <div className="int-detail">
              <button type="button" className="ghost small" onClick={() => setSelected(null)}>
                <Icon name="back" size={14} /> All integrations
              </button>
              <div className="int-detail-head">
                <Badge item={selected} />
                <div>
                  <h3>{selected.name}</h3>
                  <p className="muted">{selected.description}</p>
                </div>
              </div>
              {selected.render(origin)}
            </div>
          ) : (
            <>
              <h3 className="int-title">{query ? `Results for “${query}”` : `${current?.group} › ${current?.name}`}</h3>
              <div className="int-grid">
                {list.map((item) => (
                  <button key={item.id} type="button" className="int-card" onClick={() => setSelected(item)}>
                    <Badge item={item} />
                    <span className="int-card-name">{item.name}</span>
                    <span className="muted small">{item.description}</span>
                  </button>
                ))}
                {!list.length && <p className="muted">No integrations match.</p>}
              </div>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
