import { Router } from 'express';
import { ExpenseCategoriesController } from '../controllers/ExpensesController';
import { authenticate } from '../middleware/auth';
import { requireAdmin } from '../middleware/authorize';

const router = Router();

// All routes require authentication and admin role
router.use(authenticate);
router.use(requireAdmin);

// GET /api/expense-categories - Get expense categories
router.get('/', ExpenseCategoriesController.getCategories);

// POST /api/expense-categories - Create expense category
router.post('/', ExpenseCategoriesController.createCategory);

export default router;


