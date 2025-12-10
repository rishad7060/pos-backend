import { Router } from 'express';
import { AuthController } from '../controllers/AuthController';
import { UserSessionsController } from '../controllers/StubControllers';
import { authenticate } from '../middleware/auth';
import { authLimiter, pinAuthLimiter } from '../middleware/rate-limit';

const router = Router();

// POST /api/auth/login - stricter rate limiting for password login
router.post('/login', authLimiter, AuthController.login);

// POST /api/auth/register - stricter rate limiting
router.post('/register', authLimiter, AuthController.register);

// POST /api/auth/pin-login - very strict rate limiting (only 3 attempts per 15 min)
router.post('/pin-login', pinAuthLimiter, AuthController.pinLogin);

// POST /api/auth/logout (requires authentication to record session)
router.post('/logout', authenticate, UserSessionsController.recordLogout);

export default router;



