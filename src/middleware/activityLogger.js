const pool = require('../config/db');

const ACTIONS = { POST: 'create', PUT: 'update', PATCH: 'update', DELETE: 'delete' };

// Wraps res.json/res.send so every successful mutation on a router is recorded
// into activity_logs without each route handler having to call this itself.
function activityLogger(entityType, { entityIdParam = 'id' } = {}) {
  return (req, res, next) => {
    const action = ACTIONS[req.method];
    if (!action) return next();

    // res.json() ultimately calls res.send() internally, so guard against
    // logging the same response twice regardless of which one the handler used.
    let recorded = false;
    const record = (payload) => {
      if (recorded || res.statusCode >= 400) return;
      recorded = true;
      const entityId = req.params[entityIdParam] || payload?.id || null;
      const userId = req.user?.id || null;
      pool
        .query(
          'INSERT INTO activity_logs (user_id, action, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?)',
          [userId, action, entityType, entityId, JSON.stringify(req.body || {})]
        )
        .catch((err) => console.error('activity log failed:', err));
    };

    const originalJson = res.json.bind(res);
    res.json = (body) => {
      record(body);
      return originalJson(body);
    };

    const originalSend = res.send.bind(res);
    res.send = (body) => {
      record(undefined);
      return originalSend(body);
    };

    next();
  };
}

module.exports = activityLogger;
