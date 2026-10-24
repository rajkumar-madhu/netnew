import { createContext, useContext, useState } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { useLiveStatus } from './api.js';
import AddNodes from './pages/AddNodes.jsx';
import Alerts from './pages/Alerts.jsx';
import NodePage from './pages/NodePage.jsx';
import Overview from './pages/Overview.jsx';

export const RANGES = [
  { label: '5m', seconds: 300 },
  { label: '15m', seconds: 900 },
  { label: '1h', seconds: 3600 },
  { label: '6h', seconds: 21600 },
  { label: '24h', seconds: 86400 },
];

const RangeContext = createContext({ range: 900, setRange: () => {} });
export const useRange = () => useContext(RangeContext);

function readStoredRange() {
  try {
    const value = Number(localStorage.getItem('netnew.range'));
    return RANGES.some((r) => r.seconds === value) ? value : 900;
  } catch {
    return 900;
  }
}

function Logo() {
  return (
    <svg viewBox="0 0 32 32" width="22" height="22" aria-hidden="true">
      <path d="M2 20h7l3-9 5 15 4-11 2 5h7" fill="none" stroke="currentColor" strokeWidth="3"
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function App() {
  const [range, setRangeState] = useState(readStoredRange);
  const live = useLiveStatus();

  const setRange = (seconds) => {
    setRangeState(seconds);
    try { localStorage.setItem('netnew.range', String(seconds)); } catch {}
  };

  return (
    <RangeContext.Provider value={{ range, setRange }}>
      <div className="layout">
        <aside className="sidebar">
          <div className="brand"><Logo /> NetNew</div>
          <nav>
            <NavLink to="/" end>Overview</NavLink>
            <NavLink to="/alerts">Alerts</NavLink>
            <NavLink to="/add-nodes">Add nodes</NavLink>
          </nav>
        </aside>
        <div className="main">
          <header className="topbar">
            <div className="range" role="group" aria-label="Time range">
              {RANGES.map((r) => (
                <button key={r.seconds} type="button" className={r.seconds === range ? 'active' : ''}
                  onClick={() => setRange(r.seconds)}>
                  {r.label}
                </button>
              ))}
            </div>
            <span className={`live ${live ? 'on' : ''}`}>
              <span className="dot" /> {live ? 'Live' : 'Reconnecting…'}
            </span>
          </header>
          <main className="content">
            <Routes>
              <Route path="/" element={<Overview />} />
              <Route path="/nodes/:id" element={<NodePage />} />
              <Route path="/alerts" element={<Alerts />} />
              <Route path="/add-nodes" element={<AddNodes />} />
              <Route path="*" element={<p className="muted">Page not found.</p>} />
            </Routes>
          </main>
        </div>
      </div>
    </RangeContext.Provider>
  );
}
