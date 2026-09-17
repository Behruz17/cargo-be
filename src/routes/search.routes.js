const { Router } = require('express');
const pool = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = Router();

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// раздел 16 ТЗ: код/ФИО/телефон получателя, номер рейса/машины/склад, дата
router.get(
  '/',
  requireAuth,
  requireRole('admin', 'manager'),
  asyncHandler(async (req, res) => {
    const q = (req.query.q || '').trim();
    if (!q) return res.status(400).json({ error: 'q обязателен', code: 'SEARCH_QUERY_REQUIRED' });

    const like = `%${q}%`;

    const [clients] = await pool.query(
      `SELECT id, code, full_name, phone FROM clients
       WHERE status = 1 AND (code LIKE ? OR full_name LIKE ? OR phone LIKE ?)
       LIMIT 20`,
      [like, like, like]
    );

    const shipmentBase = `
      SELECT s.id, s.shipment_number, s.vehicle_number, s.status, w.name AS warehouse_name,
             s.load_date, s.departure_date, s.arrival_date
      FROM shipments s
      JOIN warehouses w ON w.id = s.warehouse_id
    `;

    const [shipments] = DATE_PATTERN.test(q)
      ? await pool.query(
          `${shipmentBase} WHERE s.is_active = 1 AND (s.load_date = ? OR s.departure_date = ? OR s.arrival_date = ?)
           LIMIT 20`,
          [q, q, q]
        )
      : await pool.query(
          `${shipmentBase} WHERE s.is_active = 1 AND (s.shipment_number LIKE ? OR s.vehicle_number LIKE ? OR w.name LIKE ?)
           LIMIT 20`,
          [like, like, like]
        );

    res.json({ clients, shipments });
  })
);

module.exports = router;
