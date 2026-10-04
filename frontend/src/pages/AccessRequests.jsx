import { useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useApi, Async, PageHeader, Table, Modal, Field, Notice, Pill, useAction, fmtDate } from '../components/ui';

export default function AccessRequests() {
  const { user } = useAuth();
  const [status, setStatus] = useState('pending');
  const [creating, setCreating] = useState(false);
  const state = useApi(() => api.get(`/access-requests${status ? `?status=${status}` : ''}`), [status]);
  const act = useAction();
  const canReview = ['admin', 'manager'].includes(user?.role);

  const review = async (r, decision) => {
    await act.run(() => api.post(`/access-requests/${r.request_id}/${decision}`), decision === 'approve' ? 'Request approved — access granted.' : 'Request rejected.');
    state.reload();
  };

  return (
    <div>
      <PageHeader title="Access Requests" subtitle="Approval workflow for standard, temporary and break-glass (emergency) access.">
        <select className="select" aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="">All</option>
        </select>
        <button className="btn btn--primary" onClick={() => setCreating(true)}>New request</button>
      </PageHeader>
      <Notice kind="err">{act.error}</Notice><Notice kind="ok">{act.ok}</Notice>
      <Async state={state}>{(rows) => (
        <Table rows={rows} empty="No requests in this view."
          columns={[
            { key: 'requester_name', label: 'Requester', render: (r) => <><div>{r.requester_name}</div><div className="faint" style={{ fontSize: 12 }}>{r.requester_department}</div></> },
            { key: 'what', label: 'Requesting', render: (r) => r.role_name ? `Role: ${r.role_name}` : `Resource: ${r.resource_name}` },
            { key: 'kind', label: 'Type', render: (r) => r.is_break_glass ? <Pill value="break glass" tone="bad" /> : r.is_temporary ? <Pill value="temporary" tone="warn" /> : <Pill value="standard" /> },
            { key: 'justification', label: 'Justification', render: (r) => <span className="muted">{r.justification || '—'}</span> },
            { key: 'expires_at', label: 'Expires', render: (r) => fmtDate(r.expires_at) },
            { key: 'status', label: 'Status', render: (r) => <><Pill value={r.status} />{r.reviewed_by_name && <div className="faint" style={{ fontSize: 12 }}>by {r.reviewed_by_name}</div>}</> },
            { key: 'requested_at', label: 'Requested', render: (r) => fmtDate(r.requested_at) },
            ...(canReview ? [{ key: 'x', label: '', render: (r) => r.status === 'pending' && (
              <div className="row"><button className="btn btn--sm btn--primary" onClick={() => review(r, 'approve')}>Approve</button><button className="btn btn--sm btn--danger" onClick={() => review(r, 'reject')}>Reject</button></div>) }] : []),
          ]} />
      )}</Async>
      {creating && <NewRequest onClose={() => setCreating(false)} onDone={() => { setCreating(false); state.reload(); }} />}
    </div>
  );
}

function NewRequest({ onClose, onDone }) {
  const roles = useApi(() => api.get('/roles'));
  const resources = useApi(() => api.get('/resources'));
  const [f, setF] = useState({ role_id: '', resource_id: '', is_temporary: false, is_break_glass: false, expires_at: '', justification: '' });
  const act = useAction();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const save = async () => {
    const body = { ...f, role_id: f.role_id ? Number(f.role_id) : null, resource_id: f.resource_id ? Number(f.resource_id) : null, expires_at: f.expires_at || null };
    if (await act.run(() => api.post('/access-requests', body))) onDone();
  };
  return (
    <Modal title="Request access" onClose={onClose} footer={<button className="btn btn--primary" disabled={act.busy || (!f.role_id && !f.resource_id)} onClick={save}>Submit request</button>}>
      <Field label="Role"><select className="select" value={f.role_id} onChange={set('role_id')}><option value="">— none —</option>{(roles.data || []).map((r) => <option key={r.role_id} value={r.role_id}>{r.role_name}</option>)}</select></Field>
      <Field label="…or resource"><select className="select" value={f.resource_id} onChange={set('resource_id')}><option value="">— none —</option>{(resources.data || []).map((r) => <option key={r.resource_id} value={r.resource_id}>{r.resource_name}</option>)}</select></Field>
      <label className="row"><input type="checkbox" checked={f.is_temporary} onChange={set('is_temporary')} /> Temporary access (auto-expires)</label>
      <label className="row"><input type="checkbox" checked={f.is_break_glass} onChange={set('is_break_glass')} /> Break-glass emergency access — justification required, flagged for review</label>
      {(f.is_temporary || f.is_break_glass) && <Field label="Expires at (optional — defaults to 24 h for break-glass, 7 days otherwise)"><input className="input" type="datetime-local" value={f.expires_at} onChange={set('expires_at')} /></Field>}
      <Field label="Justification"><textarea className="input" value={f.justification} onChange={set('justification')} /></Field>
      <Notice kind="err">{act.error}</Notice>
    </Modal>
  );
}
