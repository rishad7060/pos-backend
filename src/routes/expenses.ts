import { Router } from 'express';
import { ExpensesController, ExpenseCategoriesController } from '../controllers/ExpensesController';
import { authenticate } from '../middleware/auth';
import { requireManager, checkManagerPermission } from '../middleware/authorize';

const router = Router();

// All routes require authentication and manager role
router.use(authenticate);
router.use(requireManager);

// GET /api/expenses - Get expenses
router.get('/', checkManagerPermission('canViewExpenses'), ExpensesController.getExpenses);

// POST /api/expenses - Create expense
router.post('/', checkManagerPermission('canCreateExpenses'), ExpensesController.createExpense);

// PUT /api/expenses?id=X - Update expense
router.put('/', checkManagerPermission('canEditExpenses'), ExpensesController.updateExpense);

// DELETE /api/expenses?id=X - Delete expense
router.delete('/', checkManagerPermission('canDeleteExpenses'), ExpensesController.deleteExpense);

// GET /api/expenses/summary - Get expense summary
router.get('/summary', checkManagerPermission('canViewExpenses'), ExpensesController.getSummary);

// GET /api/expenses/financial-summary - Get comprehensive financial summary
router.get('/financial-summary', checkManagerPermission('canViewFinancialSummary'), ExpensesController.getFinancialSummary);

// GET /api/expense-categories - Get expense categories
router.get('/categories', checkManagerPermission('canViewExpenses'), ExpenseCategoriesController.getCategories);

// POST /api/expense-categories - Create expense category
router.post('/categories', checkManagerPermission('canCreateExpenses'), ExpenseCategoriesController.createCategory);

// PUT /api/expense-categories?id=X - Update expense category
router.put('/categories', checkManagerPermission('canEditExpenses'), ExpenseCategoriesController.updateCategory);

// DELETE /api/expense-categories?id=X - Delete expense category
router.delete('/categories', checkManagerPermission('canDeleteExpenses'), ExpenseCategoriesController.deleteCategory);

export default router;

