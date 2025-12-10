import { Router } from 'express';
import { AuditLogsController } from '../controllers/AuditLogsController';
import { authenticate } from '../middleware/auth';
import { requireManager, checkManagerPermission } from '../middleware/authorize';

const router = Router();

// All routes require authentication and manager role
router.use(authenticate);
router.use(requireManager);

// GET /api/audit-logs - Get audit logs
router.get('/', checkManagerPermission('canViewAuditLogs'), AuditLogsController.getAuditLogs);

export default router;


