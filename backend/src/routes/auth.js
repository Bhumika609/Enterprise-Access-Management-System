const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { query } = require('../db');
const { signToken, authenticate } = require('../auth');
const { ah } = require('../util');

// POST /api/auth/login  { username, password }
router.post('/login', ah(async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password are required' });
  }
  const { rows } = await query(
    `SELECT u.user_id, u.employee_id, u.username, u.password_hash, u.system_role, e.full_name
       FROM app_users u
       LEFT JOIN employees e ON e.employee_id = u.employee_id
      WHERE u.username = $1 AND u.is_active`,
    [username]
  );
  const user = rows[0];
  // Same message for unknown user and wrong password (no user enumeration)
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  await query('UPDATE app_users SET last_login_at = now() WHERE user_id = $1', [user.user_id]);
  res.json({
    token: signToken(user),
    user: {
      user_id: user.user_id,
      employee_id: user.employee_id,
      username: user.username,
      role: user.system_role,
      full_name: user.full_name,
    },
  });
}));

// GET /api/auth/me
router.get('/me', authenticate, (req, res) => res.json({ user: req.user }));

module.exports = router;