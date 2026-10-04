import { useState } from 'react';
import { api } from '../lib/api';
import { useApi, Async, PageHeader, Table, Modal, Field, Notice, Pill, useAction, fmtDate } from '../components/ui';

export default function Delegations() {
  const [status, setStatus] = useState('active');
  const [creating, setCreating] = useState(false);
  const state = useApi(() => api.get(`/delegations?status=${status}`), [status]);
  const act = useAction();
  const revoke = async (r) => { await act.run(() => api.post(`/delegations/${r.grant_id}/revoke`), 'Delegation ended.'); state.reload(); };

  return (
    <div>
      <PageHeader title="Delegations" subtitle="Lend one of your own roles to a colleague for up to 30 days. Conflicting delegations are refused by the database.">
        <select className="select" aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="active">Active</option><option value="revoked">Revoked</option><option value="expired">Expired</option><option value="all">All</option>
        </select>
        <button className="btn btn--primary" onClick={() => setCreating(true)}>Delegate a role</button>
      </PageHeader>
      <Notice kind="err">{act.error}</Notice><Notice kind="ok">{act.ok}</Notice>
      <Async state={state}>{(rows) => (
        <Table rows={rows} empty="No delegations in this view."
          columns={[
            { key: 'role_name', label: 'Role' },
            { key: 'delegator_name', label: 'From' },
            { key: 'delegate_name', label: 'To' },
            { key: 'expires_at', label: 'Expires', render: (r) => fmtDate(r.expires_at) },
            { key: 'justification', label: 'Justification', render: (r) => <span className="muted">{r.justification}</span> },
            { key: 'status', label: 'Status', render: (r) => <Pill value={r.status} /> },
            { key: 'x', label: '', render: (r) => r.status === 'active' && <button className="btn btn--sm btn--danger" onClick={() => revoke(r)}>End</button> },
          ]} />
      )}</Async>
      {creating && <NewDelegation onClose={() => setCreating(false)} onDone={() => { setCreating(false); state.reload(); }} />}
    </div>
  );
}

function NewDelegation({ onClose, onDone }) {
  const roles = useApi(() => api.get('/roles'));
  const people = useApi(() => api.get('/employees?status=active&sort=name&limit=500'));
  const [f, setF] = useState({ role_id: '', delegate_id: '', expires_at: '', justification: '' });
  const act = useAction();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => { if (await act.run(() => api.post('/delegations', { ...f, role_id: Number(f.role_id), delegate_id: Number(f.delegate_id) }))) onDone(); };
  return (
    <Modal title="Delegate a role" onClose={onClose} footer={<button className="btn btn--primary" disabled={act.busy || !f.role_id || !f.delegate_id || !f.expires_at} onClick={save}>Delegate</button>}>
      <p className="muted">You can only delegate a role you hold directly.</p>
      <Field label="Role"><select className="select" value={f.role_id} onChange={set('role_id')}><option value="">Select…</option>{(roles.data || []).map((r) => <option key={r.role_id} value={r.role_id}>{r.role_name}</option>)}</select></Field>
      <Field label="Delegate to"><select className="select" value={f.delegate_id} onChange={set('delegate_id')}><option value="">Select…</option>{(people.data?.items || []).map((p) => <option key={p.employee_id} value={p.employee_id}>{p.full_name} — {p.department}</option>)}</select></Field>
      <Field label="Until"><input className="input" type="datetime-local" value={f.expires_at} onChange={set('expires_at')} /></Field>
      <Field label="Justification"><textarea className="input" value={f.justification} onChange={set('justification')} /></Field>
      <Notice kind="err">{act.error}</Notice>
    </Modal>
  );
}
