import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useApi, Async, PageHeader, Table, Pager, Pill, Sev, fmtDate, titleCase, qs } from '../components/ui';
import FindingReview from '../components/FindingReview';

const LIMIT = 25;
const TYPES = ['sod_violation', 'privilege_escalation', 'unused_access', 'anomalous_access'];

export default function Findings() {
  const [params] = useSearchParams();
  const [f, setF] = useState({ type: '', severity: '', status: 'active', search: '', employee_id: params.get('employee_id') || '' });
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState(null);
  const set = (k) => (e) => { setF({ ...f, [k]: e.target.value }); setOffset(0); };
  const state = useApi(() => api.get(`/findings${qs({ ...f, limit: LIMIT, offset })}`), [f, offset]);

  return (
    <div>
      <PageHeader title="Findings" subtitle="Unified output of every detector — review, resolve or mark as false positive." />
      <div className="toolbar">
        <input className="input grow" placeholder="Search employee or description…" aria-label="Search findings" value={f.search} onChange={set('search')} />
        <select className="select" aria-label="Type" value={f.type} onChange={set('type')}>
          <option value="">All types</option>{TYPES.map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}
        </select>
        <select className="select" aria-label="Severity" value={f.severity} onChange={set('severity')}>
          <option value="">All severities</option>{['critical', 'high', 'medium', 'low'].map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
        </select>
        <select className="select" aria-label="Status" value={f.status} onChange={set('status')}>
          <option value="active">Open + under review</option><option value="open">Open</option><option value="under_review">Under review</option>
          <option value="resolved">Resolved</option><option value="false_positive">False positive</option><option value="all">All</option>
        </select>
        {f.employee_id && <button className="btn btn--sm" onClick={() => { setF({ ...f, employee_id: '' }); setOffset(0); }}>Clear employee filter ✕</button>}
      </div>
      <Async state={state}>{(d) => (
        <>
          <Table rows={d.items} onRowClick={setOpen} empty="No findings match these filters."
            columns={[
              { key: 'severity', label: 'Severity', render: (r) => <Sev level={r.severity} /> },
              { key: 'title', label: 'Finding', render: (r) => <><div>{r.title}</div><div className="faint" style={{ fontSize: 12 }}>{titleCase(r.finding_type)}</div></> },
              { key: 'full_name', label: 'Employee', render: (r) => <><div>{r.full_name}</div><div className="faint" style={{ fontSize: 12 }}>{r.department}</div></> },
              { key: 'status', label: 'Status', render: (r) => <Pill value={r.status} /> },
              { key: 'detected_at', label: 'Detected', render: (r) => fmtDate(r.detected_at) },
            ]} />
          <Pager total={d.total} limit={LIMIT} offset={offset} onChange={setOffset} />
          {open && <FindingReview finding={open} onClose={() => setOpen(null)} onChanged={(row) => { setOpen(row); state.reload(); }} />}
        </>
      )}</Async>
    </div>
  );
}
