import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CodeBlock } from '../../components/ui/Bits.jsx';
import Icon, { Logo } from '../../components/ui/Icon.jsx';
import { useAuth } from '../../state/auth.jsx';
import { useTheme } from '../../state/theme.jsx';
import '../../styles/landing.css';

const REPO_URL = 'https://github.com/rajkumar-madhu/netnew';

const FEATURES = [
  { icon: 'metrics', title: 'Per-second metrics', text: 'CPU by state and core, memory, disks, network interfaces, processes and sensors, collected every second with no configuration.' },
  { icon: 'nodes', title: 'Groups of nodes', text: 'Organize servers by environment, team or service. Every view, alert and dashboard can be scoped to a group.' },
  { icon: 'dashboard', title: 'Custom dashboards', text: 'Drag any chart onto a board, choose how series are grouped and aggregated, add notes, and share it with your team.' },
  { icon: 'logs', title: 'Logs', text: 'The systemd journal and any log file, searchable in full text with level, service and node filters and live follow.' },
  { icon: 'container', title: 'Containers & Kubernetes', text: 'Per-container CPU, memory, network and disk from Docker, and pods with phase and restarts on Kubernetes.' },
  { icon: 'services', title: 'Service checks', text: 'HTTP, TCP and ping checks plus Nginx, Redis, PostgreSQL and MySQL collectors, configured from the browser.' },
  { icon: 'alerts', title: 'Alerts that reach you', text: 'Sensible thresholds out of the box, offline and failed-check detection, delivered to Slack, Discord or any webhook.' },
  { icon: 'anomalies', title: 'Anomaly detection', text: 'Every metric is compared with its own learned baseline each second, so unusual behaviour stands out before it pages you.' },
];

const STEPS = [
  { title: 'Run the server', text: 'One container or one Node.js process. Data lives in a single SQLite file on your own disk.', code: 'docker compose up -d' },
  { title: 'Connect your machines', text: 'Paste one command on each server. The agent installs as a service and starts streaming within seconds.', code: 'curl -fsSL https://your-server/install.sh | sudo sh -s -- --token <TOKEN>' },
  { title: 'Watch and get alerted', text: 'Live charts, logs and checks for every node, with alerts sent wherever your team already talks.', code: 'open https://your-server/app' },
];

const INTEGRATIONS = ['Linux', 'macOS', 'Windows', 'FreeBSD', 'Docker', 'Kubernetes', 'Nginx', 'Redis', 'PostgreSQL', 'MySQL', 'systemd', 'Slack', 'Discord', 'Webhooks'];

const FAQ = [
  { q: 'Where is my data stored?', a: 'On the server you run. NetNew keeps metrics, logs and settings in a SQLite database in its data directory; nothing is sent to a third party.' },
  { q: 'How much does an agent cost to run?', a: 'The agent is a small Node.js process that samples once per second. On a typical server it uses a fraction of one CPU percent and well under 100 MB of memory.' },
  { q: 'How long is data kept?', a: 'Per-second metrics for 24 hours and logs for 72 hours by default, with per-minute rollups that keep long time ranges fast. Both are configurable.' },
  { q: 'Can my whole team use it?', a: 'Yes. Admins invite users as admins or read-only viewers, and everyone shares the same groups and dashboards.' },
];

