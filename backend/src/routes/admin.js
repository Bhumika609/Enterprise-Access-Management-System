const router = require('express').Router();
const { query } = require('../db');
const { authorize } = require('../auth');
const { ah } = require('../util');

// POST /api/admin/run-detectors  (admin) - runs every detector now
router.post('/run-detectors', authorize('admin'), ah(async (req, res) => {
  const before = await query(`SELECT COUNT(*) AS n FROM findings`);
  await query('CALL sp_run_all_detectors()');
  const after = await query(`SELECT COUNT(*) AS n FROM findings`);
  res.json({ new_findings: after.rows[0].n - before.rows[0].n, total_findings: after.rows[0].n });
}));

// POST /api/admin/expire-grants  (admin) - expire overdue temporary / break-glass access now
router.post('/expire-grants', authorize('admin'), ah(async (req, res) => {
  const due = await query(
    `SELECT COUNT(*) AS n FROM employee_roles WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at <= now()`
  );
  await query('CALL sp_expire_stale_grants()');
  res.json({ expired: due.rows[0].n });
}));

module.exports = router;