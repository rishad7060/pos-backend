import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { apiLimiter } from './middleware/rate-limit';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'https://pos.focaldive.io',
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Apply rate limiting to all /api routes
app.use('/api', apiLimiter);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API Routes
import authRoutes from './routes/auth';
import ordersRoutes from './routes/orders';
import usersRoutes from './routes/users';
import productsRoutes from './routes/products';
import dashboardRoutes from './routes/dashboard';
import customersRoutes from './routes/customers';
import categoriesRoutes from './routes/categories';
import suppliersRoutes from './routes/suppliers';
import expensesRoutes from './routes/expenses';
import expenseCategoriesRoutes from './routes/expense-categories';
import purchasesRoutes from './routes/purchases';
import purchasePaymentsRoutes from './routes/purchase-payments';
import purchaseReceivesRoutes from './routes/purchase-receives';
import reportsRoutes from './routes/reports';
import priceHistoryRoutes from './routes/price-history';
import auditLogsRoutes from './routes/audit-logs';
import customerCreditsRoutes from './routes/customer-credits';
import supplierCreditsRoutes from './routes/supplier-credits';
import registrySessionsRoutes from './routes/registry-sessions';
import cashTransactionsRoutes from './routes/cash-transactions';
import refundsRoutes from './routes/refunds';
import shiftsRoutes from './routes/shifts';
import branchesRoutes from './routes/branches';
import cashiersRoutes from './routes/cashiers';
import cashierPinsRoutes from './routes/cashier-pins';
import cashierPermissionsRoutes from './routes/cashier-permissions';
import managerPermissionsRoutes from './routes/manager-permissions';
import printerSettingsRoutes from './routes/printer-settings';
import uploadLogoRoutes from './routes/upload-logo';
import printRoutes from './routes/print';
import paymentDetailsRoutes from './routes/payment-details';
import settingsRoutes from './routes/settings';
import stockMovementsRoutes from './routes/stock-movements';
import chequesRoutes from './routes/cheques';

app.use('/api/auth', authRoutes);
app.use('/api/orders', ordersRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/products', productsRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/customers', customersRoutes);
app.use('/api/categories', categoriesRoutes);
app.use('/api/suppliers', suppliersRoutes);
app.use('/api/expenses', expensesRoutes);
app.use('/api/expense-categories', expenseCategoriesRoutes);
app.use('/api/purchases', purchasesRoutes);
app.use('/api/purchase-payments', purchasePaymentsRoutes);
app.use('/api/purchase-receives', purchaseReceivesRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/price-history', priceHistoryRoutes);
app.use('/api/audit-logs', auditLogsRoutes);
app.use('/api/customer-credits', customerCreditsRoutes);
app.use('/api/supplier-credits', supplierCreditsRoutes);
app.use('/api/registry-sessions', registrySessionsRoutes);
app.use('/api/cash-transactions', cashTransactionsRoutes);
app.use('/api/refunds', refundsRoutes);
app.use('/api/shifts', shiftsRoutes);
app.use('/api/branches', branchesRoutes);
app.use('/api/cashiers', cashiersRoutes);
app.use('/api/cashier-pins', cashierPinsRoutes);
app.use('/api/cashier-permissions', cashierPermissionsRoutes);
app.use('/api/manager-permissions', managerPermissionsRoutes);
app.use('/api/printer-settings', printerSettingsRoutes);
app.use('/api/upload-logo', uploadLogoRoutes);
app.use('/api/print', printRoutes);
app.use('/api/payment-details', paymentDetailsRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/stock-movements', stockMovementsRoutes);
app.use('/api/cheques', chequesRoutes);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Route not found',
    code: 'NOT_FOUND'
  });
});

// Error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({
    error: 'Internal server error',
    code: 'INTERNAL_ERROR'
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Backend server running on http://localhost:${PORT}`);
});

export default app;
