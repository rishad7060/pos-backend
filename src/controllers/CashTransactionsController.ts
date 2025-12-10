import { Response } from 'express';
import { prisma } from '../models/db';
import { AuthRequest } from '../middleware/auth';
import { decimalToNumber } from '../utils/decimal';
import { RegistrySessionsController } from './RegistrySessionsController';

export class CashTransactionsController {
  static async getTransactions(req: AuthRequest, res: Response) {
    try {
      const { registrySessionId, transactionType, startDate, limit = 100 } = req.query;

      const where: any = {};

      // Filter by registry session if provided
      if (registrySessionId) {
        const sessionId = parseInt(registrySessionId as string);
        if (!isNaN(sessionId)) {
          where.registrySessionId = sessionId;
        }
      }

      // Filter by transaction type if provided
      if (transactionType) {
        where.transactionType = transactionType;
      }

      // Filter by start date if provided
      if (startDate) {
        where.createdAt = {
          gte: new Date(startDate as string),
        };
      }

      const take = Math.min(parseInt(limit as string) || 100, 1000);

      const transactions = await prisma.cashTransaction.findMany({
        where,
        include: {
          cashier: {
            select: { id: true, fullName: true, email: true },
          },
          registrySession: {
            select: { id: true, sessionNumber: true },
          },
          approvedByUser: {
            select: { id: true, fullName: true, email: true },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
        take,
      });

      // Convert Decimal types to numbers
      const serialized = transactions.map(transaction => ({
        ...transaction,
        amount: decimalToNumber(transaction.amount) ?? 0,
        cashierName: transaction.cashier.fullName,
        cashierEmail: transaction.cashier.email,
        sessionNumber: transaction.registrySession.sessionNumber,
        approverName: transaction.approvedByUser?.fullName || null,
        approverEmail: transaction.approvedByUser?.email || null,
      }));

      return res.json(serialized);
    } catch (error) {
      console.error('Get cash transactions error:', error);
      return res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
      });
    }
  }

  static async createTransaction(req: AuthRequest, res: Response) {
    try {
      const {
        registrySessionId,
        cashierId,
        transactionType,
        amount,
        reason,
        reference,
        notes,
        approvedBy
      } = req.body;

      // Validation
      if (!registrySessionId || !cashierId || !transactionType || !amount || !reason) {
        return res.status(400).json({
          error: 'Registry session ID, cashier ID, transaction type, amount, and reason are required',
          code: 'MISSING_REQUIRED_FIELDS',
        });
      }

      if (!['cash_in', 'cash_out'].includes(transactionType)) {
        return res.status(400).json({
          error: 'Transaction type must be either "cash_in" or "cash_out"',
          code: 'INVALID_TRANSACTION_TYPE',
        });
      }

      const sessionId = parseInt(registrySessionId);
      const cashierIdNum = parseInt(cashierId);
      const amountNum = parseFloat(amount);
      const approvedByNum = approvedBy ? parseInt(approvedBy) : null;

      if (isNaN(sessionId) || isNaN(cashierIdNum) || isNaN(amountNum)) {
        return res.status(400).json({
          error: 'Invalid registry session ID, cashier ID, or amount',
          code: 'INVALID_DATA',
        });
      }

      // Validate that registry session exists and is open
      const session = await prisma.registrySession.findUnique({
        where: { id: sessionId },
        select: { id: true, status: true, sessionNumber: true },
      });

      if (!session) {
        return res.status(404).json({
          error: 'Registry session not found',
          code: 'SESSION_NOT_FOUND',
        });
      }

      if (session.status !== 'open') {
        return res.status(400).json({
          error: 'Cannot create cash transaction for closed registry session',
          code: 'SESSION_CLOSED',
        });
      }

      // Validate that cashier exists
      const cashier = await prisma.user.findUnique({
        where: { id: cashierIdNum },
        select: { id: true, role: true, isActive: true },
      });

      if (!cashier || cashier.role !== 'cashier' || !cashier.isActive) {
        return res.status(400).json({
          error: 'Invalid or inactive cashier',
          code: 'INVALID_CASHIER',
        });
      }

      const transaction = await prisma.cashTransaction.create({
        data: {
          registrySessionId: sessionId,
          cashierId: cashierIdNum,
          transactionType,
          amount: amountNum,
          reason,
          reference: reference || null,
          notes: notes || null,
          approvedBy: approvedByNum,
        },
        include: {
          cashier: {
            select: { id: true, fullName: true, email: true },
          },
          registrySession: {
            select: { id: true, sessionNumber: true },
          },
          approvedByUser: {
            select: { id: true, fullName: true, email: true },
          },
        },
      });

      // Update registry session stats after cash transaction
      try {
        // Get the session date range for stats update
        const session = await prisma.registrySession.findUnique({
          where: { id: sessionId },
          select: { sessionDate: true },
        });

        if (session) {
          const sessionDate = new Date(session.sessionDate);
          sessionDate.setHours(0, 0, 0, 0);
          const sessionDateEnd = new Date(sessionDate);
          sessionDateEnd.setDate(sessionDateEnd.getDate() + 1);

          // Update session stats synchronously to ensure data consistency
          await RegistrySessionsController.updateSessionStats(sessionId, sessionDate, sessionDateEnd);
        }
      } catch (error) {
        console.error('Error triggering registry session stats update:', error);
        // Don't fail the transaction if stats update fails
      }

      // Convert Decimal types to numbers
      const serialized = {
        ...transaction,
        amount: decimalToNumber(transaction.amount) ?? 0,
        cashierName: transaction.cashier.fullName,
        cashierEmail: transaction.cashier.email,
        sessionNumber: transaction.registrySession.sessionNumber,
        approverName: transaction.approvedByUser?.fullName || null,
        approverEmail: transaction.approvedByUser?.email || null,
      };

      return res.status(201).json(serialized);
    } catch (error: any) {
      console.error('Create cash transaction error:', error);

      if (error.code === 'P2003') {
        return res.status(400).json({
          error: 'Invalid registry session ID, cashier ID, or approver ID',
          code: 'INVALID_REFERENCE',
        });
      }

      return res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
      });
    }
  }
}


