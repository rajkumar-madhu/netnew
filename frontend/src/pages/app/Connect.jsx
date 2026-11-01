import { useEffect, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { ago } from '../../lib/format.js';
import { PageHeader } from '../../components/layout/AppLayout.jsx';
import { GUIDES, PLATFORMS } from '../../components/connect/guides.jsx';
import { AgentTokenContext, StatusDot } from '../../components/ui/Bits.jsx';
import Icon from '../../components/ui/Icon.jsx';
import { useAuth } from '../../state/auth.jsx';
import { useWorkspace } from '../../state/workspace.jsx';

const nowSec = () => Date.now() / 1000;

// Servers that first connected this long before the page opened still count
// as "just connected", e.g. one started while the workspace was being set up.
const RECENT_SEC = 120;

// The server's clock when the page opened, and how far this browser's clock
// is from it. Node timestamps come from the server, so comparing them with
// the browser's clock would break whenever the two disagree.
function useServerClock() {
  const [clock, setClock] = useState(null);
  useEffect(() => {
    const sent = nowSec();
    api('/health')
      .then((h) => setClock({ openedAt: h.time, offset: Math.round(h.time - (sent + nowSec()) / 2) }))
      .catch(() => setClock({ openedAt: nowSec(), offset: 0 }));
  }, []);
  return clock;
}

function Step({ n, title, children, done }) {
  return (
    <section className={`step ${done ? 'done' : ''}`}>
      <div className="step-marker">{done ? <Icon name="check" size={16} /> : n}</div>
      <div className="step-body">
        <h2>{title}</h2>
        {children}
      </div>
    </section>
  );
}

// Watches for nodes that connected since this page was opened.
function WaitForNode({ clock }) {
  const { nodes } = useWorkspace();
  const fresh = clock ? (nodes ?? []).filter((n) => n.firstSeen >= clock.openedAt - RECENT_SEC) : [];
  const others = (nodes ?? []).length - fresh.length;
  if (fresh.length) {
    return (
      <div className="connected-list">
        {fresh.map((n) => (
          <div key={n.id} className="connected-row">
            <StatusDot online={n.online} />
            <span><strong>{n.hostname}</strong> <span className="muted">connected {ago(n.firstSeen - clock.offset)}</span></span>
            <Link className="button primary push" to={`/app/nodes/${n.id}`}>Open {n.hostname} <Icon name="arrow" size={14} /></Link>
          </div>
        ))}
        <p className="muted small">Run the same command on more servers to add them too.</p>
      </div>
    );
  }
  return (
    <div className="waiting">
      <span className="spinner" />
      <div>
        <strong>Waiting for a server to connect…</strong>
        <p className="muted small">
          This updates by itself as soon as the agent reports.
          {others > 0 && <> You already have {others} connected; <Link to="/app/nodes">see them</Link>.</>}
        </p>
      </div>
    </div>
  );
}

/** Connect a server: choose the platform, run the command, watch it arrive. */
export default function Connect() {
  const { isAdmin } = useAuth();
  const [params] = useSearchParams();
  const { hash } = useLocation();
  const [platformId, setPlatformId] = useState(params.get('platform') ?? 'linux');
  const [token, setToken] = useState(null);
  const clock = useServerClock();
  const platform = PLATFORMS.find((p) => p.id === platformId) ?? PLATFORMS[0];
  const origin = window.location.origin;

  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [hash]);

  return (
    <div className="connect">
      <PageHeader title="Connect a server" description="Install the NetNew agent on any machine. It starts streaming metrics, logs, containers and services within seconds." />

      {params.get('welcome') && (
        <div className="welcome">
          <Icon name="check" size={18} />
          <div>
            <strong>Your workspace is ready.</strong>
            <span className="muted"> Connect your first server to start seeing data. You can come back here any time from <em>Connect a server</em> in the sidebar.</span>
          </div>
        </div>
      )}

      <div className="steps">
        <Step n={1} title="Where will the agent run?">
          <div className="platforms" role="radiogroup" aria-label="Platform">
            {PLATFORMS.map((p) => (
              <button key={p.id} type="button" role="radio" aria-checked={p.id === platform.id}
                className={`platform ${p.id === platform.id ? 'active' : ''}`} onClick={() => setPlatformId(p.id)}>
                <span className="platform-badge" aria-hidden="true" style={{ '--brand': p.color }}>{p.badge}</span>
                <span className="platform-name">{p.name}</span>
              </button>
            ))}
          </div>
          <p className="muted small">{platform.description}</p>
        </Step>

        <Step n={2} title={`Run this on your ${platform.name} machine`}>
          {isAdmin && (
            <div className="token-bar">
              {token
                ? <span className="ok-text small"><Icon name="lock" size={14} /> Your agent token is filled in. Keep these commands private.</span>
                : <button type="button" className="ghost small" onClick={() => api('/workspace/agent-token').then((r) => setToken(r.token))}>
                  <Icon name="lock" size={14} /> Fill in my agent token
                </button>}
            </div>
          )}
          <div className="guide">
            <AgentTokenContext.Provider value={token}>{platform.render(origin)}</AgentTokenContext.Provider>
          </div>
        </Step>

        <Step n={3} title="See it arrive">
          <WaitForNode clock={clock} />
        </Step>
      </div>

      <h2 className="section-title">More data from your servers</h2>
      <div className="sources">
        <section className="source panel" id="logs">
          <header><Icon name="logs" size={18} /><h3>Logs</h3></header>
          {GUIDES.filter((g) => g.topic === 'logs').map((g) => (
            <div key={g.id} className="source-guide"><h4>{g.name}</h4>{g.render(origin)}</div>
          ))}
        </section>
        <section className="source panel" id="containers">
          <header><Icon name="container" size={18} /><h3>Containers and pods</h3></header>
          {GUIDES.filter((g) => g.topic === 'containers').map((g) => (
            <div key={g.id} className="source-guide"><h4>{g.name}</h4>{g.render(origin)}</div>
          ))}
        </section>
        <section className="source panel" id="checks">
          <header><Icon name="services" size={18} /><h3>Health checks and app collectors</h3></header>
          <p>Watch HTTP endpoints, TCP ports and hosts, and collect metrics from Nginx, Redis, PostgreSQL and MySQL. They are set up here in the browser and run by a node's agent, with no config files to edit.</p>
          <Link className="button" to="/app/services">Add a check on the Services page</Link>
        </section>
        <section className="source panel" id="notifications">
          <header><Icon name="alerts" size={18} /><h3>Alert notifications</h3></header>
          <p>Get alerts in Slack, Discord or any webhook as soon as they fire, and when they clear.</p>
          <Link className="button" to="/app/settings/notifications">Set up notifications</Link>
        </section>
      </div>
    </div>
  );
}
