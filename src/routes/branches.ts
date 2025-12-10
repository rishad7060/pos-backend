import { Router } from 'express';
import { BranchesController } from '../controllers/StubControllers';
import { authenticate } from '../middleware/auth';
import { requireAdmin } from '../middleware/authorize';

const router = Router();

router.use(authenticate);
router.use(requireAdmin);

router.get('/', BranchesController.getBranches);
router.post('/', BranchesController.createBranch);

export default router;


