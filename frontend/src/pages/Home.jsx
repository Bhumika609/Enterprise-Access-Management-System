import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useApi, Async, Card, PageHeader, Table, titleCase } from '../components/ui';
import { Donut, HBars, ActivityChart, sevColor } from '../components/charts';

// Everything on this page is read from fn_dashboard_summary() — no analysis happens in the browser.
export default function Home() {
  const nav = useNavigate();
  const state = useApi(() => api.get('/dashboard'));

  return (
    <div>
      <PageHeader title="Dashboard" subtitle="Live security posture, computed by the PostgreSQL detection engine." />
      <Async state={state}>{(d) => {
        const cards = [
          { label: 'Total employees', value: d.total_employees, to: '/employees' },
          { label: 'Total roles', value: d.total_roles, to: '/roles' },
          { label: 'Total permissions', value: d.total_permissions, to: '/roles' },
          { label: 'Active temporary access', value: d.active_temporary_access, to: '/access-requests', tone: d.active_temporary_access > 0 ? 'medium' : null },
          { label: 'Critical findings', value: d.critical_findings, to: '/findings', tone: d.critical_findings > 0 ? 'critical' : null },
          { label: 'SoD violations', value: d.sod_violations, to: '/sod-violations', tone: d.sod_violations > 0 ? 'high' : null },
          { label: 'Unused permissions', value: d.unused_permissions, to: '/unused-access', tone: d.unused_permissions > 0 ? 'medium' : null },
          { label: 'Pending requests', value: d.pending_access_requests, to: '/access-requests' },
        ];
        const sev = ['critical', 'high', 'medium', 'low'].map((s) => ({ label: titleCase(s), value: d.risk_distribution?.[s] ?? 0, color: sevColor(s) }));
        const types = Object.entries(d.findings_by_type || {}).map(([k, v]) => ({ label: titleCase(k), value: v }));
        return (
          <>
            <div className="grid grid--stats">
              {cards.map((c) => (
                <div key={c.label} className="stat stat--link" role="link" tabIndex={0} onClick={() => nav(c.to)} onKeyDown={(e) => e.key === 'Enter' && nav(c.to)}>
                  <p>{c.label}</p>
                  <p className="num" style={{ color: c.tone ? `var(--${c.tone})` : 'var(--text)' }}>{c.value}</p>
                </div>
              ))}
            </div>
            <div className="grid grid--2">
              <Card title="Risk distribution (open findings by severity)"><Donut items={sev} /></Card>
              <Card title="Findings by detector"><HBars items={types} /></Card>
            </div>
            <div className="grid grid--2">
              <Card title="Security activity — last 30 days"><ActivityChart points={d.activity_trend || []} /></Card>
              <Card title="Top risky employees" actions={<a href="/reports" onClick={(e) => { e.preventDefault(); nav('/reports'); }}>Full report →</a>}>
                <Table
                  rows={d.top_risky_employees || []}
                  onRowClick={(r) => nav(`/employees/${r.employee_id}`)}
                  empty="No open risk. Nice."
                  columns={[
                    { key: 'full_name', label: 'Employee', render: (r) => <><div>{r.full_name}</div><div className="faint" style={{ fontSize: 12 }}>{r.department}</div></> },
                    { key: 'open_finding_count', label: 'Open', align: 'right' },
                    { key: 'risk_score', label: 'Risk score', align: 'right', render: (r) => <b className="mono" style={{ color: r.risk_score >= 100 ? 'var(--critical)' : r.risk_score >= 50 ? 'var(--high)' : 'var(--medium)' }}>{r.risk_score}</b> },
                  ]}
                />
              </Card>
            </div>
          </>
        );
      }}</Async>
    </div>
  );
}
