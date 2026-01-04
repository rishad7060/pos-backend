import { Response } from 'express';
import { prisma } from '../models/db';
import { AuthRequest } from '../middleware/auth';
import { decimalToNumber } from '../utils/decimal';
import { parseLimit, getPaginationParams } from '../config/pagination';

export class PurchaseReturnsController {
  /**
   * Get purchase returns with optional filters
   */
  static async getReturns(req: AuthRequest, res: Response) {
    try {
      const { purchaseId, supplierId, limit } = req.query;

      const where: any = {};
      if (purchaseId) {
        where.purchaseId = parseInt(purchaseId as string);
      }
      if (supplierId) {
        where.supplierId = parseInt(supplierId as string);
      }

      const returns = await prisma.purchaseReturn.findMany({
        where,
        include: {
          purchase: {
            select: {
              id: true,
              purchaseNumber: true,
            },
          },
          supplier: {
            select: {
              id: true,
              name: true,
            },
          },
          user: {
            select: {
              id: true,
              fullName: true,
              email: true,
            },
          },
          purchaseReturnItems: {
            include: {
              product: {
                select: {
                  id: true,
                  name: true,
                  sku: true,
                },
              },
            },
          },
        },
        orderBy: {
          returnDate: 'desc',
        },
        take: Math.min(parseLimit(limit, 'purchaseReturns'), 1000),
      });

      // Convert Decimal fields to numbers
      const serializedReturns = returns.map((ret) => ({
        ...ret,
        totalAmount: decimalToNumber(ret.totalAmount) ?? 0,
        purchaseReturnItems: ret.purchaseReturnItems.map((item) => ({
          ...item,
          returnedQuantity: decimalToNumber(item.returnedQuantity) ?? 0,
          unitPrice: decimalToNumber(item.unitPrice) ?? 0,
          totalCost: decimalToNumber(item.totalCost) ?? 0,
        })),
      }));

      return res.json(serializedReturns);
    } catch (error: any) {
      console.error('Get purchase returns error:', error);
      return res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
        message: error.message,
      });
    }
  }

  /**
   * Create a new purchase return
   * This reduces the supplier credit (amount owed) and updates stock
   */
  static async createReturn(req: AuthRequest, res: Response) {
    try {
      const { purchaseId, items, reason, notes } = req.body;

      if (!purchaseId || !items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({
          error: 'Purchase ID and items are required',
          code: 'MISSING_REQUIRED_FIELDS',
        });
      }

      // Validate purchase exists
      const purchase = await prisma.purchase.findUnique({
        where: { id: parseInt(purchaseId) },
        include: {
          purchaseItems: true,
        },
      });

      if (!purchase) {
        return res.status(404).json({
          error: 'Purchase order not found',
          code: 'PURCHASE_NOT_FOUND',
        });
      }

      // Validate all items belong to this purchase and quantities are valid
      for (const item of items) {
        const purchaseItem = purchase.purchaseItems.find(
          (pi) => pi.id === parseInt(item.purchaseItemId)
        );

        if (!purchaseItem) {
          return res.status(400).json({
            error: `Item ${item.purchaseItemId} does not belong to this purchase`,
            code: 'INVALID_ITEM',
          });
        }

        const returnedQty = parseFloat(item.returnedQuantity);
        const receivedQty = decimalToNumber(purchaseItem.receivedQuantity) ?? 0;

        if (returnedQty <= 0) {
          return res.status(400).json({
            error: 'Returned quantity must be greater than 0',
            code: 'INVALID_QUANTITY',
          });
        }

        if (returnedQty > receivedQty) {
          return res.status(400).json({
            error: `Cannot return more than received quantity for ${purchaseItem.productName}`,
            code: 'QUANTITY_EXCEEDS_RECEIVED',
          });
        }
      }

      // Calculate total return amount
      let totalReturnAmount = 0;
      for (const item of items) {
        const purchaseItem = purchase.purchaseItems.find(
          (pi) => pi.id === parseInt(item.purchaseItemId)
        );
        if (purchaseItem) {
          const returnedQty = parseFloat(item.returnedQuantity);
          const unitPrice = decimalToNumber(purchaseItem.unitPrice) ?? 0;
          totalReturnAmount += returnedQty * unitPrice;
        }
      }

      // Use transaction to ensure data consistency
      const result = await prisma.$transaction(async (tx) => {
        // Generate unique return number
        const today = new Date();
        const dateStr = today.toISOString().split('T')[0].replace(/-/g, '');
        const lastReturn = await tx.purchaseReturn.findFirst({
          where: {
            returnNumber: {
              startsWith: `RET-${dateStr}`,
            },
          },
          orderBy: {
            returnNumber: 'desc',
          },
        });

        let returnNumber: string;
        if (lastReturn) {
          const lastNum = parseInt(lastReturn.returnNumber.split('-')[2]);
          returnNumber = `RET-${dateStr}-${(lastNum + 1).toString().padStart(4, '0')}`;
        } else {
          returnNumber = `RET-${dateStr}-0001`;
        }

        // Create purchase return
        const purchaseReturn = await tx.purchaseReturn.create({
          data: {
            returnNumber,
            purchaseId: parseInt(purchaseId),
            supplierId: purchase.supplierId,
            totalAmount: totalReturnAmount,
            userId: req.user?.id || 1,
            reason: reason || null,
            notes: notes || null,
          },
        });

        // Create return items and update stock
        for (const item of items) {
          const purchaseItem = purchase.purchaseItems.find(
            (pi) => pi.id === parseInt(item.purchaseItemId)
          );

          if (!purchaseItem) continue;

          const returnedQty = parseFloat(item.returnedQuantity);
          const unitPrice = decimalToNumber(purchaseItem.unitPrice) ?? 0;
          const totalCost = returnedQty * unitPrice;

          // Create return item record
          await tx.purchaseReturnItem.create({
            data: {
              purchaseReturnId: purchaseReturn.id,
              purchaseItemId: parseInt(item.purchaseItemId),
              productId: purchaseItem.productId,
              productName: purchaseItem.productName,
              returnedQuantity: returnedQty,
              unitPrice: unitPrice,
              totalCost: totalCost,
            },
          });

          // Update product stock (subtract returned quantity)
          if (purchaseItem.productId) {
            await tx.product.update({
              where: { id: purchaseItem.productId },
              data: {
                stockQuantity: {
                  decrement: returnedQty,
                },
              },
            });
          }

          // Update purchase item received quantity
          await tx.purchaseItem.update({
            where: { id: purchaseItem.id },
            data: {
              receivedQuantity: {
                decrement: returnedQty,
              },
            },
          });
        }

        // Create a debit transaction record for the return (shows in transaction history)
        // This acts like a payment - reducing what we owe to the supplier
        const returnDescription = `Return ${returnNumber} - ${purchase.purchaseNumber}${reason ? ` (${reason})` : ''}`;

        // Recalculate supplier's outstanding balance INCLUDING all transaction types
        const allTransactions = await tx.supplierCredit.findMany({
          where: {
            supplierId: purchase.supplierId,
          },
          select: {
            amount: true,
          },
        });

        // Calculate running balance from ALL transactions
        // Simply sum all transaction amounts:
        // - Credits (purchases) have positive amounts (we owe more)
        // - Debits (payments/returns) have negative amounts (we owe less)
        // - Do NOT use paidAmount as payments are already recorded as separate debit transactions
        let runningBalance = 0;
        for (const txn of allTransactions) {
          const amt = decimalToNumber(txn.amount) ?? 0;
          runningBalance += amt;
        }

        // Add this return's debit amount (subtract because it's a return)
        const newOutstanding = runningBalance - totalReturnAmount;

        // Create the debit transaction record
        await tx.supplierCredit.create({
          data: {
            supplierId: purchase.supplierId,
            purchaseId: parseInt(purchaseId),
            transactionType: 'debit',
            amount: -totalReturnAmount, // Negative because it reduces outstanding
            balance: newOutstanding,
            description: returnDescription,
            userId: req.user?.id || 1,
            paidAmount: 0,
            paymentStatus: null, // Debit transactions don't have payment status
          },
        });

        // Update supplier outstanding balance
        await tx.supplier.update({
          where: { id: purchase.supplierId },
          data: { outstandingBalance: newOutstanding },
        });

        // Update purchase totals
        const newPurchaseTotal = (decimalToNumber(purchase.total) ?? 0) - totalReturnAmount;
        const currentPaid = decimalToNumber(purchase.paidAmount) ?? 0;

        // Determine new payment status for purchase
        let newPurchasePaymentStatus = 'unpaid';
        if (currentPaid >= newPurchaseTotal && newPurchaseTotal > 0) {
          newPurchasePaymentStatus = 'paid';
        } else if (currentPaid > 0) {
          newPurchasePaymentStatus = 'partial';
        }

        await tx.purchase.update({
          where: { id: parseInt(purchaseId) },
          data: {
            total: newPurchaseTotal,
            paymentStatus: newPurchasePaymentStatus,
          },
        });

        return purchaseReturn;
      });

      // Fetch the complete return with relations
      const completeReturn = await prisma.purchaseReturn.findUnique({
        where: { id: result.id },
        include: {
          purchase: {
            select: {
              id: true,
              purchaseNumber: true,
            },
          },
          supplier: {
            select: {
              id: true,
              name: true,
            },
          },
          user: {
            select: {
              id: true,
              fullName: true,
              email: true,
            },
          },
          purchaseReturnItems: {
            include: {
              product: {
                select: {
                  id: true,
                  name: true,
                  sku: true,
                },
              },
            },
          },
        },
      });

      if (!completeReturn) {
        throw new Error('Failed to fetch created return');
      }

      // Serialize Decimals
      const serialized = {
        ...completeReturn,
        totalAmount: decimalToNumber(completeReturn.totalAmount) ?? 0,
        purchaseReturnItems: completeReturn.purchaseReturnItems.map((item) => ({
          ...item,
          returnedQuantity: decimalToNumber(item.returnedQuantity) ?? 0,
          unitPrice: decimalToNumber(item.unitPrice) ?? 0,
          totalCost: decimalToNumber(item.totalCost) ?? 0,
        })),
      };

      return res.status(201).json(serialized);
    } catch (error: any) {
      console.error('Create purchase return error:', error);
      return res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
        message: error.message,
      });
    }
  }
}
