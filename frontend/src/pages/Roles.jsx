import { useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useApi, Async, Card, PageHeader, Table, Tabs, Modal, Field, Notice, Pill, Sev, useAction } from '../components/ui';

export default function Roles() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [tab, setTab] = useState('roles');
  return (
    <div>
      <PageHeader title="Roles & Permissions" subtitle={isAdmin ? 'View and manage the RBAC model. Every change is written to the audit log by database triggers.' : 'The RBAC model being analysed (read-only for your role).'} />
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'roles', label: 'Roles' }, { key: 'permissions', label: 'Permissions' }, { key: 'sod', label: 'SoD rules' }]} />
      {tab === 'roles' && <RolesTab isAdmin={isAdmin} />}
      {tab === 'permissions' && <PermissionsTab isAdmin={isAdmin} />}
      {tab === 'sod' && <SodRulesTab isAdmin={isAdmin} />}
    </div>
  );
}

function RolesTab({ isAdmin }) {
  const roles = useApi(() => api.get('/roles'));
  const [openId, setOpenId] = useState(null);
  const [creating, setCreating] = useState(false);
  return (
    <>
      {isAdmin && <div className="toolbar"><button className="btn btn--primary right" onClick={() => setCreating(true)}>New role</button></div>}
      <Async state={roles}>{(rows) => (
        <Table rows={rows} onRowClick={(r) => setOpenId(r.role_id)}
          columns={[
            { key: 'role_name', label: 'Role', render: (r) => <><div>{r.role_name}</div><div className="faint" style={{ fontSize: 12 }}>{r.description}</div></> },
            { key: 'parents', label: 'Inherits from', render: (r) => (r.parents.length ? r.parents.join(', ') : <span className="faint">— (root)</span>) },
            { key: 'direct_permission_count', label: 'Own perms', align: 'right' },
            { key: 'holders', label: 'Holders', align: 'right' },
          ]} />
      )}</Async>
      {openId && <RoleDetail id={openId} isAdmin={isAdmin} onClose={() => { setOpenId(null); roles.reload(); }} />}
      {creating && <NewRole onClose={() => setCreating(false)} onDone={() => { setCreating(false); roles.reload(); }} />}
    </>
  );
}

function NewRole({ onClose, onDone }) {
  const [name, setName] = useState(''); const [desc, setDesc] = useState('');
  const act = useAction();
  const save = async () => { if (await act.run(() => api.post('/manage/roles', { role_name: name, description: desc }))) onDone(); };
  return (
    <Modal title="New role" onClose={onClose} footer={<button className="btn btn--primary" disabled={act.busy || !name.trim()} onClick={save}>Create role</button>}>
      <Field label="Role name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="Description"><textarea className="input" value={desc} onChange={(e) => setDesc(e.target.value)} /></Field>
      <Notice kind="err">{act.error}</Notice>
    </Modal>
  );
}

