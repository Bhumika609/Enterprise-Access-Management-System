import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useApi, Async, PageHeader, Table, Pager, Pill, qs } from '../components/ui';

const LIMIT = 25;

export default function Employees() {
  const nav = useNavigate();
  const [f, setF] = useState({ search: '', department: '', status: '', sort: 'risk' });
  const [offset, setOffset] = useState(0);
  const set = (k) => (e) => { setF({ ...f, [k]: e.target.value }); setOffset(0); };
  const depts = useApi(() => api.get('/employees/meta/departments'));
  const state = useApi(() => api.get(`/employees${qs({ ...f, limit: LIMIT, offset })}`), [f, offset]);

  return (
    <div>
      <PageHeader title="Employees" subtitle="Everyone in scope, ranked by computed risk score." />
      <div className="toolbar">
        <input className="input grow" placeholder="Search name, email or role…" aria-label="Search employees" value={f.search} onChange={set('search')} />
        <select className="select" aria-label="Department" value={f.department} onChange={set('department')}>
          <option value="">All departments</option>{(depts.data || []).map((d) => <option key={d}>{d}</option>)}
        </select>
        <select className="select" aria-label="Status" value={f.status} onChange={set('status')}>
          <option value="">Any status</option><option value="active">Active</option><option value="inactive">Inactive</option><option value="terminated">Terminated</option>
        </select>
        <select className="select" aria-label="Sort" value={f.sort} onChange={set('sort')}>
          <option value="risk">Sort: risk</option><option value="name">Sort: name</option><option value="department">Sort: department</option><option value="findings">Sort: findings</option>
        </select>
      </div>
      <Async state={state}>{(d) => (
        <>
          <Table
            rows={d.items}
            onRowClick={(r) => nav(`/employees/${r.employee_id}`)}
            columns={[
              { key: 'full_name', label: 'Name', render: (r) => <><div>{r.full_name}</div><div className="faint" style={{ fontSize: 12 }}>{r.email}</div></> },
              { key: 'department', label: 'Department' },
              { key: 'active_roles', label: 'Active roles', render: (r) => <span className="muted">{r.active_roles || '—'}</span> },
              { key: 'status', label: 'Status', render: (r) => <Pill value={r.status} /> },
              { key: 'open_finding_count', label: 'Findings', align: 'right' },
              { key: 'risk_score', label: 'Risk', align: 'right', render: (r) => <b className="mono" style={{ color: r.risk_score >= 100 ? 'var(--critical)' : r.risk_score >= 50 ? 'var(--high)' : r.risk_score > 0 ? 'var(--medium)' : 'var(--text-faint)' }}>{r.risk_score}</b> },
            ]}
          />
          <Pager total={d.total} limit={LIMIT} offset={offset} onChange={setOffset} />
        </>
      )}</Async>
    </div>
  );
}
