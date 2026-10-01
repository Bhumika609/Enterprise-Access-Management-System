const router = require('express').Router();
const { query } = require('../db');
const { ah } = require('../util');

// GET /api/dashboard - the whole landing page, computed by fn_dashboard_summary() in PostgreSQL
router.get('/', ah(async (req, res) => {
  const { rows } = await query('SELECT fn_dashboard_summary() AS summary');
  res.json(rows[0].summary);
}));

module.exports = router;