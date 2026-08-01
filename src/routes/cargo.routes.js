const { Router } = require('express');
const pool = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth, requireRole } = require('../middleware/auth');
const { parsePagination, parseSort, buildListResponse } = require('../utils/queryOptions');
const { withTransaction } = require('../utils/transaction');
const activityLogger = require('../middleware/activityLogger');

const router = Router();
router.use(activityLogger('cargo'));

const WEIGHT_THRESHOLD_KG = 200;
const SORT_MAP = {
  id: 'c.id',
  added_date: 'c.added_date',
  weight_kg: 'c.weight_kg',
  volume_m3: 'c.volume_m3',
  places: 'c.places',
  final_cost: 'c.final_cost',
};

// раздел 8 ТЗ: вес >= 200кг — тариф по кг, иначе — по объёму
function calculateCargoCost(weightKg, volumeM3, rate) {
  const calculation_type = weightKg >= WEIGHT_THRESHOLD_KG ? 'by_weight' : 'by_volume';
  const basis = calculation_type === 'by_weight' ? weightKg : volumeM3;
  const calculated_cost = Math.round(basis * rate * 100) / 100;
  return { calculation_type, calculated_cost };
}

const SELECT_WITH_JOIN = `
  SELECT
    c.*,
    cl.code AS client_code,
    cl.full_name AS client_full_name,
    s.shipment_number
  FROM cargo c
  JOIN clients cl ON cl.id = c.client_id
  JOIN shipments s ON s.id = c.shipment_id
`;

const SELECT_LIST = SELECT_WITH_JOIN.replace('c.*,', 'c.*, COUNT(*) OVER() AS total_count,');

router.get(
  '/',
  requireAuth,
  requireRole('admin', 'manager'),
  asyncHandler(async (req, res) => {
    const { shipment_id, client_id } = req.query;
    const { limit, offset, page, pageSize } = parsePagination(req.query);
    const sort = parseSort(req.query, SORT_MAP, 'id', 'desc');
    const conditions = ['c.status = 1'];
    const params = [];

    if (shipment_id) {
      conditions.push('c.shipment_id = ?');
      params.push(shipment_id);
    }
    if (client_id) {
      conditions.push('c.client_id = ?');
      params.push(client_id);
    }

    const sql = `${SELECT_LIST} WHERE ${conditions.join(' AND ')} ORDER BY ${sort} LIMIT ? OFFSET ?`;
    const [rows] = await pool.query(sql, [...params, limit, offset]);
    res.json(buildListResponse(rows, { page, pageSize }));
  })
);

router.get(
  '/:id',
  requireAuth,
  requireRole('admin', 'manager'),
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(`${SELECT_WITH_JOIN} WHERE c.id = ? AND c.status = 1`, [
      req.params.id,
    ]);
    if (!rows[0]) return res.status(404).json({ error: 'Груз не найден' });
    res.json(rows[0]);
  })
);

router.post(
  '/',
  requireAuth,
  requireRole('admin', 'manager'),
  asyncHandler(async (req, res) => {
    const { shipment_id, client_id, added_date, description, weight_kg, volume_m3, places, rate, comment } =
      req.body;

    if (!shipment_id || !client_id || weight_kg == null || volume_m3 == null || places == null || rate == null) {
      return res
        .status(400)
        .json({ error: 'shipment_id, client_id, weight_kg, volume_m3, places и rate обязательны' });
    }
    if (weight_kg <= 0 || volume_m3 <= 0 || rate <= 0 || !Number.isInteger(Number(places)) || places <= 0) {
      return res
        .status(400)
        .json({ error: 'weight_kg, volume_m3 и rate должны быть положительными, places — целое положительное' });
    }

    const { calculation_type, calculated_cost } = calculateCargoCost(
      Number(weight_kg),
      Number(volume_m3),
      Number(rate)
    );

    try {
      const row = await withTransaction(async (conn) => {
        const [result] = await conn.query(
          `INSERT INTO cargo
             (shipment_id, client_id, added_date, description, weight_kg, volume_m3, places,
              calculation_type, rate, calculated_cost, final_cost, comment)
           VALUES (?, ?, COALESCE(?, CURDATE()), ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            shipment_id,
            client_id,
            added_date ?? null,
            description ?? null,
            weight_kg,
            volume_m3,
            places,
            calculation_type,
            rate,
            calculated_cost,
            calculated_cost,
            comment ?? null,
          ]
        );
        const [rows] = await conn.query(`${SELECT_WITH_JOIN} WHERE c.id = ?`, [result.insertId]);
        return rows[0];
      });
      res.status(201).json(row);
    } catch (err) {
      if (err.code === 'ER_NO_REFERENCED_ROW_2') {
        return res.status(400).json({ error: 'Рейс или получатель не найден' });
      }
      throw err;
    }
  })
);

// Только admin: изменение существующего груза, включая ручную корректировку final_cost (раздел 8 ТЗ)
router.put(
  '/:id',
  requireAuth,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const { client_id, added_date, description, weight_kg, volume_m3, places, rate, final_cost, comment } =
      req.body;

    if (!client_id || weight_kg == null || volume_m3 == null || places == null || rate == null) {
      return res.status(400).json({ error: 'client_id, weight_kg, volume_m3, places и rate обязательны' });
    }
    if (weight_kg <= 0 || volume_m3 <= 0 || rate <= 0 || !Number.isInteger(Number(places)) || places <= 0) {
      return res
        .status(400)
        .json({ error: 'weight_kg, volume_m3 и rate должны быть положительными, places — целое положительное' });
    }

    const { calculation_type, calculated_cost } = calculateCargoCost(
      Number(weight_kg),
      Number(volume_m3),
      Number(rate)
    );
    const isAdjusted = final_cost != null && Number(final_cost) !== calculated_cost;
    const resolvedFinalCost = isAdjusted ? Number(final_cost) : calculated_cost;

    try {
      const row = await withTransaction(async (conn) => {
        const [result] = await conn.query(
          `UPDATE cargo SET
             client_id = ?, added_date = COALESCE(?, added_date), description = ?,
             weight_kg = ?, volume_m3 = ?, places = ?, calculation_type = ?, rate = ?,
             calculated_cost = ?, final_cost = ?, is_cost_adjusted = ?, comment = ?
           WHERE id = ? AND status = 1`,
          [
            client_id,
            added_date ?? null,
            description ?? null,
            weight_kg,
            volume_m3,
            places,
            calculation_type,
            rate,
            calculated_cost,
            resolvedFinalCost,
            isAdjusted ? 1 : 0,
            comment ?? null,
            req.params.id,
          ]
        );
        if (result.affectedRows === 0) return null;
        const [rows] = await conn.query(`${SELECT_WITH_JOIN} WHERE c.id = ?`, [req.params.id]);
        return rows[0];
      });
      if (!row) return res.status(404).json({ error: 'Груз не найден' });
      res.json(row);
    } catch (err) {
      if (err.code === 'ER_NO_REFERENCED_ROW_2') {
        return res.status(400).json({ error: 'Получатель не найден' });
      }
      throw err;
    }
  })
);

router.delete(
  '/:id',
  requireAuth,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const [result] = await pool.query('UPDATE cargo SET status = 0 WHERE id = ? AND status = 1', [
      req.params.id,
    ]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Груз не найден' });
    res.status(204).send();
  })
);

module.exports = router;
