const { Router } = require('express');
const pool = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth, requireRole } = require('../middleware/auth');
const { CURRENCIES, OFFICES, computeAmountUsd } = require('../utils/currency');
const { parsePagination, parseSort, buildListResponse } = require('../utils/queryOptions');
const { withTransaction } = require('../utils/transaction');
const activityLogger = require('../middleware/activityLogger');

const router = Router();
router.use(activityLogger('expense'));

const SORT_MAP = { id: 'e.id', amount_usd: 'e.amount_usd', created_at: 'e.created_at' };

const SELECT_WITH_JOIN = `
  SELECT
    e.*,
    et.name AS expense_type_name,
    s.shipment_number,
    u.full_name AS created_by_name
  FROM expenses e
  JOIN expense_types et ON et.id = e.expense_type_id
  LEFT JOIN shipments s ON s.id = e.shipment_id
  JOIN users u ON u.id = e.created_by
`;

const SELECT_LIST = SELECT_WITH_JOIN.replace('e.*,', 'e.*, COUNT(*) OVER() AS total_count,');

function validateExpenseBody(body) {
  const { expense_type_id, amount, currency, exchange_rate, office } = body;
  if (!expense_type_id || amount == null || !currency || !office) {
    return { message: 'expense_type_id, amount, currency и office обязательны', code: 'EXPENSE_FIELDS_REQUIRED' };
  }
  if (Number(amount) <= 0) return { message: 'amount должен быть положительным', code: 'AMOUNT_MUST_BE_POSITIVE' };
  if (!CURRENCIES.includes(currency)) {
    return { message: `currency должен быть одним из: ${CURRENCIES.join(', ')}`, code: 'CURRENCY_INVALID' };
  }
  if (!OFFICES.includes(office)) {
    return { message: `office должен быть одним из: ${OFFICES.join(', ')}`, code: 'OFFICE_INVALID' };
  }
  if (currency === 'TJS' && !(Number(exchange_rate) > 0)) {
    return { message: 'exchange_rate обязателен и должен быть положительным для TJS', code: 'EXCHANGE_RATE_REQUIRED' };
  }
  return null;
}

router.get(
  '/',
  requireAuth,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const { shipment_id, scope } = req.query;
    const { limit, offset, page, pageSize } = parsePagination(req.query);
    const sort = parseSort(req.query, SORT_MAP, 'created_at', 'desc');
    const conditions = ['e.status = 1'];
    const params = [];

    if (scope === 'general') {
      conditions.push('e.shipment_id IS NULL');
    } else if (shipment_id) {
      conditions.push('e.shipment_id = ?');
      params.push(shipment_id);
    }

    const sql = `${SELECT_LIST} WHERE ${conditions.join(' AND ')} ORDER BY ${sort} LIMIT ? OFFSET ?`;
    const [rows] = await pool.query(sql, [...params, limit, offset]);
    res.json(buildListResponse(rows, { page, pageSize }));
  })
);

router.get(
  '/:id',
  requireAuth,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(`${SELECT_WITH_JOIN} WHERE e.id = ? AND e.status = 1`, [
      req.params.id,
    ]);
    if (!rows[0]) return res.status(404).json({ error: 'Расход не найден', code: 'EXPENSE_NOT_FOUND' });
    res.json(rows[0]);
  })
);

router.post(
  '/',
  requireAuth,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const error = validateExpenseBody(req.body);
    if (error) return res.status(400).json({ error: error.message, code: error.code });

    const { shipment_id, office, expense_type_id, amount, currency, comment } = req.body;
    const exchangeRate = currency === 'USD' ? 1 : Number(req.body.exchange_rate);
    const amountUsd = computeAmountUsd(amount, currency, exchangeRate);

    try {
      const row = await withTransaction(async (conn) => {
        const [result] = await conn.query(
          `INSERT INTO expenses
             (shipment_id, office, expense_type_id, amount, currency, exchange_rate, amount_usd, comment, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            shipment_id ?? null,
            office,
            expense_type_id,
            amount,
            currency,
            exchangeRate,
            amountUsd,
            comment ?? null,
            req.user.id,
          ]
        );
        const [rows] = await conn.query(`${SELECT_WITH_JOIN} WHERE e.id = ?`, [result.insertId]);
        return rows[0];
      });
      res.status(201).json(row);
    } catch (err) {
      if (err.code === 'ER_NO_REFERENCED_ROW_2') {
        return res.status(400).json({ error: 'Рейс или тип расхода не найден', code: 'EXPENSE_SHIPMENT_OR_TYPE_NOT_FOUND' });
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
    const error = validateExpenseBody(req.body);
    if (error) return res.status(400).json({ error: error.message, code: error.code });

    const { shipment_id, office, expense_type_id, amount, currency, comment } = req.body;
    const exchangeRate = currency === 'USD' ? 1 : Number(req.body.exchange_rate);
    const amountUsd = computeAmountUsd(amount, currency, exchangeRate);

    try {
      const row = await withTransaction(async (conn) => {
        const [result] = await conn.query(
          `UPDATE expenses SET
             shipment_id = ?, office = ?, expense_type_id = ?, amount = ?, currency = ?,
             exchange_rate = ?, amount_usd = ?, comment = ?
           WHERE id = ? AND status = 1`,
          [shipment_id ?? null, office, expense_type_id, amount, currency, exchangeRate, amountUsd, comment ?? null, req.params.id]
        );
        if (result.affectedRows === 0) return null;
        const [rows] = await conn.query(`${SELECT_WITH_JOIN} WHERE e.id = ?`, [req.params.id]);
        return rows[0];
      });
      if (!row) return res.status(404).json({ error: 'Расход не найден', code: 'EXPENSE_NOT_FOUND' });
      res.json(row);
    } catch (err) {
      if (err.code === 'ER_NO_REFERENCED_ROW_2') {
        return res.status(400).json({ error: 'Рейс или тип расхода не найден', code: 'EXPENSE_SHIPMENT_OR_TYPE_NOT_FOUND' });
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
    const [result] = await pool.query('UPDATE expenses SET status = 0 WHERE id = ? AND status = 1', [
      req.params.id,
    ]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Расход не найден', code: 'EXPENSE_NOT_FOUND' });
    res.status(204).send();
  })
);

module.exports = router;
