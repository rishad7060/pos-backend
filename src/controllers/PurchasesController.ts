import { Response } from 'express';
import { prisma } from '../models/db';
import { AuthRequest } from '../middleware/auth';
import { decimalToNumber } from '../utils/decimal';
import { createStockBatch } from '../services/batchService';
import { parseLimit } from '../config/pagination';

export class PurchasesController {
  static async getPurchases(req: AuthRequest, res: Response) {
    try {
      const { id, supplierId, status, limit } = req.query;

      // Get single purchase by ID
      if (id) {
        const purchaseId = parseInt(id as string);
        if (isNaN(purchaseId)) {
          return res.status(400).json({
            error: 'Invalid purchase ID',
            code: 'INVALID_ID',
          });
        }

        const purchase = await prisma.purchase.findUnique({
          where: { id: purchaseId },
          include: {
            supplier: {
              select: {
                id: true,
                name: true,
                contactPerson: true,
                phone: true,
                email: true,
              },
            },
            purchaseItems: {
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
            purchasePayments: {
              include: {
                user: {
                  select: {
                    id: true,
                    fullName: true,
                  },
                },
              },
              orderBy: {
                paymentDate: 'desc',
              },
            },
            purchaseReceives: {
              include: {
                purchaseItem: true,
                user: {
                  select: {
                    id: true,
                    fullName: true,
                  },
                },
              },
              orderBy: {
                receivedDate: 'desc',
              },
            },
            user: {
              select: {
                id: true,
                fullName: true,
                email: true,
              },
            },
          },
        });

        if (!purchase) {
          return res.status(404).json({
            error: 'Purchase not found',
            code: 'PURCHASE_NOT_FOUND',
          });
        }

        // Convert Decimal to numbers
        // IMPORTANT: Use purchase.paidAmount directly (updated by FIFO allocation)

        // Check if this PO has FIFO payment allocations
        const supplierCredit = await prisma.supplierCredit.findFirst({
          where: { purchaseId: purchase.id },
          select: { id: true },
        });

        let hasFifoPayments = false;
        if (supplierCredit) {
          const allocationCount = await prisma.supplierPaymentAllocation.count({
            where: { allocatedCreditId: supplierCredit.id },
          });
          hasFifoPayments = allocationCount > 0;
        }

        const serialized = {
          ...purchase,
          subtotal: decimalToNumber(purchase.subtotal) ?? 0,
          taxAmount: decimalToNumber(purchase.taxAmount) ?? 0,
          shippingCost: decimalToNumber(purchase.shippingCost) ?? 0,
          total: decimalToNumber(purchase.total) ?? 0,
          paidAmount: decimalToNumber(purchase.paidAmount) ?? 0, // Use field directly (FIFO updates this)
          hasFifoPayments, // Flag to indicate FIFO payments exist
          items: purchase.purchaseItems.map((item) => ({
            ...item,
            quantity: decimalToNumber(item.quantity) ?? 0,
            unitPrice: decimalToNumber(item.unitPrice) ?? 0,
            totalPrice: decimalToNumber(item.totalPrice) ?? 0,
            receivedQuantity: decimalToNumber(item.receivedQuantity) ?? 0,
          })),
          purchaseItems: purchase.purchaseItems.map((item) => ({
            ...item,
            quantity: decimalToNumber(item.quantity) ?? 0,
            unitPrice: decimalToNumber(item.unitPrice) ?? 0,
            totalPrice: decimalToNumber(item.totalPrice) ?? 0,
            receivedQuantity: decimalToNumber(item.receivedQuantity) ?? 0,
          })),
          purchasePayments: purchase.purchasePayments.map((payment) => ({
            ...payment,
            amount: decimalToNumber(payment.amount) ?? 0,
          })),
          purchaseReceives: purchase.purchaseReceives.map((receive) => ({
            ...receive,
            receivedQuantity: decimalToNumber(receive.receivedQuantity) ?? 0,
          })),
        };

        // Prevent caching to ensure fresh data
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.setHeader('Surrogate-Control', 'no-store');
        return res.json(serialized);
      }

      // Get multiple purchases
      const where: any = {};
      if (supplierId) {
        where.supplierId = parseInt(supplierId as string);
      }
      if (status) {
        where.status = status as string;
      }

      const purchases = await prisma.purchase.findMany({
        where,
        include: {
          supplier: {
            select: {
              id: true,
              name: true,
            },
          },
          purchaseItems: true,
        },
        orderBy: {
          createdAt: 'desc',
        },
        take: Math.min(parseLimit(limit, 'orders'), 1000),
      });

      // Convert Decimal to numbers
      // IMPORTANT: Use purchase.paidAmount directly (updated by FIFO allocation)
      // instead of calculating from purchasePayment table
      const serialized = await Promise.all(
        purchases.map(async (purchase) => {
          const items = purchase.purchaseItems.map((item) => ({
            ...item,
            quantity: decimalToNumber(item.quantity) ?? 0,
            unitPrice: decimalToNumber(item.unitPrice) ?? 0,
            totalPrice: decimalToNumber(item.totalPrice) ?? 0,
            receivedQuantity: decimalToNumber(item.receivedQuantity) ?? 0,
          }));

          // Check if this PO has FIFO payment allocations
          const supplierCredit = await prisma.supplierCredit.findFirst({
            where: { purchaseId: purchase.id },
            select: { id: true },
          });

          let hasFifoPayments = false;
          if (supplierCredit) {
            const allocationCount = await prisma.supplierPaymentAllocation.count({
              where: { allocatedCreditId: supplierCredit.id },
            });
            hasFifoPayments = allocationCount > 0;
          }

          return {
            ...purchase,
            subtotal: decimalToNumber(purchase.subtotal) ?? 0,
            taxAmount: decimalToNumber(purchase.taxAmount) ?? 0,
            shippingCost: decimalToNumber(purchase.shippingCost) ?? 0,
            total: decimalToNumber(purchase.total) ?? 0,
            paidAmount: decimalToNumber(purchase.paidAmount) ?? 0, // Use field directly (FIFO updates this)
            hasFifoPayments, // Flag to indicate FIFO payments exist
            items, // Frontend expects 'items'
            purchaseItems: items, // Keep for backward compatibility
          };
        })
      );

      // Prevent caching to ensure fresh data
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.setHeader('Surrogate-Control', 'no-store');

      return res.json(serialized);
    } catch (error: any) {
      console.error('Get purchases error:', error);
      return res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
        message: error.message,
      });
    }
  }

  static async createPurchase(req: AuthRequest, res: Response) {
    try {
      const {
        supplierId,
        items,
        subtotal,
        taxAmount,
        shippingCost,
        total,
        status = 'pending',
        paymentStatus = 'unpaid',
        notes,
        userId,
      } = req.body;

      if (!supplierId) {
        return res.status(400).json({
          error: 'Supplier ID is required',
          code: 'MISSING_SUPPLIER',
        });
      }

      if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({
          error: 'At least one item is required',
          code: 'MISSING_ITEMS',
        });
      }

      // Generate unique purchase number
      const today = new Date();
      const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');
      const randomNum = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
      const purchaseNumber = `PO-${dateStr}-${randomNum}`;

      // Use transaction for atomicity
      const purchase = await prisma.$transaction(async (tx) => {
        // Create purchase
        const newPurchase = await tx.purchase.create({
          data: {
            purchaseNumber,
            supplierId: parseInt(supplierId),
            userId: userId ? parseInt(userId) : req.user?.id || null,
            status,
            subtotal: subtotal || 0,
            taxAmount: taxAmount || 0,
            shippingCost: shippingCost || 0,
            total: total || subtotal + (taxAmount || 0) + (shippingCost || 0),
            paidAmount: 0,
            paymentStatus,
            notes: notes || null,
          },
        });

        // Create purchase items
        const purchaseItems = await Promise.all(
          items.map((item: any) =>
            tx.purchaseItem.create({
              data: {
                purchaseId: newPurchase.id,
                productId: item.productId ? parseInt(item.productId) : null,
                productName: item.productName || 'Unknown Product',
                quantity: item.quantity || 0,
                unitPrice: item.unitPrice || 0,
                totalPrice: item.totalPrice || (item.quantity || 0) * (item.unitPrice || 0),
                receivedQuantity: 0,
              },
            })
          )
        );

        // Auto-create supplier credit for this PO (adds to supplier's outstanding balance)
        const { calculateNewBalance } = require('../services/supplierCreditService');
        const totalAmount = newPurchase.total || subtotal + (taxAmount || 0) + (shippingCost || 0);

        // Check if supplier has negative outstanding balance (credit from returns/overpayments)
        const supplier = await tx.supplier.findUnique({
          where: { id: parseInt(supplierId) },
          select: { outstandingBalance: true },
        });

        const currentOutstanding = decimalToNumber(supplier?.outstandingBalance) ?? 0;
        const totalAmountNum = decimalToNumber(totalAmount) ?? 0;

        // Calculate how much of the available credit can be applied to this PO
        let creditToApply = 0;
        let purchasePaidAmount = 0;
        let purchasePaymentStatus = 'unpaid';

        if (currentOutstanding < 0) {
          // There's available credit (negative outstanding means they overpaid or returned items)
          const availableCredit = Math.abs(currentOutstanding);
          creditToApply = Math.min(availableCredit, totalAmountNum);
          purchasePaidAmount = creditToApply;

          // Determine payment status
          if (creditToApply >= totalAmountNum) {
            purchasePaymentStatus = 'paid';
          } else if (creditToApply > 0) {
            purchasePaymentStatus = 'partial';
          }
        }

        const newBalance = await calculateNewBalance(parseInt(supplierId), totalAmountNum, tx);

        const purchaseCredit = await tx.supplierCredit.create({
          data: {
            supplierId: parseInt(supplierId),
            purchaseId: newPurchase.id,
            transactionType: 'credit',
            amount: totalAmount,
            balance: newBalance,
            description: `Purchase order ${purchaseNumber}`,
            userId: userId ? parseInt(userId) : req.user?.id || null,
            paidAmount: creditToApply, // Apply available credit immediately
            paymentStatus: purchasePaymentStatus,
          },
        });

        // Update purchase with applied credit
        if (creditToApply > 0) {
          await tx.purchase.update({
            where: { id: newPurchase.id },
            data: {
              paidAmount: purchasePaidAmount,
              paymentStatus: purchasePaymentStatus,
            },
          });

          // Find existing debit transactions (from returns/payments) that created the available credit
          // We'll allocate from the most recent debits that created the negative balance
          const debitTransactions = await tx.supplierCredit.findMany({
            where: {
              supplierId: parseInt(supplierId),
              transactionType: 'debit',
            },
            orderBy: {
              createdAt: 'desc', // Most recent first
            },
            take: 10, // Get recent debits
          });

          // Create allocation records linking the debit transactions to this PO
          // This makes the payment visible in the PO's payment history
          let remainingToAllocate = creditToApply;

          for (const debit of debitTransactions) {
            if (remainingToAllocate <= 0) break;

            const debitAmount = Math.abs(decimalToNumber(debit.amount) ?? 0);
            const amountToAllocateFromThisDebit = Math.min(remainingToAllocate, debitAmount);

            if (amountToAllocateFromThisDebit > 0) {
              await tx.supplierPaymentAllocation.create({
                data: {
                  paymentCreditId: debit.id, // The debit that provided the funds
                  allocatedCreditId: purchaseCredit.id, // The PO credit being paid
                  allocatedAmount: amountToAllocateFromThisDebit,
                },
              });

              remainingToAllocate -= amountToAllocateFromThisDebit;
            }
          }
        }

        // Update supplier's outstanding balance
        // Simply use newBalance which is calculated from all transactions
        const finalBalance = newBalance;

        await tx.supplier.update({
          where: { id: parseInt(supplierId) },
          data: {
            outstandingBalance: finalBalance,
            totalPurchases: {
              increment: totalAmount,
            },
          },
        });

        return { ...newPurchase, purchaseItems };
      });

      // Convert Decimal to numbers
      const serialized = {
        ...purchase,
        subtotal: decimalToNumber(purchase.subtotal) ?? 0,
        taxAmount: decimalToNumber(purchase.taxAmount) ?? 0,
        shippingCost: decimalToNumber(purchase.shippingCost) ?? 0,
        total: decimalToNumber(purchase.total) ?? 0,
        paidAmount: decimalToNumber(purchase.paidAmount) ?? 0,
        purchaseItems: purchase.purchaseItems.map((item) => ({
          ...item,
          quantity: decimalToNumber(item.quantity) ?? 0,
          unitPrice: decimalToNumber(item.unitPrice) ?? 0,
          totalPrice: decimalToNumber(item.totalPrice) ?? 0,
          receivedQuantity: decimalToNumber(item.receivedQuantity) ?? 0,
        })),
      };

      return res.status(201).json(serialized);
    } catch (error: any) {
      console.error('Create purchase error:', error);
      return res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
        message: error.message,
      });
    }
  }

  static async updatePurchase(req: AuthRequest, res: Response) {
    try {
      const { id } = req.query;
      const { status, paymentStatus, notes } = req.body;

      if (!id) {
        return res.status(400).json({
          error: 'Purchase ID is required',
          code: 'MISSING_ID',
        });
      }

      const purchaseId = parseInt(id as string);
      if (isNaN(purchaseId)) {
        return res.status(400).json({
          error: 'Invalid purchase ID',
          code: 'INVALID_ID',
        });
      }

      const updateData: any = {};
      if (status !== undefined) updateData.status = status;
      if (paymentStatus !== undefined) updateData.paymentStatus = paymentStatus;
      if (notes !== undefined) updateData.notes = notes;

      const purchase = await prisma.purchase.update({
        where: { id: purchaseId },
        include: {
          supplier: {
            select: {
              id: true,
              name: true,
            },
          },
          purchaseItems: true,
        },
        data: updateData,
      });

      // Calculate paid amount
      const payments = await prisma.purchasePayment.findMany({
        where: { purchaseId: purchase.id },
        select: { amount: true },
      });

      const paidAmount = payments.reduce((sum, payment) => {
        return sum + (decimalToNumber(payment.amount) ?? 0);
      }, 0);

      // Convert Decimal to numbers
      const serialized = {
        ...purchase,
        subtotal: decimalToNumber(purchase.subtotal) ?? 0,
        taxAmount: decimalToNumber(purchase.taxAmount) ?? 0,
        shippingCost: decimalToNumber(purchase.shippingCost) ?? 0,
        total: decimalToNumber(purchase.total) ?? 0,
        paidAmount,
        purchaseItems: purchase.purchaseItems.map((item) => ({
          ...item,
          quantity: decimalToNumber(item.quantity) ?? 0,
          unitPrice: decimalToNumber(item.unitPrice) ?? 0,
          totalPrice: decimalToNumber(item.totalPrice) ?? 0,
          receivedQuantity: decimalToNumber(item.receivedQuantity) ?? 0,
        })),
      };

      return res.json(serialized);
    } catch (error: any) {
      console.error('Update purchase error:', error);
      if (error.code === 'P2025') {
        return res.status(404).json({
          error: 'Purchase not found',
          code: 'PURCHASE_NOT_FOUND',
        });
      }
      return res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
        message: error.message,
      });
    }
  }
}

