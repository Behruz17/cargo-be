const { Router } = require('express');
const bcrypt = require('bcrypt');
const pool = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth, requireRole } = require('../middleware/auth');
const { parsePagination, parseSort, buildListResponse } = require('../utils/queryOptions');
const activityLogger = require('../middleware/activityLogger');

const router = Router();
router.use(activityLogger('user'));

const ROLES = ['admin', 'manager', 'client'];
const SAFE_COLUMNS = 'id, username, full_name, role, client_id, phone, status, created_at, updated_at';
const SORT_MAP = { id: 'id', username: 'username', role: 'role' };

function validateUserBody(body, { requirePassword }) {
  const { username, full_name, role, client_id, password } = body;
  if (!username || !full_name || !role) {
    return { message: 'username, full_name и role обязательны', code: 'USER_FIELDS_REQUIRED' };
  }
  if (!ROLES.includes(role)) return { message: `role должен быть одним из: ${ROLES.join(', ')}`, code: 'ROLE_INVALID' };
  if (role === 'client' && !client_id) {
    return { message: 'client_id обязателен для роли client', code: 'USER_CLIENT_ID_REQUIRED' };
  }
  if (requirePassword && !password) return { message: 'password обязателен', code: 'PASSWORD_REQUIRED' };
  return null;
}

router.get(
  '/',
  requireAuth,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const { limit, offset, page, pageSize } = parsePagination(req.query);
    const sort = parseSort(req.query, SORT_MAP, 'username');
    const [rows] = await pool.query(
      `SELECT ${SAFE_COLUMNS}, COUNT(*) OVER() AS total_count FROM users WHERE status = 1
       ORDER BY ${sort} LIMIT ? OFFSET ?`,
      [limit, offset]
    );
    res.json(buildListResponse(rows, { page, pageSize }));
  })
);

router.get(
  '/:id',
  requireAuth,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(`SELECT ${SAFE_COLUMNS} FROM users WHERE id = ? AND status = 1`, [
      req.params.id,
    ]);
    if (!rows[0]) return res.status(404).json({ error: 'Пользователь не найден', code: 'USER_NOT_FOUND' });
    res.json(rows[0]);
  })
);

router.post(
  '/',
  requireAuth,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const error = validateUserBody(req.body, { requirePassword: true });
    if (error) return res.status(400).json({ error: error.message, code: error.code });

    const { username, password, full_name, role, client_id, phone } = req.body;
    const passwordHash = await bcrypt.hash(password, 10);

    try {
      const [result] = await pool.query(
        'INSERT INTO users (username, password_hash, full_name, role, client_id, phone) VALUES (?, ?, ?, ?, ?, ?)',
        [username, passwordHash, full_name, role, role === 'client' ? client_id : null, phone ?? null]
      );
      const [rows] = await pool.query(`SELECT ${SAFE_COLUMNS} FROM users WHERE id = ?`, [result.insertId]);
      res.status(201).json(rows[0]);
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'username уже занят', code: 'USERNAME_TAKEN' });
      if (err.code === 'ER_NO_REFERENCED_ROW_2') {
        return res.status(400).json({ error: 'Получатель не найден', code: 'CLIENT_NOT_FOUND' });
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
    const error = validateUserBody(req.body, { requirePassword: false });
    if (error) return res.status(400).json({ error: error.message, code: error.code });

    const { username, password, full_name, role, client_id, phone } = req.body;
    const resolvedClientId = role === 'client' ? client_id : null;

    try {
      const passwordHash = password ? await bcrypt.hash(password, 10) : null;
      const sql = passwordHash
        ? `UPDATE users SET username = ?, password_hash = ?, full_name = ?, role = ?, client_id = ?, phone = ?
           WHERE id = ? AND status = 1`
        : `UPDATE users SET username = ?, full_name = ?, role = ?, client_id = ?, phone = ?
           WHERE id = ? AND status = 1`;
      const params = passwordHash
        ? [username, passwordHash, full_name, role, resolvedClientId, phone ?? null, req.params.id]
        : [username, full_name, role, resolvedClientId, phone ?? null, req.params.id];

      const [result] = await pool.query(sql, params);
      if (result.affectedRows === 0) return res.status(404).json({ error: 'Пользователь не найден', code: 'USER_NOT_FOUND' });

      const [rows] = await pool.query(`SELECT ${SAFE_COLUMNS} FROM users WHERE id = ?`, [req.params.id]);
      res.json(rows[0]);
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'username уже занят', code: 'USERNAME_TAKEN' });
      if (err.code === 'ER_NO_REFERENCED_ROW_2') {
        return res.status(400).json({ error: 'Получатель не найден', code: 'CLIENT_NOT_FOUND' });
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
    const [result] = await pool.query('UPDATE users SET status = 0 WHERE id = ? AND status = 1', [
      req.params.id,
    ]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Пользователь не найден', code: 'USER_NOT_FOUND' });
    res.status(204).send();
  })
);

module.exports = router;
