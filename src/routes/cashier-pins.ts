import { Router } from 'express';
import { CashierPinsController } from '../controllers/StubControllers';
import { authenticate } from '../middleware/auth';
import { requireAdmin } from '../middleware/authorize';

const router = Router();

router.use(authenticate);
router.use(requireAdmin);

router.get('/', CashierPinsController.getPins);
router.post('/', CashierPinsController.createPin);
router.put('/', CashierPinsController.updatePin);
router.delete('/', CashierPinsController.deletePin);

export default router;


