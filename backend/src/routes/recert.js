const router = require('express').Router();
const { query } = require('../db');
const { authorize } = require('../auth');
const { ah, toInt, whereBuilder } = require('../util');

// GET /api/recertification/campaigns
router.get('/campaigns', ah(async (req, res) => {
  const { rows } = await query('SELECT * FROM v_recertification_campaigns ORDER BY campaign_id DESC');
  res.json(rows);
}));

// POST /api/recertification/campaigns  { name, start_date, end_date }  (admin)
router.post('/campaigns', authorize('admin'), ah(async (req, res) => {
  const { name, start_date, end_date } = req.body || {};
  if (!name || !start_date || !end_date) {
    return res.status(400).json({ error: 'name, start_date and end_date are required' });
  }
  const { rows } = await query(
    'CALL sp_launch_recertification_campaign($1::varchar, $2::date, $3::date, NULL)',
    [name, start_date, end_date]
  );
  res.status(201).json({ campaign_id: rows[0].p_campaign_id });
}));

// POST /api/recertification/campaigns/:id/close  (admin) - only when nothing is pending
router.post('/campaigns/:id/close', authorize('admin'), ah(async (req, res) => {
  const id = toInt(req.params.id);
  if (id === null) return res.status(400).json({ error: 'Invalid campaign id' });
  await query('CALL sp_close_recertification_campaign($1)', [id]);
  res.json({ campaign_id: id, status: 'completed' });
}));

// GET /api/recertification/items?campaign_id=&decision=&mine=true
// Managers only ever see items assigned to them; admins/auditors see everything.
router.get('/items', ah(async (req, res) => {
  const { campaign_id, decision, reviewer_id } = req.query;
  const w = whereBuilder();
  if (toInt(campaign_id) !== null) w.add('campaign_id = ?', toInt(campaign_id));
  if (decision) w.add('decision = ?', decision);
  if (req.user.role === 'manager') w.add('reviewer_id = ?', req.user.employee_id || -1);
  else if (toInt(reviewer_id) !== null) w.add('reviewer_id = ?', toInt(reviewer_id));
  const { rows } = await query(
    `SELECT * FROM v_recertification_items ${w.where} ORDER BY (decision = 'pending') DESC, employee_name, role_name`,
    w.params
  );
  res.json(rows);
}));

// POST /api/recertification/items/:id/decision  { decision: 'keep' | 'revoke' }  (manager, admin)
router.post('/items/:id/decision', authorize('manager', 'admin'), ah(async (req, res) => {
  const id = toInt(req.params.id);
  const { decision } = req.body || {};
  if (id === null) return res.status(400).json({ error: 'Invalid item id' });
  if (!['keep', 'revoke'].includes(decision)) {
    return res.status(400).json({ error: "decision must be 'keep' or 'revoke'" });
  }
  const { rows } = await query('SELECT reviewer_id, decision FROM recertification_items WHERE item_id = $1', [id]);
  if (!rows[0]) return res.status(404).json({ error: 'Recertification item not found' });
  if (req.user.role === 'manager' && rows[0].reviewer_id !== req.user.employee_id) {
    return res.status(403).json({ error: 'This item is assigned to a different reviewer' });
  }
  if (rows[0].decision !== 'pending') {
    return res.status(409).json({ error: `This item was already decided: ${rows[0].decision}` });
  }
  await query('CALL sp_apply_recertification_decision($1, $2::varchar, $3)', [id, decision, req.user.employee_id]);
  res.json({ item_id: id, decision });
}));

module.exports = router;