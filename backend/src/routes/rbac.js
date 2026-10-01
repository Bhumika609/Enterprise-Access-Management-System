const router = require('express').Router();
const { query } = require('../db');
const { ah, toInt } = require('../util');

// GET /api/roles - Roles & Permissions page (list)
router.get('/roles', ah(async (req, res) => {
  const { rows } = await query(
    `SELECT n.role_id, n.role_name, n.description, n.level, n.parent_count,
            n.direct_permission_count, n.holders,
            (SELECT COALESCE(jsonb_agg(p.role_name ORDER BY p.role_name), '[]'::jsonb)
               FROM role_hierarchy rh JOIN roles p ON p.role_id = rh.parent_role_id
              WHERE rh.child_role_id = n.role_id) AS parents
       FROM v_role_hierarchy_nodes n
      ORDER BY n.role_name`
  );
  res.json(rows);
}));

// GET /api/roles/:id - one role: parents, children, direct + inherited permissions, holders
router.get('/roles/:id', ah(async (req, res) => {
  const id = toInt(req.params.id);
  if (id === null) return res.status(400).json({ error: 'Invalid role id' });
  const { rows } = await query('SELECT fn_role_detail($1) AS detail', [id]);
  if (!rows[0].detail.role) return res.status(404).json({ error: 'Role not found' });
  res.json(rows[0].detail);
}));

// GET /api/role-hierarchy - nodes + edges for the DAG graph
router.get('/role-hierarchy', ah(async (req, res) => {
  const [nodes, edges] = await Promise.all([
    query('SELECT * FROM v_role_hierarchy_nodes ORDER BY level, role_name'),
    query('SELECT child_role_id, parent_role_id FROM role_hierarchy'),
  ]);
  res.json({ nodes: nodes.rows, edges: edges.rows });
}));

// GET /api/permissions
router.get('/permissions', ah(async (req, res) => {
  const { rows } = await query(
    `SELECT p.permission_id, p.action, p.resource_type, p.risk_level, p.expected_frequency, p.description,
            (SELECT COUNT(*) FROM role_permissions rp WHERE rp.permission_id = p.permission_id) AS role_count
       FROM permissions p
      ORDER BY p.resource_type, p.action`
  );
  res.json(rows);
}));

// GET /api/sod-rules - the configurable rule set
router.get('/sod-rules', ah(async (req, res) => {
  const { rows } = await query(
    `SELECT r.rule_id, pa.action || ' ' || pa.resource_type AS permission_a,
            pb.action || ' ' || pb.resource_type AS permission_b,
            r.severity, r.description, r.is_active
       FROM sod_conflict_rules r
       JOIN permissions pa ON pa.permission_id = r.permission_a_id
       JOIN permissions pb ON pb.permission_id = r.permission_b_id
      ORDER BY r.rule_id`
  );
  res.json(rows);
}));

// GET /api/resources (used by the access-request form)
router.get('/resources', ah(async (req, res) => {
  const { rows } = await query(
    `SELECT r.resource_id, r.resource_name, r.resource_type, e.full_name AS owner_name
       FROM resources r LEFT JOIN employees e ON e.employee_id = r.owner_id
      ORDER BY r.resource_name`
  );
  res.json(rows);
}));

module.exports = router;