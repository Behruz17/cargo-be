const { Router } = require('express');
const pool = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth, requireRole } = require('../middleware/auth');
const { parsePagination, parseSort, buildListResponse } = require('../utils/queryOptions');
const activityLogger = require('../middleware/activityLogger');

const router = Router();
router.use(activityLogger('shipment'));

const SORT_MAP = {
  id: 's.id',
  shipment_number: 's.shipment_number',
  departure_date: 's.departure_date',
  status: 's.status',
};

const ALLOWED_STATUSES = [
  'created',
  'loading',
  'ready_to_ship',
  'in_transit',
  'arrived',
  'distribution_completed',
  'closed',
];

// remaining/distributed weight & volume are computed here, never stored (RULES.md #6)
const SELECT_WITH_AGGREGATES = `
  SELECT
    s.*,
    w.name AS warehouse_name,
    COALESCE(d.distributed_weight_kg, 0) AS distributed_weight_kg,
    COALESCE(d.distributed_volume_m3, 0) AS distributed_volume_m3,
    s.total_weight_kg - COALESCE(d.distributed_weight_kg, 0) AS remaining_weight_kg,
    s.total_volume_m3 - COALESCE(d.distributed_volume_m3, 0) AS remaining_volume_m3,
    COALESCE(d.distributed_cost_usd, 0) AS distributed_cost_usd,
    COALESCE(d.client_count, 0) AS client_count
  FROM shipments s
  JOIN warehouses w ON w.id = s.warehouse_id
  LEFT JOIN (
    SELECT shipment_id,
      SUM(weight_kg) AS distributed_weight_kg,
      SUM(volume_m3) AS distributed_volume_m3,
      SUM(final_cost) AS distributed_cost_usd,
      COUNT(DISTINCT client_id) AS client_count
    FROM cargo
    WHERE status = 1
    GROUP BY shipment_id
  ) d ON d.shipment_id = s.id
`;

const SELECT_LIST = SELECT_WITH_AGGREGATES.replace('s.*,', 's.*, COUNT(*) OVER() AS total_count,');

async function nextShipmentNumber() {
  const [rows] = await pool.query(
    "SELECT MAX(CAST(shipment_number AS UNSIGNED)) AS maxNumber FROM shipments WHERE shipment_number REGEXP '^[0-9]+$'"
  );
  return String((rows[0].maxNumber || 0) + 1);
}

