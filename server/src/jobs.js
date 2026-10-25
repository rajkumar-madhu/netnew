// Collector jobs: application collectors and service checks that the server
// configures centrally and pushes to a node's agent. Each type lists its
// fields so the dashboard can render the form; `secret` fields are never sent
// back to the browser.
export const JOB_TYPES = {
  http: {
    name: 'HTTP check',
    description: 'Requests a URL and checks the status code, response time and (optionally) the body.',
    fields: [
      { key: 'url', label: 'URL', type: 'url', required: true, placeholder: 'https://example.com/health' },
      { key: 'method', label: 'Method', type: 'select', options: ['GET', 'HEAD', 'POST'], default: 'GET' },
      { key: 'expect_status', label: 'Expected status', type: 'text', default: '200-399', placeholder: '200-399 or 200,204' },
      { key: 'match', label: 'Body must contain', type: 'text', placeholder: 'optional' },
      { key: 'timeout_ms', label: 'Timeout (ms)', type: 'number', default: 5000, min: 100, max: 60000 },
      { key: 'interval_s', label: 'Interval (s)', type: 'number', default: 10, min: 1, max: 3600 },
    ],
  },
  tcp: {
    name: 'TCP port check',
    description: 'Opens a TCP connection and measures how long it takes.',
    fields: [
      { key: 'host', label: 'Host', type: 'text', required: true, placeholder: 'db.internal' },
      { key: 'port', label: 'Port', type: 'number', required: true, min: 1, max: 65535 },
      { key: 'timeout_ms', label: 'Timeout (ms)', type: 'number', default: 3000, min: 100, max: 60000 },
      { key: 'interval_s', label: 'Interval (s)', type: 'number', default: 10, min: 1, max: 3600 },
    ],
  },
  ping: {
    name: 'Ping',
    description: 'ICMP round-trip time and packet loss, using the system ping command.',
    fields: [
      { key: 'host', label: 'Host', type: 'text', required: true, placeholder: '1.1.1.1' },
      { key: 'count', label: 'Packets per run', type: 'number', default: 3, min: 1, max: 20 },
      { key: 'interval_s', label: 'Interval (s)', type: 'number', default: 10, min: 1, max: 3600 },
    ],
  },
  nginx: {
    name: 'Nginx',
    description: 'Connections and requests per second from the stub_status page.',
    fields: [
      { key: 'url', label: 'stub_status URL', type: 'url', required: true, default: 'http://127.0.0.1/nginx_status' },
      { key: 'interval_s', label: 'Interval (s)', type: 'number', default: 5, min: 1, max: 3600 },
    ],
  },
  redis: {
    name: 'Redis',
    description: 'Clients, memory, operations per second, hit ratio and keys from INFO.',
    fields: [
      { key: 'host', label: 'Host', type: 'text', default: '127.0.0.1' },
      { key: 'port', label: 'Port', type: 'number', default: 6379, min: 1, max: 65535 },
      { key: 'password', label: 'Password', type: 'password', secret: true, placeholder: 'optional' },
      { key: 'interval_s', label: 'Interval (s)', type: 'number', default: 5, min: 1, max: 3600 },
    ],
  },
  postgres: {
    name: 'PostgreSQL',
    description: 'Connections, transactions, cache hit ratio and database size from pg_stat_database.',
    fields: [
      { key: 'dsn', label: 'Connection string', type: 'password', secret: true, required: true, placeholder: 'postgres://netnew:secret@127.0.0.1:5432/postgres' },
      { key: 'interval_s', label: 'Interval (s)', type: 'number', default: 10, min: 1, max: 3600 },
    ],
  },
  mysql: {
    name: 'MySQL / MariaDB',
    description: 'Connections, queries, slow queries and network traffic from SHOW GLOBAL STATUS.',
    fields: [
      { key: 'dsn', label: 'Connection string', type: 'password', secret: true, required: true, placeholder: 'mysql://netnew:secret@127.0.0.1:3306' },
      { key: 'interval_s', label: 'Interval (s)', type: 'number', default: 10, min: 1, max: 3600 },
    ],
  },
};

export const SECRET_MASK = '••••••••';

// Validates and normalizes a job from the API. `existing` is the stored job
// when updating, so unchanged secrets (sent back masked) are preserved.
export function validateJob(body, existing) {
  const type = existing?.type ?? String(body?.type ?? '');
  const def = JOB_TYPES[type];
  if (!def) return { error: `type must be one of ${Object.keys(JOB_TYPES).join(', ')}` };
  const name = String(body?.name ?? existing?.name ?? '').trim().slice(0, 60);
  if (!/^[\w .:/-]{1,60}$/.test(name)) return { error: 'name is required (letters, digits, spaces and . : / - _)' };
  const nodeId = existing?.node_id ?? String(body?.node_id ?? '');
  if (!nodeId) return { error: 'node_id is required' };

  const input = body?.config ?? {};
  const config = {};
  for (const f of def.fields) {
    let v = input[f.key];
    if (f.secret && v === SECRET_MASK) v = existing ? JSON.parse(existing.config)[f.key] : undefined;
    if (v === '' || v == null) v = f.default;
    if (v == null) {
      if (f.required) return { error: `${f.label} is required` };
      continue;
    }
    if (f.type === 'number') {
      v = Number(v);
      if (!Number.isFinite(v) || (f.min != null && v < f.min) || (f.max != null && v > f.max)) {
        return { error: `${f.label} must be between ${f.min} and ${f.max}` };
      }
    } else {
      v = String(v).slice(0, 500);
      if (f.type === 'url' && !/^https?:\/\/\S+$/.test(v)) return { error: `${f.label} must be an http(s) URL` };
      if (f.type === 'select' && !f.options.includes(v)) return { error: `${f.label} must be one of ${f.options.join(', ')}` };
    }
    config[f.key] = v;
  }
  if (config.dsn && !/^(postgres(ql)?|mysql):\/\//.test(config.dsn)) {
    return { error: 'Connection string must start with postgres:// or mysql://' };
  }
  const enabled = body?.enabled ?? (existing ? Boolean(existing.enabled) : true);
  return { job: { node_id: nodeId, name, type, config, enabled: Boolean(enabled) } };
}

// The job as the dashboard sees it: secrets masked.
export function publicJob(row, status) {
  const config = JSON.parse(row.config);
  for (const f of JOB_TYPES[row.type]?.fields ?? []) {
    if (f.secret && config[f.key]) config[f.key] = SECRET_MASK;
  }
  return { ...row, enabled: Boolean(row.enabled), config, status: status ?? null };
}

// The job as the agent needs it.
export const agentJob = (row) => ({ id: row.id, name: row.name, type: row.type, config: JSON.parse(row.config) });
