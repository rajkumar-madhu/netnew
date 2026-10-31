import { useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { Loading } from '../../components/ui/Bits.jsx';
import { useAuth } from '../../state/auth.jsx';
import AuthLayout, { Field } from './AuthLayout.jsx';

// Only same-app paths are valid redirect targets after sign-in.
const safeNext = (next) => (next && next.startsWith('/app') ? next : '/app');

export default function Login() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  if (auth.loading) return <Loading />;
  if (auth.setupRequired) return <Navigate to="/setup" replace />;
  if (auth.user) return <Navigate to={safeNext(params.get('next'))} replace />;

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await auth.login(email, password);
      navigate(safeNext(params.get('next')), { replace: true });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <AuthLayout title="Sign in" subtitle={auth.workspaceName ? `to ${auth.workspaceName}` : undefined}
      footer={<>Forgot your password? Ask a workspace admin to reset it. · <Link to="/">About NetNew</Link></>}>
      <form className="auth-form" onSubmit={submit}>
        <Field label="Email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        <Field label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {error && <p className="error small" role="alert">{error}</p>}
        <button type="submit" className="primary block" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </AuthLayout>
  );
}
