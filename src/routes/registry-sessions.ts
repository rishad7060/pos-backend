import { Router } from 'express';
import { RegistrySessionsController } from '../controllers/RegistrySessionsController';
import { authenticate } from '../middleware/auth';
import { requireAdmin, requireCashier, requireManager, checkManagerPermission } from '../middleware/authorize';

const router = Router();

// All routes require authentication
router.use(authenticate);

// GET /api/registry-sessions/current - Get current session
router.get('/current', RegistrySessionsController.getCurrentSession);

// GET /api/registry-sessions - Get all sessions
router.get('/', requireManager, checkManagerPermission('canViewRegistrySessions'), RegistrySessionsController.getSessions);

// POST /api/registry-sessions - Create session
router.post('/', requireCashier, RegistrySessionsController.createSession);

// PUT /api/registry-sessions?id=X - Update session (close session)
// TEAM_003: Allow cashiers to close registry (changed from requireManager)
router.put('/', requireCashier, RegistrySessionsController.updateSession);

// POST /api/registry-sessions/cleanup - Cleanup old sessions (admin only)
router.post('/cleanup', requireAdmin, RegistrySessionsController.cleanupOldSessions);

export default router;


