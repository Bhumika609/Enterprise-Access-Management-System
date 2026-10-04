import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useApi, Async, Card, PageHeader, Table, Pill, Sev, fmtDate, titleCase } from '../components/ui';

export default function EmployeeProfile() {
  const { id } = useParams();
  const nav = useNavigate();
  const state = useApi(() => api.get(`/employees/${id}`), [id]);

  return (
    <Async state={state}>{(p) => {
      const e = p.employee;
      const unused = p.findings.filter((f) => f.finding_type === 'unused_access');
      const violations = p.findings.filter((f) => f.finding_type === 'sod_violation' || f.finding_type === 'privilege_escalation');
      const anomalies = p.findings.filter((f) => f.finding_type === 'anomalous_access');
      const temporary = p.grants.filter((g) => g.status === 'active' && g.grant_type !== 'direct');
      return (
        <div>
          <PageHeader title={e.full_name} subtitle={`${e.department} · ${e.email}${e.manager_name ? ` · reports to ${e.manager_name}` : ''}`}>
            <Pill value={e.status} />
            <button className="btn btn--sm" onClick={() => nav(-1)}>← Back</button>
          </PageHeader>

          <div className="grid grid--stats">
            <div className="stat"><p>Risk score</p><p className="num" style={{ color: p.risk_score >= 100 ? 'var(--critical)' : p.risk_score >= 50 ? 'var(--high)' : 'var(--text)' }}>{p.risk_score}</p></div>
            <div className="stat"><p>Open findings</p><p className="num">{p.findings.length}</p></div>
            <div className="stat"><p>SoD / escalation</p><p className="num">{violations.length}</p></div>
            <div className="stat"><p>Unused permissions</p><p className="num">{unused.length}</p></div>
            <div className="stat"><p>Anomalous events</p><p className="num">{anomalies.length}</p></div>
          </div>

          <div className="grid grid--2">
            <Card title="Role grants">
              <Table rows={p.grants} empty="No grants."
                columns={[
                  { key: 'role_name', label: 'Role' },
                  { key: 'grant_type', label: 'Type', render: (g) => <Pill value={g.grant_type} tone={g.grant_type === 'break_glass' ? 'bad' : g.grant_type === 'direct' ? '' : 'warn'} /> },
                  { key: 'status', label: 'Status', render: (g) => <Pill value={g.status} /> },
                  { key: 'expires_at', label: 'Expires', render: (g) => fmtDate(g.expires_at) },
                  { key: 'granted_by', label: 'Granted by' },
                ]} />
              {temporary.length > 0 && <p className="muted" style={{ marginTop: 8, fontSize: 12.5 }}>{temporary.length} active non-permanent grant(s) (temporary, delegated or break-glass).</p>}
            </Card>
            <Card title="Effective roles (direct + inherited)">
              <Table rows={p.effective_roles} empty="No roles."
                columns={[
                  { key: 'role_name', label: 'Role' },
                  { key: 'is_direct', label: 'Source', render: (r) => <Pill value={r.is_direct ? 'direct' : 'inherited'} tone={r.is_direct ? 'info' : ''} /> },
                ]} />
            </Card>
          </div>

          <Card title={`Effective permissions (${p.effective_permissions.length})`} style={{ marginBottom: 12 }}>
            <Table rows={p.effective_permissions} empty="No permissions."
              columns={[
                { key: 'action', label: 'Permission', render: (r) => `${r.action} ${r.resource_type}` },
                { key: 'risk_level', label: 'Risk', render: (r) => <Sev level={r.risk_level} /> },
                { key: 'via_role_name', label: 'Granted through' },
                { key: 'via_role_direct', label: 'Path', render: (r) => <Pill value={r.via_role_direct ? 'direct role' : 'inherited'} tone={r.via_role_direct ? 'info' : ''} /> },
              ]} />
          </Card>

          <Card title="Open findings" style={{ marginBottom: 12 }}>
            <Table rows={p.findings} empty="No open findings." onRowClick={() => nav(`/findings?employee_id=${id}`)}
              columns={[
                { key: 'severity', label: 'Severity', render: (f) => <Sev level={f.severity} /> },
                { key: 'finding_type', label: 'Type', render: (f) => titleCase(f.finding_type) },
                { key: 'title', label: 'Detail' },
                { key: 'status', label: 'Status', render: (f) => <Pill value={f.status} /> },
                { key: 'detected_at', label: 'Detected', render: (f) => fmtDate(f.detected_at) },
              ]} />
            <p className="muted" style={{ marginTop: 8, fontSize: 12.5 }}>Review and resolve these on the <Link to={`/findings?employee_id=${id}`}>Findings page</Link>.</p>
          </Card>

          <Card title="Recent activity (last 20 events)">
            <Table rows={p.recent_activity} empty="No recorded activity."
              columns={[
                { key: 'occurred_at', label: 'When', render: (a) => fmtDate(a.occurred_at) },
                { key: 'resource_name', label: 'Resource' },
                { key: 'action', label: 'Action' },
                { key: 'success', label: 'Result', render: (a) => <Pill value={a.success ? 'success' : 'failed'} tone={a.success ? 'ok' : 'bad'} /> },
                { key: 'ip_address', label: 'IP', render: (a) => <span className="mono">{a.ip_address}</span> },
              ]} />
          </Card>
        </div>
      );
    }}</Async>
  );
}
