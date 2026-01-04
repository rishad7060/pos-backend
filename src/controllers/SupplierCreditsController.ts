import { Response } from 'express';
import { prisma } from '../models/db';
import { AuthRequest } from '../middleware/auth';
import { decimalToNumber } from '../utils/decimal';
import { PaymentAllocation } from '../services/supplierCreditService';
import { parseLimit, getPaginationParams } from '../config/pagination';

export class SupplierCreditsController {
  /**
   * Get all credit/debit transactions for a specific supplier
   */
  static async getSupplierCredits(req: AuthRequest, res: Response) {
    try {
      const { supplierId, limit } = req.query;

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

      const take = Math.min(parseLimit(limit, 'supplierCredits'), 1000);

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
          paidAmount: 0,
          paymentStatus: transactionType === 'debit' ? null : 'unpaid', // Debits don't have payment status
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

      // CRITICAL FIX: Update supplier's outstanding balance to match the ledger
      await prisma.supplier.update({
        where: { id: supplierIdNum },
        data: {
          outstandingBalance: runningBalance,
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

      // Update supplier's outstanding balance to match the ledger
      await prisma.supplier.update({
        where: { id: creditToDelete.supplierId },
        data: {
          outstandingBalance: runningBalance,
        },
      });

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

  /**
   * Recalculate supplier outstanding balance from credit ledger
   * Utility endpoint to sync database in case of discrepancies
   */
  static async recalculateBalance(req: AuthRequest, res: Response) {
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

      // Get the latest credit record for this supplier
      const latestCredit = await prisma.supplierCredit.findFirst({
        where: { supplierId: supplierIdNum },
        orderBy: { createdAt: 'desc' },
        select: { balance: true },
      });

      const correctBalance = latestCredit
        ? decimalToNumber(latestCredit.balance) ?? 0
        : 0;

      // Update supplier's outstanding balance
      await prisma.supplier.update({
        where: { id: supplierIdNum },
        data: { outstandingBalance: correctBalance },
      });

      return res.json({
        success: true,
        supplierId: supplierIdNum,
        outstandingBalance: correctBalance,
        message: 'Supplier balance recalculated successfully',
      });
    } catch (error) {
      console.error('Recalculate balance error:', error);
      return res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * Record a payment and allocate to credits using FIFO
   */
  static async recordPayment(req: AuthRequest, res: Response) {
    try {
      const { supplierId, amount, paymentMethod, reference, notes, customerChequeId } = req.body;

      if (!supplierId || !amount) {
        return res.status(400).json({
          error: 'Supplier ID and amount are required',
          code: 'MISSING_REQUIRED_FIELDS',
        });
      }

      const supplierIdNum = parseInt(supplierId);
      const amountNum = parseFloat(amount);
      const chequeId = customerChequeId ? parseInt(customerChequeId) : null;

      if (isNaN(supplierIdNum) || isNaN(amountNum) || amountNum <= 0) {
        return res.status(400).json({
          error: 'Invalid supplier ID or amount. Amount must be positive.',
          code: 'INVALID_DATA',
        });
      }

      // If customer cheque is provided, validate it
      let customerCheque = null;
      if (chequeId) {
        customerCheque = await prisma.cheque.findUnique({
          where: { id: chequeId },
          include: {
            customer: true,
          },
        });

        if (!customerCheque) {
          return res.status(404).json({
            error: 'Customer cheque not found',
            code: 'CHEQUE_NOT_FOUND',
          });
        }

        // Validate cheque is from a customer (received by us)
        if (customerCheque.transactionType !== 'received') {
          return res.status(400).json({
            error: 'Only customer cheques (received) can be endorsed to suppliers',
            code: 'INVALID_CHEQUE_TYPE',
          });
        }

        // Validate cheque is in a valid state
        if (!['pending', 'deposited'].includes(customerCheque.status)) {
          return res.status(400).json({
            error: `Cheque cannot be endorsed. Status: ${customerCheque.status}`,
            code: 'INVALID_CHEQUE_STATUS',
          });
        }

        // Validate cheque is not already endorsed
        if (customerCheque.isEndorsed) {
          return res.status(400).json({
            error: 'Cheque is already endorsed to another party',
            code: 'CHEQUE_ALREADY_ENDORSED',
          });
        }

        // Use cheque amount if not specified
        const chequeAmount = decimalToNumber(customerCheque.amount) || 0;
        if (amountNum !== chequeAmount) {
          return res.status(400).json({
            error: `Payment amount (${amountNum}) must match cheque amount (${chequeAmount})`,
            code: 'AMOUNT_MISMATCH',
          });
        }
      }

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

      // Validate payment doesn't exceed outstanding balance
      const outstandingBalance = decimalToNumber(supplier.outstandingBalance) || 0;

      if (outstandingBalance <= 0) {
        return res.status(400).json({
          error: 'No outstanding balance to pay',
          code: 'NO_OUTSTANDING_BALANCE',
        });
      }

      if (amountNum > outstandingBalance) {
        return res.status(400).json({
          error: `Payment amount (${amountNum.toFixed(2)}) cannot exceed outstanding balance (${outstandingBalance.toFixed(2)})`,
          code: 'PAYMENT_EXCEEDS_BALANCE',
          outstandingBalance,
        });
      }

      // Use transaction for data consistency
      const result = await prisma.$transaction(async (tx) => {
        // Import the allocation service
        const { allocatePaymentFIFO, calculateNewBalance } = require('../services/supplierCreditService');

        // Allocate payment using FIFO
        const allocation = await allocatePaymentFIFO(supplierIdNum, amountNum, tx);

        if (allocation.allocations.length === 0) {
          throw new Error('No unpaid credits found for this supplier');
        }

        // Calculate new balance
        const newBalance = await calculateNewBalance(supplierIdNum, -amountNum, tx);

        // Build description
        let description = 'Payment';
        if (customerCheque) {
          description += ` via Customer Cheque #${customerCheque.chequeNumber}`;
        } else if (paymentMethod) {
          description += ` via ${paymentMethod}`;
        }
        if (reference) description += ` - Ref: ${reference}`;
        if (notes) description += ` - ${notes}`;

        // Create payment record (debit)
        const paymentCredit = await tx.supplierCredit.create({
          data: {
            supplierId: supplierIdNum,
            transactionType: 'debit',
            amount: -amountNum, // Negative for payment
            balance: newBalance,
            description,
            userId: req.user?.id || null,
          },
        });

        // If customer cheque is used, endorse it to the supplier
        if (customerCheque) {
          await tx.cheque.update({
            where: { id: customerCheque.id },
            data: {
              isEndorsed: true,
              endorsedTo: supplier.name,
              endorsedDate: new Date(),
              endorsedById: req.user?.id || null,
              supplierId: supplierIdNum,
              // Keep existing status (pending/deposited) - status tracks clearance, not ownership
              notes: customerCheque.notes
                ? `${customerCheque.notes}\nEndorsed to supplier: ${supplier.name} for payment #${paymentCredit.id}`
                : `Endorsed to supplier: ${supplier.name} for payment #${paymentCredit.id}`,
            },
          });

          console.log(`✅ Customer cheque #${customerCheque.chequeNumber} endorsed to supplier: ${supplier.name}`);
        }

        // Create allocation records and update credits
        for (const alloc of allocation.allocations) {
          // Create allocation record
          await tx.supplierPaymentAllocation.create({
            data: {
              paymentCreditId: paymentCredit.id,
              allocatedCreditId: alloc.creditId,
              allocatedAmount: alloc.amountAllocated,
            },
          });

          // Update credit paidAmount and status
          await tx.supplierCredit.update({
            where: { id: alloc.creditId },
            data: {
              paidAmount: alloc.paidAmount,
              paymentStatus: alloc.newPaymentStatus,
            },
          });

          // If linked to PO, update PO payment info
          if (alloc.purchaseId) {
            const purchase = await tx.purchase.findUnique({
              where: { id: alloc.purchaseId },
              select: { paidAmount: true, total: true },
            });

            if (purchase) {
              const currentPaidAmount = decimalToNumber(purchase.paidAmount) ?? 0;
              const newPaidAmount = currentPaidAmount + alloc.amountAllocated;
              const total = decimalToNumber(purchase.total) ?? 0;

              await tx.purchase.update({
                where: { id: alloc.purchaseId },
                data: {
                  paidAmount: newPaidAmount,
                  paymentStatus: newPaidAmount >= total ? 'paid' : 'partial',
                },
              });
            }
          }
        }

        // Update supplier outstanding balance
        await tx.supplier.update({
          where: { id: supplierIdNum },
          data: {
            outstandingBalance: newBalance,
          },
        });

        return {
          payment: paymentCredit,
          allocations: allocation.allocations,
          totalAllocated: allocation.totalAllocated,
          newBalance,
          endorsedCheque: customerCheque ? {
            id: customerCheque.id,
            chequeNumber: customerCheque.chequeNumber,
            amount: decimalToNumber(customerCheque.amount),
            endorsedTo: supplier.name,
          } : null,
        };
      });

      return res.status(201).json({
        success: true,
        payment: {
          id: result.payment.id,
          supplierId: result.payment.supplierId,
          transactionType: result.payment.transactionType,
          amount: decimalToNumber(result.payment.amount),
          balance: decimalToNumber(result.payment.balance),
          description: result.payment.description,
          createdAt: result.payment.createdAt,
        },
        endorsedCheque: result.endorsedCheque,
        allocations: result.allocations.map((alloc: PaymentAllocation) => ({
          creditId: alloc.creditId,
          creditType: alloc.creditType,
          description: alloc.description,
          amountAllocated: alloc.amountAllocated,
          remainingOnCredit: alloc.remainingOnCredit,
        })),
        totalAllocated: result.totalAllocated,
        newBalance: result.newBalance,
        message: result.endorsedCheque
          ? `Payment of ${amountNum.toFixed(2)} recorded successfully via customer cheque #${result.endorsedCheque.chequeNumber}. Cheque endorsed to supplier. Allocated to ${result.allocations.length} credit(s).`
          : `Payment of ${amountNum.toFixed(2)} recorded successfully. Allocated to ${result.allocations.length} credit(s).`,
      });
    } catch (error: any) {
      console.error('Record payment error:', error);
      return res.status(500).json({
        error: error.message || 'Internal server error',
        code: 'INTERNAL_ERROR',
      });
    }
  }
}
