const router = require('express').Router();
const { query } = require('../db');
const { authorize } = require('../auth');
const { ah, toInt } = require('../util');

// GET /api/access-requests?status=pending|approved|rejected
router.get('/', ah(async (req, res) => {
  const { status } = req.query;
  const params = [];
  let where = '';
  if (status) { params.push(status); where = 'WHERE status = $1'; }
  const { rows } = await query(
    `SELECT * FROM v_access_requests_detail ${where}
      ORDER BY (status = 'pending') DESC, is_break_glass DESC, requested_at DESC`,
    params
  );
  res.json(rows);
}));

// POST /api/access-requests
// body: { role_id?, resource_id?, is_temporary?, is_break_glass?, justification?, expires_at? , requester_id? (admin only) }
router.post('/', ah(async (req, res) => {
  const b = req.body || {};
  let requesterId = req.user.employee_id;
  if (req.user.role === 'admin' && toInt(b.requester_id) !== null) requesterId = toInt(b.requester_id);
  if (!requesterId) {
    return res.status(400).json({ error: 'This login is not linked to an employee, so it cannot raise access requests' });
  }
  const { rows } = await query(
    'SELECT fn_create_access_request($1, $2, $3, $4, $5, $6, $7) AS request_id',
    [requesterId, toInt(b.role_id), toInt(b.resource_id), !!b.is_temporary, !!b.is_break_glass,
     b.justification || null, b.expires_at || null]
  );
  res.status(201).json({ request_id: rows[0].request_id });
}));

async function review(req, res, decision) {
  const id = toInt(req.params.id);
  if (id === null) return res.status(400).json({ error: 'Invalid request id' });
  if (!req.user.employee_id) {
    return res.status(400).json({ error: 'This login is not linked to an employee, so it cannot review requests' });
  }
  const { rows } = await query('SELECT fn_review_access_request($1, $2, $3) AS grant_id',
    [id, decision, req.user.employee_id]);
  res.json({ request_id: id, status: decision, grant_id: rows[0].grant_id });
}

// POST /api/access-requests/:id/approve  (manager, admin)
router.post('/:id/approve', authorize('manager', 'admin'), ah((req, res) => review(req, res, 'approved')));
// POST /api/access-requests/:id/reject   (manager, admin)
router.post('/:id/reject', authorize('manager', 'admin'), ah((req, res) => review(req, res, 'rejected')));

module.exports = router;