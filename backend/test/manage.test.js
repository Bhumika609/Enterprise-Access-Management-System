// backend/test/manage.test.js
// Tests admin management + delegation endpoints. Run with:   node test/manage.test.js
// It cleans up everything it creates (test roles/permissions/rules are deleted through the
// API itself; test delegations are removed with SQL). Audit-log entries are kept, as they
// would be in real use.
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { pool, query } = require('../src/db');
const { buildApp } = require('../src/app');

let passed = 0, failed = 0;
const check = (name, cond, extra = '') => {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name} ${extra ? JSON.stringify(extra) : ''}`); }
};
const daysAhead = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 19);

async function cleanup() {
  await query(`DELETE FROM sod_conflict_rules WHERE permission_a_id IN (SELECT permission_id FROM permissions WHERE resource_type = 'zz_doc')`);
  await query(`DELETE FROM roles WHERE role_name LIKE 'ZZ Test%'`);
  await query(`DELETE FROM permissions WHERE resource_type = 'zz_doc'`);
  await query(`DELETE FROM employee_roles WHERE grant_type = 'delegated' AND justification LIKE 'MANAGE-TEST%'`);
}

(async () => {
  const PW = process.env.DEMO_PASSWORD || 'Password@123';
  const hash = await bcrypt.hash(PW, 10);
  await query(`UPDATE app_users SET password_hash = $1 WHERE password_hash LIKE 'PLACEHOLDER_HASH%'`, [hash]);
  await cleanup();

  const server = buildApp().listen(0);
  const base = `http://localhost:${server.address().port}`;
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
    const admin = await login('lsimmons'), auditor = await login('falsayed'),
          manager = await login('pnair'), viewer = await login('dchen');
    const emp = async (search) => (await call('GET', `/api/employees?search=${search}`, viewer)).data.items[0].employee_id;

    console.log('\nAccess control');
    for (const [who, tok] of [['viewer', viewer], ['auditor', auditor], ['manager', manager]]) {
      check(`${who} cannot create a role -> 403`, (await call('POST', '/api/manage/roles', tok, { role_name: 'ZZ Test X' })).status === 403);
    }
    check('no token -> 401', (await call('POST', '/api/manage/roles', null, { role_name: 'ZZ Test X' })).status === 401);

    console.log('\nRoles');
    const a = await call('POST', '/api/manage/roles', admin, { role_name: 'ZZ Test A', description: 'test' });
    const b = await call('POST', '/api/manage/roles', admin, { role_name: 'ZZ Test B' });
    check('admin creates roles', a.status === 201 && b.status === 201 && a.data.role_name === 'ZZ Test A', a.data);
    check('duplicate role name (case-insensitive) -> 400', (await call('POST', '/api/manage/roles', admin, { role_name: 'zz test a' })).status === 400);
    check('empty role name -> 400', (await call('POST', '/api/manage/roles', admin, { role_name: '  ' })).status === 400);
    const ren = await call('PATCH', `/api/manage/roles/${a.data.role_id}`, admin, { description: 'updated' });
    check('role can be edited', ren.status === 200 && ren.data.description === 'updated', ren.data);
    check('unknown role -> 400', (await call('PATCH', '/api/manage/roles/999999', admin, { description: 'x' })).status === 400);

    console.log('\nPermissions');
    const p1 = await call('POST', '/api/manage/permissions', admin, { action: 'Create', resource_type: 'ZZ_Doc', risk_level: 'high', expected_frequency: 'rare' });
    const p2 = await call('POST', '/api/manage/permissions', admin, { action: 'approve', resource_type: 'zz_doc', risk_level: 'critical' });
    check('admin creates permissions (names normalised to lower case)', p1.status === 201 && p1.data.action === 'create' && p1.data.resource_type === 'zz_doc', p1.data);
    check('duplicate permission -> 400', (await call('POST', '/api/manage/permissions', admin, { action: 'create', resource_type: 'zz_doc', risk_level: 'low' })).status === 400);
    check('invalid risk level -> 400', (await call('POST', '/api/manage/permissions', admin, { action: 'x', resource_type: 'zz_doc', risk_level: 'extreme' })).status === 400);
    const pu = await call('PATCH', `/api/manage/permissions/${p1.data.permission_id}`, admin, { risk_level: 'medium' });
    check('permission risk can be edited', pu.status === 200 && pu.data.risk_level === 'medium', pu.data);

    console.log('\nRole <-> permission links and hierarchy');
    check('link permission to role', (await call('POST', `/api/manage/roles/${b.data.role_id}/permissions`, admin, { permission_id: p1.data.permission_id })).status === 201);
    check('duplicate link -> 400', (await call('POST', `/api/manage/roles/${b.data.role_id}/permissions`, admin, { permission_id: p1.data.permission_id })).status === 400);
    check('A inherits from B', (await call('POST', `/api/manage/roles/${a.data.role_id}/parents`, admin, { parent_role_id: b.data.role_id })).status === 201);
    const cyc = await call('POST', `/api/manage/roles/${b.data.role_id}/parents`, admin, { parent_role_id: a.data.role_id });
    check('cycle B -> A rejected by the database trigger', cyc.status === 400 && /cycle/i.test(cyc.data.error), cyc.data);
    check('self-inheritance -> 400', (await call('POST', `/api/manage/roles/${a.data.role_id}/parents`, admin, { parent_role_id: a.data.role_id })).status === 400);
    const detail = (await call('GET', `/api/roles/${a.data.role_id}`, viewer)).data;
    check('role A now shows the permission as inherited from B', detail.permissions.some((p) => p.action === 'create' && p.inherited && p.via_role === 'ZZ Test B'), detail.permissions);
    check('delete of a permission still in use -> 400', (await call('DELETE', `/api/manage/permissions/${p1.data.permission_id}`, admin)).status === 400);

    console.log('\nSoD rules');
    const rulesBefore = (await call('GET', '/api/sod-rules', viewer)).data.length;
    const r = await call('POST', '/api/manage/sod-rules', admin, { permission_a_id: p2.data.permission_id, permission_b_id: p1.data.permission_id, severity: 'high', description: 'MANAGE-TEST rule' });
    check('rule created; pair stored in canonical order', r.status === 201 && r.data.permission_a_id < r.data.permission_b_id, r.data);
    check('reverse-order duplicate -> 400', (await call('POST', '/api/manage/sod-rules', admin, { permission_a_id: p1.data.permission_id, permission_b_id: p2.data.permission_id, severity: 'low' })).status === 400);
    check('same permission twice -> 400', (await call('POST', '/api/manage/sod-rules', admin, { permission_a_id: p1.data.permission_id, permission_b_id: p1.data.permission_id, severity: 'low' })).status === 400);
    const ru = await call('PATCH', `/api/manage/sod-rules/${r.data.rule_id}`, admin, { severity: 'critical', is_active: false });
    check('rule can be edited and deactivated', ru.status === 200 && ru.data.severity === 'critical' && ru.data.is_active === false, ru.data);
    check('rule list grows', (await call('GET', '/api/sod-rules', viewer)).data.length === rulesBefore + 1);
    check('management list includes ids', (await call('GET', '/api/manage/sod-rules', admin)).data.some((x) => x.rule_id === r.data.rule_id && x.permission_a_id));
    const aud = (await call('GET', '/api/audit-logs?target_type=sod_rule&limit=20', viewer)).data.items;
    check('rule changes are audited with the admin as actor', aud.some((x) => x.change_type === 'insert' && x.actor_name === 'Laura Simmons') && aud.some((x) => x.change_type === 'update'), aud.length);

    console.log('\nClean-up through the API (also tests deletes)');
    check('delete rule', (await call('DELETE', `/api/manage/sod-rules/${r.data.rule_id}`, admin)).status === 200);
    check('delete missing rule -> 400', (await call('DELETE', `/api/manage/sod-rules/${r.data.rule_id}`, admin)).status === 400);
    check('unlink permission from role', (await call('DELETE', `/api/manage/roles/${b.data.role_id}/permissions/${p1.data.permission_id}`, admin)).status === 200);
    check('remove inheritance', (await call('DELETE', `/api/manage/roles/${a.data.role_id}/parents/${b.data.role_id}`, admin)).status === 200);
    check('delete both permissions', (await call('DELETE', `/api/manage/permissions/${p1.data.permission_id}`, admin)).status === 200 &&
                                     (await call('DELETE', `/api/manage/permissions/${p2.data.permission_id}`, admin)).status === 200);
    check('delete both roles', (await call('DELETE', `/api/manage/roles/${a.data.role_id}`, admin)).status === 200 &&
                               (await call('DELETE', `/api/manage/roles/${b.data.role_id}`, admin)).status === 200);
    check('a role that was granted cannot be deleted -> 400', (await call('DELETE', `/api/manage/roles/${(await call('GET', '/api/roles', viewer)).data.find((x) => x.role_name === 'Payments Admin').role_id}`, admin)).status === 400);
    check('rule count back to original', (await call('GET', '/api/sod-rules', viewer)).data.length === rulesBefore);

    console.log('\nDelegated access');
    const roles = (await call('GET', '/api/roles', viewer)).data;
    const fm = roles.find((x) => x.role_name === 'Finance Manager').role_id;
    const pa = roles.find((x) => x.role_name === 'Payments Admin').role_id;
    const marcus = await emp('webb'), grace = await emp('kim');
    const d = await call('POST', '/api/delegations', manager, { role_id: fm, delegate_id: marcus, expires_at: daysAhead(3), justification: 'MANAGE-TEST covering leave' });
    check('manager delegates her own role', d.status === 201 && d.data.delegator_name === 'Priya Nair' && d.data.delegate_name === 'Marcus Webb' && d.data.status === 'active', d.data);
    const mprof = (await call('GET', `/api/employees/${marcus}`, viewer)).data;
    check('delegate now holds it as a "delegated" grant', mprof.grants.some((g) => g.role_name === 'Finance Manager' && g.grant_type === 'delegated' && g.status === 'active'));
    check('and gains its permissions', mprof.effective_permissions.some((p) => p.action === 'export'));
    check('appears in the active list and in "mine"', (await call('GET', '/api/delegations', viewer)).data.some((x) => x.grant_id === d.data.grant_id) &&
                                                       (await call('GET', '/api/delegations?mine=true', manager)).data.some((x) => x.grant_id === d.data.grant_id));
    check('not in someone else\'s "mine"', !(await call('GET', '/api/delegations?mine=true', viewer)).data.some((x) => x.grant_id === d.data.grant_id));
    check('delegating again -> 400 (already holds)', (await call('POST', '/api/delegations', manager, { role_id: fm, delegate_id: marcus, expires_at: daysAhead(2), justification: 'MANAGE-TEST dup' })).status === 400);
    check('delegate cannot pass it on (no direct grant) -> 400', (await call('POST', '/api/delegations', admin, { delegator_id: marcus, role_id: fm, delegate_id: grace, expires_at: daysAhead(2), justification: 'MANAGE-TEST chain' })).status === 400);
    check('no justification -> 400', (await call('POST', '/api/delegations', manager, { role_id: fm, delegate_id: grace, expires_at: daysAhead(2) })).status === 400);
    check('no expiry -> 400', (await call('POST', '/api/delegations', manager, { role_id: fm, delegate_id: grace, justification: 'MANAGE-TEST' })).status === 400);
    check('more than 30 days -> 400', (await call('POST', '/api/delegations', manager, { role_id: fm, delegate_id: grace, expires_at: daysAhead(31), justification: 'MANAGE-TEST' })).status === 400);
    check('to yourself -> 400', (await call('POST', '/api/delegations', manager, { role_id: fm, delegate_id: (await emp('nair')), expires_at: daysAhead(2), justification: 'MANAGE-TEST' })).status === 400);
    const sod = await call('POST', '/api/delegations', admin, { delegator_id: grace, role_id: pa, delegate_id: marcus, expires_at: daysAhead(2), justification: 'MANAGE-TEST sod' });
    check('delegation that would create an SoD conflict is refused', sod.status === 400 && /segregation-of-duties/.test(sod.data.error), sod.data);
    const left = await query(`SELECT COUNT(*) AS n FROM employee_roles WHERE employee_id = $1 AND role_id = $2`, [marcus, pa]);
    check('refused delegation left nothing behind', left.rows[0].n === 0);
    check('unrelated viewer cannot end someone else\'s delegation -> 400', (await call('POST', `/api/delegations/${d.data.grant_id}/revoke`, viewer)).status === 400);
    check('delegator ends it', (await call('POST', `/api/delegations/${d.data.grant_id}/revoke`, manager)).status === 200);
    check('ending twice -> 400', (await call('POST', `/api/delegations/${d.data.grant_id}/revoke`, manager)).status === 400);
    check('delegate lost the access', !(await call('GET', `/api/employees/${marcus}`, viewer)).data.effective_permissions.some((p) => p.action === 'export'));
    check('shows under status=revoked', (await call('GET', '/api/delegations?status=revoked', viewer)).data.some((x) => x.grant_id === d.data.grant_id));
    const d2 = await call('POST', '/api/delegations', manager, { role_id: fm, delegate_id: marcus, expires_at: daysAhead(2), justification: 'MANAGE-TEST admin ends' });
    check('admin can end anybody\'s delegation', (await call('POST', `/api/delegations/${d2.data.grant_id}/revoke`, admin)).status === 200);
    const audD = (await call('GET', `/api/audit-logs?target_type=employee_role&limit=50`, viewer)).data.items;
    check('delegation is audited with the delegator as actor', audD.some((x) => x.target_id === d.data.grant_id && x.change_type === 'insert' && x.actor_name === 'Priya Nair'));
  } catch (e) {
    failed++; console.log('  FAIL  unexpected error:', e);
  } finally {
    await cleanup();
    server.close(); await pool.end();
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
  }
})();