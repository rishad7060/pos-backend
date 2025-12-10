import { Router } from 'express';
import { OrdersController } from '../controllers/OrdersController';
import { authenticate } from '../middleware/auth';
import { requireCashier, requireAdmin } from '../middleware/authorize';
import { orderCreationLimiter } from '../middleware/rate-limit';

const router = Router();

// All routes require authentication
router.use(authenticate);

// GET /api/orders - Get orders (both admin and cashier can access)
// Admin sees all orders, cashiers see only their own (handled in controller)
router.get('/', OrdersController.getOrders);

// POST /api/orders - Create new order (cashier+ required)
router.post('/', requireCashier, orderCreationLimiter, OrdersController.createOrder);

// GET /api/orders/profit-details - Get order profit/loss details (admin only)
router.get('/profit-details', requireAdmin, OrdersController.getOrderProfitDetails);

export default router;


