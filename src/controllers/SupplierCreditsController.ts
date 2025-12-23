import { Response } from 'express';
import { prisma } from '../models/db';
import { AuthRequest } from '../middleware/auth';
import { decimalToNumber } from '../utils/decimal';

export class SupplierCreditsController {
  /**
   * Get all credit/debit transactions for a specific supplier
   */
  static async getSupplierCredits(req: AuthRequest, res: Response) {
    try {
      const { supplierId, limit = 50 } = req.query;

      if (!supplierId) {
        return res.status(400).json({
          error: 'Supplier ID is required',
          code: 'MISSING_SUPPLIER_ID',
        });
      }

      const supplierIdNum = parseInt(supplierId as string);
      if (isNaN(supplierIdNum)) {
        return res.status(400).json({
          error: 'Invalid supplier ID',
          code: 'INVALID_SUPPLIER_ID',
        });
      }

      const take = Math.min(parseInt(limit as string) || 50, 1000);

      const credits = await prisma.supplierCredit.findMany({
        where: {
          supplierId: supplierIdNum,
        },
        include: {
          user: {
            select: { id: true, fullName: true, email: true },
          },
          purchase: {
            select: { id: true, purchaseNumber: true, total: true, status: true },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
        take,
      });

      // Convert Decimal types to numbers
      const serialized = credits.map(credit => ({
        ...credit,
        amount: decimalToNumber(credit.amount) ?? 0,
        balance: decimalToNumber(credit.balance) ?? 0,
        purchase: credit.purchase ? {
          ...credit.purchase,
          total: decimalToNumber(credit.purchase.total) ?? 0,
        } : null,
      }));

      return res.json(serialized);
    } catch (error) {
      console.error('Get supplier credits error:', error);
      return res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * Get current outstanding balance for a supplier
   */
  static async getSupplierBalance(req: AuthRequest, res: Response) {
    try {
      const { supplierId } = req.query;

      if (!supplierId) {
        return res.status(400).json({
          error: 'Supplier ID is required',
          code: 'MISSING_SUPPLIER_ID',
        });
      }

      const supplierIdNum = parseInt(supplierId as string);
      if (isNaN(supplierIdNum)) {
        return res.status(400).json({
          error: 'Invalid supplier ID',
          code: 'INVALID_SUPPLIER_ID',
        });
      }

      // Get the latest credit record to get the current balance
      const latestCredit = await prisma.supplierCredit.findFirst({
        where: { supplierId: supplierIdNum },
        orderBy: { createdAt: 'desc' },
        select: { balance: true },
      });

      const balance = latestCredit
        ? decimalToNumber(latestCredit.balance) ?? 0
        : 0;

      return res.json({ balance });
    } catch (error) {
      console.error('Get supplier balance error:', error);
      return res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * Create a new credit/debit transaction (manual admin entry)
   */
  static async createCredit(req: AuthRequest, res: Response) {
    try {
      const { supplierId, purchaseId, transactionType, amount, description } = req.body;

      if (!supplierId || !transactionType || amount === undefined) {
        return res.status(400).json({
          error: 'Supplier ID, transaction type, and amount are required',
          code: 'MISSING_REQUIRED_FIELDS',
        });
      }

      const supplierIdNum = parseInt(supplierId);
      let amountNum = parseFloat(amount);

      if (isNaN(supplierIdNum) || isNaN(amountNum)) {
        return res.status(400).json({
          error: 'Invalid supplier ID or amount',
          code: 'INVALID_DATA',
        });
      }

      // Validate transaction type
      const validTypes = ['credit', 'debit', 'admin_credit'];
      if (!validTypes.includes(transactionType)) {
        return res.status(400).json({
          error: 'Invalid transaction type. Must be: credit, debit, or admin_credit',
          code: 'INVALID_TRANSACTION_TYPE',
        });
      }

      // CRITICAL FIX: Enforce sign convention for data integrity
      // admin_credit = we owe more (POSITIVE amount increases outstanding)
      // debit = payment made (NEGATIVE amount decreases outstanding)
      if (transactionType === 'admin_credit') {
        amountNum = Math.abs(amountNum); // Ensure positive
      } else if (transactionType === 'debit') {
        amountNum = -Math.abs(amountNum); // Ensure negative
      }
      // For 'credit' type (future use for auto-generated from purchases), keep as-is

      // Verify supplier exists
      const supplier = await prisma.supplier.findUnique({
        where: { id: supplierIdNum },
      });

      if (!supplier) {
        return res.status(404).json({
          error: 'Supplier not found',
          code: 'SUPPLIER_NOT_FOUND',
        });
      }

      // Calculate the new balance by summing all existing credits for this supplier
      const existingCredits = await prisma.supplierCredit.findMany({
        where: { supplierId: supplierIdNum },
        select: { amount: true },
        orderBy: { createdAt: 'asc' },
      });

      // Calculate running balance
      let runningBalance = 0;
      for (const credit of existingCredits) {
        runningBalance += decimalToNumber(credit.amount) ?? 0;
      }
      runningBalance += amountNum; // Add the new transaction

      const credit = await prisma.supplierCredit.create({
        data: {
          supplierId: supplierIdNum,
          purchaseId: purchaseId ? parseInt(purchaseId) : null,
          transactionType,
          amount: amountNum,
          balance: runningBalance,
          description: description || null,
          userId: req.user?.id || null,
        },
        include: {
          user: {
            select: { id: true, fullName: true, email: true },
          },
          purchase: {
            select: { id: true, purchaseNumber: true, total: true, status: true },
          },
        },
      });

      // Convert Decimal types to numbers
      const serialized = {
        ...credit,
        amount: decimalToNumber(credit.amount) ?? 0,
        balance: decimalToNumber(credit.balance) ?? 0,
        purchase: credit.purchase ? {
          ...credit.purchase,
          total: decimalToNumber(credit.purchase.total) ?? 0,
        } : null,
      };

      return res.status(201).json(serialized);
    } catch (error: any) {
      console.error('Create supplier credit error:', error);

      if (error.code === 'P2003') {
        return res.status(400).json({
          error: 'Invalid supplier ID or purchase ID',
          code: 'INVALID_REFERENCE',
        });
      }

      return res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * Delete a supplier credit transaction (admin only)
   */
  static async deleteCredit(req: AuthRequest, res: Response) {
    try {
      const { id } = req.params; // FIXED: Use req.params for RESTful routing

      if (!id) {
        return res.status(400).json({
          error: 'Credit ID is required',
          code: 'MISSING_CREDIT_ID',
        });
      }

      const creditIdNum = parseInt(id);
      if (isNaN(creditIdNum)) {
        return res.status(400).json({
          error: 'Invalid credit ID',
          code: 'INVALID_CREDIT_ID',
        });
      }

      // Get the credit to be deleted
      const creditToDelete = await prisma.supplierCredit.findUnique({
        where: { id: creditIdNum },
      });

      if (!creditToDelete) {
        return res.status(404).json({
          error: 'Credit transaction not found',
          code: 'CREDIT_NOT_FOUND',
        });
      }

      // Delete the credit
      await prisma.supplierCredit.delete({
        where: { id: creditIdNum },
      });

      // Recalculate balances for all subsequent transactions (after the deleted one)
      const remainingCredits = await prisma.supplierCredit.findMany({
        where: {
          supplierId: creditToDelete.supplierId,
          createdAt: { gt: creditToDelete.createdAt } // FIXED: Use gt (greater than) not gte
        },
        orderBy: { createdAt: 'asc' },
      });

      // Get all credits before the deleted one to calculate the starting balance
      const previousCredits = await prisma.supplierCredit.findMany({
        where: {
          supplierId: creditToDelete.supplierId,
          createdAt: { lt: creditToDelete.createdAt }
        },
        orderBy: { createdAt: 'asc' },
      });

      let runningBalance = 0;
      for (const credit of previousCredits) {
        runningBalance += decimalToNumber(credit.amount) ?? 0;
      }

      // Update balances for all remaining transactions
      for (const credit of remainingCredits) {
        runningBalance += decimalToNumber(credit.amount) ?? 0;
        await prisma.supplierCredit.update({
          where: { id: credit.id },
          data: { balance: runningBalance },
        });
      }

      return res.json({
        success: true,
        message: 'Credit transaction deleted successfully'
      });
    } catch (error) {
      console.error('Delete supplier credit error:', error);
      return res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
      });
    }
  }
}
