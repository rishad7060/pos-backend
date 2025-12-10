import { Router } from 'express';
import { CashiersController } from '../controllers/StubControllers';
import { authenticate } from '../middleware/auth';
import { requireAdmin } from '../middleware/authorize';

const router = Router();

router.use(authenticate);
router.use(requireAdmin);

router.get('/', CashiersController.getCashiers);
router.post('/', CashiersController.createCashier);
router.put('/', CashiersController.updateCashier);

export default router;


