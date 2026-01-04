import { Router } from 'express';
import { CustomerCreditsController } from '../controllers/CustomerCreditsController';
import { authenticate } from '../middleware/auth';
import { requireManager } from '../middleware/authorize';

const router = Router();

// All routes require authentication and manager role
router.use(authenticate);
router.use(requireManager);

// GET /api/customer-credits/overdue - Get overdue customers (specific routes first)
router.get('/overdue', CustomerCreditsController.getOverdueCustomers);

// GET /api/customer-credits/summary - Get credit summary report
router.get('/summary', CustomerCreditsController.getCreditSummary);

// GET /api/customer-credits/customers - Get all customers with credit balances
router.get('/customers', CustomerCreditsController.getCustomersWithCredit);

// GET /api/customer-credits - Get customer credits (query param: customerId)
router.get('/', CustomerCreditsController.getCustomerCredits);

// POST /api/customer-credits - Create customer credit transaction (LIABILITY tracking)
router.post('/', CustomerCreditsController.createCredit);

export default router;

