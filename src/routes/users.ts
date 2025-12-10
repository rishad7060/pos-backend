import { Router } from 'express';
import { UsersController } from '../controllers/UsersController';
import { authenticate } from '../middleware/auth';
import { requireAdmin } from '../middleware/authorize';

const router = Router();

// All routes require authentication and admin role
router.use(authenticate);
router.use(requireAdmin);

// GET /api/users - Get all users
router.get('/', UsersController.getUsers);

// POST /api/users - Create new user
router.post('/', UsersController.createUser);

// PUT /api/users/:id - Update user
router.put('/:id', UsersController.updateUser);

export default router;


