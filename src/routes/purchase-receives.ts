import { Router } from 'express';
import { PurchaseReceivesController } from '../controllers/PurchasesController';
import { authenticate } from '../middleware/auth';
import { requireAdmin } from '../middleware/authorize';

const router = Router();

// All routes require authentication and admin role
router.use(authenticate);
router.use(requireAdmin);

// GET /api/purchase-receives - Get purchase receives
router.get('/', PurchaseReceivesController.getReceives);

// POST /api/purchase-receives - Create purchase receive
router.post('/', PurchaseReceivesController.createReceive);

export default router;

