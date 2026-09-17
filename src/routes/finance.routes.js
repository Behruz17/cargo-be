const { Router } = require('express');
const pool = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = Router();

// раздел 13 ТЗ: прибыль = доход (final_cost грузов) − расход (amount_usd), нигде не хранится, всегда on-the-fly
router.get(
  '/shipments/:id/profit',
  requireAuth,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const [shipmentRows] = await pool.query(
      'SELECT id, shipment_number FROM shipments WHERE id = ? AND is_active = 1',
      [req.params.id]
    );
    if (!shipmentRows[0]) return res.status(404).json({ error: 'Рейс не найден', code: 'SHIPMENT_NOT_FOUND' });

    const [[revenueRow]] = await pool.query(
      'SELECT COALESCE(SUM(final_cost), 0) AS revenue_usd FROM cargo WHERE shipment_id = ? AND status = 1',
      [req.params.id]
    );
    const [[expenseRow]] = await pool.query(
      'SELECT COALESCE(SUM(amount_usd), 0) AS expenses_usd FROM expenses WHERE shipment_id = ? AND status = 1',
      [req.params.id]
    );

    const revenueUsd = Number(revenueRow.revenue_usd);
    const expensesUsd = Number(expenseRow.expenses_usd);

    res.json({
      shipmentId: shipmentRows[0].id,
      shipmentNumber: shipmentRows[0].shipment_number,
      revenueUsd,
      expensesUsd,
      profitUsd: Math.round((revenueUsd - expensesUsd) * 100) / 100,
    });
  })
);

router.get(
  '/profit',
  requireAuth,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const { from, to } = req.query;
    if (!from || !to) return res.status(400).json({ error: 'from и to обязательны (YYYY-MM-DD)', code: 'FROM_TO_REQUIRED' });

    const [[revenueRow]] = await pool.query(
      'SELECT COALESCE(SUM(final_cost), 0) AS revenue_usd FROM cargo WHERE status = 1 AND added_date BETWEEN ? AND ?',
      [from, to]
    );
    const [[expenseRow]] = await pool.query(
      'SELECT COALESCE(SUM(amount_usd), 0) AS expenses_usd FROM expenses WHERE status = 1 AND DATE(created_at) BETWEEN ? AND ?',
      [from, to]
    );

    const revenueUsd = Number(revenueRow.revenue_usd);
    const expensesUsd = Number(expenseRow.expenses_usd);

    res.json({
      from,
      to,
      revenueUsd,
      expensesUsd,
      profitUsd: Math.round((revenueUsd - expensesUsd) * 100) / 100,
    });
  })
);

module.exports = router;
