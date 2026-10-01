// Smoke test: starts the API in-process against your real database and checks every
// endpoint group, role restrictions and validation. It is safe to run: the only write
// it makes is one access request that it immediately rejects.
//
//   npm test
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { pool, query } = require('../src/db');
const { buildApp } = require('../src/app');

let passed = 0, failed = 0;
const check = (name, cond, extra = '') => {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name} ${extra}`); }
};

(async () => {
  // make sure demo accounts have real passwords (same step server.js does on first start)
  const hash = await bcrypt.hash(process.env.DEMO_PASSWORD || 'Password@123', 10);
  await query(`UPDATE app_users SET password_hash = $1 WHERE password_hash LIKE 'PLACEHOLDER_HASH%'`, [hash]);

  const server = buildApp().listen(0);
  const base = `http://localhost:${server.address().port}`;
  const PW = process.env.DEMO_PASSWORD || 'Password@123';

  const call = async (method, path, token, body) => {
    const r = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = null; try { data = await r.json(); } catch (e) { /* empty */ }
    return { status: r.status, data };
  };
  const login = async (u) => (await call('POST', '/api/auth/login', null, { username: u, password: PW })).data.token;

  try {
    console.log('\nAuthentication');
    check('health endpoint is public', (await call('GET', '/api/health')).status === 200);
    check('wrong password -> 401', (await call('POST', '/api/auth/login', null, { username: 'lsimmons', password: 'nope' })).status === 401);
    check('missing credentials -> 400', (await call('POST', '/api/auth/login', null, {})).status === 400);
    check('no token -> 401', (await call('GET', '/api/dashboard')).status === 401);
    const admin = await login('lsimmons'), auditor = await login('falsayed'),
          manager = await login('pnair'), viewer = await login('dchen');
    check('all four demo roles can log in', admin && auditor && manager && viewer);

    console.log('\nDashboard');
    const dash = (await call('GET', '/api/dashboard', viewer)).data;
    check('summary cards present', dash.total_employees === 22 && dash.total_roles >= 15 && dash.total_permissions === 16);
    check('risk distribution has all 4 severities', ['critical', 'high', 'medium', 'low'].every((k) => k in dash.risk_distribution));
    check('activity trend is an array', Array.isArray(dash.activity_trend));
    check('top risky employees sorted desc', dash.top_risky_employees.length > 0 &&
      dash.top_risky_employees.every((e, i, a) => i === 0 || a[i - 1].risk_score >= e.risk_score));

    console.log('\nEmployees');
    const emps = (await call('GET', '/api/employees?limit=5', viewer)).data;
    check('list returns total + items', emps.total === 22 && emps.items.length === 5);
    const s = (await call('GET', '/api/employees?search=baxter', viewer)).data;
    check('search works', s.total === 1 && s.items[0].full_name === 'Tom Baxter');
    check('min_risk filter works', (await call('GET', '/api/employees?min_risk=100', viewer)).data.items.every((e) => e.risk_score >= 100));
    const tomId = s.items[0].employee_id;
    const prof = (await call('GET', `/api/employees/${tomId}`, viewer)).data;
    check('profile has effective permissions incl. inherited', prof.effective_permissions.some((p) => p.action === 'approve' && p.via_role_direct === false));
    check('profile has grants, activity, findings, risk score',
      prof.grants.length > 0 && prof.recent_activity.length > 0 && prof.findings.length > 0 && prof.risk_score > 0);
    check('unknown employee -> 404', (await call('GET', '/api/employees/99999', viewer)).status === 404);
    check('bad employee id -> 400', (await call('GET', '/api/employees/abc', viewer)).status === 400);
    check('departments list', (await call('GET', '/api/employees/meta/departments', viewer)).data.includes('Finance'));

    console.log('\nRoles, permissions, hierarchy');
    const roles = (await call('GET', '/api/roles', viewer)).data;
    check('roles list', roles.length >= 15);
    const fg = roles.find((r) => r.role_name === 'Finance Generalist');
    const detail = (await call('GET', `/api/roles/${fg.role_id}`, viewer)).data;
    check('multi-parent role has 2 parents', detail.parents.length === 2);
    check('inherited permissions resolved through DAG', detail.permissions.filter((p) => p.inherited).length >= 2);
    const h = (await call('GET', '/api/role-hierarchy', viewer)).data;
    check('hierarchy returns nodes and edges', h.nodes.length >= 15 && h.edges.length >= 15);
    check('permissions list', (await call('GET', '/api/permissions', viewer)).data.length === 16);
    check('SoD rules list', (await call('GET', '/api/sod-rules', viewer)).data.length === 3);

    console.log('\nFindings, SoD, unused access');
    const f = (await call('GET', '/api/findings?limit=500', viewer)).data;
    check('findings list', f.total > 0 && f.items[0].title);
    check('type filter', (await call('GET', '/api/findings?type=anomalous_access', viewer)).data.items.every((x) => x.finding_type === 'anomalous_access'));
    const sod = (await call('GET', '/api/sod-violations', viewer)).data;
    check('SoD page distinguishes direct vs indirect', sod.some((x) => x.conflict_kind.startsWith('Direct')) && sod.some((x) => x.conflict_kind.startsWith('Indirect')));
    check('SoD rows name both permissions and granting roles', sod.every((x) => x.permission_a && x.permission_b && x.roles_granting_a));
    check('unused access list', (await call('GET', '/api/unused-access', viewer)).data.length > 0);
    const target = f.items.find((x) => x.finding_type === 'unused_access');
    check('viewer cannot change a finding -> 403', (await call('PATCH', `/api/findings/${target.finding_id}`, viewer, { status: 'resolved' })).status === 403);
    check('invalid status -> 400', (await call('PATCH', `/api/findings/${target.finding_id}`, auditor, { status: 'bogus' })).status === 400);
    const up = await call('PATCH', `/api/findings/${target.finding_id}`, auditor, { status: 'under_review', notes: 'smoke test' });
    check('auditor can move a finding to under_review', up.status === 200 && up.data.status === 'under_review');
    await call('PATCH', `/api/findings/${target.finding_id}`, auditor, { status: 'open', notes: 'smoke test reverted' });

    console.log('\nLogs');
    const al = (await call('GET', '/api/access-logs?limit=10', viewer)).data;
    check('access logs paginate', al.total > 100 && al.items.length === 10);
    check('failed-login filter', (await call('GET', '/api/access-logs?success=false', viewer)).data.items.every((x) => x.success === false));
    check('audit logs', (await call('GET', '/api/audit-logs?limit=5', viewer)).status === 200);

    console.log('\nAccess request workflow');
    const roleId = roles.find((r) => r.role_name === 'Auditor').role_id;
    const created = await call('POST', '/api/access-requests', viewer, { role_id: roleId, justification: 'smoke test' });
    check('viewer can raise a request', created.status === 201);
    const rid = created.data.request_id;
    check('break-glass without justification -> 400', (await call('POST', '/api/access-requests', viewer, { role_id: roleId, is_break_glass: true })).status === 400);
    check('request with nothing requested -> 400', (await call('POST', '/api/access-requests', viewer, {})).status === 400);
    check('viewer cannot review -> 403', (await call('POST', `/api/access-requests/${rid}/approve`, viewer)).status === 403);
    // a manager raising a request and trying to approve it themselves must be stopped by the DATABASE rule
    const own = await call('POST', '/api/access-requests', manager, { role_id: roleId, justification: 'smoke test self-approval' });
    const selfTry = await call('POST', `/api/access-requests/${own.data.request_id}/approve`, manager);
    check('manager cannot approve their own request (DB rule) -> 400', selfTry.status === 400 && /own access request/.test(selfTry.data.error));
    check('admin can reject it instead', (await call('POST', `/api/access-requests/${own.data.request_id}/reject`, admin)).status === 200);
    const rej = await call('POST', `/api/access-requests/${rid}/reject`, manager);
    check('manager can reject', rej.status === 200 && rej.data.status === 'rejected');
    check('cannot review twice -> 400', (await call('POST', `/api/access-requests/${rid}/reject`, manager)).status === 400);
    check('pending list filter', (await call('GET', '/api/access-requests?status=pending', viewer)).data.every((x) => x.status === 'pending'));

    console.log('\nRecertification');
    const camps = (await call('GET', '/api/recertification/campaigns', viewer)).data;
    check('campaigns list with progress counts', camps.length >= 1 && 'pending_items' in camps[0]);
    const mine = (await call('GET', '/api/recertification/items', manager)).data;
    check('manager only sees items assigned to them', mine.every((x) => x.reviewer_name === 'Priya Nair'));
    check('viewer cannot launch a campaign -> 403', (await call('POST', '/api/recertification/campaigns', viewer, { name: 'x', start_date: '2026-01-01', end_date: '2026-02-01' })).status === 403);
    check('bad decision -> 400', (await call('POST', '/api/recertification/items/1/decision', manager, { decision: 'maybe' })).status === 400);

    console.log('\nAdmin actions');
    check('non-admin cannot run detectors -> 403', (await call('POST', '/api/admin/run-detectors', manager)).status === 403);
    const rd = await call('POST', '/api/admin/run-detectors', admin);
    check('admin can run detectors (idempotent: 0 new findings)', rd.status === 200 && rd.data.new_findings === 0);
    check('admin can expire grants', (await call('POST', '/api/admin/expire-grants', admin)).status === 200);
    check('unknown route -> 404', (await call('GET', '/api/nope', viewer)).status === 404);
  } catch (e) {
    failed++; console.log('  FAIL  unexpected error:', e);
  } finally {
    server.close(); await pool.end();
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
  }
})();