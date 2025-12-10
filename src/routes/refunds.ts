import { Router } from 'express';
import { RefundsController } from '../controllers/RefundsController';
import { authenticate } from '../middleware/auth';
import { requireCashier } from '../middleware/authorize';

const router = Router();

// All routes require authentication
router.use(authenticate);

// GET /api/refunds - Get refunds
router.get('/', requireCashier, RefundsController.getRefunds);

// GET /api/refunds/refundable-items - Get refundable items for an order
router.get('/refundable-items', requireCashier, RefundsController.getRefundableItems);

// POST /api/refunds - Create refund
router.post('/', requireCashier, RefundsController.createRefund);

// PUT /api/refunds?id=X - Update refund
router.put('/', requireCashier, RefundsController.updateRefund);

// DELETE /api/refunds?id=X - Delete refund
router.delete('/', requireCashier, RefundsController.deleteRefund);

export default router;

