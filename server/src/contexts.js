// Chart catalog for the Metrics tab, keyed by context (Netdata's term for a
// kind of chart). Agents send samples per context/instance/dimension; this
// catalog adds the presentation: title, units, chart type, where it appears in
// the table of contents, and the default grouping and aggregation.
//
//   type:    line | area | stacked
//   agg:     how members are combined when grouped (avg | sum | min | max)
//   groupBy: dimension | node | instance
export const SECTIONS = [
  'System', 'CPUs', 'Memory', 'Disks', 'Network', 'Processes', 'Sensors',
  'Containers', 'Kubernetes', 'Service checks', 'Systemd', 'Nginx', 'Redis', 'PostgreSQL', 'MySQL',
];

export const CONTEXTS = {
  'system.cpu': {
    section: 'System', title: 'Total CPU utilization', units: '%', type: 'stacked', agg: 'avg', groupBy: 'dimension',
    help: 'Share of CPU time spent in each state, averaged across the selected nodes.',
  },
  'system.load': {
    section: 'System', title: 'System load average', units: 'load', type: 'line', agg: 'avg', groupBy: 'dimension',
    help: 'Average number of runnable (and on Linux, uninterruptible) tasks over 1, 5 and 15 minutes.',
  },
  'system.ctxt': {
    section: 'System', title: 'CPU context switches', units: 'switches/s', type: 'line', agg: 'sum', groupBy: 'node',
  },
  'system.intr': {
    section: 'System', title: 'CPU interrupts', units: 'interrupts/s', type: 'line', agg: 'sum', groupBy: 'node',
  },
  'system.uptime': {
    section: 'System', title: 'System uptime', units: 'seconds', type: 'line', agg: 'max', groupBy: 'node',
  },
  'cpu.core': {
    section: 'CPUs', title: 'Per-core CPU utilization', units: '%', type: 'line', agg: 'avg', groupBy: 'dimension',
    help: 'Utilization of each logical core. Group by node to compare machines.',
  },
  'mem.usage': {
    section: 'Memory', title: 'System RAM', units: 'bytes', type: 'stacked', agg: 'sum', groupBy: 'dimension',
    help: 'Used memory, page cache and buffers (reclaimable), and free memory.',
  },
  'mem.available': {
    section: 'Memory', title: 'Available RAM', units: 'bytes', type: 'area', agg: 'sum', groupBy: 'dimension',
    help: 'Memory available for new applications without swapping.',
  },
  'mem.swap': {
    section: 'Memory', title: 'System swap', units: 'bytes', type: 'stacked', agg: 'sum', groupBy: 'dimension',
  },
  'disk.io': {
    section: 'Disks', title: 'Disk I/O bandwidth', units: 'bytes/s', type: 'area', agg: 'sum', groupBy: 'dimension',
  },
  'disk.ops': {
    section: 'Disks', title: 'Disk completed I/O operations', units: 'operations/s', type: 'line', agg: 'sum', groupBy: 'dimension',
  },
  'disk.util': {
    section: 'Disks', title: 'Disk utilization time', units: '%', type: 'line', agg: 'max', groupBy: 'instance',
    help: 'Share of time each disk was busy serving requests.',
  },
  'disk.space': {
    section: 'Disks', title: 'Disk space usage', units: 'bytes', type: 'stacked', agg: 'sum', groupBy: 'dimension',
  },
  'net.traffic': {
    section: 'Network', title: 'Network traffic', units: 'bytes/s', type: 'area', agg: 'sum', groupBy: 'dimension',
  },
  'net.packets': {
    section: 'Network', title: 'Network packets', units: 'packets/s', type: 'line', agg: 'sum', groupBy: 'dimension',
  },
  'net.errors': {
    section: 'Network', title: 'Network errors and drops', units: 'events/s', type: 'line', agg: 'sum', groupBy: 'dimension',
  },
  'system.processes': {
    section: 'Processes', title: 'System processes', units: 'processes', type: 'line', agg: 'sum', groupBy: 'dimension',
  },
  'system.active_processes': {
    section: 'Processes', title: 'Active processes', units: 'processes', type: 'line', agg: 'sum', groupBy: 'node',
  },
  'system.forks': {
    section: 'Processes', title: 'Started processes', units: 'processes/s', type: 'line', agg: 'sum', groupBy: 'node',
  },
  'sensors.temperature': {
    section: 'Sensors', title: 'CPU temperature', units: '°C', type: 'line', agg: 'max', groupBy: 'dimension',
  },

  // Containers (Docker Engine API) and Kubernetes pods (cgroup v2 + API server).
  'docker.containers': {
    section: 'Containers', title: 'Containers by state', units: 'containers', type: 'stacked', agg: 'sum', groupBy: 'dimension',
  },
  'container.cpu': {
    section: 'Containers', title: 'Container CPU usage', units: '%', type: 'line', agg: 'sum', groupBy: 'instance',
    help: 'CPU time used, as a percentage of one core (can exceed 100% on multi-core hosts).',
  },
  'container.mem': {
    section: 'Containers', title: 'Container memory usage', units: 'bytes', type: 'line', agg: 'sum', groupBy: 'instance',
  },
  'container.net': {
    section: 'Containers', title: 'Container network traffic', units: 'bytes/s', type: 'line', agg: 'sum', groupBy: 'instance',
  },
  'container.io': {
    section: 'Containers', title: 'Container disk I/O', units: 'bytes/s', type: 'line', agg: 'sum', groupBy: 'instance',
  },
  'k8s.pods': {
    section: 'Kubernetes', title: 'Pods by phase', units: 'pods', type: 'stacked', agg: 'sum', groupBy: 'dimension',
  },
  'k8s.pod.cpu': {
    section: 'Kubernetes', title: 'Pod CPU usage', units: '%', type: 'line', agg: 'sum', groupBy: 'instance',
  },
  'k8s.pod.mem': {
    section: 'Kubernetes', title: 'Pod memory usage', units: 'bytes', type: 'line', agg: 'sum', groupBy: 'instance',
  },
  'k8s.pod.io': {
    section: 'Kubernetes', title: 'Pod disk I/O', units: 'bytes/s', type: 'line', agg: 'sum', groupBy: 'instance',
  },

  // Service checks and application collectors (configured as jobs).
  'check.up': {
    section: 'Service checks', title: 'Check status', units: 'up', type: 'line', agg: 'min', groupBy: 'instance',
    help: '1 when the check succeeds, 0 when it fails.',
  },
  'check.latency': {
    section: 'Service checks', title: 'Check response time', units: 'ms', type: 'line', agg: 'avg', groupBy: 'instance',
  },
  'ping.loss': {
    section: 'Service checks', title: 'Ping packet loss', units: '%', type: 'line', agg: 'max', groupBy: 'instance',
  },
  'systemd.units': {
    section: 'Systemd', title: 'Systemd service units by state', units: 'units', type: 'stacked', agg: 'sum', groupBy: 'dimension',
  },
  'nginx.connections': {
    section: 'Nginx', title: 'Nginx connections', units: 'connections', type: 'line', agg: 'sum', groupBy: 'dimension',
  },
  'nginx.requests': {
    section: 'Nginx', title: 'Nginx requests', units: 'requests/s', type: 'area', agg: 'sum', groupBy: 'instance',
  },
  'redis.clients': {
    section: 'Redis', title: 'Redis clients', units: 'clients', type: 'line', agg: 'sum', groupBy: 'dimension',
  },
  'redis.ops': {
    section: 'Redis', title: 'Redis operations', units: 'operations/s', type: 'area', agg: 'sum', groupBy: 'instance',
  },
  'redis.memory': {
    section: 'Redis', title: 'Redis memory', units: 'bytes', type: 'area', agg: 'sum', groupBy: 'instance',
  },
  'redis.hits': {
    section: 'Redis', title: 'Redis keyspace lookups', units: 'lookups/s', type: 'stacked', agg: 'sum', groupBy: 'dimension',
  },
  'redis.keys': {
    section: 'Redis', title: 'Redis keys', units: 'keys', type: 'line', agg: 'sum', groupBy: 'instance',
  },
  'postgres.connections': {
    section: 'PostgreSQL', title: 'PostgreSQL connections', units: 'connections', type: 'line', agg: 'sum', groupBy: 'instance',
  },
  'postgres.transactions': {
    section: 'PostgreSQL', title: 'PostgreSQL transactions', units: 'transactions/s', type: 'line', agg: 'sum', groupBy: 'dimension',
  },
  'postgres.cache': {
    section: 'PostgreSQL', title: 'PostgreSQL cache hit ratio', units: '%', type: 'line', agg: 'avg', groupBy: 'instance',
  },
  'postgres.size': {
    section: 'PostgreSQL', title: 'PostgreSQL database size', units: 'bytes', type: 'area', agg: 'sum', groupBy: 'instance',
  },
  'mysql.connections': {
    section: 'MySQL', title: 'MySQL connections', units: 'connections', type: 'line', agg: 'sum', groupBy: 'dimension',
  },
  'mysql.queries': {
    section: 'MySQL', title: 'MySQL queries', units: 'queries/s', type: 'line', agg: 'sum', groupBy: 'dimension',
  },
  'mysql.net': {
    section: 'MySQL', title: 'MySQL network traffic', units: 'bytes/s', type: 'area', agg: 'sum', groupBy: 'dimension',
  },
};

const ORDER = Object.keys(CONTEXTS);

export function describeContext(context) {
  const meta = CONTEXTS[context] ?? {
    section: 'Other', title: context, units: '', type: 'line', agg: 'avg', groupBy: 'dimension',
  };
  const index = ORDER.indexOf(context);
  return { context, ...meta, priority: index === -1 ? 1000 : index };
}
