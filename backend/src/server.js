require('dotenv').config();
const bcrypt = require('bcryptjs');
const { pool, query } = require('./db');
const { buildApp } = require('./app');

const PORT = parseInt(process.env.PORT || '4000', 10);

// The seed script stores placeholder hashes. On first start, replace them with a real
// bcrypt hash of DEMO_PASSWORD so the demo accounts can log in.
async function bootstrapDemoPasswords() {
  const { rows } = await query(`SELECT 1 FROM app_users WHERE password_hash LIKE 'PLACEHOLDER_HASH%' LIMIT 1`);
  if (!rows.length) return;
  const hash = await bcrypt.hash(process.env.DEMO_PASSWORD || 'Password@123', 10);
  const r = await query(`UPDATE app_users SET password_hash = $1 WHERE password_hash LIKE 'PLACEHOLDER_HASH%'`, [hash]);
  console.log(`[setup] Set the demo password on ${r.rowCount} dashboard account(s).`);
}

// Fallback scheduler for machines without pg_cron. Both procedures are idempotent,
// so running these alongside pg_cron is harmless.
function startScheduler() {
  const run = async (label, sql) => {
    try { await query(sql); console.log(`[scheduler] ${label} ok`); }
    catch (e) { console.error(`[scheduler] ${label} failed:`, e.message); }
  };
  const t1 = setInterval(() => run('expire grants', 'CALL sp_expire_stale_grants()'), 15 * 60 * 1000);
  const t2 = setInterval(() => run('detectors', 'CALL sp_run_all_detectors()'), 6 * 60 * 60 * 1000);
  t1.unref(); t2.unref();
  console.log('[scheduler] enabled: expiry every 15 min, detectors every 6 h');
}

async function main() {
  try {
    await query('SELECT 1');
  } catch (e) {
    console.error('\nCould not connect to PostgreSQL:', e.message);
    console.error('Check DB_HOST / DB_PORT / DB_NAME / DB_USER / DB_PASSWORD in backend/.env\n');
    process.exit(1);
  }
  try {
    await bootstrapDemoPasswords();
  } catch (e) {
    console.error('\nThe database is reachable but the EAPIS tables were not found:', e.message);
    console.error('Run the six SQL files (schema.sql ... api_views.sql) in this database first.\n');
    process.exit(1);
  }

  const server = buildApp().listen(PORT, () => {
    console.log(`EAPIS API listening on http://localhost:${PORT}  (health: /api/health)`);
  });
  if (process.env.ENABLE_SCHEDULER !== 'false') startScheduler();

  const shutdown = () => server.close(() => pool.end().then(() => process.exit(0)));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();