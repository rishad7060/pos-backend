import { Router } from 'express';
import { ChequesController } from '../controllers/ChequesController';
import { authenticate } from '../middleware/auth';
import { requireManager } from '../middleware/authorize';

const router = Router();

// All routes require authentication and manager role
router.use(authenticate);
router.use(requireManager);

// GET /api/cheques/stats - Get cheque statistics (specific route first)
router.get('/stats', ChequesController.getChequeStats);

// GET /api/cheques/reminders - Get cheques needing reminder
router.get('/reminders', ChequesController.getChequesNeedingReminder);

// GET /api/cheques/:id - Get a single cheque by ID (specific route before generic)
router.get('/:id', ChequesController.getChequeById);

// GET /api/cheques - Get all cheques with optional filters
router.get('/', ChequesController.getCheques);

// POST /api/cheques - Create a new cheque record
router.post('/', ChequesController.createCheque);

// PUT /api/cheques/:id/status - Update cheque status
router.put('/:id/status', ChequesController.updateChequeStatus);

// PUT /api/cheques/:id/cancel - Cancel a cheque
router.put('/:id/cancel', ChequesController.cancelCheque);

// PUT /api/cheques/:id/endorse - Endorse a cheque to another party
router.put('/:id/endorse', ChequesController.endorseCheque);

export default router;
