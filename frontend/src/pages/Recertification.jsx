import { useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useApi, Async, Card, PageHeader, Table, Modal, Field, Notice, Pill, useAction, fmtDay, fmtDate, qs } from '../components/ui';

export default function Recertification() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const canDecide = ['admin', 'manager'].includes(user?.role);
  const campaigns = useApi(() => api.get('/recertification/campaigns'));
  const [sel, setSel] = useState(null);
  const [decision, setDecision] = useState('pending');
  const [launching, setLaunching] = useState(false);
  const items = useApi(() => api.get(`/recertification/items${qs({ campaign_id: sel, decision })}`), [sel, decision]);
  const act = useAction();

  const decide = async (it, d) => {
    await act.run(() => api.post(`/recertification/items/${it.item_id}/decision`, { decision: d }), d === 'keep' ? 'Access kept.' : 'Access revoked.');
    items.reload(); campaigns.reload();
  };
  const close = async (c) => { await act.run(() => api.post(`/recertification/campaigns/${c.campaign_id}/close`), 'Campaign closed.'); campaigns.reload(); };

  return (
    <div>
      <PageHeader title="Recertification" subtitle="Periodic access review: each manager certifies (keep) or revokes their team's access.">
        {isAdmin && <button className="btn btn--primary" onClick={() => setLaunching(true)}>Launch campaign</button>}
      </PageHeader>
      <Notice kind="err">{act.error}</Notice><Notice kind="ok">{act.ok}</Notice>
      <Async state={campaigns}>{(rows) => (
        <Table rows={rows} onRowClick={(c) => setSel(sel === c.campaign_id ? null : c.campaign_id)} empty="No campaigns yet."
          columns={[
            { key: 'name', label: 'Campaign', render: (c) => <b style={{ color: sel === c.campaign_id ? 'var(--accent-strong)' : undefined }}>{c.name}</b> },
            { key: 'status', label: 'Status', render: (c) => <Pill value={c.status} /> },
            { key: 'window', label: 'Window', render: (c) => `${fmtDay(c.start_date)} → ${fmtDay(c.end_date)}` },
            { key: 'progress', label: 'Progress', render: (c) => {
              const done = c.total_items - c.pending_items;
              return <div style={{ minWidth: 140 }}><div className="bar-track"><div className="bar-fill" style={{ width: `${c.total_items ? (done / c.total_items) * 100 : 0}%` }} /></div><div className="faint" style={{ fontSize: 12 }}>{done}/{c.total_items} decided · {c.kept_items} kept · {c.revoked_items} revoked</div></div>;
            } },
            ...(isAdmin ? [{ key: 'x', label: '', render: (c) => c.status !== 'completed' && <button className="btn btn--sm" disabled={c.pending_items > 0} title={c.pending_items > 0 ? 'Items still pending' : ''} onClick={(e) => { e.stopPropagation(); close(c); }}>Close</button> }] : []),
          ]} />
      )}</Async>

      <div style={{ marginTop: 20 }}>
        <Card title={sel ? 'Items in selected campaign' : 'Review items (all campaigns)'} actions={
          <select className="select" aria-label="Decision" value={decision} onChange={(e) => setDecision(e.target.value)}>
            <option value="pending">Pending</option><option value="keep">Kept</option><option value="revoke">Revoked</option><option value="">All</option>
          </select>}>
          <Async state={items}>{(rows) => (
            <Table rows={rows} empty="No items match."
              columns={[
                { key: 'employee_name', label: 'Employee', render: (r) => <><div>{r.employee_name}</div><div className="faint" style={{ fontSize: 12 }}>{r.department}</div></> },
                { key: 'role_name', label: 'Role under review' },
                { key: 'grant_type', label: 'Grant', render: (r) => <Pill value={r.grant_type} /> },
                { key: 'reviewer_name', label: 'Reviewer' },
                { key: 'decision', label: 'Decision', render: (r) => <><Pill value={r.decision} />{r.reviewed_at && <div className="faint" style={{ fontSize: 12 }}>{fmtDate(r.reviewed_at)}</div>}</> },
                ...(canDecide ? [{ key: 'x', label: '', render: (r) => r.decision === 'pending' && <div className="row"><button className="btn btn--sm btn--primary" onClick={() => decide(r, 'keep')}>Keep</button><button className="btn btn--sm btn--danger" onClick={() => decide(r, 'revoke')}>Revoke</button></div> }] : []),
              ]} />
          )}</Async>
        </Card>
      </div>
      {launching && <Launch onClose={() => setLaunching(false)} onDone={() => { setLaunching(false); campaigns.reload(); items.reload(); }} />}
    </div>
  );
}

function Launch({ onClose, onDone }) {
  const today = new Date(); const plus = new Date(Date.now() + 30 * 864e5);
  const [f, setF] = useState({ name: `Access Recertification ${today.toISOString().slice(0, 7)}`, start_date: today.toISOString().slice(0, 10), end_date: plus.toISOString().slice(0, 10) });
  const act = useAction();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => { if (await act.run(() => api.post('/recertification/campaigns', f))) onDone(); };
  return (
    <Modal title="Launch recertification campaign" onClose={onClose} footer={<button className="btn btn--primary" disabled={act.busy} onClick={save}>Launch</button>}>
      <p className="muted">Creates one review item for every currently active grant, assigned to the holder's manager.</p>
      <Field label="Name"><input className="input" value={f.name} onChange={set('name')} /></Field>
      <div className="row"><Field label="Start"><input className="input" type="date" value={f.start_date} onChange={set('start_date')} /></Field><Field label="End"><input className="input" type="date" value={f.end_date} onChange={set('end_date')} /></Field></div>
      <Notice kind="err">{act.error}</Notice>
    </Modal>
  );
}
