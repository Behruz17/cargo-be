const { Router } = require('express');
const pool = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth, requireRole } = require('../middleware/auth');
const { getClientCargoHistory, getClientStats } = require('../services/clientHistory');
const { parsePagination, parseSort, buildListResponse } = require('../utils/queryOptions');
const activityLogger = require('../middleware/activityLogger');

const router = Router();
router.use(activityLogger('client'));

const CLIENT_SORT_MAP = { id: 'id', code: 'code', full_name: 'full_name', registration_date: 'registration_date' };

async function nextClientCode() {
  const [rows] = await pool.query(
    "SELECT MAX(CAST(code AS UNSIGNED)) AS maxCode FROM clients WHERE code REGEXP '^[0-9]+$'"
  );
  return String((rows[0].maxCode || 999) + 1);
}

router.get(
  '/',
  requireAuth,
  requireRole('admin', 'manager'),
  asyncHandler(async (req, res) => {
    const { search } = req.query;
    const { limit, offset, page, pageSize } = parsePagination(req.query);
    const sort = parseSort(req.query, CLIENT_SORT_MAP, 'code');

    const conditions = ['status = 1'];
    const params = [];
    if (search) {
      conditions.push('(code LIKE ? OR full_name LIKE ? OR phone LIKE ?)');
      const like = `%${search}%`;
      params.push(like, like, like);
    }

    const [rows] = await pool.query(
      `SELECT *, COUNT(*) OVER() AS total_count FROM clients
       WHERE ${conditions.join(' AND ')} ORDER BY ${sort} LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    res.json(buildListResponse(rows, { page, pageSize }));
  })
);

router.get(
  '/:id',
  requireAuth,
  requireRole('admin', 'manager'),
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query('SELECT * FROM clients WHERE id = ? AND status = 1', [
      req.params.id,
    ]);
    if (!rows[0]) return res.status(404).json({ error: 'Получатель не найден', code: 'CLIENT_NOT_FOUND' });
    res.json(rows[0]);
  })
);

// раздел 14 ТЗ: история получателя — все его грузы/рейсы + оплаты + текущий долг
router.get(
  '/:id/history',
  requireAuth,
  requireRole('admin', 'manager'),
  asyncHandler(async (req, res) => {
    const [clientRows] = await pool.query('SELECT id, code, full_name FROM clients WHERE id = ? AND status = 1', [
      req.params.id,
    ]);
    if (!clientRows[0]) return res.status(404).json({ error: 'Получатель не найден', code: 'CLIENT_NOT_FOUND' });

    const [shipments, stats] = await Promise.all([
      getClientCargoHistory(req.params.id),
      getClientStats(req.params.id),
    ]);

    res.json({ client: clientRows[0], shipments, ...stats });
  })
);

router.post(
  '/',
  requireAuth,
  requireRole('admin', 'manager'),
  asyncHandler(async (req, res) => {
    const { full_name, phone, address, comment, registration_date, opening_balance_usd } = req.body;
    let { code } = req.body;
    if (!full_name || !phone) {
      return res.status(400).json({ error: 'full_name и phone обязательны', code: 'CLIENT_NAME_PHONE_REQUIRED' });
    }
    if (!code) code = await nextClientCode();

    try {
      const [result] = await pool.query(
        `INSERT INTO clients (code, full_name, phone, address, comment, registration_date, opening_balance_usd)
         VALUES (?, ?, ?, ?, ?, COALESCE(?, CURDATE()), ?)`,
        [
          code,
          full_name,
          phone,
          address ?? null,
          comment ?? null,
          registration_date ?? null,
          opening_balance_usd ?? 0,
        ]
      );
      const [rows] = await pool.query('SELECT * FROM clients WHERE id = ?', [result.insertId]);
      res.status(201).json(rows[0]);
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ error: 'Код получателя уже используется', code: 'CLIENT_CODE_TAKEN' });
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
    const { code, full_name, phone, address, comment, registration_date } = req.body;
    if (!full_name || !phone) {
      return res.status(400).json({ error: 'full_name и phone обязательны', code: 'CLIENT_NAME_PHONE_REQUIRED' });
    }

    // opening_balance_usd умышленно не редактируется здесь: задаётся один раз
    // при создании клиента, дальнейшая правка — только напрямую в БД.
    try {
      const [result] = await pool.query(
        `UPDATE clients SET code = ?, full_name = ?, phone = ?, address = ?, comment = ?,
           registration_date = COALESCE(?, registration_date)
         WHERE id = ? AND status = 1`,
        [
          code,
          full_name,
          phone,
          address ?? null,
          comment ?? null,
          registration_date ?? null,
          req.params.id,
        ]
      );
      if (result.affectedRows === 0) return res.status(404).json({ error: 'Получатель не найден', code: 'CLIENT_NOT_FOUND' });
      const [rows] = await pool.query('SELECT * FROM clients WHERE id = ?', [req.params.id]);
      res.json(rows[0]);
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ error: 'Код получателя уже используется', code: 'CLIENT_CODE_TAKEN' });
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
    const [result] = await pool.query('UPDATE clients SET status = 0 WHERE id = ? AND status = 1', [
      req.params.id,
    ]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Получатель не найден', code: 'CLIENT_NOT_FOUND' });
    res.status(204).send();
  })
);

module.exports = router;
