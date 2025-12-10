import { Router } from 'express';
import { CustomerCreditsController } from '../controllers/CustomerCreditsController';
import { authenticate } from '../middleware/auth';
import { requireManager } from '../middleware/authorize';

const router = Router();

// All routes require authentication and manager role
router.use(authenticate);
router.use(requireManager);

// GET /api/customer-credits - Get customer credits
router.get('/', CustomerCreditsController.getCustomerCredits);

// POST /api/customer-credits - Create customer credit transaction
router.post('/', CustomerCreditsController.createCredit);

export default router;

