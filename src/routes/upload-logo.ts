import { Router } from 'express';
import { UploadController } from '../controllers/StubControllers';
import { authenticate } from '../middleware/auth';
import { requireAdmin } from '../middleware/authorize';

const router = Router();

router.use(authenticate);
router.use(requireAdmin);

router.post('/', UploadController.uploadLogo);
router.delete('/', UploadController.deleteLogo);

export default router;


