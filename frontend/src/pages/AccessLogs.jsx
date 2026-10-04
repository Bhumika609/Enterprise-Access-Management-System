import { useState } from 'react';
import { api } from '../lib/api';
import { useApi, Async, PageHeader, Table, Pager, Pill, fmtDate, qs } from '../components/ui';

const LIMIT = 50;
export default function AccessLogs() {
  const [f, setF] = useState({ search: '', success: '', from: '', to: '' });
  const [offset, setOffset] = useState(0);
  const set = (k) => (e) => { setF({ ...f, [k]: e.target.value }); setOffset(0); };
  const state = useApi(() => api.get(`/access-logs${qs({ ...f, limit: LIMIT, offset })}`), [f, offset]);
  return (
    <div>
      <PageHeader title="Access Logs" subtitle="Usage trail: who touched which resource, when, from where. (Permission changes are in Audit Logs.)" />
      <div className="toolbar">
        <input className="input grow" placeholder="Search person, resource, action or IP…" aria-label="Search access logs" value={f.search} onChange={set('search')} />
        <select className="select" aria-label="Result" value={f.success} onChange={set('success')}><option value="">Any result</option><option value="true">Success</option><option value="false">Failed</option></select>
        <input className="input" type="date" aria-label="From" value={f.from} onChange={set('from')} />
        <input className="input" type="date" aria-label="To" value={f.to} onChange={set('to')} />
      </div>
      <Async state={state}>{(d) => (
        <>
          <Table rows={d.items} empty="No log entries match."
            columns={[
              { key: 'occurred_at', label: 'When', render: (r) => <span className="mono">{fmtDate(r.occurred_at)}</span> },
              { key: 'full_name', label: 'Employee', render: (r) => <><div>{r.full_name}</div><div className="faint" style={{ fontSize: 12 }}>{r.department}</div></> },
              { key: 'resource_name', label: 'Resource' },
              { key: 'action', label: 'Action' },
              { key: 'success', label: 'Result', render: (r) => <Pill value={r.success ? 'success' : 'failed'} tone={r.success ? 'ok' : 'bad'} /> },
              { key: 'ip_address', label: 'IP address', render: (r) => <span className="mono">{String(r.ip_address).replace(/\/32$/, '')}</span> },
            ]} />
          <Pager total={d.total} limit={LIMIT} offset={offset} onChange={setOffset} />
        </>
      )}</Async>
    </div>
  );
}