function RoleDetail({ id, isAdmin, onClose }) {
  const detail = useApi(() => api.get(`/roles/${id}`), [id]);
  const perms = useApi(() => api.get('/permissions'));
  const allRoles = useApi(() => api.get('/roles'));
  const [addPerm, setAddPerm] = useState(''); const [addParent, setAddParent] = useState('');
  const act = useAction();
  const mutate = async (fn, msg) => { await act.run(fn, msg); detail.reload(); };

  return (
    <Modal title={detail.data?.role?.role_name || 'Role'} onClose={onClose} wide>
      <Async state={detail}>{(d) => {
        const ownIds = new Set(d.permissions.filter((p) => !p.inherited).map((p) => p.permission_id));
        const parentIds = new Set(d.parents.map((p) => p.role_id));
        return (
          <>
            <p className="muted">{d.role.description}</p>
            <div className="row"><b>Inherits from:</b>
              {d.parents.length === 0 && <span className="faint">nothing (root role)</span>}
              {d.parents.map((p) => <span key={p.role_id} className="pill pill--info">{p.role_name}{isAdmin && <> <a href="#rm" aria-label={`Remove parent ${p.role_name}`} onClick={(e) => { e.preventDefault(); mutate(() => api.del(`/manage/roles/${id}/parents/${p.role_id}`), 'Parent removed.'); }}>✕</a></>}</span>)}
            </div>
            <div className="row"><b>Inherited by:</b>{d.children.length === 0 ? <span className="faint">no roles</span> : d.children.map((c) => <span key={c.role_id} className="pill">{c.role_name}</span>)}</div>
            {isAdmin && (
              <div className="row">
                <select className="select" aria-label="Add parent role" value={addParent} onChange={(e) => setAddParent(e.target.value)}>
                  <option value="">Add parent role…</option>
                  {(allRoles.data || []).filter((r) => r.role_id !== id && !parentIds.has(r.role_id)).map((r) => <option key={r.role_id} value={r.role_id}>{r.role_name}</option>)}
                </select>
                <button className="btn btn--sm" disabled={!addParent} onClick={() => mutate(() => api.post(`/manage/roles/${id}/parents`, { parent_role_id: Number(addParent) }), 'Parent added.').then(() => setAddParent(''))}>Add</button>
              </div>
            )}
            <Table rows={d.permissions} empty="This role has no permissions."
              columns={[
                { key: 'perm', label: 'Permission', render: (p) => <span className="mono">{p.action} {p.resource_type}</span> },
                { key: 'risk_level', label: 'Risk', render: (p) => <Sev level={p.risk_level} /> },
                { key: 'via_role', label: 'Source', render: (p) => p.inherited ? <span className="muted">inherited from {p.via_role}</span> : 'own' },
                ...(isAdmin ? [{ key: 'x', label: '', render: (p) => !p.inherited && <button className="btn btn--sm btn--danger" onClick={() => mutate(() => api.del(`/manage/roles/${id}/permissions/${p.permission_id}`), 'Permission removed.')}>Remove</button> }] : []),
              ]} />
            {isAdmin && (
              <div className="row">
                <select className="select" aria-label="Add permission" value={addPerm} onChange={(e) => setAddPerm(e.target.value)}>
                  <option value="">Add permission…</option>
                  {(perms.data || []).filter((p) => !ownIds.has(p.permission_id)).map((p) => <option key={p.permission_id} value={p.permission_id}>{p.action} {p.resource_type}</option>)}
                </select>
                <button className="btn btn--sm" disabled={!addPerm} onClick={() => mutate(() => api.post(`/manage/roles/${id}/permissions`, { permission_id: Number(addPerm) }), 'Permission added.').then(() => setAddPerm(''))}>Add</button>
              </div>
            )}
            <b>Current holders ({d.holders.length})</b>
            <div className="row">{d.holders.map((h) => <span key={h.employee_id + h.grant_type} className="pill">{h.full_name}{h.grant_type !== 'direct' && ` · ${h.grant_type}`}</span>)}</div>
            <Notice kind="err">{act.error}</Notice><Notice kind="ok">{act.ok}</Notice>
          </>
        );
      }}</Async>
    </Modal>
  );
}

function PermissionsTab({ isAdmin }) {
  const perms = useApi(() => api.get('/permissions'));
  const [creating, setCreating] = useState(false);
  const act = useAction();
  const del = async (p) => { await act.run(() => api.del(`/manage/permissions/${p.permission_id}`), 'Permission deleted.'); perms.reload(); };
  return (
    <>
      {isAdmin && <div className="toolbar"><button className="btn btn--primary right" onClick={() => setCreating(true)}>New permission</button></div>}
      <Notice kind="err">{act.error}</Notice><Notice kind="ok">{act.ok}</Notice>
      <Async state={perms}>{(rows) => (
        <Table rows={rows}
          columns={[
            { key: 'perm', label: 'Permission', render: (p) => <><span className="mono">{p.action} {p.resource_type}</span><div className="faint" style={{ fontSize: 12 }}>{p.description}</div></> },
            { key: 'risk_level', label: 'Risk', render: (p) => <Sev level={p.risk_level} /> },
            { key: 'expected_frequency', label: 'Expected use', render: (p) => <Pill value={p.expected_frequency} /> },
            { key: 'role_count', label: 'In roles', align: 'right' },
            ...(isAdmin ? [{ key: 'x', label: '', render: (p) => <button className="btn btn--sm btn--danger" onClick={() => del(p)}>Delete</button> }] : []),
          ]} />
      )}</Async>
      {creating && <NewPermission onClose={() => setCreating(false)} onDone={() => { setCreating(false); perms.reload(); }} />}
    </>
  );
}

