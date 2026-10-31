import { CodeBlock } from '../ui/Bits.jsx';

// Install instructions for each platform the agent runs on, and guides for
// the extra data sources. `o` is the server's origin.
export const TOKEN = '<TOKEN>';

const TokenNote = () => (
  <p className="muted small">
    Replace <code>{TOKEN}</code> with your agent token: admins can fill it in above, or find it under
    Settings → General. The agent needs Node.js 18+.
  </p>
);

const manual = (o) => `mkdir -p netnew-agent && cd netnew-agent
for f in $(curl -fsSL ${o}/agent/manifest); do curl -fsSL --create-dirs -o "$f" ${o}/agent/$f; done
npm install --omit=dev
NETNEW_URL=${o} NETNEW_TOKEN=${TOKEN} node src/index.js`;

// Shell snippet for container images: download the agent's files, install, run.
const fetchAndRun = (o) => `mkdir -p /agent && cd /agent && for f in $(wget -qO- ${o}/agent/manifest); do mkdir -p $(dirname $f) && wget -qO $f ${o}/agent/$f; done && npm install --omit=dev --silent && node src/index.js`;

export const PLATFORMS = [
  {
    id: 'linux', name: 'Linux', badge: 'Lx', color: '#f5a623',
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
    id: 'debian', name: 'Ubuntu / Debian', badge: 'Ub', color: '#e95420',
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
    id: 'rhel', name: 'RHEL / Fedora / Rocky', badge: 'Rh', color: '#cc0000',
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
    id: 'macos', name: 'macOS', badge: 'Ma', color: '#9b9b9b',
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
    <string>/Users/YOU/netnew-agent/src/index.js</string>
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
    id: 'windows', name: 'Windows', badge: 'Wi', color: '#3f8fe0',
    description: 'Run the agent from PowerShell with Node.js installed.',
    render: (o) => (
      <>
        <CodeBlock title="powershell">{`winget install OpenJS.NodeJS.LTS
mkdir $env:ProgramData\\netnew-agent; cd $env:ProgramData\\netnew-agent
New-Item -ItemType Directory -Force src | Out-Null
foreach ($f in (Invoke-RestMethod ${o}/agent/manifest).Trim() -split "\n") { Invoke-WebRequest ${o}/agent/$f -OutFile $f }
npm install --omit=dev
$env:NETNEW_URL="${o}"; $env:NETNEW_TOKEN="${TOKEN}"; node src\\index.js`}</CodeBlock>
        <TokenNote />
        <p className="muted small">To keep it running, register <code>node src\index.js</code> as a service with a tool such as NSSM, or a Task Scheduler task that starts at boot.</p>
      </>
    ),
  },
  {
    id: 'freebsd', name: 'FreeBSD', badge: 'Fb', color: '#ab2b28',
    description: 'Install Node.js from pkg and run the agent.',
    render: (o) => (
      <>
        <CodeBlock>{`pkg install -y node npm curl\n${manual(o)}`}</CodeBlock>
        <TokenNote />
      </>
    ),
  },
  {
    id: 'docker', name: 'Docker', badge: 'Dk', color: '#2496ed',
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
    id: 'compose', name: 'Docker Compose', badge: 'Dc', color: '#1d63ed',
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
    id: 'kubernetes', name: 'Kubernetes', badge: 'K8', color: '#326ce5',
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
];

export const GUIDES = [
  {
    id: 'docker-containers', topic: 'containers', name: 'Docker containers', badge: 'Dk', color: '#2496ed',
    description: 'Per-container CPU, memory, network and disk I/O. Automatic when the agent can reach the Docker socket.',
    render: () => (
      <>
        <p>The agent reads the Docker Engine API on <code>/var/run/docker.sock</code> every 5 seconds. No configuration is needed, but the agent's user must be able to read the socket:</p>
        <CodeBlock>{'sudo usermod -aG docker netnew   # or run the agent as root (the installer does)'}</CodeBlock>
        <p className="muted small">Use <code>NETNEW_DOCKER_SOCKET</code> for a non-standard socket path. Results appear on the Containers page.</p>
      </>
    ),
  },
  {
    id: 'k8s-pods', topic: 'containers', name: 'Kubernetes pods', badge: 'K8', color: '#326ce5',
    description: 'Pod CPU, memory and I/O plus phase and restarts, when deployed as the DaemonSet.',
    render: () => (
      <p>Install the agent by choosing <strong>Kubernetes</strong> in step 1 above. It needs read access to pods and the host's <code>/sys/fs/cgroup</code> (cgroup v2), both included in that manifest.</p>
    ),
  },
  {
    id: 'journal', topic: 'logs', name: 'systemd journal', badge: 'Jr', color: '#7f8c99',
    description: 'Every journal entry, with unit and priority. Automatic on systemd Linux.',
    render: () => (
      <>
        <p>On Linux the agent follows the journal with <code>journalctl -o json -f</code>, starting from when it connects. Entries keep their unit name and syslog priority, so the Logs page can filter by service and level.</p>
        <p className="muted small">Running as a non-root user? Add it to the <code>systemd-journal</code> group. Turn this off with <code>NETNEW_DISABLE=journal</code>.</p>
      </>
    ),
  },
  {
    id: 'logfiles', topic: 'logs', name: 'Log files', badge: 'Lf', color: '#5c7cfa',
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
];
