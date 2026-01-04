import { Router } from 'express';
import { SupplierCreditsController } from '../controllers/SupplierCreditsController';
import { authenticate } from '../middleware/auth';
import { requireManager } from '../middleware/authorize';

const router = Router();

// All routes require authentication and manager role
router.use(authenticate);
router.use(requireManager);

// GET /api/supplier-credits - Get supplier credit history
router.get('/', SupplierCreditsController.getSupplierCredits);

// GET /api/supplier-credits/balance - Get current supplier balance
router.get('/balance', SupplierCreditsController.getSupplierBalance);

// POST /api/supplier-credits/recalculate - Recalculate supplier balance from ledger
router.post('/recalculate', SupplierCreditsController.recalculateBalance);

// POST /api/supplier-credits/payment - Record payment with FIFO allocation
router.post('/payment', SupplierCreditsController.recordPayment);

// POST /api/supplier-credits - Create supplier credit transaction (manual admin entry)
router.post('/', SupplierCreditsController.createCredit);

// DELETE /api/supplier-credits/:id - Delete a supplier credit transaction (RESTful)
router.delete('/:id', SupplierCreditsController.deleteCredit);

export default router;
