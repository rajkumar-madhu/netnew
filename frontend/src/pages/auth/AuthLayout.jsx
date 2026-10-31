import { Link } from 'react-router-dom';
import { Logo } from '../../components/ui/Icon.jsx';

/** Centered card used by the sign-in and setup pages. */
export default function AuthLayout({ title, subtitle, children, footer }) {
  return (
    <div className="auth-page">
      <Link to="/" className="auth-brand"><Logo size={30} /> NetNew</Link>
      <main className="auth-card panel">
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
        {children}
      </main>
      {footer && <div className="auth-footer muted small">{footer}</div>}
    </div>
  );
}

export function Field({ label, hint, ...input }) {
  return (
    <label className="auth-field">
      <span>{label}</span>
      <input {...input} />
      {hint && <em className="muted small">{hint}</em>}
    </label>
  );
}
