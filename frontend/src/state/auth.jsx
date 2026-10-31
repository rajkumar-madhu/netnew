import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Loading } from '../components/ui/Bits.jsx';
import { api, disconnectLive, setUnauthorizedHandler } from '../lib/api.js';

// Who is signed in, and whether the workspace still needs its first-run setup.
const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }) {
  const [state, setState] = useState(null); // { setupRequired, user, workspaceName, version }

  const refresh = useCallback(() => api('/auth/state').then(setState).catch(() => setState({ setupRequired: false, user: null })), []);

  useEffect(() => {
    refresh();
    setUnauthorizedHandler(refresh);
    return () => setUnauthorizedHandler(null);
  }, [refresh]);

  const value = useMemo(() => ({
    ...state,
    loading: !state,
    isAdmin: state?.user?.role === 'admin',
    refresh,
    async login(email, password) {
      await api('/auth/login', { method: 'POST', body: { email, password } });
      await refresh();
    },
    async setup(fields) {
      await api('/auth/setup', { method: 'POST', body: fields });
      await refresh();
    },
    async logout() {
      await api('/auth/logout', { method: 'POST' });
      disconnectLive();
      await refresh();
    },
  }), [state, refresh]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** Only renders its children for signed-in users; otherwise sends them to setup or sign-in. */
export function RequireAuth({ children }) {
  const auth = useAuth();
  const location = useLocation();
  if (auth.loading) return <div className="page"><Loading /></div>;
  if (auth.setupRequired) return <Navigate to="/setup" replace />;
  if (!auth.user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  return children;
}
