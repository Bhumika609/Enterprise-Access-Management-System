import { useEffect, useState } from 'react';
import { api } from '../lib/api';

// Stage 1 placeholder: proves the authenticated API call works end-to-end.
// The full Dashboard (charts, top risky employees, activity trend) is next.
export default function Home() {
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get('/dashboard').then(setSummary).catch((e) => setError(e.message));
  }, []);

  const stats = summary && [
    { label: 'Employees', value: summary.total_employees },
    { label: 'Open findings', value: summary.open_findings, tone: summary.open_findings > 0 ? 'high' : 'low' },
    { label: 'Critical findings', value: summary.critical_findings, tone: summary.critical_findings > 0 ? 'critical' : 'low' },
    { label: 'Pending requests', value: summary.pending_access_requests },
  ];

  return (
    <div>
      <h1 style={{ fontSize: 20, marginBottom: 4 }}>Dashboard</h1>
      <p style={{ color: 'var(--text-muted)', marginBottom: 24 }}>
        Signed in — live counts below are read straight from the database.
      </p>

      {error && <p className="mono" style={{ color: 'var(--critical)' }}>Could not load dashboard: {error}</p>}

      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, maxWidth: 720 }}>
          {stats.map((s) => (
            <div key={s.label} style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: 16 }}>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>{s.label}</p>
              <p className="mono" style={{ fontSize: 26, fontWeight: 600, color: s.tone ? `var(--${s.tone})` : 'var(--text)' }}>
                {s.value}
              </p>
            </div>
          ))}
        </div>
      )}

      <p style={{ marginTop: 28, color: 'var(--text-faint)', fontSize: 12.5 }}>
        The full dashboard (risk distribution, activity trend, top risky employees) is built in the next stage.
      </p>
    </div>
  );
}