const jwt = require('jsonwebtoken');
const { jwt: jwtConfig } = require('../config/env');

function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
  }

  const token = header.slice('Bearer '.length);
  try {
    req.user = jwt.verify(token, jwtConfig.secret);
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired token', code: 'INVALID_TOKEN' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN' });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };
