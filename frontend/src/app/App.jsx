import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import GroupLayout from '../components/layout/GroupLayout.jsx';
import Shell from '../components/layout/Shell.jsx';
import { Empty } from '../components/ui/Bits.jsx';
import Alerts from '../pages/app/Alerts.jsx';
import Anomalies from '../pages/app/Anomalies.jsx';
import Containers from '../pages/app/Containers.jsx';
import { DashboardList, DashboardView } from '../pages/app/Dashboards.jsx';
import Events from '../pages/app/Events.jsx';
import Home from '../pages/app/Home.jsx';
import Logs from '../pages/app/Logs.jsx';
import Metrics from '../pages/app/Metrics.jsx';
import NodeView from '../pages/app/NodeView.jsx';
import Nodes from '../pages/app/Nodes.jsx';
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

// /app opens the "All nodes" group, keeping any query (e.g. ?integrations=...).
function AppHome() {
  const { search } = useLocation();
  return <Navigate to={{ pathname: 'groups/all/home', search }} replace />;
}

// The signed-in application, under /app.
function AppRoutes() {
  return (
    <RequireAuth>
      <TimeProvider>
        <WorkspaceProvider>
          <Routes>
            <Route element={<Shell />}>
              <Route index element={<AppHome />} />
              <Route path="groups/:groupId" element={<GroupLayout />}>
                <Route index element={<Navigate to="home" replace />} />
                <Route path="home" element={<Home />} />
                <Route path="nodes" element={<Nodes />} />
                <Route path="metrics" element={<Metrics />} />
                <Route path="dashboards" element={<DashboardList />} />
                <Route path="dashboards/:dashboardId" element={<DashboardView />} />
                <Route path="logs" element={<Logs />} />
                <Route path="containers" element={<Containers />} />
                <Route path="services" element={<Services />} />
                <Route path="processes" element={<Processes />} />
                <Route path="events" element={<Events />} />
                <Route path="alerts" element={<Alerts />} />
                <Route path="anomalies" element={<Anomalies />} />
              </Route>
              <Route path="nodes/:nodeId/:tab?" element={<NodeView />} />
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
