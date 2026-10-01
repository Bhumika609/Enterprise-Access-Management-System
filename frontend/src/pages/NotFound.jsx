import { Link } from 'react-router-dom';
export default function NotFound() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
      <p className="mono" style={{ color: 'var(--text-faint)' }}>404</p>
      <p>That page doesn't exist.</p>
      <Link to="/">Back to dashboard</Link>
    </div>
  );
}