// Chart catalog for the Metrics tab, keyed by context (Netdata's term for a
// kind of chart). Agents send samples per context/instance/dimension; this
// catalog adds the presentation: title, units, chart type, where it appears in
// the table of contents, and the default grouping and aggregation.
//
//   type:    line | area | stacked
//   agg:     how members are combined when grouped (avg | sum | min | max)
//   groupBy: dimension | node | instance
export const SECTIONS = ['System', 'CPUs', 'Memory', 'Disks', 'Network', 'Processes', 'Sensors'];

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
};

const ORDER = Object.keys(CONTEXTS);

export function describeContext(context) {
  const meta = CONTEXTS[context] ?? {
    section: 'Other', title: context, units: '', type: 'line', agg: 'avg', groupBy: 'dimension',
  };
  const index = ORDER.indexOf(context);
  return { context, ...meta, priority: index === -1 ? 1000 : index };
}
