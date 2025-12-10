import { Router } from 'express';
import { PrinterSettingsController } from '../controllers/PrinterSettingsController';
import { authenticate } from '../middleware/auth';
import { requireCashier } from '../middleware/authorize';

const router = Router();

router.use(authenticate);
router.use(requireCashier);

router.get('/', PrinterSettingsController.getSettings);
router.put('/', PrinterSettingsController.updateSettings);
router.post('/', PrinterSettingsController.updateSettings);

export default router;


