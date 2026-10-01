const express = require('express');
const cors = require('cors');
const { query } = require('./db');
const { authenticate } = require('./auth');

function buildApp() {
  const app = express();

  const origins = (process.env.FRONTEND_ORIGIN || 'http://localhost:5173').split(',').map((s) => s.trim());
  app.use(cors({ origin: origins }));
  app.use(express.json());

  // Public endpoints
  app.get('/api/health', async (req, res) => {
    try {
      await query('SELECT 1');
      res.json({ status: 'ok', database: 'connected' });
    } catch (e) {
      res.status(503).json({ status: 'error', database: 'unreachable' });
    }
  });
  app.use('/api/auth', require('./routes/auth'));

  // Everything below requires a valid login token
  const api = express.Router();
  api.use(authenticate);
  api.use('/dashboard', require('./routes/dashboard'));
  api.use('/employees', require('./routes/employees'));
  api.use('/access-requests', require('./routes/requests'));
  api.use('/recertification', require('./routes/recert'));
  api.use('/admin', require('./routes/admin'));
  api.use('/manage', require('./routes/manage'));
  api.use('/delegations', require('./routes/delegations'));
  api.use('/', require('./routes/rbac'));
  api.use('/', require('./routes/findings'));
  api.use('/', require('./routes/logs'));
  app.use('/api', api);

  app.use((req, res) => res.status(404).json({ error: 'Not found' }));

  // Central error handler
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body' });
    // P0001 = a RAISE EXCEPTION written on purpose inside our PL/pgSQL (business-rule violation)
    if (err.code === 'P0001') return res.status(400).json({ error: err.message });
    // 23xxx = constraint violations (FK / CHECK / UNIQUE / NOT NULL)
    if (err.code && err.code.startsWith('23')) {
      return res.status(409).json({ error: err.detail || err.message });
    }
    // 22xxx = bad input value (wrong type / format)
    if (err.code && err.code.startsWith('22')) return res.status(400).json({ error: 'Invalid input value' });
    console.error('[error]', err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

module.exports = { buildApp };