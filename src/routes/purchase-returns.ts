import { Router } from 'express';
import { PurchaseReturnsController } from '../controllers/PurchaseReturnsController';
import { authenticate } from '../middleware/auth';
import { requireAdmin } from '../middleware/authorize';

const router = Router();

// All routes require authentication and admin role
router.use(authenticate);
router.use(requireAdmin);

// GET /api/purchase-returns - Get purchase returns
router.get('/', PurchaseReturnsController.getReturns);

// POST /api/purchase-returns - Create purchase return
router.post('/', PurchaseReturnsController.createReturn);

export default router;
