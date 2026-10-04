import { useState } from 'react';
import { api } from '../lib/api';
import { useApi, Async, PageHeader, Table, Pill, Sev, fmtDate } from '../components/ui';
import FindingReview from '../components/FindingReview';

export default function SodViolations() {
  const [status, setStatus] = useState('active');
  const [open, setOpen] = useState(null);
  const state = useApi(() => api.get(`/sod-violations?status=${status}`), [status]);

  const review = async (row) => setOpen(await api.get(`/findings/${row.finding_id}`));

  return (
    <div>
      <PageHeader title="SoD Violations" subtitle="Conflicting permission pairs held by one person — direct, or hidden in the role hierarchy.">
        <select className="select" aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="active">Open + under review</option><option value="resolved">Resolved</option><option value="all">All</option>
        </select>
      </PageHeader>
      <Async state={state}>{(rows) => (
        <>
          <p className="muted" style={{ marginBottom: 12 }}>{rows.length} conflict(s) · {rows.filter((r) => r.finding_type === 'privilege_escalation').length} only visible by walking the role hierarchy</p>
          <Table rows={rows} onRowClick={review} empty="No segregation-of-duties violations."
            columns={[
              { key: 'severity', label: 'Severity', render: (r) => <Sev level={r.severity} /> },
              { key: 'full_name', label: 'Employee', render: (r) => <><div>{r.full_name}</div><div className="faint" style={{ fontSize: 12 }}>{r.department}</div></> },
              { key: 'conflict', label: 'Conflicting permissions', render: (r) => <><span className="mono">{r.permission_a}</span> <span className="faint">⚡</span> <span className="mono">{r.permission_b}</span><div className="faint" style={{ fontSize: 12 }}>{r.rule_description}</div></> },
              { key: 'roles', label: 'Granted by role(s)', render: (r) => <span className="muted">{r.roles_granting_a}{r.roles_granting_a !== r.roles_granting_b ? ` + ${r.roles_granting_b}` : ''}</span> },
              { key: 'conflict_kind', label: 'Kind', render: (r) => <Pill value={r.finding_type === 'sod_violation' ? 'direct' : 'indirect'} tone={r.finding_type === 'sod_violation' ? 'bad' : 'warn'} /> },
              { key: 'status', label: 'Status', render: (r) => <Pill value={r.status} /> },
              { key: 'detected_at', label: 'Detected', render: (r) => fmtDate(r.detected_at) },
            ]} />
          {open && <FindingReview finding={open} onClose={() => setOpen(null)} onChanged={(row) => { setOpen(row); state.reload(); }} />}
        </>
      )}</Async>
    </div>
  );
}
