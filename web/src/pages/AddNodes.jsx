import { useState } from 'react';

function CodeBlock({ title, children }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(children);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };
  return (
    <div className="code-block">
      <div className="code-head">
        <span>{title}</span>
        <button type="button" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
      </div>
      <pre><code>{children}</code></pre>
    </div>
  );
}

export default function AddNodes() {
  const origin = window.location.origin;

  return (
    <>
      <h1>Add nodes</h1>
      <p className="muted">
        Each server runs a small agent that streams its metrics to this dashboard every second. The agent needs
        Node.js 18 or newer. Replace <code>&lt;TOKEN&gt;</code> with the agent token: it is printed when the
        server starts and stored in <code>server/data/agent-token</code> (or set via <code>AGENT_TOKEN</code>).
      </p>

      <section className="panel">
        <h3>Linux (systemd), one command</h3>
        <p className="muted">Installs the agent to <code>/opt/netnew-agent</code> and starts it as a service.</p>
        <CodeBlock title="bash">{`curl -fsSL ${origin}/install.sh | sudo sh -s -- --token <TOKEN>`}</CodeBlock>
        <p className="muted small">
          Check it with <code>systemctl status netnew-agent</code>. Uninstall with
          {' '}<code>curl -fsSL {origin}/install.sh | sudo sh -s -- --uninstall</code>.
        </p>
      </section>

      <section className="panel">
        <h3>Any OS (Linux, macOS, Windows), run manually</h3>
        <CodeBlock title="bash">{`mkdir netnew-agent && cd netnew-agent
curl -fsSL -O ${origin}/agent/index.js -O ${origin}/agent/package.json
npm install --omit=dev
NETNEW_URL=${origin} NETNEW_TOKEN=<TOKEN> node index.js`}</CodeBlock>
      </section>

      <section className="panel">
        <h3>Agent settings</h3>
        <table>
          <tbody>
            <tr><td><code>NETNEW_URL</code></td><td className="muted">Dashboard URL the agent connects to.</td></tr>
            <tr><td><code>NETNEW_TOKEN</code></td><td className="muted">Agent token (required).</td></tr>
            <tr><td><code>NETNEW_HOSTNAME</code></td><td className="muted">Display name, defaults to the machine hostname.</td></tr>
            <tr><td><code>NETNEW_INTERVAL_MS</code></td><td className="muted">Collection interval, default 1000.</td></tr>
            <tr><td><code>NETNEW_STATE_DIR</code></td><td className="muted">Where the node ID is stored, default <code>~/.netnew-agent</code>.</td></tr>
          </tbody>
        </table>
      </section>
    </>
  );
}
