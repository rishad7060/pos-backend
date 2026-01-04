import { Router } from 'express';
import { ReportsController } from '../controllers/ReportsController';
import { authenticate } from '../middleware/auth';
import { requireAdmin } from '../middleware/authorize';

const router = Router();

// All routes require authentication and admin role
router.use(authenticate);
router.use(requireAdmin);

// GET /api/reports/profit-analysis - Get profit analysis
router.get('/profit-analysis', ReportsController.getProfitAnalysis);

// GET /api/reports/profit-loss - Get comprehensive Profit & Loss statement
router.get('/profit-loss', ReportsController.getProfitLossStatement);

export default router;

