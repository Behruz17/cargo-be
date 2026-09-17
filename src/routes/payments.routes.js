const { Router } = require('express');
const pool = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth, requireRole } = require('../middleware/auth');
const { CURRENCIES, OFFICES, computeAmountUsd } = require('../utils/currency');
const { parsePagination, parseSort, buildListResponse } = require('../utils/queryOptions');
const { withTransaction } = require('../utils/transaction');
const activityLogger = require('../middleware/activityLogger');

const router = Router();
router.use(activityLogger('payment'));

const SORT_MAP = { id: 'p.id', payment_date: 'p.payment_date', amount_usd: 'p.amount_usd' };

const SELECT_WITH_JOIN = `
  SELECT
    p.*,
    cl.code AS client_code,
    cl.full_name AS client_full_name,
    u.full_name AS created_by_name
  FROM payments p
  JOIN clients cl ON cl.id = p.client_id
  JOIN users u ON u.id = p.created_by
`;

const SELECT_LIST = SELECT_WITH_JOIN.replace('p.*,', 'p.*, COUNT(*) OVER() AS total_count,');

function validatePaymentBody(body) {
  const { client_id, payment_date, amount, currency, exchange_rate, office } = body;
  if (!client_id || !payment_date || amount == null || !currency || !office) {
    return { message: 'client_id, payment_date, amount, currency и office обязательны', code: 'PAYMENT_FIELDS_REQUIRED' };
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
  requireRole('admin', 'manager'),
  asyncHandler(async (req, res) => {
    const { client_id } = req.query;
    const { limit, offset, page, pageSize } = parsePagination(req.query);
    const sort = parseSort(req.query, SORT_MAP, 'payment_date', 'desc');
    const conditions = ['p.status = 1'];
    const params = [];

    if (client_id) {
      conditions.push('p.client_id = ?');
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
    const [rows] = await pool.query(`${SELECT_WITH_JOIN} WHERE p.id = ? AND p.status = 1`, [
      req.params.id,
    ]);
    if (!rows[0]) return res.status(404).json({ error: 'Платёж не найден', code: 'PAYMENT_NOT_FOUND' });
    res.json(rows[0]);
  })
);

router.post(
  '/',
  requireAuth,
  requireRole('admin', 'manager'),
  asyncHandler(async (req, res) => {
    const error = validatePaymentBody(req.body);
    if (error) return res.status(400).json({ error: error.message, code: error.code });

    const { client_id, cargo_id, office, payment_date, amount, currency, comment } = req.body;
    const exchangeRate = currency === 'USD' ? 1 : Number(req.body.exchange_rate);
    const amountUsd = computeAmountUsd(amount, currency, exchangeRate);

    try {
      const row = await withTransaction(async (conn) => {
        const [result] = await conn.query(
          `INSERT INTO payments
             (client_id, cargo_id, office, payment_date, amount, currency, exchange_rate, amount_usd, comment, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            client_id,
            cargo_id ?? null,
            office,
            payment_date,
            amount,
            currency,
            exchangeRate,
            amountUsd,
            comment ?? null,
            req.user.id,
          ]
        );
        const [rows] = await conn.query(`${SELECT_WITH_JOIN} WHERE p.id = ?`, [result.insertId]);
        return rows[0];
      });
      res.status(201).json(row);
    } catch (err) {
      if (err.code === 'ER_NO_REFERENCED_ROW_2') {
        return res.status(400).json({ error: 'Получатель или груз не найден', code: 'PAYMENT_CLIENT_OR_CARGO_NOT_FOUND' });
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
    const error = validatePaymentBody(req.body);
    if (error) return res.status(400).json({ error: error.message, code: error.code });

    const { client_id, cargo_id, office, payment_date, amount, currency, comment } = req.body;
    const exchangeRate = currency === 'USD' ? 1 : Number(req.body.exchange_rate);
    const amountUsd = computeAmountUsd(amount, currency, exchangeRate);

    try {
      const row = await withTransaction(async (conn) => {
        const [result] = await conn.query(
          `UPDATE payments SET
             client_id = ?, cargo_id = ?, office = ?, payment_date = ?, amount = ?, currency = ?,
             exchange_rate = ?, amount_usd = ?, comment = ?
           WHERE id = ? AND status = 1`,
          [client_id, cargo_id ?? null, office, payment_date, amount, currency, exchangeRate, amountUsd, comment ?? null, req.params.id]
        );
        if (result.affectedRows === 0) return null;
        const [rows] = await conn.query(`${SELECT_WITH_JOIN} WHERE p.id = ?`, [req.params.id]);
        return rows[0];
      });
      if (!row) return res.status(404).json({ error: 'Платёж не найден', code: 'PAYMENT_NOT_FOUND' });
      res.json(row);
    } catch (err) {
      if (err.code === 'ER_NO_REFERENCED_ROW_2') {
        return res.status(400).json({ error: 'Получатель или груз не найден', code: 'PAYMENT_CLIENT_OR_CARGO_NOT_FOUND' });
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
    const [result] = await pool.query('UPDATE payments SET status = 0 WHERE id = ? AND status = 1', [
      req.params.id,
    ]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Платёж не найден', code: 'PAYMENT_NOT_FOUND' });
    res.status(204).send();
  })
);

module.exports = router;
