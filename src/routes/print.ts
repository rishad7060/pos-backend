import { Router } from 'express';
import { PrintController } from '../controllers/StubControllers';
import { authenticate } from '../middleware/auth';
import { requireCashier } from '../middleware/authorize';

const router = Router();

router.use(authenticate);
router.use(requireCashier);

router.post('/', PrintController.print);

export default router;


