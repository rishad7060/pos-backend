import { Router } from 'express';
import { ShiftsController, UserSessionsController } from '../controllers/StubControllers';
import { authenticate } from '../middleware/auth';
import { requireManager, checkManagerPermission } from '../middleware/authorize';

const router = Router();

router.use(authenticate);
router.use(requireManager);

// Cashier shifts routes
router.get('/shifts', checkManagerPermission('canViewShifts'), ShiftsController.getShifts);
router.put('/shifts', checkManagerPermission('canViewShifts'), ShiftsController.updateShift);

// User sessions routes
router.get('/sessions', checkManagerPermission('canViewUserSessions'), UserSessionsController.getUserSessions);
router.post('/sessions/login', checkManagerPermission('canViewUserSessions'), UserSessionsController.recordLogin);
router.post('/sessions/logout', checkManagerPermission('canViewUserSessions'), UserSessionsController.recordLogout);
router.post('/sessions/registry-open', checkManagerPermission('canViewUserSessions'), UserSessionsController.recordRegistryOpen);

// Legacy route for backward compatibility
router.get('/', checkManagerPermission('canViewShifts'), ShiftsController.getShifts);
router.put('/', checkManagerPermission('canViewShifts'), ShiftsController.updateShift);

export default router;


