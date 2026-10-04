import { api } from '../lib/api';
import { Card, PageHeader, Notice, useAction } from '../components/ui';

export default function Admin() {
  const detect = useAction();
  const expire = useAction();
  return (
    <div>
      <PageHeader title="Administration" subtitle="Run the database jobs on demand. They also run automatically (pg_cron nightly detection, 15-minute expiry)." />
      <div className="grid grid--2">
        <Card title="Detection engine">
          <p className="muted" style={{ marginBottom: 12 }}>Runs the SoD / privilege-escalation, unused-access and anomalous-access detectors. Safe to repeat — already-open findings are never duplicated.</p>
          <button className="btn btn--primary" disabled={detect.busy} onClick={() => detect.run(() => api.post('/admin/run-detectors'), (r) => `Done. ${r.new_findings} new finding(s); ${r.total_findings} in total.`)}>{detect.busy ? 'Running…' : 'Run all detectors now'}</button>
          <div style={{ marginTop: 12 }}><Notice kind="err">{detect.error}</Notice><Notice kind="ok">{detect.ok}</Notice></div>
        </Card>
        <Card title="Temporary & break-glass access">
          <p className="muted" style={{ marginBottom: 12 }}>Moves every active grant past its expiry date to “expired”. Each change is audit-logged by trigger.</p>
          <button className="btn" disabled={expire.busy} onClick={() => expire.run(() => api.post('/admin/expire-grants'), (r) => `${r.expired} grant(s) expired.`)}>Expire overdue grants now</button>
          <div style={{ marginTop: 12 }}><Notice kind="err">{expire.error}</Notice><Notice kind="ok">{expire.ok}</Notice></div>
        </Card>
      </div>
    </div>
  );
}
