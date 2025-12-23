import { Response } from 'express';
import { prisma } from '../models/db';
import { AuthRequest } from '../middleware/auth';
import { decimalToNumber } from '../utils/decimal';

export class ChequesController {
  /**
   * Get all cheques with optional filters
   */
  static async getCheques(req: AuthRequest, res: Response) {
    try {
      const {
        status,
        transactionType,
        customerId,
        supplierId,
        startDate,
        endDate,
        limit = 100
      } = req.query;

      const take = Math.min(parseInt(limit as string) || 100, 1000);

      // Build where clause
      const where: any = {};

      if (status) {
        where.status = status;
      }

      if (transactionType) {
        where.transactionType = transactionType;
      }

      if (customerId) {
        where.customerId = parseInt(customerId as string);
      }

      if (supplierId) {
        where.supplierId = parseInt(supplierId as string);
      }

      if (startDate || endDate) {
        where.chequeDate = {};
        if (startDate) {
          where.chequeDate.gte = new Date(startDate as string);
        }
        if (endDate) {
          where.chequeDate.lte = new Date(endDate as string);
        }
      }

      const cheques = await prisma.cheque.findMany({
        where,
        include: {
          order: {
            select: { id: true, orderNumber: true, total: true },
          },
          customer: {
            select: { id: true, name: true, phone: true, email: true },
          },
          purchasePayment: {
            select: {
              id: true,
              amount: true,
              paymentDate: true,
              purchase: {
                select: { id: true, purchaseNumber: true, total: true },
              },
            },
          },
          supplier: {
            select: { id: true, name: true, contactPerson: true, phone: true },
          },
          user: {
            select: { id: true, fullName: true, email: true },
          },
          approver: {
            select: { id: true, fullName: true, email: true },
          },
        },
        orderBy: {
          chequeDate: 'desc', // Show latest cheque date first
        },
        take,
      });

      // Convert Decimal types to numbers
      const serialized = cheques.map(cheque => ({
        ...cheque,
        amount: decimalToNumber(cheque.amount) ?? 0,
        order: cheque.order ? {
          ...cheque.order,
          total: decimalToNumber(cheque.order.total) ?? 0,
        } : null,
        purchasePayment: cheque.purchasePayment ? {
          ...cheque.purchasePayment,
          amount: decimalToNumber(cheque.purchasePayment.amount) ?? 0,
          purchase: cheque.purchasePayment.purchase ? {
            ...cheque.purchasePayment.purchase,
            total: decimalToNumber(cheque.purchasePayment.purchase.total) ?? 0,
          } : null,
        } : null,
      }));

      return res.json(serialized);
    } catch (error) {
      console.error('Get cheques error:', error);
      return res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * Get a single cheque by ID
   */
  static async getChequeById(req: AuthRequest, res: Response) {
    try {
      const { id } = req.params;

      if (!id) {
        return res.status(400).json({
          error: 'Cheque ID is required',
          code: 'MISSING_CHEQUE_ID',
        });
      }

      const chequeIdNum = parseInt(id);
      if (isNaN(chequeIdNum)) {
        return res.status(400).json({
          error: 'Invalid cheque ID',
          code: 'INVALID_CHEQUE_ID',
        });
      }

      const cheque = await prisma.cheque.findUnique({
        where: { id: chequeIdNum },
        include: {
          order: {
            select: { id: true, orderNumber: true, total: true, createdAt: true },
          },
          customer: {
            select: { id: true, name: true, phone: true, email: true },
          },
          purchasePayment: {
            select: {
              id: true,
              amount: true,
              paymentDate: true,
              purchase: {
                select: { id: true, purchaseNumber: true, total: true, status: true },
              },
            },
          },
          supplier: {
            select: { id: true, name: true, contactPerson: true, phone: true, email: true },
          },
          user: {
            select: { id: true, fullName: true, email: true },
          },
          approver: {
            select: { id: true, fullName: true, email: true },
          },
        },
      });

      if (!cheque) {
        return res.status(404).json({
          error: 'Cheque not found',
          code: 'CHEQUE_NOT_FOUND',
        });
      }

      // Convert Decimal types to numbers
      const serialized = {
        ...cheque,
        amount: decimalToNumber(cheque.amount) ?? 0,
        order: cheque.order ? {
          ...cheque.order,
          total: decimalToNumber(cheque.order.total) ?? 0,
        } : null,
        purchasePayment: cheque.purchasePayment ? {
          ...cheque.purchasePayment,
          amount: decimalToNumber(cheque.purchasePayment.amount) ?? 0,
          purchase: cheque.purchasePayment.purchase ? {
            ...cheque.purchasePayment.purchase,
            total: decimalToNumber(cheque.purchasePayment.purchase.total) ?? 0,
          } : null,
        } : null,
      };

      return res.json(serialized);
    } catch (error) {
      console.error('Get cheque by ID error:', error);
      return res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * Create a new cheque record
   */
  static async createCheque(req: AuthRequest, res: Response) {
    try {
      const {
        chequeNumber,
        chequeDate,
        amount,
        payerName,
        payeeName,
        bankName,
        branchName,
        transactionType,
        depositReminderDate,
        orderId,
        customerId,
        purchasePaymentId,
        supplierId,
        notes,
      } = req.body;

      // Validate required fields
      if (!chequeNumber || !chequeDate || !amount || !payerName || !bankName || !transactionType) {
        return res.status(400).json({
          error: 'Cheque number, date, amount, payer name, bank name, and transaction type are required',
          code: 'MISSING_REQUIRED_FIELDS',
        });
      }

      // Validate transaction type
      const validTypes = ['received', 'issued'];
      if (!validTypes.includes(transactionType)) {
        return res.status(400).json({
          error: 'Invalid transaction type. Must be: received or issued',
          code: 'INVALID_TRANSACTION_TYPE',
        });
      }

      // Validate amount is positive
      const amountNum = parseFloat(amount);
      if (isNaN(amountNum) || amountNum <= 0) {
        return res.status(400).json({
          error: 'Invalid amount. Must be a positive number',
          code: 'INVALID_AMOUNT',
        });
      }

      // Check if cheque number already exists
      const existingCheque = await prisma.cheque.findUnique({
        where: { chequeNumber },
      });

      if (existingCheque) {
        return res.status(400).json({
          error: 'Cheque number already exists',
          code: 'DUPLICATE_CHEQUE_NUMBER',
        });
      }

      // Note: Customer/Supplier are optional to allow standalone cheques
      // that can be linked later or used for general tracking

      const cheque = await prisma.cheque.create({
        data: {
          chequeNumber,
          chequeDate: new Date(chequeDate),
          amount: amountNum,
          payerName,
          payeeName: payeeName || null,
          bankName,
          branchName: branchName || null,
          status: 'pending',
          transactionType,
          receivedDate: new Date(),
          depositReminderDate: depositReminderDate ? new Date(depositReminderDate) : null,
          orderId: orderId ? parseInt(orderId) : null,
          customerId: customerId ? parseInt(customerId) : null,
          purchasePaymentId: purchasePaymentId ? parseInt(purchasePaymentId) : null,
          supplierId: supplierId ? parseInt(supplierId) : null,
          userId: req.user?.id || null,
          notes: notes || null,
        },
        include: {
          order: {
            select: { id: true, orderNumber: true, total: true },
          },
          customer: {
            select: { id: true, name: true, phone: true },
          },
          purchasePayment: {
            select: {
              id: true,
              purchase: {
                select: { id: true, purchaseNumber: true },
              },
            },
          },
          supplier: {
            select: { id: true, name: true, phone: true },
          },
          user: {
            select: { id: true, fullName: true },
          },
        },
      });

      // Convert Decimal types to numbers
      const serialized = {
        ...cheque,
        amount: decimalToNumber(cheque.amount) ?? 0,
        order: cheque.order ? {
          ...cheque.order,
          total: decimalToNumber(cheque.order.total) ?? 0,
        } : null,
      };

      return res.status(201).json(serialized);
    } catch (error: any) {
      console.error('Create cheque error:', error);

      if (error.code === 'P2003') {
        return res.status(400).json({
          error: 'Invalid order ID, customer ID, purchase payment ID, or supplier ID',
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
   * Update cheque status
   */
  static async updateChequeStatus(req: AuthRequest, res: Response) {
    try {
      const { id } = req.params;
      const { status, depositDate, clearanceDate, bounceDate, bounceReason, notes } = req.body;

      if (!id) {
        return res.status(400).json({
          error: 'Cheque ID is required',
          code: 'MISSING_CHEQUE_ID',
        });
      }

      const chequeIdNum = parseInt(id);
      if (isNaN(chequeIdNum)) {
        return res.status(400).json({
          error: 'Invalid cheque ID',
          code: 'INVALID_CHEQUE_ID',
        });
      }

      if (!status) {
        return res.status(400).json({
          error: 'Status is required',
          code: 'MISSING_STATUS',
        });
      }

      // Validate status
      const validStatuses = ['pending', 'deposited', 'cleared', 'bounced', 'cancelled'];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({
          error: `Invalid status. Must be: ${validStatuses.join(', ')}`,
          code: 'INVALID_STATUS',
        });
      }

      // Get the cheque
      const cheque = await prisma.cheque.findUnique({
        where: { id: chequeIdNum },
      });

      if (!cheque) {
        return res.status(404).json({
          error: 'Cheque not found',
          code: 'CHEQUE_NOT_FOUND',
        });
      }

      // Build update data
      const updateData: any = {
        status,
        approvedBy: req.user?.id || null,
        updatedAt: new Date(),
      };

      if (depositDate) {
        updateData.depositDate = new Date(depositDate);
      }

      if (clearanceDate) {
        updateData.clearanceDate = new Date(clearanceDate);
      }

      if (bounceDate) {
        updateData.bounceDate = new Date(bounceDate);
      }

      if (bounceReason) {
        updateData.bounceReason = bounceReason;
      }

      if (notes) {
        updateData.notes = notes;
      }

      // Auto-set dates based on status if not provided
      if (status === 'deposited' && !updateData.depositDate) {
        updateData.depositDate = new Date();
      }

      if (status === 'cleared' && !updateData.clearanceDate) {
        updateData.clearanceDate = new Date();
      }

      if (status === 'bounced' && !updateData.bounceDate) {
        updateData.bounceDate = new Date();
      }

      const updatedCheque = await prisma.cheque.update({
        where: { id: chequeIdNum },
        data: updateData,
        include: {
          order: {
            select: { id: true, orderNumber: true, total: true },
          },
          customer: {
            select: { id: true, name: true, phone: true },
          },
          purchasePayment: {
            select: {
              id: true,
              purchase: {
                select: { id: true, purchaseNumber: true },
              },
            },
          },
          supplier: {
            select: { id: true, name: true, phone: true },
          },
          user: {
            select: { id: true, fullName: true },
          },
          approver: {
            select: { id: true, fullName: true },
          },
        },
      });

      // Convert Decimal types to numbers
      const serialized = {
        ...updatedCheque,
        amount: decimalToNumber(updatedCheque.amount) ?? 0,
        order: updatedCheque.order ? {
          ...updatedCheque.order,
          total: decimalToNumber(updatedCheque.order.total) ?? 0,
        } : null,
      };

      return res.json(serialized);
    } catch (error) {
      console.error('Update cheque status error:', error);
      return res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * Cancel a cheque
   */
  static async cancelCheque(req: AuthRequest, res: Response) {
    try {
      const { id } = req.params;
      const { reason } = req.body;

      if (!id) {
        return res.status(400).json({
          error: 'Cheque ID is required',
          code: 'MISSING_CHEQUE_ID',
        });
      }

      const chequeIdNum = parseInt(id);
      if (isNaN(chequeIdNum)) {
        return res.status(400).json({
          error: 'Invalid cheque ID',
          code: 'INVALID_CHEQUE_ID',
        });
      }

      const cheque = await prisma.cheque.findUnique({
        where: { id: chequeIdNum },
      });

      if (!cheque) {
        return res.status(404).json({
          error: 'Cheque not found',
          code: 'CHEQUE_NOT_FOUND',
        });
      }

      // Don't allow cancelling already cleared cheques
      if (cheque.status === 'cleared') {
        return res.status(400).json({
          error: 'Cannot cancel a cleared cheque',
          code: 'CHEQUE_ALREADY_CLEARED',
        });
      }

      const updatedCheque = await prisma.cheque.update({
        where: { id: chequeIdNum },
        data: {
          status: 'cancelled',
          notes: reason ? `Cancelled: ${reason}` : 'Cancelled',
          approvedBy: req.user?.id || null,
          updatedAt: new Date(),
        },
        include: {
          user: {
            select: { id: true, fullName: true },
          },
          approver: {
            select: { id: true, fullName: true },
          },
        },
      });

      const serialized = {
        ...updatedCheque,
        amount: decimalToNumber(updatedCheque.amount) ?? 0,
      };

      return res.json(serialized);
    } catch (error) {
      console.error('Cancel cheque error:', error);
      return res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * Get cheque statistics
   */
  static async getChequeStats(req: AuthRequest, res: Response) {
    try {
      const { startDate, endDate } = req.query;

      const where: any = {};

      if (startDate || endDate) {
        where.chequeDate = {};
        if (startDate) {
          where.chequeDate.gte = new Date(startDate as string);
        }
        if (endDate) {
          where.chequeDate.lte = new Date(endDate as string);
        }
      }

      // Get counts by status
      const statusCounts = await prisma.cheque.groupBy({
        by: ['status'],
        where,
        _count: true,
        _sum: {
          amount: true,
        },
      });

      // Get counts by transaction type
      const typeCounts = await prisma.cheque.groupBy({
        by: ['transactionType'],
        where,
        _count: true,
        _sum: {
          amount: true,
        },
      });

      const stats = {
        byStatus: statusCounts.map(item => ({
          status: item.status,
          count: item._count,
          totalAmount: decimalToNumber(item._sum.amount) ?? 0,
        })),
        byType: typeCounts.map(item => ({
          type: item.transactionType,
          count: item._count,
          totalAmount: decimalToNumber(item._sum.amount) ?? 0,
        })),
      };

      return res.json(stats);
    } catch (error) {
      console.error('Get cheque stats error:', error);
      return res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * Get cheques needing reminder (due for deposit)
   */
  static async getChequesNeedingReminder(req: AuthRequest, res: Response) {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Get cheques where:
      // 1. Status is pending (not deposited yet)
      // 2. depositReminderDate is today or past
      // OR cheque date is past and still pending
      const chequesNeedingReminder = await prisma.cheque.findMany({
        where: {
          status: 'pending',
          OR: [
            {
              depositReminderDate: {
                lte: today,
              },
            },
            {
              // If no reminder date set, use cheque date
              depositReminderDate: null,
              chequeDate: {
                lte: today,
              },
            },
          ],
        },
        include: {
          customer: {
            select: { id: true, name: true, phone: true },
          },
          supplier: {
            select: { id: true, name: true, phone: true },
          },
          order: {
            select: { id: true, orderNumber: true },
          },
          purchasePayment: {
            select: {
              id: true,
              purchase: {
                select: { id: true, purchaseNumber: true },
              },
            },
          },
        },
        orderBy: {
          depositReminderDate: 'asc', // Show most urgent first
        },
      });

      const serialized = chequesNeedingReminder.map(cheque => ({
        ...cheque,
        amount: decimalToNumber(cheque.amount) ?? 0,
      }));

      return res.json(serialized);
    } catch (error) {
      console.error('Get cheques needing reminder error:', error);
      return res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * Endorse a cheque to another party
   */
  static async endorseCheque(req: AuthRequest, res: Response) {
    try {
      const { id } = req.params;
      const { endorsedTo, notes } = req.body;

      if (!id) {
        return res.status(400).json({
          error: 'Cheque ID is required',
          code: 'MISSING_CHEQUE_ID',
        });
      }

      const chequeIdNum = parseInt(id);
      if (isNaN(chequeIdNum)) {
        return res.status(400).json({
          error: 'Invalid cheque ID',
          code: 'INVALID_CHEQUE_ID',
        });
      }

      if (!endorsedTo || !endorsedTo.trim()) {
        return res.status(400).json({
          error: 'Endorsee name is required',
          code: 'MISSING_ENDORSEE',
        });
      }

      const cheque = await prisma.cheque.findUnique({
        where: { id: chequeIdNum },
      });

      if (!cheque) {
        return res.status(404).json({
          error: 'Cheque not found',
          code: 'CHEQUE_NOT_FOUND',
        });
      }

      // Can only endorse received cheques that are pending
      if (cheque.transactionType !== 'received') {
        return res.status(400).json({
          error: 'Can only endorse received cheques',
          code: 'INVALID_TRANSACTION_TYPE',
        });
      }

      if (cheque.status !== 'pending') {
        return res.status(400).json({
          error: 'Can only endorse pending cheques',
          code: 'INVALID_STATUS',
        });
      }

      if (cheque.isEndorsed) {
        return res.status(400).json({
          error: 'Cheque is already endorsed',
          code: 'ALREADY_ENDORSED',
        });
      }

      const updatedCheque = await prisma.cheque.update({
        where: { id: chequeIdNum },
        data: {
          isEndorsed: true,
          endorsedTo: endorsedTo.trim(),
          endorsedDate: new Date(),
          endorsedById: req.user?.id || null,
          notes: notes ? `${cheque.notes ? cheque.notes + ' | ' : ''}Endorsed to ${endorsedTo}. ${notes}` : `${cheque.notes ? cheque.notes + ' | ' : ''}Endorsed to ${endorsedTo}`,
          updatedAt: new Date(),
        },
        include: {
          customer: {
            select: { id: true, name: true },
          },
          supplier: {
            select: { id: true, name: true },
          },
          endorsedByUser: {
            select: { id: true, fullName: true },
          },
        },
      });

      const serialized = {
        ...updatedCheque,
        amount: decimalToNumber(updatedCheque.amount) ?? 0,
      };

      return res.json(serialized);
    } catch (error) {
      console.error('Endorse cheque error:', error);
      return res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
      });
    }
  }
}
