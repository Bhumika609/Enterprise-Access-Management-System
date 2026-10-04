// backend/src/routes/reports.js
// Downloadable reports. Every report is a PostgreSQL view (reports.sql); this
// file only serialises the rows as JSON or CSV.
const router = require('express').Router();
const { query } = require('../db');
const { authorize } = require('../auth');
const { ah } = require('../util');

// whitelist: URL name -> [view, human title]. Never user-supplied SQL.
const REPORTS = {
  'risk-scores':      ['v_report_risk_scored_employees', 'Risk-scored employees'],
  'sod-conflicts':    ['v_report_sod_conflicts', 'Segregation-of-duties conflicts'],
  'unused-permissions': ['v_report_unused_permissions', 'Unused permissions'],
  'campaign-status':  ['v_report_campaign_status', 'Certification campaign status'],
  'break-glass':      ['v_report_break_glass', 'Break-glass access'],
};

const csvCell = (v) => {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCsv = (rows) => {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  return [cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\r\n') + '\r\n';
};

// GET /api/reports  -> catalogue
router.get('/', authorize('admin', 'auditor', 'manager'), (req, res) => {
  res.json(Object.entries(REPORTS).map(([key, [, title]]) => ({ key, title })));
});

// GET /api/reports/:name?format=json|csv
router.get('/:name', authorize('admin', 'auditor', 'manager'), ah(async (req, res) => {
  const def = REPORTS[req.params.name];
  if (!def) return res.status(404).json({ error: 'Unknown report' });
  const { rows } = await query(`SELECT * FROM ${def[0]}`);
  if (req.query.format === 'csv') {
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="eapis-${req.params.name}.csv"`);
    return res.send(toCsv(rows));
  }
  res.json({ key: req.params.name, title: def[1], count: rows.length, rows });
}));

module.exports = router;
