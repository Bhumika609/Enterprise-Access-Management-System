import { useState } from 'react';
import { api } from '../lib/api';
import { useApi, Async, PageHeader, Table, Pill, Sev, fmtDate } from '../components/ui';
import FindingReview from '../components/FindingReview';

export default function UnusedAccess() {
  const [status, setStatus] = useState('active');
  const [open, setOpen] = useState(null);
  const state = useApi(() => api.get(`/unused-access?status=${status}`), [status]);
  const review = async (row) => setOpen(await api.get(`/findings/${row.finding_id}`));

  return (
    <div>
      <PageHeader title="Unused Access" subtitle="Permissions granted but never exercised in the rolling window — candidates for revocation.">
        <select className="select" aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="active">Open + under review</option><option value="resolved">Resolved</option><option value="all">All</option>
        </select>
      </PageHeader>
      <Async state={state}>{(rows) => (
        <>
          <p className="muted" style={{ marginBottom: 12 }}>{rows.length} unused permission(s) · {rows.filter((r) => r.inherited).length} reached only through role inheritance</p>
          <Table rows={rows} onRowClick={review} empty="No unused permissions detected."
            columns={[
              { key: 'severity', label: 'Risk', render: (r) => <Sev level={r.severity} /> },
              { key: 'full_name', label: 'Employee', render: (r) => <><div>{r.full_name}</div><div className="faint" style={{ fontSize: 12 }}>{r.department}</div></> },
              { key: 'perm', label: 'Permission', render: (r) => <span className="mono">{r.action} {r.resource_type}</span> },
              { key: 'role_name', label: 'Granted through', render: (r) => r.inherited ? <>{r.role_name} <span className="faint">(inherited by {r.held_role_name})</span></> : r.role_name },
              { key: 'window_days', label: 'Unused for', render: (r) => `${r.window_days}+ days` },
              { key: 'status', label: 'Status', render: (r) => <Pill value={r.status} /> },
              { key: 'detected_at', label: 'Detected', render: (r) => fmtDate(r.detected_at) },
            ]} />
          {open && <FindingReview finding={open} onClose={() => setOpen(null)} onChanged={(row) => { setOpen(row); state.reload(); }} />}
        </>
      )}</Async>
    </div>
  );
}
