// Alert notifications to webhook-style channels.
//   webhook: POSTs the full JSON event
//   slack:   Slack incoming webhook ({ text })
//   discord: Discord webhook ({ content })
export const CHANNEL_TYPES = ['webhook', 'slack', 'discord'];

const RANK = { warning: 1, critical: 2 };
const ICON = { critical: '🔴', warning: '🟠', cleared: '✅' };

export function validateChannel(body) {
  const name = String(body?.name ?? '').trim().slice(0, 100);
  const type = String(body?.type ?? '');
  const url = String(body?.url ?? '').trim();
  const minSeverity = String(body?.min_severity ?? 'warning');
  if (!name) return { error: 'name is required' };
  if (!CHANNEL_TYPES.includes(type)) return { error: `type must be one of ${CHANNEL_TYPES.join(', ')}` };
  if (!['warning', 'critical'].includes(minSeverity)) return { error: 'min_severity must be warning or critical' };
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
  } catch {
    return { error: 'url must be an http(s) URL' };
  }
  return { channel: { name, type, url, min_severity: minSeverity, enabled: body.enabled !== false } };
}

function payloadFor(channel, event) {
  if (channel.type === 'slack') return { text: event.text };
  if (channel.type === 'discord') return { content: event.text };
  return event;
}

export function createNotifier({ db, publicUrl, onFailure }) {
  async function deliver(channel, event) {
    const res = await fetch(channel.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'NetNew' },
      body: JSON.stringify(payloadFor(channel, event)),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  }

  function buildEvent(kind, alert, hostname) {
    const status = kind === 'cleared' ? 'cleared' : alert.severity;
    const link = publicUrl ? ` ${publicUrl.replace(/\/$/, '')}/nodes/${alert.node_id}` : '';
    const detail = kind === 'cleared' ? `${alert.name} recovered` : alert.message;
    return {
      kind,
      status,
      text: `${ICON[status] ?? ''} [${status.toUpperCase()}] ${hostname}: ${detail}${link}`.trim(),
      alert,
      node: { id: alert.node_id, hostname },
      ts: Math.floor(Date.now() / 1000),
    };
  }

  return {
    // Raised/changed alerts are sent when at or above the channel's minimum
    // severity; a clear is sent when the alert it clears would have been.
    onAlert(kind, alert, hostname) {
      for (const channel of db.listChannels()) {
        if (!channel.enabled || (RANK[alert.severity] ?? 0) < RANK[channel.min_severity]) continue;
        const event = buildEvent(kind, alert, hostname);
        deliver(channel, event).catch((err) => onFailure(channel, err));
      }
    },

    async test(channel) {
      await deliver(channel, {
        kind: 'test',
        status: 'test',
        text: `🔔 NetNew test notification for channel "${channel.name}"`,
        ts: Math.floor(Date.now() / 1000),
      });
    },
  };
}
