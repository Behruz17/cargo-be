const pool = require('../config/db');

// Раздел RULES.md п.4: финансовые операции (payments/expenses/cargo.final_cost)
// идут через BEGIN/COMMIT/ROLLBACK на одном соединении, без промежуточных состояний.
async function withTransaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { withTransaction };
