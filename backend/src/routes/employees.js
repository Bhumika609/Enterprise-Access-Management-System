const router = require('express').Router();
const { query } = require('../db');
const { ah, toInt, paging, whereBuilder } = require('../util');

const SORTS = {
  risk: 'risk_score DESC, full_name',
  name: 'full_name',
  department: 'department, full_name',
  findings: 'open_finding_count DESC, full_name',
};

// GET /api/employees?search=&department=&status=&min_risk=&sort=risk|name|department|findings&limit=&offset=
router.get('/', ah(async (req, res) => {
  const { search, department, status, min_risk, sort } = req.query;
  const w = whereBuilder();

  if (search) {
    // one parameter reused three times
    w.params.push(`%${search}%`);
    const p = `$${w.params.length}`;
    w.addRaw(`(full_name ILIKE ${p} OR email ILIKE ${p} OR COALESCE(active_roles, '') ILIKE ${p})`);
  }
  if (department) w.add('department = ?', department);
  if (status) w.add('status = ?', status);
  if (toInt(min_risk) !== null) w.add('risk_score >= ?', toInt(min_risk));

  const { limit, offset } = paging(req, 100, 500);
  const order = SORTS[sort] || SORTS.risk; // whitelisted, never user-supplied SQL

  const [items, total] = await Promise.all([
    query(`SELECT * FROM v_employee_directory ${w.where} ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}`, w.params),
    query(`SELECT COUNT(*) AS n FROM v_employee_directory ${w.where}`, w.params),
  ]);
  res.json({ total: total.rows[0].n, items: items.rows });
}));

// GET /api/employees/meta/departments
router.get('/meta/departments', ah(async (req, res) => {
  const { rows } = await query('SELECT DISTINCT department FROM employees ORDER BY department');
  res.json(rows.map((r) => r.department));
}));

// GET /api/employees/:id - full drill-down profile from fn_employee_profile()
router.get('/:id', ah(async (req, res) => {
  const id = toInt(req.params.id);
  if (id === null) return res.status(400).json({ error: 'Invalid employee id' });
  const { rows } = await query('SELECT fn_employee_profile($1) AS profile', [id]);
  const profile = rows[0].profile;
  if (!profile.employee) return res.status(404).json({ error: 'Employee not found' });
  res.json(profile);
}));

module.exports = router;