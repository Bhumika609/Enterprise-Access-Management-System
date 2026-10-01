// backend/src/routes/delegations.js
// Delegated access: lend one of YOUR OWN roles to a colleague for up to 30 days.
// Rules (justification, expiry, no re-delegation, preventive SoD check...) are
// enforced inside PostgreSQL by fn_delegate_role().
const router = require('express').Router();
const { query } = require('../db');
const { ah, toInt, whereBuilder } = require('../util');

// GET /api/delegations?status=active|revoked|expired|all&mine=true&delegator_id=&delegate_id=
router.get('/', ah(async (req, res) => {
  const { status, mine, delegator_id, delegate_id } = req.query;
  const w = whereBuilder();
  if (!status || status === 'active') w.addRaw(`status = 'active'`);
  else if (status !== 'all') w.add('status = ?', status);
  if (mine === 'true') {
    w.params.push(req.user.employee_id || -1);
    w.addRaw(`(delegator_id = $${w.params.length} OR delegate_id = $${w.params.length})`);
  }
  if (toInt(delegator_id) !== null) w.add('delegator_id = ?', toInt(delegator_id));
  if (toInt(delegate_id) !== null) w.add('delegate_id = ?', toInt(delegate_id));
  const { rows } = await query(`SELECT * FROM v_delegations ${w.where} ORDER BY granted_at DESC`, w.params);
  res.json(rows);
}));

// POST /api/delegations  { role_id, delegate_id, expires_at, justification, delegator_id? (admin only) }
router.post('/', ah(async (req, res) => {
  const b = req.body || {};
  let delegator = req.user.employee_id;
  if (req.user.role === 'admin' && toInt(b.delegator_id) !== null) delegator = toInt(b.delegator_id);
  if (!delegator) {
    return res.status(400).json({ error: 'This login is not linked to an employee, so it cannot delegate access' });
  }
  const { rows } = await query('SELECT fn_delegate_role($1, $2, $3, $4, $5) AS grant_id',
    [delegator, toInt(b.delegate_id), toInt(b.role_id), b.expires_at || null, b.justification || null]);
  const created = (await query('SELECT * FROM v_delegations WHERE grant_id = $1', [rows[0].grant_id])).rows[0];
  res.status(201).json(created);
}));

// POST /api/delegations/:grantId/revoke   (the delegator, the delegate, or an admin)
router.post('/:grantId/revoke', ah(async (req, res) => {
  const id = toInt(req.params.grantId);
  if (id === null) return res.status(400).json({ error: 'Invalid delegation id' });
  await query('SELECT fn_revoke_delegation($1, $2, $3)', [id, req.user.employee_id || null, req.user.role === 'admin']);
  res.json({ grant_id: id, status: 'revoked' });
}));

module.exports = router;