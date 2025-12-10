import { Router } from 'express';
import { CashTransactionsController } from '../controllers/CashTransactionsController';
import { authenticate } from '../middleware/auth';

const router = Router();

// All routes require authentication
router.use(authenticate);

// GET /api/cash-transactions - Get transactions
// All authenticated users (including cashiers) can view transactions
router.get('/', CashTransactionsController.getTransactions);

// POST /api/cash-transactions - Create transaction
// All authenticated users (including cashiers) can create cash in/out transactions
// This is a standard POS operation that cashiers need for daily operations
router.post('/', CashTransactionsController.createTransaction);

export default router;


