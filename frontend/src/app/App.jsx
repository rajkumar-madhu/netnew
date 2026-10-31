import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import AppLayout from '../components/layout/AppLayout.jsx';
import { Empty } from '../components/ui/Bits.jsx';
import Alerts from '../pages/app/Alerts.jsx';
import Anomalies from '../pages/app/Anomalies.jsx';
import Connect from '../pages/app/Connect.jsx';
import Containers from '../pages/app/Containers.jsx';
import { DashboardList, DashboardView } from '../pages/app/Dashboards.jsx';
import Events from '../pages/app/Events.jsx';
import Logs from '../pages/app/Logs.jsx';
import Metrics from '../pages/app/Metrics.jsx';
import NodeView from '../pages/app/NodeView.jsx';
import Nodes from '../pages/app/Nodes.jsx';
import Overview from '../pages/app/Overview.jsx';
import Processes from '../pages/app/Processes.jsx';
import Services from '../pages/app/Services.jsx';
import Settings from '../pages/app/Settings.jsx';
import Login from '../pages/auth/Login.jsx';
import Setup from '../pages/auth/Setup.jsx';
import Landing from '../pages/marketing/Landing.jsx';
import { AuthProvider, RequireAuth } from '../state/auth.jsx';
import { ThemeProvider } from '../state/theme.jsx';
import { TimeProvider } from '../state/time.jsx';
import { WorkspaceProvider } from '../state/workspace.jsx';

function NotFound({ home = '/' }) {
  return (
    <div className="page">
      <Empty icon="info" title="Page not found" action={<Link className="button primary" to={home}>Go home</Link>} />
    </div>
  );
}

// /app opens the overview, keeping any query (e.g. ?group=...).
function AppHome() {
  const { search } = useLocation();
  return <Navigate to={{ pathname: 'overview', search }} replace />;
}

// The signed-in application, under /app.
function AppRoutes() {
  return (
    <RequireAuth>
      <TimeProvider>
        <WorkspaceProvider>
          <Routes>
            <Route element={<AppLayout />}>
              <Route index element={<AppHome />} />
              <Route path="overview" element={<Overview />} />
              <Route path="nodes" element={<Nodes />} />
              <Route path="nodes/:nodeId/:tab?" element={<NodeView />} />
              <Route path="metrics" element={<Metrics />} />
              <Route path="dashboards" element={<DashboardList />} />
              <Route path="dashboards/:dashboardId" element={<DashboardView />} />
              <Route path="logs" element={<Logs />} />
              <Route path="containers" element={<Containers />} />
              <Route path="services" element={<Services />} />
              <Route path="processes" element={<Processes />} />
              <Route path="alerts" element={<Alerts />} />
              <Route path="anomalies" element={<Anomalies />} />
              <Route path="activity" element={<Events />} />
              <Route path="connect" element={<Connect />} />
              <Route path="settings/:section?" element={<Settings />} />
              <Route path="*" element={<NotFound home="/app" />} />
            </Route>
          </Routes>
        </WorkspaceProvider>
      </TimeProvider>
    </RequireAuth>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/setup" element={<Setup />} />
          <Route path="/app/*" element={<AppRoutes />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </AuthProvider>
    </ThemeProvider>
  );
}
