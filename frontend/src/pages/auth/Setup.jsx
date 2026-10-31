import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Loading } from '../../components/ui/Bits.jsx';
import { useAuth } from '../../state/auth.jsx';
import AuthLayout, { Field } from './AuthLayout.jsx';

/** First-run setup: names the workspace and creates the first admin account. */
export default function Setup() {
  const auth = useAuth();
  const [form, setForm] = useState({ workspaceName: '', name: '', email: '', password: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  // Straight after setup, open the app on the "connect your servers" instructions.
  if (done) return <Navigate to="/app/groups/all/home?integrations=deploy.servers" replace />;
  if (auth.loading) return <Loading />;
  // (Skipped while submitting: the refreshed auth state arrives before `done`.)
  if (!auth.setupRequired && !busy) return <Navigate to={auth.user ? '/app' : '/login'} replace />;

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await auth.setup(form);
      setDone(true);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <AuthLayout title="Set up NetNew" subtitle="Name your workspace and create the admin account. You can invite your team afterwards.">
      <form className="auth-form" onSubmit={submit}>
        <Field label="Workspace name" value={form.workspaceName} onChange={set('workspaceName')} placeholder="e.g. Acme Production" required autoFocus maxLength={80} />
        <Field label="Your name" autoComplete="name" value={form.name} onChange={set('name')} required maxLength={80} />
        <Field label="Email" type="email" autoComplete="email" value={form.email} onChange={set('email')} required />
        <Field label="Password" type="password" autoComplete="new-password" value={form.password} onChange={set('password')} required minLength={8} hint="At least 8 characters." />
        {error && <p className="error small" role="alert">{error}</p>}
        <button type="submit" className="primary block" disabled={busy}>{busy ? 'Creating…' : 'Create workspace'}</button>
      </form>
    </AuthLayout>
  );
}
