import { Response } from 'express';
import { prisma } from '../models/db';
import { AuthRequest } from '../middleware/auth';

import { decimalToNumber } from '../utils/decimal';
import { parseLimit, getPaginationParams } from '../config/pagination';

// Refund Method Constants
const REFUND_METHODS = {
  CASH: 'cash',
  CARD: 'card',
  MOBILE: 'mobile',
  CREDIT: 'credit',  // Store credit - reduces customer balance
  CHEQUE: 'cheque',   // Cheque payment
} as const;

const VALID_REFUND_METHODS = Object.values(REFUND_METHODS);

// Refund Status Constants
const REFUND_STATUS = {
  PENDING: 'pending',
  COMPLETED: 'completed',
  REJECTED: 'rejected',
} as const;

// Payment methods that affect cashier's cash reconciliation
const CASH_AFFECTING_METHODS = [REFUND_METHODS.CASH];

// Payment methods that require customer credit balance update
const CREDIT_METHODS = [REFUND_METHODS.CREDIT];

// Payment methods that require cheque handling
const CHEQUE_METHODS = [REFUND_METHODS.CHEQUE];

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
        take: limit ? parseLimit(limit, 'refunds') : 100,
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
        registrySessionId, // Link to current registry session
        refundType,
        reason,
        totalAmount,
        refundMethod,
        cashHandedToCustomer, // Track if physical cash was given
        notes,
        items, // Changed from refundItems for consistency
      } = req.body;

      if (!originalOrderId || !cashierId || !reason || !totalAmount) {
        return res.status(400).json({
          error: 'Missing required fields',
          code: 'MISSING_REQUIRED_FIELDS',
        });
      }

      // Validate refund method
      const method = refundMethod || REFUND_METHODS.CASH;
      if (!VALID_REFUND_METHODS.includes(method)) {
        return res.status(400).json({
          error: `Invalid refund method. Must be one of: ${VALID_REFUND_METHODS.join(', ')}`,
          code: 'INVALID_REFUND_METHOD',
        });
      }

      // Validate cashHandedToCustomer - only applicable for cash refunds
      if (cashHandedToCustomer && method !== REFUND_METHODS.CASH) {
        return res.status(400).json({
          error: 'cashHandedToCustomer can only be true for cash refunds',
          code: 'INVALID_CASH_HANDED_FLAG',
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

      // Handle cheque refunds - determine if we need to return original cheque or create new one
      let chequeData: { originalChequeId?: number; refundChequeId?: number } = {};
      if (method === REFUND_METHODS.CHEQUE) {
        // Get the original order to check if it was paid with cheque
        const originalOrder = await prisma.order.findUnique({
          where: { id: parseInt(originalOrderId) },
          include: {
            cheques: true,
          },
        });

        if (!originalOrder) {
          return res.status(404).json({
            error: 'Original order not found',
            code: 'ORDER_NOT_FOUND',
          });
        }

        // Find cheque from original order
        const originalCheque = originalOrder.cheques?.[0];

        // Determine if this is a full or partial refund
        const orderTotal = decimalToNumber(originalOrder.total) ?? 0;
        const refundAmount = parseFloat(totalAmount);
        const isFullRefund = Math.abs(orderTotal - refundAmount) < 0.01; // Allow small floating point difference

        if (isFullRefund && originalCheque) {
          // Full refund: Return the original cheque to customer
          chequeData.originalChequeId = originalCheque.id;
        } else {
          // Partial refund or no original cheque: Create a new cheque for the refund amount
          // The cheque will be created after the refund is approved
          // For now, we don't create it - it will be created on approval
          // This is handled in the updateRefund method
        }
      }

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
            registrySessionId: registrySessionId ? parseInt(registrySessionId) : null, // Link to registry session
            refundType: refundType || 'full',
            reason,
            totalAmount: parseFloat(totalAmount),
            refundMethod: method, // Use validated method
            status: initialStatus,
            approvedBy: canAutoApprove ? parseInt(cashierId) : null, // Self-approved if auto-approve
            cashHandedToCustomer: cashHandedToCustomer === true, // Track if cash was physically given
            cashHandedAt: cashHandedToCustomer === true ? new Date() : null, // Timestamp when cash given
            // Cheque tracking
            originalChequeId: chequeData.originalChequeId || null,
            refundChequeId: chequeData.refundChequeId || null,
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

            // Handle cheque refunds for auto-approved refunds
            if (method === REFUND_METHODS.CHEQUE) {
              if (chequeData.originalChequeId) {
                // Full refund: Mark original cheque as cancelled
                await tx.cheque.update({
                  where: { id: chequeData.originalChequeId },
                  data: {
                    status: 'cancelled',
                    notes: `Auto-approved refund: ${refundNumber} - Original cheque returned to customer`,
                  },
                });
                console.log(`✅ Auto-approved: Original cheque #${chequeData.originalChequeId} marked as cancelled`);
              } else {
                // Partial refund: Create new cheque
                const refundAmountNum = parseFloat(totalAmount);
                const chequeNumber = `CHQ-REF-${refundNumber}`;

                if (customerId) {
                  // Fetch customer name for cheque
                  const customer = await tx.customer.findUnique({
                    where: { id: parseInt(customerId) },
                    select: { name: true },
                  });

                  const newCheque = await tx.cheque.create({
                    data: {
                      chequeNumber: chequeNumber,
                      amount: refundAmountNum,
                      chequeDate: new Date(),
                      payerName: customer?.name || 'Unknown Customer',
                      bankName: 'System Generated',
                      transactionType: 'issued',
                      status: 'pending',
                      customerId: parseInt(customerId),
                      userId: parseInt(cashierId),
                      notes: `Auto-approved refund cheque for ${refundNumber}`,
                    },
                  });

                  // Update refund with new cheque ID
                  await tx.refund.update({
                    where: { id: refund.id },
                    data: { refundChequeId: newCheque.id },
                  });

                  console.log(`✅ Auto-approved: Created new refund cheque #${newCheque.id} for LKR ${refundAmountNum}`);
                }
              }
            }

            // Handle credit refunds for auto-approved refunds
            if (method === REFUND_METHODS.CREDIT && customerId) {
              const refundAmountNum = parseFloat(totalAmount);
              const customerIdNum = parseInt(customerId);

              // Get customer's current credit balance
              const latestCredit = await tx.customerCredit.findFirst({
                where: { customerId: customerIdNum },
                orderBy: { createdAt: 'desc' },
              });

              const currentBalance = decimalToNumber(latestCredit?.balance) ?? 0;
              const newBalance = currentBalance + refundAmountNum;

              // Create credit transaction
              await tx.customerCredit.create({
                data: {
                  customerId: customerIdNum,
                  orderId: parseInt(originalOrderId),
                  transactionType: 'credit_refunded',
                  amount: refundAmountNum,
                  balance: newBalance,
                  description: `Auto-approved store credit from refund ${refundNumber}`,
                  userId: parseInt(cashierId),
                },
              });

              console.log(`✅ Auto-approved: Created CustomerCredit transaction: +LKR ${refundAmountNum} (new balance: LKR ${newBalance})`);
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
        // CRITICAL: Restore stock to the SAME batches that were originally sold (maintains FIFO accuracy)
        if (status === 'completed') {
          for (const item of currentRefund.refundItems) {
            const restockQty = decimalToNumber(item.restockQuantity) || 0;

            if (item.productId && restockQty > 0) {
              // Get the original order item to find which batches were used
              const orderItemBatches = await tx.orderItemBatch.findMany({
                where: { orderItemId: item.orderItemId },
                include: { stockBatch: true },
                orderBy: { quantityUsed: 'desc' }, // Restore to newest batches first (LIFO restore)
              });

              if (orderItemBatches.length > 0) {
                // Restore stock to the SAME batches that were sold (LIFO order for restoration)
                let remainingToRestock = restockQty;

                for (const oib of orderItemBatches) {
                  if (remainingToRestock <= 0) break;

                  const quantityUsedFromBatch = decimalToNumber(oib.quantityUsed) || 0;
                  const quantityToRestore = Math.min(remainingToRestock, quantityUsedFromBatch);

                  // Update the batch quantity
                  const currentBatchQty = decimalToNumber(oib.stockBatch.quantityRemaining) || 0;
                  const newBatchQty = currentBatchQty + quantityToRestore;

                  await tx.stockBatch.update({
                    where: { id: oib.stockBatchId },
                    data: { quantityRemaining: newBatchQty },
                  });

                  console.log(`✅ Restored ${quantityToRestore}kg to batch ${oib.stockBatch.batchNumber} (new qty: ${newBatchQty}kg)`);

                  remainingToRestock -= quantityToRestore;
                }

                // Update product stock and weighted average cost
                const product = await tx.product.findUnique({
                  where: { id: item.productId },
                  select: { stockQuantity: true },
                });

                if (product) {
                  const currentStock = decimalToNumber(product.stockQuantity) || 0;
                  const newStockQuantity = currentStock + restockQty;

                  // Recalculate weighted average cost after restocking
                  const batches = await tx.stockBatch.findMany({
                    where: {
                      productId: item.productId,
                      quantityRemaining: { gt: 0 },
                    },
                  });

                  let totalCost = 0;
                  let totalQty = 0;
                  for (const batch of batches) {
                    const qty = decimalToNumber(batch.quantityRemaining) || 0;
                    const cost = decimalToNumber(batch.costPrice) || 0;
                    totalCost += qty * cost;
                    totalQty += qty;
                  }

                  const newWeightedAvgCost = totalQty > 0 ? totalCost / totalQty : 0;

                  // Update product stock and cost
                  await tx.product.update({
                    where: { id: item.productId },
                    data: {
                      stockQuantity: newStockQuantity,
                      costPrice: newWeightedAvgCost,
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
                      notes: `Refund approved: ${currentRefund.refundNumber} - ${item.productName} (restored to original batches)`,
                    },
                  });

                  console.log(`✅ Updated product stock: ${newStockQuantity}kg, new avg cost: $${newWeightedAvgCost.toFixed(2)}/kg`);
                }
              } else {
                // Fallback: No batch tracking found, just update product stock (shouldn't happen for weight-based products)
                console.warn(`⚠️ No batch tracking found for order item ${item.orderItemId}, using fallback stock update`);

                const product = await tx.product.findUnique({
                  where: { id: item.productId },
                  select: { stockQuantity: true },
                });

                if (product) {
                  const currentStock = decimalToNumber(product.stockQuantity) || 0;
                  const newStockQuantity = currentStock + restockQty;

                  await tx.product.update({
                    where: { id: item.productId },
                    data: { stockQuantity: newStockQuantity },
                  });

                  await tx.stockMovement.create({
                    data: {
                      productId: item.productId,
                      movementType: 'refund_restock',
                      quantityChange: restockQty,
                      quantityAfter: newStockQuantity,
                      userId: approvedBy || 1,
                      notes: `Refund approved: ${currentRefund.refundNumber} - ${item.productName} (no batch tracking)`,
                    },
                  });
                }
              }
            }
          }

          // Handle cheque refunds on approval
          if (currentRefund.refundMethod === REFUND_METHODS.CHEQUE) {
            if (currentRefund.originalChequeId) {
              // Full refund: Return original cheque - mark it as cancelled/returned
              await tx.cheque.update({
                where: { id: currentRefund.originalChequeId },
                data: {
                  status: 'cancelled',
                  notes: `Refund approved: ${currentRefund.refundNumber} - Original cheque returned to customer`,
                },
              });
              console.log(`✅ Original cheque #${currentRefund.originalChequeId} marked as cancelled (returned to customer)`);
            } else {
              // Partial refund: Create a new cheque for the refund amount
              const refundAmount = decimalToNumber(currentRefund.totalAmount) ?? 0;
              const chequeNumber = `CHQ-REF-${currentRefund.refundNumber}`;

              // Get customer info from the refund
              const refundWithCustomer = await tx.refund.findUnique({
                where: { id: currentRefund.id },
                include: {
                  customer: true,
                  originalOrder: true,
                },
              });

              if (refundWithCustomer?.customerId) {
                // Get customer details for cheque
                const customer = await tx.customer.findUnique({
                  where: { id: refundWithCustomer.customerId },
                });

                const newCheque = await tx.cheque.create({
                  data: {
                    chequeNumber: chequeNumber,
                    chequeDate: new Date(),
                    amount: refundAmount,
                    payerName: 'POS Store', // The store is issuing the cheque
                    payeeName: customer?.name || 'Customer',
                    bankName: 'Store Bank', // TODO: Make this configurable
                    transactionType: 'issued', // We are issuing the cheque to customer
                    status: 'pending',
                    customerId: refundWithCustomer.customerId,
                    notes: `Refund cheque for ${currentRefund.refundNumber} - Partial refund of order ${refundWithCustomer.originalOrder?.orderNumber}`,
                  },
                });

                // Link the new cheque to the refund
                updateData.refundChequeId = newCheque.id;
                console.log(`✅ Created new refund cheque #${newCheque.id} for LKR ${refundAmount}`);
              }
            }
          }

          // Handle credit refunds on approval - create CustomerCredit transaction
          if (currentRefund.refundMethod === REFUND_METHODS.CREDIT && currentRefund.customerId) {
            const refundAmount = decimalToNumber(currentRefund.totalAmount) ?? 0;

            // Get customer's current credit balance
            const latestCredit = await tx.customerCredit.findFirst({
              where: { customerId: currentRefund.customerId },
              orderBy: { createdAt: 'desc' },
            });

            const currentBalance = decimalToNumber(latestCredit?.balance) ?? 0;
            const newBalance = currentBalance + refundAmount;

            // Create credit transaction
            await tx.customerCredit.create({
              data: {
                customerId: currentRefund.customerId,
                orderId: currentRefund.originalOrderId,
                transactionType: 'credit_refunded',
                amount: refundAmount,
                balance: newBalance,
                description: `Store credit from refund ${currentRefund.refundNumber}`,
                userId: approvedBy || 1,
              },
            });

            console.log(`✅ Created CustomerCredit transaction: +LKR ${refundAmount} (new balance: LKR ${newBalance})`);
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
