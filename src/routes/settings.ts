import { Router } from 'express';
import { SettingsController } from '../controllers/SettingsController';
import { authenticate } from '../middleware/auth';
import { requireAdmin } from '../middleware/authorize';

const router = Router();

// All routes require authentication
router.use(authenticate);

// GET /api/settings - Get all system settings
router.get('/', SettingsController.getSettings);

// PUT /api/settings/business - Update business settings
router.put('/business', requireAdmin, SettingsController.updateBusinessSettings);

// PUT /api/settings/printer - Update printer settings
router.put('/printer', requireAdmin, SettingsController.updatePrinterSettings);

export default router;