export class PurchasePaymentsController {
  static async getPayments(req: AuthRequest, res: Response) {
    try {
      const { purchaseId, limit } = req.query;

      const where: any = {};
      if (purchaseId) {
        where.purchaseId = parseInt(purchaseId as string);
      }

      // Get old-style purchase payments (for backward compatibility)
      const oldPayments = await prisma.purchasePayment.findMany({
        where,
        include: {
          purchase: {
            select: {
              id: true,
              purchaseNumber: true,
              total: true,
            },
          },
          user: {
            select: {
              id: true,
              fullName: true,
              email: true,
            },
          },
        },
        orderBy: {
          paymentDate: 'desc',
        },
        take: Math.min(parseLimit(limit, 'orders'), 1000),
      });

      // Convert old payments to standard format
      const serializedOldPayments = oldPayments.map((payment) => ({
        ...payment,
        amount: decimalToNumber(payment.amount) ?? 0,
        source: 'direct', // Mark as direct payment
      }));

      // If purchaseId provided, also get FIFO payment allocations
      let fifoPayments: any[] = [];
      if (purchaseId) {
        const purchaseIdNum = parseInt(purchaseId as string);

        // Get the supplier credit entry for this purchase
        const purchaseCredit = await prisma.supplierCredit.findFirst({
          where: { purchaseId: purchaseIdNum },
        });

        if (purchaseCredit) {
          // Get all payment allocations to this PO's credit
          const allocations = await prisma.supplierPaymentAllocation.findMany({
            where: {
              allocatedCreditId: purchaseCredit.id,
            },
            include: {
              paymentCredit: {
                include: {
                  supplier: {
                    select: {
                      id: true,
                      name: true,
                    },
                  },
                },
              },
              allocatedCredit: {
                include: {
                  purchase: {
                    select: {
                      id: true,
                      purchaseNumber: true,
                      total: true,
                    },
                  },
                },
              },
            },
            orderBy: {
              createdAt: 'desc',
            },
          });

          // Convert FIFO allocations to payment format
          fifoPayments = allocations.map((alloc) => ({
            id: alloc.id,
            purchaseId: purchaseIdNum,
            amount: decimalToNumber(alloc.allocatedAmount) ?? 0,
            paymentMethod: 'Supplier Payment (FIFO)', // Indicate FIFO allocation
            paymentDate: alloc.createdAt,
            reference: alloc.paymentCredit.description || '',
            notes: `Allocated from supplier payment: ${alloc.paymentCredit.description}`,
            createdAt: alloc.createdAt,
            purchase: alloc.allocatedCredit.purchase,
            user: null, // FIFO payments don't have user attribution in current schema
            source: 'fifo', // Mark as FIFO allocation
            supplierId: alloc.paymentCredit.supplierId,
            supplier: alloc.paymentCredit.supplier,
          }));
        }
      }

      // Combine both payment types and sort by date
      const allPayments = [...serializedOldPayments, ...fifoPayments].sort((a, b) => {
        const dateA = new Date(a.paymentDate || a.createdAt).getTime();
        const dateB = new Date(b.paymentDate || b.createdAt).getTime();
        return dateB - dateA; // Most recent first
      });

      return res.json(allPayments);
    } catch (error: any) {
      console.error('Get purchase payments error:', error);
      return res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
        message: error.message,
      });
    }
  }

  static async createPayment(req: AuthRequest, res: Response) {
    // DISABLED: Direct purchase payments are no longer allowed
    // All supplier payments must be made through Supplier Management using FIFO allocation
    return res.status(403).json({
      error: 'Direct purchase payments are disabled',
      code: 'DIRECT_PAYMENT_DISABLED',
      message: 'All payments must be made through Supplier Management → Credits & Outstanding. The system uses FIFO (First-In-First-Out) allocation to automatically distribute payments across purchase orders.',
    });
  }
}

