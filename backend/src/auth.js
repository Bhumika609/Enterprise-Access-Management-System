const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET || 'dev-only-secret-change-me';
if (!process.env.JWT_SECRET) {
  console.warn('[auth] JWT_SECRET is not set in .env - using an insecure development default.');
}

function signToken(user) {
  return jwt.sign(
    {
      user_id: user.user_id,
      employee_id: user.employee_id,
      username: user.username,
      role: user.system_role,
      full_name: user.full_name,
    },
    SECRET,
    { expiresIn: '8h' }
  );
}

function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Missing or malformed Authorization header' });
  }
  try {
    req.user = jwt.verify(token, SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// authorize('admin', 'manager') -> only those system roles may pass
const authorize = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({ error: `Requires one of: ${roles.join(', ')}` });
  }
  next();
};

module.exports = { signToken, authenticate, authorize };