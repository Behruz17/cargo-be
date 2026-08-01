const pool = require('../config/db');

// paid_usd per cargo row only counts payments explicitly linked via cargo_id;
// lump-sum payments without cargo_id count toward the client's overall balance
// only (see getClientStats), not toward any specific shipment line.
async function getClientCargoHistory(clientId) {
  const [rows] = await pool.query(
    `SELECT c.id, c.added_date, c.weight_kg, c.volume_m3, c.places, c.final_cost,
            s.id AS shipment_id, s.shipment_number, s.departure_date, s.arrival_date,
            w.name AS warehouse_name,
            COALESCE(pd.paid_usd, 0) AS paid_usd,
            c.final_cost - COALESCE(pd.paid_usd, 0) AS debt_usd
     FROM cargo c
     JOIN shipments s ON s.id = c.shipment_id
     JOIN warehouses w ON w.id = s.warehouse_id
     LEFT JOIN (
       SELECT cargo_id, SUM(amount_usd) AS paid_usd FROM payments WHERE status = 1 GROUP BY cargo_id
     ) pd ON pd.cargo_id = c.id
     WHERE c.client_id = ? AND c.status = 1
     ORDER BY c.added_date DESC`,
    [clientId]
  );
  return rows.map((row) => ({
    ...row,
    weight_kg: Number(row.weight_kg),
    volume_m3: Number(row.volume_m3),
    final_cost: Number(row.final_cost),
    paid_usd: Number(row.paid_usd),
    debt_usd: Number(row.debt_usd),
  }));
}

async function getClientStats(clientId) {
  const [[cargoAgg]] = await pool.query(
    `SELECT COALESCE(SUM(weight_kg), 0) AS total_weight_kg,
            COALESCE(SUM(volume_m3), 0) AS total_volume_m3,
            COALESCE(SUM(final_cost), 0) AS total_cost_usd
     FROM cargo WHERE client_id = ? AND status = 1`,
    [clientId]
  );
  const [[paymentAgg]] = await pool.query(
    `SELECT COALESCE(SUM(amount_usd), 0) AS total_paid_usd FROM payments WHERE client_id = ? AND status = 1`,
    [clientId]
  );
  const [[clientRow]] = await pool.query(
    `SELECT opening_balance_usd FROM clients WHERE id = ?`,
    [clientId]
  );

  const totalCostUsd = Number(cargoAgg.total_cost_usd);
  const totalPaidUsd = Number(paymentAgg.total_paid_usd);
  const openingBalanceUsd = Number(clientRow?.opening_balance_usd ?? 0);

  return {
    totalWeightKg: Number(cargoAgg.total_weight_kg),
    totalVolumeM3: Number(cargoAgg.total_volume_m3),
    totalCostUsd,
    totalPaidUsd,
    openingBalanceUsd,
    remainingDebtUsd: Math.round((totalCostUsd - totalPaidUsd + openingBalanceUsd) * 100) / 100,
  };
}

module.exports = { getClientCargoHistory, getClientStats };
