import { useState } from 'react';
import { api, download } from '../lib/api';
import { useApi, Async, Card, PageHeader, Table, Notice, useAction, titleCase } from '../components/ui';

export default function Reports() {
  const cat = useApi(() => api.get('/reports'));
  const [key, setKey] = useState('risk-scores');
  const report = useApi(() => api.get(`/reports/${key}`), [key]);
  const act = useAction();
  const cols = (rows) => (rows[0] ? Object.keys(rows[0]).map((k) => ({ key: k, label: titleCase(k), render: (r) => (r[k] === null ? '—' : typeof r[k] === 'boolean' ? (r[k] ? 'yes' : 'no') : String(r[k]).replace('T', ' ').slice(0, 19)) })) : []);

  return (
    <div>
      <PageHeader title="Reports" subtitle="Compliance-ready exports. Each report is a PostgreSQL view; download it as CSV for auditors.">
        <button className="btn btn--primary" disabled={act.busy} onClick={() => act.run(() => download(`/reports/${key}?format=csv`, `eapis-${key}.csv`), 'Download started.')}>Download CSV</button>
      </PageHeader>
      <Notice kind="err">{act.error}</Notice>
      <Async state={cat}>{(list) => (
        <div className="toolbar">{list.map((r) => <button key={r.key} className={`btn btn--sm ${r.key === key ? 'btn--primary' : ''}`} onClick={() => setKey(r.key)}>{r.title}</button>)}</div>
      )}</Async>
      <Async state={report}>{(d) => (
        <Card title={`${d.title} — ${d.count} row(s)`}><Table rows={d.rows} columns={cols(d.rows)} empty="This report is empty." /></Card>
      )}</Async>
    </div>
  );
}
