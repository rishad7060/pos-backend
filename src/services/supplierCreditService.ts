import { Prisma } from '@prisma/client';
import { prisma } from '../models/db';
import { decimalToNumber } from '../utils/decimal';

export interface PaymentAllocation {
  creditId: number;
  creditType: string;
  description: string;
  amountAllocated: number;
  remainingOnCredit: number;
  paidAmount: number;
  newPaymentStatus: string;
  purchaseId: number | null;
}

export interface PaymentAllocationResult {
  allocations: PaymentAllocation[];
  totalAllocated: number;
  remainingPayment: number;
}

/**
 * Allocate payment to credits using FIFO (oldest first)
 *
 * @param supplierId - Supplier ID
 * @param paymentAmount - Total payment amount
 * @param tx - Prisma transaction client
 * @returns Allocation breakdown
 */
export async function allocatePaymentFIFO(
  supplierId: number,
  paymentAmount: number,
  tx: Prisma.TransactionClient
): Promise<PaymentAllocationResult> {
  // Get all unpaid/partial credits (oldest first) - FIFO order
  const unpaidCredits = await tx.supplierCredit.findMany({
    where: {
      supplierId,
      transactionType: { in: ['admin_credit', 'credit'] },
      OR: [
        { paymentStatus: null },
        { paymentStatus: 'unpaid' },
        { paymentStatus: 'partial' }
      ]
    },
    orderBy: {
      createdAt: 'asc' // FIFO: oldest first
    },
    include: {
      purchase: {
        select: { purchaseNumber: true }
      }
    }
  });

  const allocations: PaymentAllocation[] = [];
  let remainingPayment = paymentAmount;

  // Allocate payment across credits using FIFO
  for (const credit of unpaidCredits) {
    if (remainingPayment <= 0) break;

    const creditAmount = decimalToNumber(credit.amount) ?? 0;
    const paidAmount = decimalToNumber(credit.paidAmount) ?? 0;
    const remainingOnCredit = creditAmount - paidAmount;

    // Calculate how much to allocate to this credit
    const amountToAllocate = Math.min(remainingPayment, remainingOnCredit);

    const newPaidAmount = paidAmount + amountToAllocate;
    const newPaymentStatus = newPaidAmount >= creditAmount ? 'paid' : 'partial';

    allocations.push({
      creditId: credit.id,
      creditType: credit.transactionType,
      description: credit.purchase
        ? `PO ${credit.purchase.purchaseNumber}`
        : credit.description || 'Manual credit',
      amountAllocated: amountToAllocate,
      remainingOnCredit: remainingOnCredit - amountToAllocate,
      paidAmount: newPaidAmount,
      newPaymentStatus,
      purchaseId: credit.purchaseId
    });

    remainingPayment -= amountToAllocate;
  }

  return {
    allocations,
    totalAllocated: paymentAmount - remainingPayment,
    remainingPayment
  };
}

/**
 * Get current outstanding balance for a supplier
 *
 * @param supplierId - Supplier ID
 * @param tx - Optional Prisma transaction client
 * @returns Current balance
 */
export async function getSupplierOutstandingBalance(
  supplierId: number,
  tx?: Prisma.TransactionClient
): Promise<number> {
  const db = tx || prisma;

  const latestCredit = await db.supplierCredit.findFirst({
    where: { supplierId },
    orderBy: { createdAt: 'desc' },
    select: { balance: true },
  });

  return latestCredit ? (decimalToNumber(latestCredit.balance) ?? 0) : 0;
}

/**
 * Calculate new balance after transaction
 *
 * FIXED: Now calculates balance by summing ALL transactions (credits and debits)
 * Do NOT use paidAmount as payments are recorded as separate debit transactions
 *
 * @param supplierId - Supplier ID
 * @param transactionAmount - Transaction amount (positive for credit, negative for payment)
 * @param tx - Prisma transaction client
 * @returns New balance
 */
export async function calculateNewBalance(
  supplierId: number,
  transactionAmount: number,
  tx: Prisma.TransactionClient
): Promise<number> {
  const db = tx || prisma;

  // Get ALL transactions for this supplier
  const allTransactions = await db.supplierCredit.findMany({
    where: {
      supplierId,
    },
    select: {
      amount: true,
    },
  });

  // Simply sum all transaction amounts:
  // - Credits (purchases) have positive amounts (we owe more)
  // - Debits (payments/returns) have negative amounts (we owe less)
  // - Do NOT use paidAmount as payments are already recorded as separate debit transactions
  let outstandingBalance = 0;
  for (const txn of allTransactions) {
    const amount = decimalToNumber(txn.amount) ?? 0;
    outstandingBalance += amount;
  }

  // Add the new transaction amount
  return outstandingBalance + transactionAmount;
}
