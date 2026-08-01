const { Router } = require('express');
const pool = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth, requireRole } = require('../middleware/auth');
const { getClientCargoHistory, getClientStats } = require('../services/clientHistory');

const router = Router();

router.use(requireAuth, requireRole('client'));

router.get(
  '/cargo',
  asyncHandler(async (req, res) => {
    res.json(await getClientCargoHistory(req.user.clientId));
  })
);

router.get(
  '/payments',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT id, payment_date, amount, currency, exchange_rate, amount_usd, cargo_id, comment
       FROM payments WHERE client_id = ? AND status = 1 ORDER BY payment_date DESC`,
      [req.user.clientId]
    );
    res.json(rows);
  })
);

router.get(
  '/stats',
  asyncHandler(async (req, res) => {
    res.json(await getClientStats(req.user.clientId));
  })
);

router.get(
  '/debt',
  asyncHandler(async (req, res) => {
    const stats = await getClientStats(req.user.clientId);
    res.json({ debtUsd: stats.remainingDebtUsd });
  })
);

module.exports = router;
