import { Router } from 'express';
import { PurchasePaymentsController } from '../controllers/PurchasesController';
import { authenticate } from '../middleware/auth';
import { requireAdmin } from '../middleware/authorize';

const router = Router();

// All routes require authentication and admin role
router.use(authenticate);
router.use(requireAdmin);

// GET /api/purchase-payments - Get purchase payments
router.get('/', PurchasePaymentsController.getPayments);

// POST /api/purchase-payments - Create purchase payment
router.post('/', PurchasePaymentsController.createPayment);

export default router;

