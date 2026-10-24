import { Link, Navigate, Route, Routes } from 'react-router-dom';
import { Empty } from './components/Bits.jsx';
import RoomLayout from './components/RoomLayout.jsx';
import Shell from './components/Shell.jsx';
import Alerts from './pages/Alerts.jsx';
import Anomalies from './pages/Anomalies.jsx';
import Events from './pages/Events.jsx';
import Home from './pages/Home.jsx';
import Metrics from './pages/Metrics.jsx';
import NodeView from './pages/NodeView.jsx';
import Nodes from './pages/Nodes.jsx';
import Settings from './pages/Settings.jsx';
import Top from './pages/Top.jsx';
import { SpaceProvider } from './state/space.jsx';
import { ThemeProvider } from './state/theme.jsx';
import { TimeProvider } from './state/time.jsx';

function NotFound() {
  return (
    <div className="page">
      <Empty icon="info" title="Page not found" action={<Link className="button primary" to="/">Go home</Link>} />
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <TimeProvider>
        <SpaceProvider>
          <Routes>
            <Route element={<Shell />}>
              <Route index element={<Navigate to="/rooms/all/home" replace />} />
              <Route path="rooms/:roomId" element={<RoomLayout />}>
                <Route index element={<Navigate to="home" replace />} />
                <Route path="home" element={<Home />} />
                <Route path="nodes" element={<Nodes />} />
                <Route path="metrics" element={<Metrics />} />
                <Route path="top" element={<Top />} />
                <Route path="events" element={<Events />} />
                <Route path="alerts" element={<Alerts />} />
                <Route path="anomalies" element={<Anomalies />} />
              </Route>
              <Route path="nodes/:nodeId/:tab?" element={<NodeView />} />
              <Route path="settings/:section?" element={<Settings />} />
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </SpaceProvider>
      </TimeProvider>
    </ThemeProvider>
  );
}
