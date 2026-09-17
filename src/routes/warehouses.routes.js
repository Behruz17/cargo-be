const { Router } = require('express');
const pool = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth, requireRole } = require('../middleware/auth');
const { parsePagination, parseSort, buildListResponse } = require('../utils/queryOptions');
const activityLogger = require('../middleware/activityLogger');

const router = Router();
router.use(activityLogger('warehouse'));

const SORT_MAP = { id: 'id', name: 'name' };

router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { search } = req.query;
    const { limit, offset, page, pageSize } = parsePagination(req.query);
    const sort = parseSort(req.query, SORT_MAP, 'name');

    const conditions = ['status = 1'];
    const params = [];
    if (search) {
      conditions.push('(name LIKE ? OR address LIKE ? OR contact_person LIKE ?)');
      const like = `%${search}%`;
      params.push(like, like, like);
    }

    const [rows] = await pool.query(
      `SELECT *, COUNT(*) OVER() AS total_count FROM warehouses
       WHERE ${conditions.join(' AND ')} ORDER BY ${sort} LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    res.json(buildListResponse(rows, { page, pageSize }));
  })
);

router.get(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query('SELECT * FROM warehouses WHERE id = ? AND status = 1', [
      req.params.id,
    ]);
    if (!rows[0]) return res.status(404).json({ error: 'Склад не найден', code: 'WAREHOUSE_NOT_FOUND' });
    res.json(rows[0]);
  })
);

router.post(
  '/',
  requireAuth,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const { name, address, contact_person, phone, comment } = req.body;
    if (!name) return res.status(400).json({ error: 'name обязателен', code: 'NAME_REQUIRED' });

    const [result] = await pool.query(
      'INSERT INTO warehouses (name, address, contact_person, phone, comment) VALUES (?, ?, ?, ?, ?)',
      [name, address ?? null, contact_person ?? null, phone ?? null, comment ?? null]
    );
    const [rows] = await pool.query('SELECT * FROM warehouses WHERE id = ?', [result.insertId]);
    res.status(201).json(rows[0]);
  })
);

router.put(
  '/:id',
  requireAuth,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const { name, address, contact_person, phone, comment } = req.body;
    const [result] = await pool.query(
      `UPDATE warehouses SET name = ?, address = ?, contact_person = ?, phone = ?, comment = ?
       WHERE id = ? AND status = 1`,
      [name, address ?? null, contact_person ?? null, phone ?? null, comment ?? null, req.params.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Склад не найден', code: 'WAREHOUSE_NOT_FOUND' });
    const [rows] = await pool.query('SELECT * FROM warehouses WHERE id = ?', [req.params.id]);
    res.json(rows[0]);
  })
);

router.delete(
  '/:id',
  requireAuth,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const [result] = await pool.query('UPDATE warehouses SET status = 0 WHERE id = ? AND status = 1', [
      req.params.id,
    ]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Склад не найден', code: 'WAREHOUSE_NOT_FOUND' });
    res.status(204).send();
  })
);

module.exports = router;
