import { Response } from 'express';
import { prisma } from '../models/db';
import { AuthRequest } from '../middleware/auth';

import { decimalToNumber } from '../utils/decimal';

export class RefundsController {
  /**
   * Get refunds - supports fetching all or single by ID
   */
  static async getRefunds(req: AuthRequest, res: Response) {
    try {
      const { id, limit } = req.query;

      // If ID is provided, fetch single refund with items
      if (id) {
        const refundId = parseInt(id as string);
        if (isNaN(refundId)) {
          return res.status(400).json({
            error: 'Invalid refund ID',
            code: 'INVALID_ID',
          });
        }

        const refund = await prisma.refund.findUnique({
          where: { id: refundId },
          include: {
            originalOrder: {
              select: {
                id: true,
                orderNumber: true,
                total: true,
              },
            },
            cashier: {
              select: {
                id: true,
                fullName: true,
                email: true,
              },
            },
            customer: {
              select: {
                id: true,
                name: true,
              },
            },
            refundItems: true,
          },
        });

        if (!refund) {
          return res.status(404).json({
            error: 'Refund not found',
            code: 'REFUND_NOT_FOUND',
          });
        }

        // Convert Decimal to numbers and map items
        const serialized = {
          ...refund,
          totalAmount: decimalToNumber(refund.totalAmount) ?? 0,
          items: refund.refundItems.map(item => ({
            ...item,
            quantityReturned: decimalToNumber(item.quantityReturned) ?? 0,
            refundAmount: decimalToNumber(item.refundAmount) ?? 0,
            restockQuantity: decimalToNumber(item.restockQuantity) ?? 0,
          })),
        };

        return res.json(serialized);
      }

      // Otherwise, fetch all refunds
      const refunds = await prisma.refund.findMany({
        include: {
          originalOrder: {
            select: {
              id: true,
              orderNumber: true,
              total: true,
            },
          },
          cashier: {
            select: {
              id: true,
              fullName: true,
              email: true,
            },
          },
          customer: {
            select: {
              id: true,
              name: true,
            },
          },
          refundItems: true,
        },
        orderBy: {
          createdAt: 'desc',
        },
        take: limit ? Math.min(parseInt(limit as string), 1000) : 100,
      });

      // Convert Decimal to numbers
      const serialized = refunds.map(refund => ({
        ...refund,
        totalAmount: decimalToNumber(refund.totalAmount) ?? 0,
      }));

      return res.json(serialized);
    } catch (error: any) {
      console.error('Get refunds error:', error);
      return res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
        message: error.message,
      });
    }
  }

  /**
   * Get refundable items for an order - shows remaining quantities that can be refunded
   */
  static async getRefundableItems(req: AuthRequest, res: Response) {
    try {
      const { orderId } = req.query;

      if (!orderId) {
        return res.status(400).json({
          error: 'Order ID is required',
          code: 'MISSING_ORDER_ID',
        });
      }

      const orderIdNum = parseInt(orderId as string);

      // Get order with items
      const order = await prisma.order.findUnique({
        where: { id: orderIdNum },
        include: {
          orderItems: {
            include: {
              product: {
                select: { id: true, name: true },
              },
              refundItems: {
                include: {
                  refund: {
                    select: { status: true },
                  },
                },
              },
            },
          },
        },
      });

      if (!order) {
        return res.status(404).json({
          error: 'Order not found',
          code: 'ORDER_NOT_FOUND',
        });
      }

      // Calculate refundable quantities for each item
      const refundableItems = order.orderItems.map((item: any) => {
        const originalQty = decimalToNumber(item.netWeightKg) ?? 0;

        // Sum up already refunded quantities (only from completed/pending refunds, not rejected)
        const refundedQty = item.refundItems
          .filter((ri: any) => ri.refund.status !== 'rejected')
          .reduce((sum: number, ri: any) => sum + (decimalToNumber(ri.quantityReturned) ?? 0), 0);

        const remainingQty = Math.max(0, originalQty - refundedQty);
        const pricePerKg = decimalToNumber(item.pricePerKg) ?? 0;
        const originalTotal = decimalToNumber(item.finalTotal) ?? 0;

        return {
          orderItemId: item.id,
          productId: item.productId,
          productName: item.itemName,
          originalQuantity: originalQty,
          alreadyRefundedQuantity: refundedQty,
          refundableQuantity: remainingQty,
          pricePerKg: pricePerKg,
          originalTotal: originalTotal,
          maxRefundAmount: remainingQty * pricePerKg,
          isFullyRefunded: remainingQty <= 0,
        };
      });

      return res.json({
        orderId: order.id,
        orderNumber: order.orderNumber,
        orderTotal: decimalToNumber(order.total) ?? 0,
        orderStatus: order.status,
        items: refundableItems,
      });
    } catch (error: any) {
      console.error('Get refundable items error:', error);
      return res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
        message: error.message,
      });
    }
  }

  /**
   * Create refund request - status defaults to 'pending'
   * Stock is NOT updated here - it's updated on approval
   */
  static async createRefund(req: AuthRequest, res: Response) {
    try {
      const {
        originalOrderId,
        cashierId,
        customerId,
        refundType,
        reason,
        totalAmount,
        refundMethod,
        notes,
        items, // Changed from refundItems for consistency
      } = req.body;

      if (!originalOrderId || !cashierId || !reason || !totalAmount) {
        return res.status(400).json({
          error: 'Missing required fields',
          code: 'MISSING_REQUIRED_FIELDS',
        });
      }

      const refundItems = items || req.body.refundItems || [];

      // Validate refund quantities against available quantities
      for (const item of refundItems) {
        const orderItem = await prisma.orderItem.findUnique({
          where: { id: parseInt(item.orderItemId) },
          include: {
            refundItems: {
              include: {
                refund: {
                  select: { status: true },
                },
              },
            },
          },
        });

        if (!orderItem) {
          return res.status(400).json({
            error: `Order item ${item.orderItemId} not found`,
            code: 'ORDER_ITEM_NOT_FOUND',
          });
        }

        const originalQty = decimalToNumber(orderItem.netWeightKg) ?? 0;
        const alreadyRefunded = orderItem.refundItems
          .filter(ri => ri.refund.status !== 'rejected')
          .reduce((sum, ri) => sum + (decimalToNumber(ri.quantityReturned) ?? 0), 0);

        const requestedQty = parseFloat(item.quantityReturned) || 0;
        const availableQty = originalQty - alreadyRefunded;

        if (requestedQty > availableQty + 0.001) { // Small tolerance for floating point
          return res.status(400).json({
            error: `Cannot refund ${requestedQty} kg of "${item.productName}". Only ${availableQty.toFixed(3)} kg available (already refunded: ${alreadyRefunded.toFixed(3)} kg)`,
            code: 'EXCEEDS_REFUNDABLE_QUANTITY',
          });
        }
      }

      // Generate refund number
      const refundCount = await prisma.refund.count();
      const refundNumber = `REF-${String(refundCount + 1).padStart(4, '0')}`;

      // Check if cashier has auto-approve permission
      const cashierPermission = await prisma.cashierPermission.findUnique({
        where: { cashierId: parseInt(cashierId) },
      });
      const canAutoApprove = cashierPermission?.canAutoApproveRefunds || false;

      // Create refund in transaction
      const result = await prisma.$transaction(async (tx) => {
        // Determine initial status based on permission
        const initialStatus = canAutoApprove ? 'completed' : 'pending';

        // Create the refund record
        const refund = await tx.refund.create({
          data: {
            refundNumber,
            originalOrderId: parseInt(originalOrderId),
            cashierId: parseInt(cashierId),
            customerId: customerId ? parseInt(customerId) : null,
            refundType: refundType || 'full',
            reason,
            totalAmount: parseFloat(totalAmount),
            refundMethod: refundMethod || 'cash',
            status: initialStatus,
            approvedBy: canAutoApprove ? parseInt(cashierId) : null, // Self-approved if auto-approve
            notes: canAutoApprove ? 'Auto-approved: Cashier has full refund permission' : (notes || null),
          },
        });

        // Create refund items if provided
        if (refundItems && Array.isArray(refundItems) && refundItems.length > 0) {
          await tx.refundItem.createMany({
            data: refundItems.map((item: any) => ({
              refundId: refund.id,
              orderItemId: parseInt(item.orderItemId),
              productId: item.productId ? parseInt(item.productId) : null,
              productName: item.productName,
              quantityReturned: parseFloat(item.quantityReturned) || 0,
              refundAmount: parseFloat(item.refundAmount) || 0,
              restockQuantity: item.condition === 'good' ? (parseFloat(item.quantityReturned) || 0) : 0,
              condition: item.condition || 'good',
            })),
          });

          // If auto-approved, update stock immediately for items with condition 'good'
          if (canAutoApprove) {
            for (const item of refundItems) {
              const restockQty = item.condition === 'good' ? (parseFloat(item.quantityReturned) || 0) : 0;

              if (item.productId && restockQty > 0) {
                const product = await tx.product.findUnique({
                  where: { id: parseInt(item.productId) },
                  select: { stockQuantity: true },
                });

                if (product) {
                  const currentStock = decimalToNumber(product.stockQuantity) || 0;
                  const newStockQuantity = currentStock + restockQty;

                  await tx.product.update({
                    where: { id: parseInt(item.productId) },
                    data: { stockQuantity: newStockQuantity },
                  });

                  await tx.stockMovement.create({
                    data: {
                      productId: parseInt(item.productId),
                      movementType: 'refund_restock',
                      quantityChange: restockQty,
                      quantityAfter: newStockQuantity,
                      userId: parseInt(cashierId),
                      notes: `Auto-approved refund: ${refundNumber} - ${item.productName}`,
                    },
                  });
                }
              }
            }
          }
        }

        return refund;
      });

      // Fetch the complete refund with items
      const completeRefund = await prisma.refund.findUnique({
        where: { id: result.id },
        include: {
          originalOrder: {
            select: {
              id: true,
              orderNumber: true,
              total: true,
            },
          },
          cashier: {
            select: {
              id: true,
              fullName: true,
              email: true,
            },
          },
          customer: {
            select: {
              id: true,
              name: true,
            },
          },
          refundItems: true,
        },
      });

      // Convert Decimal to numbers
      const serialized = {
        ...completeRefund,
        totalAmount: decimalToNumber(completeRefund!.totalAmount) ?? 0,
        refundItems: completeRefund!.refundItems.map(item => ({
          ...item,
          quantityReturned: decimalToNumber(item.quantityReturned) ?? 0,
          refundAmount: decimalToNumber(item.refundAmount) ?? 0,
          restockQuantity: decimalToNumber(item.restockQuantity) ?? 0,
        })),
      };

      return res.status(201).json(serialized);
    } catch (error: any) {
      console.error('Create refund error:', error);
      if (error.code === 'P2003') {
        return res.status(400).json({
          error: 'Invalid reference (order, cashier, or customer not found)',
          code: 'INVALID_REFERENCE',
        });
      }
      return res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
        message: error.message,
      });
    }
  }

  /**
   * Update refund - handles approval/rejection
   * Stock is ONLY updated when status changes to 'completed' (approved)
   */
  static async updateRefund(req: AuthRequest, res: Response) {
    try {
      const { id } = req.query;
      const { status, approvedBy, notes, rejectReason } = req.body;

      if (!id) {
        return res.status(400).json({
          error: 'Refund ID is required',
          code: 'MISSING_ID',
        });
      }

      const refundId = parseInt(id as string);
      if (isNaN(refundId)) {
        return res.status(400).json({
          error: 'Invalid refund ID',
          code: 'INVALID_ID',
        });
      }

      // Get the current refund with items
      const currentRefund = await prisma.refund.findUnique({
        where: { id: refundId },
        include: {
          refundItems: true,
        },
      });

      if (!currentRefund) {
        return res.status(404).json({
          error: 'Refund not found',
          code: 'REFUND_NOT_FOUND',
        });
      }

      // Check if refund is already processed
      if (currentRefund.status !== 'pending') {
        return res.status(400).json({
          error: `Refund is already ${currentRefund.status}. Cannot modify.`,
          code: 'REFUND_ALREADY_PROCESSED',
        });
      }

      // Use transaction for approval to ensure atomic stock updates
      const result = await prisma.$transaction(async (tx) => {
        const updateData: any = {};
        if (status !== undefined) updateData.status = status;
        if (approvedBy !== undefined) updateData.approvedBy = approvedBy || null;

        // Store reject reason in notes if rejecting
        if (status === 'rejected' && rejectReason) {
          updateData.notes = `REJECTED: ${rejectReason}${notes ? `\n${notes}` : ''}`;
        } else if (notes !== undefined) {
          updateData.notes = notes || null;
        }

        // If approving (status = 'completed'), update stock for items with condition 'good'
        if (status === 'completed') {
          for (const item of currentRefund.refundItems) {
            const restockQty = decimalToNumber(item.restockQuantity) || 0;

            if (item.productId && restockQty > 0) {
              // Get current stock before update
              const product = await tx.product.findUnique({
                where: { id: item.productId },
                select: { stockQuantity: true },
              });

              if (product) {
                const currentStock = decimalToNumber(product.stockQuantity) || 0;
                const newStockQuantity = currentStock + restockQty;

                // Update product stock
                await tx.product.update({
                  where: { id: item.productId },
                  data: {
                    stockQuantity: newStockQuantity,
                  },
                });

                // Create stock movement record
                await tx.stockMovement.create({
                  data: {
                    productId: item.productId,
                    movementType: 'refund_restock',
                    quantityChange: restockQty,
                    quantityAfter: newStockQuantity,
                    userId: approvedBy || 1,
                    notes: `Refund approved: ${currentRefund.refundNumber} - ${item.productName}`,
                  },
                });
              }
            }
          }
        }

        // Update the refund
        const refund = await tx.refund.update({
          where: { id: refundId },
          data: updateData,
          include: {
            originalOrder: true,
            cashier: {
              select: { id: true, fullName: true, email: true },
            },
            refundItems: true,
          },
        });

        return refund;
      });

      // Convert Decimal to numbers
      const serialized = {
        ...result,
        totalAmount: decimalToNumber(result.totalAmount) ?? 0,
        items: result.refundItems.map(item => ({
          ...item,
          quantityReturned: decimalToNumber(item.quantityReturned) ?? 0,
          refundAmount: decimalToNumber(item.refundAmount) ?? 0,
          restockQuantity: decimalToNumber(item.restockQuantity) ?? 0,
        })),
      };

      return res.json(serialized);
    } catch (error: any) {
      console.error('Update refund error:', error);
      if (error.code === 'P2025') {
        return res.status(404).json({
          error: 'Refund not found',
          code: 'REFUND_NOT_FOUND',
        });
      }
      return res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
        message: error.message,
      });
    }
  }

  static async deleteRefund(req: AuthRequest, res: Response) {
    try {
      const { id } = req.query;

      if (!id) {
        return res.status(400).json({
          error: 'Refund ID is required',
          code: 'MISSING_ID',
        });
      }

      const refundId = parseInt(id as string);
      if (isNaN(refundId)) {
        return res.status(400).json({
          error: 'Invalid refund ID',
          code: 'INVALID_ID',
        });
      }

      // Only allow deleting pending refunds
      const refund = await prisma.refund.findUnique({
        where: { id: refundId },
      });

      if (!refund) {
        return res.status(404).json({
          error: 'Refund not found',
          code: 'REFUND_NOT_FOUND',
        });
      }

      if (refund.status !== 'pending') {
        return res.status(400).json({
          error: 'Only pending refunds can be deleted',
          code: 'CANNOT_DELETE_PROCESSED_REFUND',
        });
      }

      // Delete refund items first, then refund
      await prisma.$transaction([
        prisma.refundItem.deleteMany({ where: { refundId: refundId } }),
        prisma.refund.delete({ where: { id: refundId } }),
      ]);

      return res.json({ message: 'Refund deleted successfully' });
    } catch (error: any) {
      console.error('Delete refund error:', error);
      if (error.code === 'P2025') {
        return res.status(404).json({
          error: 'Refund not found',
          code: 'REFUND_NOT_FOUND',
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