function NewPermission({ onClose, onDone }) {
  const [f, setF] = useState({ action: '', resource_type: '', risk_level: 'medium', expected_frequency: 'regular', description: '' });
  const act = useAction();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => { if (await act.run(() => api.post('/manage/permissions', f))) onDone(); };
  return (
    <Modal title="New permission" onClose={onClose} footer={<button className="btn btn--primary" disabled={act.busy} onClick={save}>Create permission</button>}>
      <Field label="Action (e.g. approve)"><input className="input" value={f.action} onChange={set('action')} /></Field>
      <Field label="Resource type (e.g. payment)"><input className="input" value={f.resource_type} onChange={set('resource_type')} /></Field>
      <div className="row">
        <Field label="Risk level"><select className="select" value={f.risk_level} onChange={set('risk_level')}>{['low', 'medium', 'high', 'critical'].map((x) => <option key={x}>{x}</option>)}</select></Field>
        <Field label="Expected frequency"><select className="select" value={f.expected_frequency} onChange={set('expected_frequency')}>{['regular', 'occasional', 'rare'].map((x) => <option key={x}>{x}</option>)}</select></Field>
      </div>
      <Field label="Description"><textarea className="input" value={f.description} onChange={set('description')} /></Field>
      <Notice kind="err">{act.error}</Notice>
    </Modal>
  );
}

function SodRulesTab({ isAdmin }) {
  const rules = useApi(() => api.get(isAdmin ? '/manage/sod-rules' : '/sod-rules'), [isAdmin]);
  const perms = useApi(() => api.get('/permissions'));
  const [creating, setCreating] = useState(false);
  const act = useAction();
  const toggle = async (r) => { await act.run(() => api.patch(`/manage/sod-rules/${r.rule_id}`, { is_active: !r.is_active }), `Rule ${r.is_active ? 'disabled' : 'enabled'}. Re-run detectors from Administration to apply.`); rules.reload(); };
  const del = async (r) => { await act.run(() => api.del(`/manage/sod-rules/${r.rule_id}`), 'Rule deleted.'); rules.reload(); };
  return (
    <>
      <p className="muted" style={{ marginBottom: 12 }}>The detection engine is driven by this table — adding a rule needs no code change.</p>
      {isAdmin && <div className="toolbar"><button className="btn btn--primary right" onClick={() => setCreating(true)}>New rule</button></div>}
      <Notice kind="err">{act.error}</Notice><Notice kind="ok">{act.ok}</Notice>
      <Async state={rules}>{(rows) => (
        <Table rows={rows}
          columns={[
            { key: 'pair', label: 'Conflicting pair', render: (r) => <><span className="mono">{r.permission_a}</span> <span className="faint">⚡</span> <span className="mono">{r.permission_b}</span><div className="faint" style={{ fontSize: 12 }}>{r.description}</div></> },
            { key: 'severity', label: 'Severity', render: (r) => <Sev level={r.severity} /> },
            { key: 'is_active', label: 'Active', render: (r) => <Pill value={r.is_active ? 'active' : 'disabled'} tone={r.is_active ? 'ok' : ''} /> },
            ...(isAdmin ? [{ key: 'x', label: '', render: (r) => <div className="row"><button className="btn btn--sm" onClick={() => toggle(r)}>{r.is_active ? 'Disable' : 'Enable'}</button><button className="btn btn--sm btn--danger" onClick={() => del(r)}>Delete</button></div> }] : []),
          ]} />
      )}</Async>
      {creating && <NewRule perms={perms.data || []} onClose={() => setCreating(false)} onDone={() => { setCreating(false); rules.reload(); }} />}
    </>
  );
}

function NewRule({ perms, onClose, onDone }) {
  const [f, setF] = useState({ permission_a_id: '', permission_b_id: '', severity: 'high', description: '' });
  const act = useAction();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => { if (await act.run(() => api.post('/manage/sod-rules', f))) onDone(); };
  const opts = <>{<option value="">Select…</option>}{perms.map((p) => <option key={p.permission_id} value={p.permission_id}>{p.action} {p.resource_type}</option>)}</>;
  return (
    <Modal title="New SoD rule" onClose={onClose} footer={<button className="btn btn--primary" disabled={act.busy || !f.permission_a_id || !f.permission_b_id} onClick={save}>Create rule</button>}>
      <Field label="Permission A"><select className="select" value={f.permission_a_id} onChange={set('permission_a_id')}>{opts}</select></Field>
      <Field label="Permission B"><select className="select" value={f.permission_b_id} onChange={set('permission_b_id')}>{opts}</select></Field>
      <Field label="Severity"><select className="select" value={f.severity} onChange={set('severity')}>{['low', 'medium', 'high', 'critical'].map((x) => <option key={x}>{x}</option>)}</select></Field>
      <Field label="Why is this combination dangerous?"><textarea className="input" value={f.description} onChange={set('description')} /></Field>
      <Notice kind="err">{act.error}</Notice>
    </Modal>
  );
}
