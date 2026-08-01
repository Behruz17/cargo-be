const { Router } = require('express');
const pool = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth, requireRole } = require('../middleware/auth');
const activityLogger = require('../middleware/activityLogger');

const router = Router();
router.use(activityLogger('expense_type'));

router.get(
  '/',
  requireAuth,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query('SELECT * FROM expense_types WHERE status = 1 ORDER BY name');
    res.json(rows);
  })
);

router.post(
  '/',
  requireAuth,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'name обязателен' });

    try {
      const [result] = await pool.query('INSERT INTO expense_types (name) VALUES (?)', [name]);
      const [rows] = await pool.query('SELECT * FROM expense_types WHERE id = ?', [result.insertId]);
      res.status(201).json(rows[0]);
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ error: 'Такой тип расхода уже существует' });
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
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'name обязателен' });

    try {
      const [result] = await pool.query(
        'UPDATE expense_types SET name = ? WHERE id = ? AND status = 1',
        [name, req.params.id]
      );
      if (result.affectedRows === 0) return res.status(404).json({ error: 'Тип расхода не найден' });
      const [rows] = await pool.query('SELECT * FROM expense_types WHERE id = ?', [req.params.id]);
      res.json(rows[0]);
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ error: 'Такой тип расхода уже существует' });
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
    const [result] = await pool.query(
      'UPDATE expense_types SET status = 0 WHERE id = ? AND status = 1',
      [req.params.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Тип расхода не найден' });
    res.status(204).send();
  })
);

module.exports = router;
