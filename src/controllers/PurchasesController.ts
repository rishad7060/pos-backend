import { Response } from 'express';
import { prisma } from '../models/db';
import { AuthRequest } from '../middleware/auth';
import { decimalToNumber } from '../utils/decimal';

export class PurchasesController {
  static async getPurchases(req: AuthRequest, res: Response) {
    try {
      const { id, supplierId, status, limit = 200 } = req.query;

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

        // Calculate paid amount from payments
        const paidAmount = purchase.purchasePayments.reduce((sum, payment) => {
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
        take: Math.min(parseInt(limit as string) || 200, 1000),
      });

      // Convert Decimal to numbers and calculate paid amounts
      const serialized = await Promise.all(
        purchases.map(async (purchase) => {
          const payments = await prisma.purchasePayment.findMany({
            where: { purchaseId: purchase.id },
            select: { amount: true },
          });

          const paidAmount = payments.reduce((sum, payment) => {
            return sum + (decimalToNumber(payment.amount) ?? 0);
          }, 0);

          const items = purchase.purchaseItems.map((item) => ({
            ...item,
            quantity: decimalToNumber(item.quantity) ?? 0,
            unitPrice: decimalToNumber(item.unitPrice) ?? 0,
            totalPrice: decimalToNumber(item.totalPrice) ?? 0,
            receivedQuantity: decimalToNumber(item.receivedQuantity) ?? 0,
          }));

          return {
            ...purchase,
            subtotal: decimalToNumber(purchase.subtotal) ?? 0,
            taxAmount: decimalToNumber(purchase.taxAmount) ?? 0,
            shippingCost: decimalToNumber(purchase.shippingCost) ?? 0,
            total: decimalToNumber(purchase.total) ?? 0,
            paidAmount,
            items, // Frontend expects 'items'
            purchaseItems: items, // Keep for backward compatibility
          };
        })
      );

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
      const { purchaseId, limit = 100 } = req.query;

      const where: any = {};
      if (purchaseId) {
        where.purchaseId = parseInt(purchaseId as string);
      }

      const payments = await prisma.purchasePayment.findMany({
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
        take: Math.min(parseInt(limit as string) || 100, 1000),
      });

      // Convert Decimal to numbers
      const serialized = payments.map((payment) => ({
        ...payment,
        amount: decimalToNumber(payment.amount) ?? 0,
      }));

      return res.json(serialized);
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
    try {
      const {
        purchaseId,
        amount,
        paymentMethod,
        paymentDate,
        reference,
        notes,
        userId,
      } = req.body;

      if (!purchaseId || !amount) {
        return res.status(400).json({
          error: 'Purchase ID and amount are required',
          code: 'MISSING_REQUIRED_FIELDS',
        });
      }

      const purchase = await prisma.purchase.findUnique({
        where: { id: parseInt(purchaseId) },
        include: {
          purchasePayments: true,
        },
      });

      if (!purchase) {
        return res.status(404).json({
          error: 'Purchase not found',
          code: 'PURCHASE_NOT_FOUND',
        });
      }

      // Calculate current paid amount
      const currentPaid = purchase.purchasePayments.reduce((sum, payment) => {
        return sum + (decimalToNumber(payment.amount) ?? 0);
      }, 0);

      const total = decimalToNumber(purchase.total) ?? 0;
      const newPaid = currentPaid + parseFloat(amount);

      if (newPaid > total) {
        return res.status(400).json({
          error: `Payment amount exceeds remaining balance. Remaining: LKR ${(total - currentPaid).toFixed(2)}`,
          code: 'PAYMENT_EXCEEDS_BALANCE',
        });
      }

      // Use transaction
      const result = await prisma.$transaction(async (tx) => {
        // Create payment record
        const payment = await tx.purchasePayment.create({
          data: {
            purchaseId: parseInt(purchaseId),
            amount: parseFloat(amount),
            paymentMethod: paymentMethod || 'cash',
            paymentDate: paymentDate ? new Date(paymentDate) : new Date(),
            reference: reference || null,
            notes: notes || null,
            userId: userId ? parseInt(userId) : req.user?.id || null,
          },
          include: {
            user: {
              select: {
                id: true,
                fullName: true,
                email: true,
              },
            },
          },
        });

        // Update purchase paid amount and payment status
        const newPaymentStatus = newPaid >= total ? 'paid' : 'partial';
        await tx.purchase.update({
          where: { id: parseInt(purchaseId) },
          data: {
            paidAmount: newPaid,
            paymentStatus: newPaymentStatus,
          },
        });

        return payment;
      });

      // Convert Decimal to numbers
      const serialized = {
        ...result,
        amount: decimalToNumber(result.amount) ?? 0,
      };

      return res.status(201).json(serialized);
    } catch (error: any) {
      console.error('Create purchase payment error:', error);
      return res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
        message: error.message,
      });
    }
  }
}

export class PurchaseReceivesController {
  static async getReceives(req: AuthRequest, res: Response) {
    try {
      const { purchaseId, limit = 100 } = req.query;

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
        take: Math.min(parseInt(limit as string) || 100, 1000),
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

            console.log(`✅ Updated stock for product ${product.name}: +${quantityToAdd} (New stock: ${newStockQuantity})`);
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
