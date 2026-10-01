// backend/src/routes/manage.js
// Admin-only management of roles, permissions, role<->permission links, the role
// hierarchy and the SoD rules. All rules/validation live in PostgreSQL functions
// (see admin_management.sql); this file only forwards the request.
const router = require('express').Router();
const { query } = require('../db');
const { authorize } = require('../auth');
const { ah, toInt } = require('../util');

router.use(authorize('admin'));

const actor = (req) => req.user.employee_id || null;
const bad = (res, msg) => res.status(400).json({ error: msg });
const roleRow = async (id) =>
  (await query('SELECT * FROM v_role_hierarchy_nodes WHERE role_id = $1', [id])).rows[0];
const permRow = async (id) => (await query('SELECT * FROM permissions WHERE permission_id = $1', [id])).rows[0];
const ruleRow = async (id) => (await query('SELECT * FROM v_sod_rules_detail WHERE rule_id = $1', [id])).rows[0];

// ---------------------------------------------------------------- roles
// POST /api/manage/roles  { role_name, description? }
router.post('/roles', ah(async (req, res) => {
  const b = req.body || {};
  const { rows } = await query('SELECT fn_create_role($1, $2, $3) AS id', [b.role_name, b.description || null, actor(req)]);
  res.status(201).json(await roleRow(rows[0].id));
}));

// PATCH /api/manage/roles/:id  { role_name?, description? }
router.patch('/roles/:id', ah(async (req, res) => {
  const id = toInt(req.params.id);
  if (id === null) return bad(res, 'Invalid role id');
  const b = req.body || {};
  await query('SELECT fn_update_role($1, $2, $3, $4)', [id, b.role_name ?? null, b.description ?? null, actor(req)]);
  res.json(await roleRow(id));
}));

// DELETE /api/manage/roles/:id  (refused if the role was ever granted or requested)
router.delete('/roles/:id', ah(async (req, res) => {
  const id = toInt(req.params.id);
  if (id === null) return bad(res, 'Invalid role id');
  await query('SELECT fn_delete_role($1, $2)', [id, actor(req)]);
  res.json({ deleted: true, role_id: id });
}));

// POST /api/manage/roles/:id/permissions  { permission_id }
router.post('/roles/:id/permissions', ah(async (req, res) => {
  const id = toInt(req.params.id), pid = toInt((req.body || {}).permission_id);
  if (id === null || pid === null) return bad(res, 'role id and permission_id are required');
  await query('SELECT fn_grant_permission_to_role($1, $2, $3)', [id, pid, actor(req)]);
  res.status(201).json({ role_id: id, permission_id: pid });
}));

// DELETE /api/manage/roles/:id/permissions/:permissionId
router.delete('/roles/:id/permissions/:permissionId', ah(async (req, res) => {
  const id = toInt(req.params.id), pid = toInt(req.params.permissionId);
  if (id === null || pid === null) return bad(res, 'Invalid id');
  await query('SELECT fn_revoke_permission_from_role($1, $2, $3)', [id, pid, actor(req)]);
  res.json({ deleted: true, role_id: id, permission_id: pid });
}));

// POST /api/manage/roles/:id/parents  { parent_role_id }   (id inherits FROM parent_role_id)
router.post('/roles/:id/parents', ah(async (req, res) => {
  const id = toInt(req.params.id), parent = toInt((req.body || {}).parent_role_id);
  if (id === null || parent === null) return bad(res, 'role id and parent_role_id are required');
  await query('SELECT fn_add_role_parent($1, $2, $3)', [id, parent, actor(req)]);
  res.status(201).json({ child_role_id: id, parent_role_id: parent });
}));

// DELETE /api/manage/roles/:id/parents/:parentId
router.delete('/roles/:id/parents/:parentId', ah(async (req, res) => {
  const id = toInt(req.params.id), parent = toInt(req.params.parentId);
  if (id === null || parent === null) return bad(res, 'Invalid id');
  await query('SELECT fn_remove_role_parent($1, $2, $3)', [id, parent, actor(req)]);
  res.json({ deleted: true, child_role_id: id, parent_role_id: parent });
}));

// ---------------------------------------------------------------- permissions
// POST /api/manage/permissions  { action, resource_type, risk_level, expected_frequency?, description? }
router.post('/permissions', ah(async (req, res) => {
  const b = req.body || {};
  const { rows } = await query('SELECT fn_create_permission($1, $2, $3, $4, $5, $6) AS id',
    [b.action, b.resource_type, b.risk_level, b.expected_frequency || null, b.description || null, actor(req)]);
  res.status(201).json(await permRow(rows[0].id));
}));

// PATCH /api/manage/permissions/:id  { risk_level?, expected_frequency?, description? }
router.patch('/permissions/:id', ah(async (req, res) => {
  const id = toInt(req.params.id);
  if (id === null) return bad(res, 'Invalid permission id');
  const b = req.body || {};
  await query('SELECT fn_update_permission($1, $2, $3, $4, $5)',
    [id, b.risk_level ?? null, b.expected_frequency ?? null, b.description ?? null, actor(req)]);
  res.json(await permRow(id));
}));

// DELETE /api/manage/permissions/:id  (refused while any role or SoD rule still uses it)
router.delete('/permissions/:id', ah(async (req, res) => {
  const id = toInt(req.params.id);
  if (id === null) return bad(res, 'Invalid permission id');
  await query('SELECT fn_delete_permission($1, $2)', [id, actor(req)]);
  res.json({ deleted: true, permission_id: id });
}));

// ---------------------------------------------------------------- SoD rules
// GET /api/manage/sod-rules   (includes permission ids, for editing)
router.get('/sod-rules', ah(async (req, res) => {
  res.json((await query('SELECT * FROM v_sod_rules_detail ORDER BY rule_id')).rows);
}));

// POST /api/manage/sod-rules  { permission_a_id, permission_b_id, severity, description? }
router.post('/sod-rules', ah(async (req, res) => {
  const b = req.body || {};
  const { rows } = await query('SELECT fn_create_sod_rule($1, $2, $3, $4, $5) AS id',
    [toInt(b.permission_a_id), toInt(b.permission_b_id), b.severity, b.description || null, actor(req)]);
  res.status(201).json(await ruleRow(rows[0].id));
}));

// PATCH /api/manage/sod-rules/:id  { severity?, description?, is_active? }
router.patch('/sod-rules/:id', ah(async (req, res) => {
  const id = toInt(req.params.id);
  if (id === null) return bad(res, 'Invalid rule id');
  const b = req.body || {};
  const active = typeof b.is_active === 'boolean' ? b.is_active : null;
  await query('SELECT fn_update_sod_rule($1, $2, $3, $4, $5)', [id, b.severity ?? null, b.description ?? null, active, actor(req)]);
  res.json(await ruleRow(id));
}));

// DELETE /api/manage/sod-rules/:id
router.delete('/sod-rules/:id', ah(async (req, res) => {
  const id = toInt(req.params.id);
  if (id === null) return bad(res, 'Invalid rule id');
  await query('SELECT fn_delete_sod_rule($1, $2)', [id, actor(req)]);
  res.json({ deleted: true, rule_id: id });
}));

module.exports = router;