const pool = require('../config/db');
const { getClientCargoHistory, getClientStats } = require('./clientHistory');

async function getClientReport(clientId) {
  const [clientRows] = await pool.query(
    'SELECT id, code, full_name, phone FROM clients WHERE id = ? AND status = 1',
    [clientId]
  );
  if (!clientRows[0]) return null;

  const [shipments, stats] = await Promise.all([
    getClientCargoHistory(clientId),
    getClientStats(clientId),
  ]);
  return { client: clientRows[0], shipments, ...stats };
}

async function getShipmentReport(shipmentId) {
  const [shipmentRows] = await pool.query(
    `SELECT s.*, w.name AS warehouse_name FROM shipments s
     JOIN warehouses w ON w.id = s.warehouse_id
     WHERE s.id = ? AND s.is_active = 1`,
    [shipmentId]
  );
  if (!shipmentRows[0]) return null;

  const [cargoRows] = await pool.query(
    `SELECT c.id, c.added_date, c.weight_kg, c.volume_m3, c.calculation_type, c.rate, c.final_cost,
            cl.code AS client_code, cl.full_name AS client_full_name
     FROM cargo c
     JOIN clients cl ON cl.id = c.client_id
     WHERE c.shipment_id = ? AND c.status = 1
     ORDER BY cl.code`,
    [shipmentId]
  );
  const [expenseRows] = await pool.query(
    `SELECT e.id, e.amount_usd, e.comment, et.name AS expense_type_name
     FROM expenses e
     JOIN expense_types et ON et.id = e.expense_type_id
     WHERE e.shipment_id = ? AND e.status = 1`,
    [shipmentId]
  );

  const revenueUsd = cargoRows.reduce((sum, row) => sum + Number(row.final_cost), 0);
  const expensesUsd = expenseRows.reduce((sum, row) => sum + Number(row.amount_usd), 0);

  return {
    shipment: shipmentRows[0],
    cargo: cargoRows,
    expenses: expenseRows,
    revenueUsd: Math.round(revenueUsd * 100) / 100,
    expensesUsd: Math.round(expensesUsd * 100) / 100,
    profitUsd: Math.round((revenueUsd - expensesUsd) * 100) / 100,
  };
}

async function getWarehouseReport(warehouseId) {
  const [warehouseRows] = await pool.query('SELECT * FROM warehouses WHERE id = ? AND status = 1', [
    warehouseId,
  ]);
  if (!warehouseRows[0]) return null;

  const [shipmentRows] = await pool.query(
    `SELECT s.id, s.shipment_number, s.status, s.departure_date, s.arrival_date,
            s.total_weight_kg, s.total_volume_m3,
            COALESCE(SUM(c.final_cost), 0) AS revenue_usd
     FROM shipments s
     LEFT JOIN cargo c ON c.shipment_id = s.id AND c.status = 1
     WHERE s.warehouse_id = ? AND s.is_active = 1
     GROUP BY s.id
     ORDER BY s.departure_date DESC`,
    [warehouseId]
  );

  return { warehouse: warehouseRows[0], shipments: shipmentRows };
}

async function getPeriodReport(from, to) {
  const [shipmentRows] = await pool.query(
    `SELECT s.id, s.shipment_number, s.departure_date, s.arrival_date, w.name AS warehouse_name,
            COALESCE(c.revenue_usd, 0) AS revenue_usd,
            COALESCE(e.expenses_usd, 0) AS expenses_usd
     FROM shipments s
     JOIN warehouses w ON w.id = s.warehouse_id
     LEFT JOIN (
       SELECT shipment_id, SUM(final_cost) AS revenue_usd FROM cargo WHERE status = 1 GROUP BY shipment_id
     ) c ON c.shipment_id = s.id
     LEFT JOIN (
       SELECT shipment_id, SUM(amount_usd) AS expenses_usd FROM expenses WHERE status = 1 GROUP BY shipment_id
     ) e ON e.shipment_id = s.id
     WHERE s.is_active = 1 AND s.departure_date BETWEEN ? AND ?
     ORDER BY s.departure_date`,
    [from, to]
  );

  const revenueUsd = shipmentRows.reduce((sum, row) => sum + Number(row.revenue_usd), 0);
  const expensesUsd = shipmentRows.reduce((sum, row) => sum + Number(row.expenses_usd), 0);

  return {
    from,
    to,
    shipments: shipmentRows,
    revenueUsd: Math.round(revenueUsd * 100) / 100,
    expensesUsd: Math.round(expensesUsd * 100) / 100,
    profitUsd: Math.round((revenueUsd - expensesUsd) * 100) / 100,
  };
}

async function getDebtReport() {
  const [rows] = await pool.query(
    `SELECT cl.id, cl.code, cl.full_name, cl.phone, cl.opening_balance_usd,
            COALESCE(c.total_cost_usd, 0) AS total_cost_usd,
            COALESCE(p.total_paid_usd, 0) AS total_paid_usd,
            COALESCE(c.total_cost_usd, 0) - COALESCE(p.total_paid_usd, 0) + cl.opening_balance_usd AS debt_usd
     FROM clients cl
     LEFT JOIN (
       SELECT client_id, SUM(final_cost) AS total_cost_usd FROM cargo WHERE status = 1 GROUP BY client_id
     ) c ON c.client_id = cl.id
     LEFT JOIN (
       SELECT client_id, SUM(amount_usd) AS total_paid_usd FROM payments WHERE status = 1 GROUP BY client_id
     ) p ON p.client_id = cl.id
     WHERE cl.status = 1
     HAVING debt_usd > 0
     ORDER BY debt_usd DESC`
  );
  return rows;
}

async function getExpensesReport({ from, to, shipmentId, scope }) {
  const conditions = ['e.status = 1'];
  const params = [];

  if (scope === 'general') {
    conditions.push('e.shipment_id IS NULL');
  } else if (shipmentId) {
    conditions.push('e.shipment_id = ?');
    params.push(shipmentId);
  }
  if (from && to) {
    conditions.push('DATE(e.created_at) BETWEEN ? AND ?');
    params.push(from, to);
  }

  const [rows] = await pool.query(
    `SELECT et.name AS expense_type_name, COUNT(*) AS entries_count, SUM(e.amount_usd) AS total_usd
     FROM expenses e
     JOIN expense_types et ON et.id = e.expense_type_id
     WHERE ${conditions.join(' AND ')}
     GROUP BY et.id, et.name
     ORDER BY total_usd DESC`,
    params
  );

  const totalUsd = rows.reduce((sum, row) => sum + Number(row.total_usd), 0);
  return { byType: rows, totalUsd: Math.round(totalUsd * 100) / 100 };
}

module.exports = {
  getClientReport,
  getShipmentReport,
  getWarehouseReport,
  getPeriodReport,
  getDebtReport,
  getExpensesReport,
};
