import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import StatusDot from '../components/StatusDot';
import NodeMotif from '../components/NodeMotif';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from || '/';

  const [health, setHealth] = useState('checking');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.health()
      .then(() => { if (!cancelled) setHealth('online'); })
      .catch(() => { if (!cancelled) setHealth('offline'); });
    return () => { cancelled = true; };
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(username.trim(), password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err.message || 'Sign-in failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.topEdge} />
        <div style={styles.header}>
          <NodeMotif />
          <div>
            <p className="mono" style={styles.eyebrow}>EAPIS</p>
            <h1 style={styles.title}>Access Terminal</h1>
            <p style={styles.subtitle}>Enterprise Access &amp; Permission Intelligence</p>
          </div>
        </div>

        <div style={styles.statusRow}><StatusDot state={health} /></div>

        <form onSubmit={handleSubmit} style={styles.form} noValidate>
          <div className="field">
            <label htmlFor="username">Username</label>
            <input
              id="username" name="username" autoComplete="username" autoFocus
              value={username} onChange={(e) => setUsername(e.target.value)}
              disabled={submitting}
            />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password" name="password" type="password" autoComplete="current-password"
              value={password} onChange={(e) => setPassword(e.target.value)}
              disabled={submitting}
            />
          </div>

          <div role="alert" aria-live="polite" style={styles.errorSlot}>
            {error && <span className="mono">ACCESS DENIED — {error}</span>}
          </div>

          <button type="submit" className="btn btn--primary" disabled={submitting || !username || !password} style={{ width: '100%' }}>
            {submitting ? 'Verifying…' : 'Sign in'}
          </button>
        </form>

        <p className="mono" style={styles.hint}>
          demo accounts · lsimmons / falsayed / pnair / dchen · password Password@123
        </p>
      </div>
    </div>
  );
}

const styles = {
  page: {
    minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'var(--bg)', padding: 24,
    backgroundImage: 'radial-gradient(circle at 15% 10%, color-mix(in srgb, var(--accent) 6%, transparent), transparent 40%)',
  },
  card: {
    width: '100%', maxWidth: 400, background: 'var(--panel)', border: '1px solid var(--border)',
    borderRadius: 'var(--radius-md)', padding: '28px 28px 24px', position: 'relative', overflow: 'hidden',
  },
  topEdge: { position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: 'var(--accent)' },
  header: { display: 'flex', alignItems: 'center', gap: 16, marginBottom: 18 },
  eyebrow: { fontSize: 11, letterSpacing: '0.08em', color: 'var(--accent)', margin: 0 },
  title: { fontSize: 22, margin: '2px 0 4px' },
  subtitle: { fontSize: 12.5, color: 'var(--text-muted)' },
  statusRow: { marginBottom: 18, paddingBottom: 16, borderBottom: '1px solid var(--border)' },
  form: { display: 'flex', flexDirection: 'column', gap: 14 },
  errorSlot: { minHeight: 16, color: 'var(--critical)', fontSize: 12.5 },
  hint: { marginTop: 18, fontSize: 11, color: 'var(--text-faint)', textAlign: 'center' },
};