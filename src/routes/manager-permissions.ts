import { Router } from 'express';
import { ManagerPermissionsController } from '../controllers/StubControllers';
import { authenticate } from '../middleware/auth';
import { requireAdmin } from '../middleware/authorize';

const router = Router();

// All routes require authentication and admin role
router.use(authenticate);
router.use(requireAdmin);

// GET /api/manager-permissions - Get manager permissions
router.get('/', ManagerPermissionsController.getPermissions);

// POST /api/manager-permissions - Create manager permissions
router.post('/', ManagerPermissionsController.createPermission);

// PUT /api/manager-permissions?id=X - Update manager permissions
router.put('/', ManagerPermissionsController.updatePermission);

export default router;
