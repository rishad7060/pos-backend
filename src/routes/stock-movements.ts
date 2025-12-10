import { Router } from 'express';
import { StockMovementsController } from '../controllers/StockMovementsController';
import { authenticate } from '../middleware/auth';
import { requireManager } from '../middleware/authorize';

const router = Router();

// All routes require authentication
router.use(authenticate);

// GET /api/stock-movements - Get stock movements
router.get('/', requireManager, StockMovementsController.getStockMovements);

// POST /api/stock-movements - Create stock movement (manual stock adjustment)
router.post('/', requireManager, StockMovementsController.createStockMovement);

export default router;
