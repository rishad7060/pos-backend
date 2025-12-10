import { Router } from 'express';
import { CashierPermissionsController } from '../controllers/StubControllers';
import { authenticate } from '../middleware/auth';
import { requireAdmin } from '../middleware/authorize';

const router = Router();

router.use(authenticate);

// GET /api/cashier-permissions - Get permissions (any authenticated user)
router.get('/', CashierPermissionsController.getPermissions);

// POST /api/cashier-permissions - Create permissions (admin only)
router.post('/', requireAdmin, CashierPermissionsController.createPermission);

// PUT /api/cashier-permissions?id=X - Update permissions (admin only)
router.put('/', requireAdmin, CashierPermissionsController.updatePermission);

export default router;