// Animated illustration of the app: a few cards and a moving chart line.
function HeroPreview() {
  const [points, setPoints] = useState(() => Array.from({ length: 40 }, (_, i) => 30 + 14 * Math.sin(i / 4) + Math.random() * 8));
  useEffect(() => {
    const id = setInterval(() => {
      setPoints((p) => [...p.slice(1), Math.max(6, Math.min(70, p.at(-1) + (Math.random() - 0.48) * 12))]);
    }, 900);
    return () => clearInterval(id);
  }, []);
  const path = points.map((v, i) => `${i === 0 ? 'M' : 'L'}${(i / (points.length - 1)) * 300},${80 - v}`).join(' ');

  return (
    <div className="lp-preview" aria-hidden="true">
      <div className="lp-preview-bar"><span /><span /><span /></div>
      <div className="lp-preview-body">
        <div className="lp-preview-side">
          <div className="lp-preview-pill active" />
          <div className="lp-preview-pill" />
          <div className="lp-preview-pill" />
        </div>
        <div className="lp-preview-main">
          <div className="lp-preview-stats">
            <div><small>Nodes live</small><b>12 / 12</b></div>
            <div><small>CPU</small><b>{Math.round(points.at(-1))}%</b></div>
            <div><small>Alerts</small><b className="ok">0</b></div>
          </div>
          <div className="lp-preview-chart">
            <small>CPU utilization · last 5 minutes</small>
            <svg viewBox="0 0 300 80" preserveAspectRatio="none">
              <path d={`${path} L300,80 L0,80 Z`} className="area" />
              <path d={path} className="line" />
            </svg>
          </div>
          <div className="lp-preview-rows">
            {['web-01', 'db-01', 'cache-01'].map((h, i) => (
              <div key={h}><span className="dot" />{h}<i style={{ width: `${30 + i * 18}%` }} /></div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Landing() {
  const auth = useAuth();
  const { theme, toggle } = useTheme();
  const start = auth.user ? '/app' : auth.setupRequired ? '/setup' : '/login';
  const startLabel = auth.user ? 'Open the app' : auth.setupRequired ? 'Get started' : 'Sign in';

  return (
    <div className="lp">
      <header className="lp-nav">
        <Link to="/" className="lp-brand"><Logo size={28} /> NetNew</Link>
        <nav className="lp-links" aria-label="Sections">
          <a href="#features">Features</a>
          <a href="#how">How it works</a>
          <a href="#integrations">Integrations</a>
          <a href="#faq">FAQ</a>
        </nav>
        <div className="lp-nav-actions">
          <button type="button" className="icon-button" onClick={toggle} aria-label="Toggle theme"><Icon name={theme === 'dark' ? 'sun' : 'moon'} /></button>
          {!auth.user && !auth.setupRequired && <Link to="/login" className="lp-signin">Sign in</Link>}
          <Link to={start} className="button primary">{auth.user ? 'Open the app' : 'Get started'}</Link>
        </div>
      </header>

      <section className="lp-hero">
        <div className="lp-hero-copy">
          <span className="lp-eyebrow">Self-hosted infrastructure monitoring</span>
          <h1>See every server, <span>every second.</span></h1>
          <p>
            NetNew streams metrics, logs, containers and service health from all your machines into one live
            workspace, and tells you the moment something goes wrong. One server, one command per machine.
          </p>
          <div className="lp-cta">
            <Link to={start} className="button primary lg">{startLabel} <Icon name="right" size={16} /></Link>
            <a href={REPO_URL} className="button ghost lg" target="_blank" rel="noreferrer"><Icon name="github" size={16} /> View the code</a>
          </div>
          <ul className="lp-proof">
            <li><Icon name="check" size={15} /> 1-second resolution</li>
            <li><Icon name="check" size={15} /> Your data stays on your servers</li>
            <li><Icon name="check" size={15} /> Ready in minutes</li>
          </ul>
        </div>
        <HeroPreview />
      </section>

      <section className="lp-numbers" aria-label="At a glance">
        <div><b>1s</b><span>collection interval</span></div>
        <div><b>40+</b><span>built-in charts</span></div>
        <div><b>7</b><span>service collectors</span></div>
        <div><b>1</b><span>command per server</span></div>
      </section>

      <section className="lp-section" id="features">
        <h2>Everything you need to run servers with confidence</h2>
        <p className="lp-lead">Metrics, logs, containers, checks and alerts in one place, with no plugins to install.</p>
        <div className="lp-features">
          {FEATURES.map((f) => (
            <article key={f.title} className="lp-feature">
              <span className="lp-feature-icon"><Icon name={f.icon} size={20} /></span>
              <h3>{f.title}</h3>
              <p>{f.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="lp-section" id="how">
        <h2>Up and running in three steps</h2>
        <ol className="lp-steps">
          {STEPS.map((s, i) => (
            <li key={s.title}>
              <span className="lp-step-num">{i + 1}</span>
              <h3>{s.title}</h3>
              <p>{s.text}</p>
              <code>{s.code}</code>
            </li>
          ))}
        </ol>
      </section>

      <section className="lp-section" id="integrations">
        <h2>Works with what you run</h2>
        <p className="lp-lead">Install on any OS with Node.js, deploy as a container or a Kubernetes DaemonSet, and send alerts anywhere.</p>
        <div className="lp-chips">{INTEGRATIONS.map((i) => <span key={i}>{i}</span>)}</div>
      </section>

      <section className="lp-section lp-split">
        <div>
          <h2>Self-hosted and secure by default</h2>
          <ul className="lp-checks">
            <li><Icon name="check" size={16} /> Accounts with admin and read-only viewer roles</li>
            <li><Icon name="check" size={16} /> Agents authenticate with a workspace token</li>
            <li><Icon name="check" size={16} /> Database passwords never leave the server and the node that uses them</li>
            <li><Icon name="check" size={16} /> No external services: one process and one SQLite file</li>
          </ul>
        </div>
        <div>
          <h3 className="lp-code-title">Run it with Docker</h3>
          <CodeBlock>{`git clone ${REPO_URL}
cd netnew
docker compose up -d --build
# then open http://localhost:3000 and create your workspace`}</CodeBlock>
        </div>
      </section>

      <section className="lp-section" id="faq">
        <h2>Questions</h2>
        <div className="lp-faq">
          {FAQ.map((f) => (
            <details key={f.q}>
              <summary>{f.q}</summary>
              <p>{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="lp-final">
        <h2>Start monitoring in minutes</h2>
        <p>Run the server, paste one command on each machine, and watch your infrastructure come alive.</p>
        <Link to={start} className="button primary lg">{startLabel} <Icon name="right" size={16} /></Link>
      </section>

      <footer className="lp-footer">
        <span className="lp-brand small"><Logo size={20} /> NetNew</span>
        <span className="muted">Real-time infrastructure monitoring{auth.version ? ` · v${auth.version}` : ''}</span>
        <a href={REPO_URL} target="_blank" rel="noreferrer">GitHub</a>
      </footer>
    </div>
  );
}
