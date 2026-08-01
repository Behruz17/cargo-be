const { Router } = require('express');
const pool = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth, requireRole } = require('../middleware/auth');
const { getDebtReport } = require('../services/reports');

const router = Router();

// раздел 18 ТЗ: главная панель администратора
router.get(
  '/',
  requireAuth,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const [[clientCount]] = await pool.query('SELECT COUNT(*) AS count FROM clients WHERE status = 1');

    const [[shipmentAgg]] = await pool.query(
      `SELECT COUNT(*) AS active_shipments,
              COALESCE(SUM(total_weight_kg), 0) AS total_weight_kg,
              COALESCE(SUM(total_volume_m3), 0) AS total_volume_m3
       FROM shipments WHERE is_active = 1 AND status != 'closed'`
    );

    const [[distributedAgg]] = await pool.query(
      `SELECT COALESCE(SUM(c.weight_kg), 0) AS distributed_weight_kg,
              COALESCE(SUM(c.volume_m3), 0) AS distributed_volume_m3
       FROM cargo c
       JOIN shipments s ON s.id = c.shipment_id
       WHERE c.status = 1 AND s.is_active = 1 AND s.status != 'closed'`
    );

    const [[revenueAgg]] = await pool.query(
      "SELECT COALESCE(SUM(final_cost), 0) AS revenue_usd FROM cargo WHERE status = 1"
    );
    const [[expenseAgg]] = await pool.query(
      "SELECT COALESCE(SUM(amount_usd), 0) AS expenses_usd FROM expenses WHERE status = 1"
    );

    // reuse the debt report so the dashboard number always matches раздел 17's debt report
    const debtRows = await getDebtReport();
    const totalDebtUsd = Math.round(debtRows.reduce((sum, r) => sum + Number(r.debt_usd), 0) * 100) / 100;

    const revenueUsd = Number(revenueAgg.revenue_usd);
    const expensesUsd = Number(expenseAgg.expenses_usd);
    const totalWeightKg = Number(shipmentAgg.total_weight_kg);
    const totalVolumeM3 = Number(shipmentAgg.total_volume_m3);
    const distributedWeightKg = Number(distributedAgg.distributed_weight_kg);
    const distributedVolumeM3 = Number(distributedAgg.distributed_volume_m3);

    res.json({
      clientCount: clientCount.count,
      activeShipments: shipmentAgg.active_shipments,
      totalWeightKg,
      totalVolumeM3,
      freeWeightKg: Math.round((totalWeightKg - distributedWeightKg) * 1000) / 1000,
      freeVolumeM3: Math.round((totalVolumeM3 - distributedVolumeM3) * 1000) / 1000,
      totalDebtUsd,
      revenueUsd: Math.round(revenueUsd * 100) / 100,
      expensesUsd: Math.round(expensesUsd * 100) / 100,
      profitUsd: Math.round((revenueUsd - expensesUsd) * 100) / 100,
    });
  })
);

module.exports = router;
