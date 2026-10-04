import { useState } from 'react';
import { api } from '../lib/api';
import { useApi, Async, PageHeader, Table, Pager, Pill, Modal, fmtDate, titleCase, qs } from '../components/ui';

const LIMIT = 50;
const TARGETS = ['role', 'permission', 'role_permission', 'role_hierarchy', 'employee_role', 'sod_rule', 'access_request'];

export default function AuditLogs() {
  const [f, setF] = useState({ target_type: '', change_type: '' });
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState(null);
  const set = (k) => (e) => { setF({ ...f, [k]: e.target.value }); setOffset(0); };
  const state = useApi(() => api.get(`/audit-logs${qs({ ...f, limit: LIMIT, offset })}`), [f, offset]);
  return (
    <div>
      <PageHeader title="Audit Logs" subtitle="Every change to roles, permissions, hierarchy, grants, SoD rules and requests — written by database triggers." />
      <div className="toolbar">
        <select className="select" aria-label="Target" value={f.target_type} onChange={set('target_type')}><option value="">All targets</option>{TARGETS.map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}</select>
        <select className="select" aria-label="Change" value={f.change_type} onChange={set('change_type')}><option value="">All changes</option><option value="insert">Insert</option><option value="update">Update</option><option value="delete">Delete</option></select>
      </div>
      <Async state={state}>{(d) => (
        <>
          <Table rows={d.items} onRowClick={setOpen} empty="No audit entries."
            columns={[
              { key: 'occurred_at', label: 'When', render: (r) => <span className="mono">{fmtDate(r.occurred_at)}</span> },
              { key: 'actor_name', label: 'Actor', render: (r) => r.actor_name || <span className="faint">system</span> },
              { key: 'target_type', label: 'Target', render: (r) => `${titleCase(r.target_type)} #${r.target_id}` },
              { key: 'change_type', label: 'Change', render: (r) => <Pill value={r.change_type} /> },
            ]} />
          <Pager total={d.total} limit={LIMIT} offset={offset} onChange={setOffset} />
          {open && (
            <Modal title={`Audit #${open.audit_id} — ${titleCase(open.target_type)} ${open.change_type}`} onClose={() => setOpen(null)} wide>
              <div className="form-row"><label>Before</label><pre className="json">{open.old_value ? JSON.stringify(open.old_value, null, 2) : '—'}</pre></div>
              <div className="form-row"><label>After</label><pre className="json">{open.new_value ? JSON.stringify(open.new_value, null, 2) : '—'}</pre></div>
            </Modal>
          )}
        </>
      )}</Async>
    </div>
  );
}
