const router = require('express').Router();
const { query } = require('../db');
const { authorize } = require('../auth');
const { ah, toInt, paging, whereBuilder } = require('../util');

const FINDING_TYPES = ['sod_violation', 'privilege_escalation', 'unused_access', 'anomalous_access'];
const SEVERITIES = ['critical', 'high', 'medium', 'low'];
const STATUSES = ['open', 'under_review', 'resolved', 'false_positive'];

// "active" (default) = open + under_review; "all" = everything; or an exact status
function statusClause(w, status) {
  if (!status || status === 'active') w.addRaw(`status IN ('open', 'under_review')`);
  else if (status !== 'all') w.add('status = ?', status);
}

// GET /api/findings?type=&severity=&status=active|all|<status>&employee_id=&search=&limit=&offset=
router.get('/findings', ah(async (req, res) => {
  const { type, severity, status, employee_id, search } = req.query;
  const w = whereBuilder();
  if (type) w.add('finding_type = ?', type);
  if (severity) w.add('severity = ?', severity);
  statusClause(w, status);
  if (toInt(employee_id) !== null) w.add('employee_id = ?', toInt(employee_id));
  if (search) {
    w.params.push(`%${search}%`);
    const p = `$${w.params.length}`;
    w.addRaw(`(full_name ILIKE ${p} OR title ILIKE ${p})`);
  }
  const { limit, offset } = paging(req, 100, 500);
  const [items, total] = await Promise.all([
    query(`SELECT * FROM v_findings_detail ${w.where} ORDER BY severity_rank, detected_at DESC LIMIT ${limit} OFFSET ${offset}`, w.params),
    query(`SELECT COUNT(*) AS n FROM v_findings_detail ${w.where}`, w.params),
  ]);
  res.json({ total: total.rows[0].n, items: items.rows });
}));

// GET /api/findings/:id
router.get('/findings/:id', ah(async (req, res) => {
  const id = toInt(req.params.id);
  if (id === null) return res.status(400).json({ error: 'Invalid finding id' });
  const { rows } = await query('SELECT * FROM v_findings_detail WHERE finding_id = $1', [id]);
  if (!rows[0]) return res.status(404).json({ error: 'Finding not found' });
  res.json(rows[0]);
}));

// PATCH /api/findings/:id  { status, notes }  (review & resolve workflow)
router.patch('/findings/:id', authorize('admin', 'auditor', 'manager'), ah(async (req, res) => {
  const id = toInt(req.params.id);
  const { status, notes } = req.body || {};
  if (id === null) return res.status(400).json({ error: 'Invalid finding id' });
  if (!STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${STATUSES.join(', ')}` });
  }
  await query('SELECT fn_update_finding_status($1, $2, $3, $4)', [id, status, req.user.employee_id || null, notes || null]);
  const { rows } = await query('SELECT * FROM v_findings_detail WHERE finding_id = $1', [id]);
  res.json(rows[0]);
}));

// GET /api/sod-violations?status=active|all|<status>
router.get('/sod-violations', ah(async (req, res) => {
  const w = whereBuilder();
  statusClause(w, req.query.status);
  const { rows } = await query(`SELECT * FROM v_sod_violations ${w.where} ORDER BY severity_rank, full_name`, w.params);
  res.json(rows);
}));

// GET /api/unused-access?status=active|all|<status>&employee_id=
router.get('/unused-access', ah(async (req, res) => {
  const w = whereBuilder();
  statusClause(w, req.query.status);
  if (toInt(req.query.employee_id) !== null) w.add('employee_id = ?', toInt(req.query.employee_id));
  const { rows } = await query(`SELECT * FROM v_unused_access ${w.where} ORDER BY severity_rank, full_name, role_name`, w.params);
  res.json(rows);
}));

router.get('/findings-meta', (req, res) => res.json({ types: FINDING_TYPES, severities: SEVERITIES, statuses: STATUSES }));

module.exports = router;