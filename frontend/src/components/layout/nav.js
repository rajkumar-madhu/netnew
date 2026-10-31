// The app's navigation: sections in the sidebar, and the pages the command
// palette can jump to. `description` is shown under the page title.
export const NAV = [
  {
    section: null,
    items: [
      { id: 'overview', label: 'Overview', icon: 'home', description: 'How your infrastructure is doing right now.' },
    ],
  },
  {
    section: 'Monitor',
    items: [
      { id: 'nodes', label: 'Nodes', icon: 'nodes', description: 'Every machine running the agent, with live resource use.' },
      { id: 'metrics', label: 'Metrics', icon: 'metrics', description: 'Explore every chart the agents collect, per second.' },
      { id: 'dashboards', label: 'Dashboards', icon: 'dashboard', description: 'Your own boards of charts and notes.' },
      { id: 'logs', label: 'Logs', icon: 'logs', description: 'Search the journal and log files from every node.' },
    ],
  },
  {
    section: 'Workloads',
    items: [
      { id: 'containers', label: 'Containers', icon: 'container', description: 'Docker containers and Kubernetes pods.' },
      { id: 'services', label: 'Services', icon: 'services', description: 'Health checks, application collectors and systemd units.' },
      { id: 'processes', label: 'Processes', icon: 'top', description: 'What is running on each node, live.' },
    ],
  },
  {
    section: 'Respond',
    items: [
      { id: 'alerts', label: 'Alerts', icon: 'alerts', description: 'Active alerts, alert history and the rules behind them.' },
      { id: 'anomalies', label: 'Anomalies', icon: 'anomalies', description: 'Metrics that moved away from their learned baseline.' },
      { id: 'activity', label: 'Activity', icon: 'events', description: 'A timeline of everything that happened.' },
    ],
  },
];

export const NAV_ITEMS = NAV.flatMap((s) => s.items);
