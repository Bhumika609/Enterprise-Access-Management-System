import { useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { Modal, Sev, Pill, Notice, Field, useAction, fmtDate, titleCase, canReview } from './ui';

// Review & resolve workflow for one finding. The status change itself is
// fn_update_finding_status() in PostgreSQL; this is only the form.
export default function FindingReview({ finding, onClose, onChanged }) {
  const { user } = useAuth();
  const [notes, setNotes] = useState(finding.resolution_notes || '');
  const act = useAction();
  const allowed = canReview(user?.role);

  const setStatus = async (status) => {
    const r = await act.run(() => api.patch(`/findings/${finding.finding_id}`, { status, notes }), `Marked as ${titleCase(status)}.`);
    if (r) onChanged(r);
  };

  return (
    <Modal title={`Finding #${finding.finding_id}`} onClose={onClose} wide
      footer={allowed ? (
        <>
          <button className="btn" disabled={act.busy} onClick={() => setStatus('under_review')}>Start review</button>
          <button className="btn" disabled={act.busy} onClick={() => setStatus('false_positive')}>False positive</button>
          <button className="btn btn--primary" disabled={act.busy} onClick={() => setStatus('resolved')}>Resolve</button>
        </>
      ) : <span className="muted" style={{ marginRight: 'auto' }}>Your role is read-only for findings.</span>}>
      <div className="row"><Sev level={finding.severity} /><Pill value={finding.status} /><span className="muted">{titleCase(finding.finding_type)}</span></div>
      <p><b>{finding.title}</b></p>
      <dl className="kv">
        <dt>Employee</dt><dd>{finding.full_name} · {finding.department}</dd>
        <dt>Detected</dt><dd>{fmtDate(finding.detected_at)}</dd>
        {finding.resolved_at && <><dt>Closed</dt><dd>{fmtDate(finding.resolved_at)} by {finding.resolved_by_name || '—'}</dd></>}
      </dl>
      <div className="form-row"><label>Evidence (from the detector)</label><pre className="json">{JSON.stringify(finding.related_entity, null, 2)}</pre></div>
      {allowed && <Field label="Review notes"><textarea className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Why is this resolved / a false positive?" /></Field>}
      <Notice kind="err">{act.error}</Notice>
      <Notice kind="ok">{act.ok}</Notice>
    </Modal>
  );
}
