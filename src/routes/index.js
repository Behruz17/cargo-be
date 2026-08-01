const { Router } = require('express');
const authRoutes = require('./auth.routes');
const warehouseRoutes = require('./warehouses.routes');
const clientRoutes = require('./clients.routes');
const shipmentRoutes = require('./shipments.routes');
const cargoRoutes = require('./cargo.routes');
const paymentRoutes = require('./payments.routes');
const expenseTypeRoutes = require('./expenseTypes.routes');
const expenseRoutes = require('./expenses.routes');
const financeRoutes = require('./finance.routes');
const userRoutes = require('./users.routes');
const meRoutes = require('./me.routes');
const searchRoutes = require('./search.routes');
const reportRoutes = require('./reports.routes');
const dashboardRoutes = require('./dashboard.routes');

const router = Router();

router.use('/auth', authRoutes);
router.use('/warehouses', warehouseRoutes);
router.use('/clients', clientRoutes);
router.use('/shipments', shipmentRoutes);
router.use('/cargo', cargoRoutes);
router.use('/payments', paymentRoutes);
router.use('/expense-types', expenseTypeRoutes);
router.use('/expenses', expenseRoutes);
router.use('/finance', financeRoutes);
router.use('/users', userRoutes);
router.use('/me', meRoutes);
router.use('/search', searchRoutes);
router.use('/reports', reportRoutes);
router.use('/dashboard', dashboardRoutes);

module.exports = router;