export class PurchaseReceivesController {
  static async getReceives(req: AuthRequest, res: Response) {
    try {
      const { purchaseId, limit } = req.query;

      const where: any = {};
      if (purchaseId) {
        where.purchaseId = parseInt(purchaseId as string);
      }

      const receives = await prisma.purchaseReceive.findMany({
        where,
        include: {
          purchase: {
            select: {
              id: true,
              purchaseNumber: true,
            },
          },
          purchaseItem: {
            select: {
              id: true,
              productName: true,
              quantity: true,
            },
          },
          user: {
            select: {
              id: true,
              fullName: true,
              email: true,
            },
          },
        },
        orderBy: {
          receivedDate: 'desc',
        },
        take: Math.min(parseLimit(limit, 'orders'), 1000),
      });

      // Convert Decimal to numbers
      const serialized = receives.map((receive) => ({
        ...receive,
        receivedQuantity: decimalToNumber(receive.receivedQuantity) ?? 0,
      }));

      return res.json(serialized);
    } catch (error: any) {
      console.error('Get purchase receives error:', error);
      return res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
        message: error.message,
      });
    }
  }

  static async createReceive(req: AuthRequest, res: Response) {
    try {
      const {
        purchaseId,
        purchaseItemId,
        receivedQuantity,
        userId,
        receivedDate,
        notes,
      } = req.body;

      if (!purchaseId || !purchaseItemId || !receivedQuantity) {
        return res.status(400).json({
          error: 'Purchase ID, item ID, and received quantity are required',
          code: 'MISSING_REQUIRED_FIELDS',
        });
      }

      // Verify purchase item exists
      const purchaseItem = await prisma.purchaseItem.findUnique({
        where: { id: parseInt(purchaseItemId) },
        include: {
          purchase: true,
        },
      });

      if (!purchaseItem) {
        return res.status(404).json({
          error: 'Purchase item not found',
          code: 'PURCHASE_ITEM_NOT_FOUND',
        });
      }

      if (purchaseItem.purchase.id !== parseInt(purchaseId)) {
        return res.status(400).json({
          error: 'Purchase item does not belong to this purchase',
          code: 'INVALID_PURCHASE_ITEM',
        });
      }

      const currentReceived = decimalToNumber(purchaseItem.receivedQuantity) ?? 0;
      const totalQuantity = decimalToNumber(purchaseItem.quantity) ?? 0;
      const newReceived = currentReceived + parseFloat(receivedQuantity);

      if (newReceived > totalQuantity) {
        return res.status(400).json({
          error: `Received quantity exceeds ordered quantity. Remaining: ${(totalQuantity - currentReceived).toFixed(3)}`,
          code: 'RECEIVE_EXCEEDS_QUANTITY',
        });
      }

      // Use transaction
      const result = await prisma.$transaction(async (tx) => {
        // Create receive record
        const receive = await tx.purchaseReceive.create({
          data: {
            purchaseId: parseInt(purchaseId),
            purchaseItemId: parseInt(purchaseItemId),
            receivedQuantity: parseFloat(receivedQuantity),
            userId: userId ? parseInt(userId) : req.user?.id || 1,
            receivedDate: receivedDate ? new Date(receivedDate) : new Date(),
            notes: notes || null,
          },
          include: {
            purchaseItem: {
              include: {
                product: true,
              },
            },
            user: {
              select: {
                id: true,
                fullName: true,
                email: true,
              },
            },
          },
        });

        // Update purchase item received quantity
        await tx.purchaseItem.update({
          where: { id: parseInt(purchaseItemId) },
          data: {
            receivedQuantity: newReceived,
          },
        });

        // Update product stock quantity automatically if product exists
        if (purchaseItem.productId) {
          const product = await tx.product.findUnique({
            where: { id: purchaseItem.productId },
            select: {
              id: true,
              stockQuantity: true,
              unitType: true,
              name: true,
            },
          });

          if (product) {
            // Calculate quantity to add based on unit type
            let quantityToAdd = 0;
            const receivedQty = parseFloat(receivedQuantity);

            if (product.unitType === 'weight') {
              // For weight-based products, add the exact quantity (can be fractional)
              quantityToAdd = receivedQty;
            } else {
              // For unit-based products, round up to whole numbers
              quantityToAdd = Math.ceil(receivedQty);
            }

            const currentStock = decimalToNumber(product.stockQuantity);
            if (currentStock === null) {
              throw new Error(`Product ${product.id} has null stock quantity`);
            }
            const newStockQuantity = Number((currentStock + quantityToAdd).toFixed(3));

            // Update product stock
            await tx.product.update({
              where: { id: product.id },
              data: { stockQuantity: newStockQuantity },
            });

            // Create stock movement record to track the stock increase
            await tx.stockMovement.create({
              data: {
                productId: product.id,
                movementType: 'restock',
                quantityChange: quantityToAdd,
                quantityAfter: newStockQuantity,
                userId: userId ? parseInt(userId) : req.user?.id || 1,
                notes: `Purchase receive - PO ${purchaseItem.purchase.purchaseNumber}`,
              },
            });

            // Create stock batch for FIFO cost tracking
            const unitPrice = decimalToNumber(purchaseItem.unitPrice) ?? 0;
            const supplierId = purchaseItem.purchase.supplierId;

            await createStockBatch(
              product.id,
              quantityToAdd,
              unitPrice,
              {
                purchaseId: parseInt(purchaseId),
                purchaseReceiveId: receive.id,
                supplierId: supplierId,
                receivedDate: receivedDate ? new Date(receivedDate) : new Date(),
                notes: `PO ${purchaseItem.purchase.purchaseNumber} - Received ${quantityToAdd} units`,
              },
              tx
            );

            console.log(`✅ Updated stock for product ${product.name}: +${quantityToAdd} (New stock: ${newStockQuantity})`);
            console.log(`✅ Created stock batch with cost price: ${unitPrice}`);
          }
        }

        // Check if all items are fully received and update purchase status
        const allItems = await tx.purchaseItem.findMany({
          where: { purchaseId: parseInt(purchaseId) },
        });

        const allFullyReceived = allItems.every((item) => {
          const qty = decimalToNumber(item.quantity) ?? 0;
          const received = decimalToNumber(item.receivedQuantity) ?? 0;
          return received >= qty;
        });

        if (allFullyReceived) {
          await tx.purchase.update({
            where: { id: parseInt(purchaseId) },
            data: {
              status: 'completed',
              receivedDate: new Date(),
            },
          });
        }

        return receive;
      });

      // Convert Decimal to numbers
      const serialized = {
        ...result,
        receivedQuantity: decimalToNumber(result.receivedQuantity) ?? 0,
      };

      return res.status(201).json(serialized);
    } catch (error: any) {
      console.error('Create purchase receive error:', error);
      return res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
        message: error.message,
      });
    }
  }
}
