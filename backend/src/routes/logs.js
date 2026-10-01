const router = require('express').Router();
const { query } = require('../db');
const { ah, toInt, paging, whereBuilder } = require('../util');

// GET /api/access-logs?employee_id=&resource_id=&success=true|false&from=&to=&search=&limit=&offset=
router.get('/access-logs', ah(async (req, res) => {
  const { employee_id, resource_id, success, from, to, search } = req.query;
  const w = whereBuilder();
  if (toInt(employee_id) !== null) w.add('employee_id = ?', toInt(employee_id));
  if (toInt(resource_id) !== null) w.add('resource_id = ?', toInt(resource_id));
  if (success === 'true' || success === 'false') w.add('success = ?', success === 'true');
  if (from) w.add('occurred_at >= ?', from);
  if (to) w.add('occurred_at < ?', to);
  if (search) {
    w.params.push(`%${search}%`);
    const p = `$${w.params.length}`;
    w.addRaw(`(full_name ILIKE ${p} OR resource_name ILIKE ${p} OR ip_address ILIKE ${p} OR action ILIKE ${p})`);
  }
  const { limit, offset } = paging(req, 100, 500);
  const [items, total] = await Promise.all([
    query(`SELECT * FROM v_access_logs_detail ${w.where} ORDER BY occurred_at DESC LIMIT ${limit} OFFSET ${offset}`, w.params),
    query(`SELECT COUNT(*) AS n FROM v_access_logs_detail ${w.where}`, w.params),
  ]);
  res.json({ total: total.rows[0].n, items: items.rows });
}));

// GET /api/audit-logs?target_type=&actor_id=&change_type=&limit=&offset=
router.get('/audit-logs', ah(async (req, res) => {
  const { target_type, actor_id, change_type } = req.query;
  const w = whereBuilder();
  if (target_type) w.add('target_type = ?', target_type);
  if (toInt(actor_id) !== null) w.add('actor_id = ?', toInt(actor_id));
  if (change_type) w.add('change_type = ?', change_type);
  const { limit, offset } = paging(req, 100, 500);
  const [items, total] = await Promise.all([
    query(`SELECT * FROM v_audit_logs_detail ${w.where} ORDER BY audit_id DESC LIMIT ${limit} OFFSET ${offset}`, w.params),
    query(`SELECT COUNT(*) AS n FROM v_audit_logs_detail ${w.where}`, w.params),
  ]);
  res.json({ total: total.rows[0].n, items: items.rows });
}));

module.exports = router;