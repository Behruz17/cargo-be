const { Router } = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth, requireRole } = require('../middleware/auth');
const { sendExcel } = require('../utils/excelExport');
const reports = require('../services/reports');

const router = Router();

router.use(requireAuth, requireRole('admin'));

// раздел 17 ТЗ: отчёт по получателю
router.get(
  '/clients/:id',
  asyncHandler(async (req, res) => {
    const report = await reports.getClientReport(req.params.id);
    if (!report) return res.status(404).json({ error: 'Получатель не найден' });

    if (req.query.format === 'xlsx') {
      return sendExcel(res, `client-${report.client.code}.xlsx`, [
        {
          name: 'Сводка',
          rows: [
            {
              Код: report.client.code,
              ФИО: report.client.full_name,
              'Общий вес (кг)': report.totalWeightKg,
              'Общий объём (м3)': report.totalVolumeM3,
              'Общая стоимость (USD)': report.totalCostUsd,
              'Оплачено (USD)': report.totalPaidUsd,
              'Входящий долг (USD)': report.openingBalanceUsd,
              'Долг (USD)': report.remainingDebtUsd,
            },
          ],
        },
        {
          name: 'Грузы',
          rows: report.shipments.map((s) => ({
            Рейс: s.shipment_number,
            Склад: s.warehouse_name,
            Дата: s.added_date,
            'Вес (кг)': Number(s.weight_kg),
            'Объём (м3)': Number(s.volume_m3),
            'Место': Number(s.places),
            'Стоимость (USD)': Number(s.final_cost),
            'Оплачено (USD)': Number(s.paid_usd),
            'Долг (USD)': Number(s.debt_usd),
          })),
        },
      ]);
    }
    res.json(report);
  })
);

// раздел 17 ТЗ: отчёт по рейсу
router.get(
  '/shipments/:id',
  asyncHandler(async (req, res) => {
    const report = await reports.getShipmentReport(req.params.id);
    if (!report) return res.status(404).json({ error: 'Рейс не найден' });

    if (req.query.format === 'xlsx') {
      return sendExcel(res, `shipment-${report.shipment.shipment_number}.xlsx`, [
        {
          name: 'Сводка',
          rows: [
            {
              Рейс: report.shipment.shipment_number,
              Склад: report.shipment.warehouse_name,
              'Доход (USD)': report.revenueUsd,
              'Расход (USD)': report.expensesUsd,
              'Прибыль (USD)': report.profitUsd,
            },
          ],
        },
        {
          name: 'Грузы',
          rows: report.cargo.map((c) => ({
            Код: c.client_code,
            Получатель: c.client_full_name,
            Дата: c.added_date,
            'Вес (кг)': Number(c.weight_kg),
            'Объём (м3)': Number(c.volume_m3),
            'Место': Number(c.places),
            Расчёт: c.calculation_type === 'by_weight' ? 'по кг' : 'по м3',
            Цена: Number(c.rate),
            'Итог (USD)': Number(c.final_cost),
          })),
        },
        {
          name: 'Расходы',
          rows: report.expenses.map((e) => ({
            Тип: e.expense_type_name,
            'Сумма (USD)': Number(e.amount_usd),
            Комментарий: e.comment || '',
          })),
        },
      ]);
    }
    res.json(report);
  })
);

// раздел 17 ТЗ: отчёт по складу
router.get(
  '/warehouses/:id',
  asyncHandler(async (req, res) => {
    const report = await reports.getWarehouseReport(req.params.id);
    if (!report) return res.status(404).json({ error: 'Склад не найден' });

    if (req.query.format === 'xlsx') {
      return sendExcel(res, `warehouse-${report.warehouse.id}.xlsx`, [
        {
          name: 'Рейсы',
          rows: report.shipments.map((s) => ({
            Рейс: s.shipment_number,
            Статус: s.status,
            Отправка: s.departure_date,
            Прибытие: s.arrival_date,
            'Вес (кг)': Number(s.total_weight_kg),
            'Объём (м3)': Number(s.total_volume_m3),
            'Доход (USD)': Number(s.revenue_usd),
          })),
        },
      ]);
    }
    res.json(report);
  })
);

// раздел 17 ТЗ: отчёт за период (также покрывает "отчёт по прибыли")
router.get(
  '/period',
  asyncHandler(async (req, res) => {
    const { from, to } = req.query;
    if (!from || !to) return res.status(400).json({ error: 'from и to обязательны (YYYY-MM-DD)' });

    const report = await reports.getPeriodReport(from, to);

    if (req.query.format === 'xlsx') {
      return sendExcel(res, `period-${from}_${to}.xlsx`, [
        {
          name: 'Сводка',
          rows: [
            {
              Период: `${from} — ${to}`,
              'Доход (USD)': report.revenueUsd,
              'Расход (USD)': report.expensesUsd,
              'Прибыль (USD)': report.profitUsd,
            },
          ],
        },
        {
          name: 'Рейсы',
          rows: report.shipments.map((s) => ({
            Рейс: s.shipment_number,
            Склад: s.warehouse_name,
            Отправка: s.departure_date,
            Прибытие: s.arrival_date,
            'Доход (USD)': Number(s.revenue_usd),
            'Расход (USD)': Number(s.expenses_usd),
          })),
        },
      ]);
    }
    res.json(report);
  })
);

// раздел 17 ТЗ: отчёт по прибыли — тот же расчёт, что и период, отдельный алиас по названию из ТЗ
router.get(
  '/profit',
  asyncHandler(async (req, res) => {
    const { from, to } = req.query;
    if (!from || !to) return res.status(400).json({ error: 'from и to обязательны (YYYY-MM-DD)' });
    res.json(await reports.getPeriodReport(from, to));
  })
);

// раздел 17 ТЗ: отчёт по задолженности
router.get(
  '/debt',
  asyncHandler(async (req, res) => {
    const rows = await reports.getDebtReport();

    if (req.query.format === 'xlsx') {
      return sendExcel(res, 'debt.xlsx', [
        {
          name: 'Задолженность',
          rows: rows.map((r) => ({
            Код: r.code,
            ФИО: r.full_name,
            Телефон: r.phone,
            'Стоимость (USD)': Number(r.total_cost_usd),
            'Оплачено (USD)': Number(r.total_paid_usd),
            'Входящий долг (USD)': Number(r.opening_balance_usd),
            'Долг (USD)': Number(r.debt_usd),
          })),
        },
      ]);
    }
    res.json(rows);
  })
);

// раздел 17 ТЗ: отчёт по расходам
router.get(
  '/expenses',
  asyncHandler(async (req, res) => {
    const { from, to, shipment_id: shipmentId, scope } = req.query;
    const report = await reports.getExpensesReport({ from, to, shipmentId, scope });

    if (req.query.format === 'xlsx') {
      return sendExcel(res, 'expenses.xlsx', [
        {
          name: 'Расходы по типам',
          rows: [
            ...report.byType.map((r) => ({
              Тип: r.expense_type_name,
              Количество: r.entries_count,
              'Сумма (USD)': Number(r.total_usd),
            })),
            { Тип: 'ИТОГО', Количество: '', 'Сумма (USD)': report.totalUsd },
          ],
        },
      ]);
    }
    res.json(report);
  })
);

module.exports = router;
