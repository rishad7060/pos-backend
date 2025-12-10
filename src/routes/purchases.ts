import { Router } from 'express';
import { PurchasesController } from '../controllers/PurchasesController';
import { authenticate } from '../middleware/auth';
import { requireManager, checkManagerPermission } from '../middleware/authorize';

const router = Router();

// All routes require authentication and manager role
router.use(authenticate);
router.use(requireManager);

// GET /api/purchases - Get purchases
router.get('/', checkManagerPermission('canViewPurchases'), PurchasesController.getPurchases);

// POST /api/purchases - Create purchase order
router.post('/', checkManagerPermission('canCreatePurchases'), PurchasesController.createPurchase);

// PUT /api/purchases?id=X - Update purchase
router.put('/', checkManagerPermission('canEditPurchases'), PurchasesController.updatePurchase);

export default router;