router.get(
  '/',
  requireAuth,
  requireRole('admin', 'manager'),
  asyncHandler(async (req, res) => {
    const { status, warehouse_id, search } = req.query;
    const { limit, offset, page, pageSize } = parsePagination(req.query);
    const sort = parseSort(req.query, SORT_MAP, 'id', 'desc');
    const conditions = ['s.is_active = 1'];
    const params = [];

    if (status) {
      conditions.push('s.status = ?');
      params.push(status);
    }
    if (warehouse_id) {
      conditions.push('s.warehouse_id = ?');
      params.push(warehouse_id);
    }
    if (search) {
      conditions.push('(s.shipment_number LIKE ? OR s.vehicle_number LIKE ?)');
      const like = `%${search}%`;
      params.push(like, like);
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
    const sql = `${SELECT_WITH_AGGREGATES} WHERE s.id = ? AND s.is_active = 1`;
    const [rows] = await pool.query(sql, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Рейс не найден', code: 'SHIPMENT_NOT_FOUND' });
    res.json(rows[0]);
  })
);

router.post(
  '/',
  requireAuth,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const {
      warehouse_id,
      total_weight_kg,
      total_volume_m3,
      vehicle_number,
      driver_name,
      driver_phone,
      load_date,
      departure_date,
      arrival_date,
      comment,
    } = req.body;
    let { shipment_number } = req.body;

    if (!warehouse_id || total_weight_kg == null || total_volume_m3 == null) {
      return res
        .status(400)
        .json({ error: 'warehouse_id, total_weight_kg и total_volume_m3 обязательны' });
    }
    if (!shipment_number) shipment_number = await nextShipmentNumber();

    try {
      const [result] = await pool.query(
        `INSERT INTO shipments
           (shipment_number, warehouse_id, vehicle_number, driver_name, driver_phone,
            load_date, departure_date, arrival_date, total_weight_kg, total_volume_m3, comment)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          shipment_number,
          warehouse_id,
          vehicle_number ?? null,
          driver_name ?? null,
          driver_phone ?? null,
          load_date ?? null,
          departure_date ?? null,
          arrival_date ?? null,
          total_weight_kg,
          total_volume_m3,
          comment ?? null,
        ]
      );
      const [rows] = await pool.query(`${SELECT_WITH_AGGREGATES} WHERE s.id = ?`, [result.insertId]);
      res.status(201).json(rows[0]);
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ error: 'Номер рейса уже используется', code: 'SHIPMENT_NUMBER_TAKEN' });
      }
      if (err.code === 'ER_NO_REFERENCED_ROW_2') {
        return res.status(400).json({ error: 'Указанный склад не найден', code: 'WAREHOUSE_NOT_FOUND' });
      }
      throw err;
    }
  })
);

router.put(
  '/:id',
  requireAuth,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const {
      shipment_number,
      warehouse_id,
      vehicle_number,
      driver_name,
      driver_phone,
      load_date,
      departure_date,
      arrival_date,
      total_weight_kg,
      total_volume_m3,
      comment,
    } = req.body;

    if (!shipment_number || !warehouse_id || total_weight_kg == null || total_volume_m3 == null) {
      return res
        .status(400)
        .json({ error: 'shipment_number, warehouse_id, total_weight_kg и total_volume_m3 обязательны' });
    }

    try {
      const [result] = await pool.query(
        `UPDATE shipments SET
           shipment_number = ?, warehouse_id = ?, vehicle_number = ?, driver_name = ?, driver_phone = ?,
           load_date = ?, departure_date = ?, arrival_date = ?, total_weight_kg = ?, total_volume_m3 = ?, comment = ?
         WHERE id = ? AND is_active = 1`,
        [
          shipment_number,
          warehouse_id,
          vehicle_number ?? null,
          driver_name ?? null,
          driver_phone ?? null,
          load_date ?? null,
          departure_date ?? null,
          arrival_date ?? null,
          total_weight_kg,
          total_volume_m3,
          comment ?? null,
          req.params.id,
        ]
      );
      if (result.affectedRows === 0) return res.status(404).json({ error: 'Рейс не найден', code: 'SHIPMENT_NOT_FOUND' });
      const [rows] = await pool.query(`${SELECT_WITH_AGGREGATES} WHERE s.id = ?`, [req.params.id]);
      res.json(rows[0]);
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ error: 'Номер рейса уже используется', code: 'SHIPMENT_NUMBER_TAKEN' });
      }
      if (err.code === 'ER_NO_REFERENCED_ROW_2') {
        return res.status(400).json({ error: 'Указанный склад не найден', code: 'WAREHOUSE_NOT_FOUND' });
      }
      throw err;
    }
  })
);

// Status is changed separately from general edits — it's a distinct workflow action (раздел 5 ТЗ).
router.patch(
  '/:id/status',
  requireAuth,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const { status } = req.body;
    if (!ALLOWED_STATUSES.includes(status)) {
      return res
        .status(400)
        .json({ error: `status должен быть одним из: ${ALLOWED_STATUSES.join(', ')}`, code: 'SHIPMENT_STATUS_INVALID' });
    }

    const [result] = await pool.query(
      'UPDATE shipments SET status = ? WHERE id = ? AND is_active = 1',
      [status, req.params.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Рейс не найден', code: 'SHIPMENT_NOT_FOUND' });
    const [rows] = await pool.query(`${SELECT_WITH_AGGREGATES} WHERE s.id = ?`, [req.params.id]);
    res.json(rows[0]);
  })
);

router.delete(
  '/:id',
  requireAuth,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const [result] = await pool.query(
      'UPDATE shipments SET is_active = 0 WHERE id = ? AND is_active = 1',
      [req.params.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Рейс не найден', code: 'SHIPMENT_NOT_FOUND' });
    res.status(204).send();
  })
);

module.exports = router;
