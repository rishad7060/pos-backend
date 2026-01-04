import { Response } from 'express';
import { prisma } from '../models/db';
import { AuthRequest } from '../middleware/auth';
import { decimalToNumber } from '../utils/decimal';
import { parseLimit } from '../config/pagination';

export class RegistrySessionsController {
  /**
   * DISABLED: Auto-cleanup has been removed
   * Registry sessions now stay open until manually closed
   * This endpoint is kept for backward compatibility but does nothing
   */
  static async cleanupOldSessions(req: AuthRequest, res: Response) {
    return res.json({
      message: 'Auto-cleanup is disabled. Registry sessions must be closed manually.',
      cleanedCount: 0,
      note: 'Registry sessions stay open until a user explicitly closes them.'
    });
  }

  /**
   * Get all registry sessions (for history/reports)
   */
  static async getSessions(req: AuthRequest, res: Response) {
    try {
      const { limit } = req.query;

      const sessions = await prisma.registrySession.findMany({
        take: parseLimit(limit, 'orders'),
        orderBy: {
          createdAt: 'desc',
        },
        include: {
          openedByUser: {
            select: {
              id: true,
              fullName: true,
              email: true,
            },
          },
          closedByUser: {
            select: {
              id: true,
              fullName: true,
              email: true,
            },
          },
        },
      });

      // Convert Decimal types to numbers
      const sessionsWithNumbers = sessions.map((session) => ({
        id: session.id,
        sessionNumber: session.sessionNumber,
        sessionDate: session.sessionDate.toISOString().split('T')[0],
        status: session.status,
        closeType: session.closeType || 'manual', // How session was closed
        openingCash: decimalToNumber(session.openingCash),
        closingCash: decimalToNumber(session.closingCash),
        actualCash: decimalToNumber(session.actualCash),
        variance: decimalToNumber(session.variance),
        totalSales: decimalToNumber(session.totalSales),
        totalOrders: session.totalOrders,
        cashPayments: decimalToNumber(session.cashPayments),
        cardPayments: decimalToNumber(session.cardPayments),
        otherPayments: decimalToNumber(session.otherPayments),
        cashIn: decimalToNumber(session.cashIn || 0),
        cashOut: decimalToNumber(session.cashOut || 0),
        cashRefunds: decimalToNumber(session.cashRefunds || 0),
        cashierCount: session.cashierCount,
        openedAt: session.openedAt,
        closedAt: session.closedAt,
        notes: session.notes,
        closingNotes: session.closingNotes,
        openerName: session.openedByUser.fullName,
        closerName: session.closedByUser?.fullName || null,
        createdAt: session.createdAt,
      }));

      return res.json(sessionsWithNumbers);
    } catch (error) {
      console.error('Get registry sessions error:', error);
      return res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * Get current open session (shared by all cashiers)
   * NO AUTO-CLOSE: Registry stays open until manually closed
   */
  static async getCurrentSession(req: AuthRequest, res: Response) {
    try {
      console.log('[Registry] Checking for current open session');

      // Find the most recent open session (if any)
      // NO AUTO-CLOSE - session stays open until manually closed
      const session = await prisma.registrySession.findFirst({
        where: {
          status: 'open',
        },
        include: {
          openedByUser: {
            select: {
              id: true,
              fullName: true,
              email: true,
            },
          },
        },
        orderBy: {
          openedAt: 'desc',
        },
      });

      console.log(`[Registry] Found ${session ? 1 : 0} open session(s)`)

      if (!session) {
        console.log('[Registry] No open session found');
        return res.json(null);
      }

      console.log(`[Registry] Returning session: ${session.sessionNumber}`);

      // Get date range for stats update (use session date, not today)
      const sessionDate = new Date(session.sessionDate);
      sessionDate.setHours(0, 0, 0, 0);
      const sessionDateEnd = new Date(sessionDate);
      sessionDateEnd.setDate(sessionDateEnd.getDate() + 1);

      // Update session stats from orders (real-time calculation)
      const updatedSession = await RegistrySessionsController.updateSessionStats(session.id, sessionDate, sessionDateEnd);

      // Convert Decimal types to numbers
      const sessionResponse = {
        id: updatedSession.id,
        sessionNumber: updatedSession.sessionNumber,
        sessionDate: updatedSession.sessionDate.toISOString().split('T')[0],
        status: updatedSession.status,
        closeType: updatedSession.closeType || 'manual',
        openingCash: decimalToNumber(updatedSession.openingCash),
        closingCash: decimalToNumber(updatedSession.closingCash),
        actualCash: decimalToNumber(updatedSession.actualCash),
        variance: decimalToNumber(updatedSession.variance),
        totalSales: decimalToNumber(updatedSession.totalSales),
        totalOrders: updatedSession.totalOrders,
        cashPayments: decimalToNumber(updatedSession.cashPayments),
        cardPayments: decimalToNumber(updatedSession.cardPayments),
        otherPayments: decimalToNumber(updatedSession.otherPayments),
        cashIn: decimalToNumber(updatedSession.cashIn || 0),
        cashOut: decimalToNumber(updatedSession.cashOut || 0),
        cashRefunds: decimalToNumber(updatedSession.cashRefunds || 0),
        cashierCount: updatedSession.cashierCount,
        openedAt: updatedSession.openedAt,
        closedAt: updatedSession.closedAt,
        notes: updatedSession.notes,
        closingNotes: updatedSession.closingNotes,
        openerName: updatedSession.openedByUser.fullName,
        createdAt: updatedSession.createdAt,
      };

      return res.json(sessionResponse);
    } catch (error) {
      console.error('Get current registry session error:', error);
      return res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * Create a new registry session (only if no open session exists)
   * NO AUTO-CLOSE: Sessions stay open until manually closed
   */
  static async createSession(req: AuthRequest, res: Response) {
    try {
      const { openedBy, openingCash, notes, branchId } = req.body;

      if (!openedBy || openingCash === undefined) {
        return res.status(400).json({
          error: 'Opening cash amount and opener user ID are required',
          code: 'MISSING_REQUIRED_FIELDS',
        });
      }

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Check if there's already ANY open session
      // NO AUTO-CLOSE: Only one registry can be open at a time
      const existingSession = await prisma.registrySession.findFirst({
        where: {
          status: 'open',
        },
        orderBy: {
          openedAt: 'desc',
        },
      });

      if (existingSession) {
        return res.status(409).json({
          error: 'A registry session is already open. Please close it before opening a new one.',
          code: 'REGISTRY_ALREADY_OPEN',
          session: {
            id: existingSession.id,
            sessionNumber: existingSession.sessionNumber,
            openedAt: existingSession.openedAt,
          },
        });
      }

      // Generate unique session number (format: REG-YYYYMMDD-XXXX)
      const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');
      const randomSuffix = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
      let sessionNumber = `REG-${dateStr}-${randomSuffix}`;

      // Ensure session number is unique
      let sessionExists = await prisma.registrySession.findUnique({
        where: { sessionNumber },
      });

      let attempts = 0;
      while (sessionExists && attempts < 10) {
        const newSuffix = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
        sessionNumber = `REG-${dateStr}-${newSuffix}`;
        sessionExists = await prisma.registrySession.findUnique({
          where: { sessionNumber },
        });
        attempts++;
      }

      if (sessionExists) {
        return res.status(500).json({
          error: 'Failed to generate unique session number',
          code: 'SESSION_NUMBER_GENERATION_FAILED',
        });
      }

      // Create the session
      const session = await prisma.registrySession.create({
        data: {
          sessionNumber,
          openedBy: parseInt(openedBy),
          branchId: branchId ? parseInt(branchId) : null,
          sessionDate: today,
          status: 'open',
          openingCash: parseFloat(openingCash),
          notes: notes || null,
          cashierCount: 1, // Initial cashier count (the opener)
        },
        include: {
          openedByUser: {
            select: {
              id: true,
              fullName: true,
              email: true,
            },
          },
        },
      });

      // Convert Decimal types to numbers
      const sessionResponse = {
        id: session.id,
        sessionNumber: session.sessionNumber,
        sessionDate: session.sessionDate.toISOString().split('T')[0],
        status: session.status,
        closeType: session.closeType || 'manual',
        openingCash: decimalToNumber(session.openingCash),
        closingCash: decimalToNumber(session.closingCash),
        actualCash: decimalToNumber(session.actualCash),
        variance: decimalToNumber(session.variance),
        totalSales: decimalToNumber(session.totalSales),
        totalOrders: session.totalOrders,
        cashPayments: decimalToNumber(session.cashPayments),
        cardPayments: decimalToNumber(session.cardPayments),
        otherPayments: decimalToNumber(session.otherPayments),
        cashIn: decimalToNumber(session.cashIn || 0),
        cashOut: decimalToNumber(session.cashOut || 0),
        cashRefunds: decimalToNumber(session.cashRefunds || 0),
        cashierCount: session.cashierCount,
        openedAt: session.openedAt,
        closedAt: session.closedAt,
        notes: session.notes,
        closingNotes: session.closingNotes,
        openerName: session.openedByUser.fullName,
        createdAt: session.createdAt,
      };

      // Update the user's active session to record registry opening
      try {
        const activeSession = await prisma.userSession.findFirst({
          where: {
            userId: parseInt(openedBy),
            logoutTime: null, // Active session
          },
          orderBy: {
            loginTime: 'desc',
          },
        });

        if (activeSession) {
          await prisma.userSession.update({
            where: { id: activeSession.id },
            data: {
              registryOpened: true,
              registrySessionId: session.id,
            },
          });
        }
      } catch (sessionError) {
        console.error('Failed to update user session with registry opening:', sessionError);
        // Don't fail session creation if user session update fails
      }

      return res.status(201).json(sessionResponse);
    } catch (error: any) {
      console.error('Create registry session error:', error);
      return res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
        message: error.message,
      });
    }
  }

  /**
   * Update registry session (primarily for closing it)
   */
  static async updateSession(req: AuthRequest, res: Response) {
    try {
      const { id } = req.query;
      const { closedBy, actualCash, closingNotes, status } = req.body;

      if (!id) {
        return res.status(400).json({
          error: 'Session ID is required',
          code: 'MISSING_SESSION_ID',
        });
      }

      const sessionId = parseInt(id as string);

      // Get the session
      const session = await prisma.registrySession.findUnique({
        where: { id: sessionId },
        include: {
          openedByUser: {
            select: {
              id: true,
              fullName: true,
              email: true,
            },
          },
        },
      });

      if (!session) {
        return res.status(404).json({
          error: 'Session not found',
          code: 'SESSION_NOT_FOUND',
        });
      }

      // If closing the session, validate required data first
      if (status === 'closed' || (closedBy && session.status === 'open')) {
        // CRITICAL: Check for pending refunds before allowing registry close
        const pendingRefunds = await prisma.refund.findMany({
          where: {
            registrySessionId: sessionId,
            status: 'pending',
          },
          select: {
            id: true,
            refundNumber: true,
            totalAmount: true,
            cashHandedToCustomer: true,
            reason: true,
          },
        });

        if (pendingRefunds.length > 0) {
          const refundsList = pendingRefunds.map(r => ({
            refundNumber: r.refundNumber,
            amount: decimalToNumber(r.totalAmount),
            cashGiven: r.cashHandedToCustomer,
            reason: r.reason,
          }));

          const totalPendingAmount = pendingRefunds.reduce((sum, r) => sum + (decimalToNumber(r.totalAmount) ?? 0), 0);
          const cashGivenCount = pendingRefunds.filter(r => r.cashHandedToCustomer).length;

          return res.status(400).json({
            error: `Cannot close registry: ${pendingRefunds.length} refund(s) pending admin approval.`,
            code: 'PENDING_REFUNDS_EXIST',
            pendingRefunds: refundsList,
            totalPendingAmount: Number(totalPendingAmount.toFixed(2)),
            cashAlreadyGiven: cashGivenCount,
            message: `You have ${pendingRefunds.length} refund(s) awaiting admin approval (Total: $${totalPendingAmount.toFixed(2)}). ${cashGivenCount > 0 ? `Cash has been given for ${cashGivenCount} refund(s). ` : ''}Please have an admin approve or reject these refunds before closing the registry.`,
            action: 'Please contact admin to approve/reject pending refunds before closing the registry.',
          });
        }

        // REQUIRE actual cash count for closing - this is mandatory
        if (actualCash === undefined || actualCash === null || actualCash === '') {
          return res.status(400).json({
            error: 'Actual cash count is required to close the registry session. Please count all cash in hand and enter the amount.',
            code: 'ACTUAL_CASH_REQUIRED',
          });
        }

        // Validate actual cash is a valid number
        const actualCashNum = parseFloat(actualCash);
        if (isNaN(actualCashNum) || actualCashNum < 0) {
          return res.status(400).json({
            error: 'Actual cash count must be a valid positive number.',
            code: 'INVALID_ACTUAL_CASH',
          });
        }

        // Get today's date range
        const today = new Date(session.sessionDate);
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        // Update session stats
        await RegistrySessionsController.updateSessionStats(sessionId, today, tomorrow);
      }

      // Prepare update data
      const updateData: any = {};

      if (status) {
        updateData.status = status;
      }

      if (closedBy && session.status === 'open') {
        updateData.closedBy = parseInt(closedBy);
        updateData.status = 'closed';
        updateData.closeType = 'manual'; // Always manual close - no auto-close
        updateData.closedAt = new Date();
      }

      if (actualCash !== undefined) {
        updateData.actualCash = parseFloat(actualCash);

        // Calculate variance: expected = openingCash + cashPayments + cashIn - cashOut - cashRefunds
        const openingCashNum = decimalToNumber(session.openingCash) || 0;
        const cashPaymentsNum = decimalToNumber(session.cashPayments) || 0;
        const cashInNum = decimalToNumber(session.cashIn) || 0;
        const cashOutNum = decimalToNumber(session.cashOut) || 0;
        const cashRefundsNum = decimalToNumber(session.cashRefunds) || 0;

        const expectedCash = openingCashNum + cashPaymentsNum + cashInNum - cashOutNum - cashRefundsNum;
        const actual = parseFloat(actualCash);
        updateData.variance = actual - expectedCash;
      }

      if (closingNotes !== undefined) {
        updateData.closingNotes = closingNotes || null;
      }

      // Update the session
      const updatedSession = await prisma.registrySession.update({
        where: { id: sessionId },
        data: updateData,
        include: {
          openedByUser: {
            select: {
              id: true,
              fullName: true,
              email: true,
            },
          },
          closedByUser: {
            select: {
              id: true,
              fullName: true,
              email: true,
            },
          },
        },
      });

      // Convert Decimal types to numbers
      const sessionResponse = {
        id: updatedSession.id,
        sessionNumber: updatedSession.sessionNumber,
        sessionDate: updatedSession.sessionDate.toISOString().split('T')[0],
        status: updatedSession.status,
        closeType: updatedSession.closeType || 'manual',
        openingCash: decimalToNumber(updatedSession.openingCash),
        closingCash: decimalToNumber(updatedSession.closingCash),
        actualCash: decimalToNumber(updatedSession.actualCash),
        variance: decimalToNumber(updatedSession.variance),
        totalSales: decimalToNumber(updatedSession.totalSales),
        totalOrders: updatedSession.totalOrders,
        cashPayments: decimalToNumber(updatedSession.cashPayments),
        cardPayments: decimalToNumber(updatedSession.cardPayments),
        otherPayments: decimalToNumber(updatedSession.otherPayments),
        cashIn: decimalToNumber(updatedSession.cashIn || 0),
        cashOut: decimalToNumber(updatedSession.cashOut || 0),
        cashRefunds: decimalToNumber(updatedSession.cashRefunds || 0),
        cashierCount: updatedSession.cashierCount,
        openedAt: updatedSession.openedAt,
        closedAt: updatedSession.closedAt,
        notes: updatedSession.notes,
        closingNotes: updatedSession.closingNotes,
        openerName: updatedSession.openedByUser.fullName,
        closerName: updatedSession.closedByUser?.fullName || null,
        createdAt: updatedSession.createdAt,
      };

      return res.json(sessionResponse);
    } catch (error: any) {
      console.error('Update registry session error:', error);
      return res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
        message: error.message,
      });
    }
  }

  /**
   * Update session statistics from orders placed during the session
   * TEAM_003: Updated to use registrySessionId for accurate order counting
   */
  static async updateSessionStats(sessionId: number, startDate: Date, endDate: Date) {
    // TEAM_003: Get orders by registrySessionId (accurate), with fallback to date range (for old orders)
    const ordersBySession = await prisma.order.findMany({
      where: {
        status: 'completed',
        registrySessionId: sessionId,
      },
      include: {
        paymentDetails: true,
      },
    });

    // Also get orders by date range that don't have a registrySessionId (backward compatibility)
    const ordersByDate = await prisma.order.findMany({
      where: {
        status: 'completed',
        registrySessionId: null, // Only orders without a session ID
        createdAt: {
          gte: startDate,
          lt: endDate,
        },
      },
      include: {
        paymentDetails: true,
      },
    });

    // Combine both sets of orders
    const orders = [...ordersBySession, ...ordersByDate];

    // Get all cash transactions for the session date
    const cashTransactions = await prisma.cashTransaction.findMany({
      where: {
        registrySessionId: sessionId,
      },
    });

    // Get all CASH refunds for this specific registry session
    // IMPORTANT: Only CASH refunds affect registry cash reconciliation
    // Other payment methods (card, mobile, credit, cheque) do NOT affect cashier's cash drawer:
    //   - Card/Mobile refunds: Processed through payment gateway
    //   - Credit refunds: Reduce customer balance via CustomerCredit transaction
    //   - Cheque refunds: Physical cheque returned or new cheque issued
    //
    // Count cash refunds where:
    //   1. Status is 'completed' (approved), OR
    //   2. Status is 'pending' BUT cash was already handed to customer
    // This ensures accurate cash reconciliation even with pending refunds
    const refunds = await prisma.refund.findMany({
      where: {
        registrySessionId: sessionId,
        refundMethod: 'cash', // ONLY cash refunds
        OR: [
          { status: 'completed' }, // Approved refunds
          {
            status: 'pending',
            cashHandedToCustomer: true, // Pending but cash already given
          },
        ],
      },
    });

    // Calculate statistics
    let totalSales = 0;
    let cashPayments = 0;
    let cardPayments = 0;
    let otherPayments = 0;
    let cashIn = 0;
    let cashOut = 0;
    let cashRefunds = 0;
    const uniqueCashiers = new Set<number>();

    orders.forEach((order) => {
      const total = typeof order.total === 'object' && 'toNumber' in order.total
        ? order.total.toNumber()
        : typeof order.total === 'string'
          ? parseFloat(order.total)
          : typeof order.total === 'number'
            ? order.total
            : 0;

      totalSales += total;
      uniqueCashiers.add(order.cashierId);

      // Calculate payment breakdown from payment details
      if (order.paymentDetails && order.paymentDetails.length > 0) {
        order.paymentDetails.forEach((payment) => {
          const amount = typeof payment.amount === 'object' && 'toNumber' in payment.amount
            ? payment.amount.toNumber()
            : typeof payment.amount === 'string'
              ? parseFloat(payment.amount)
              : typeof payment.amount === 'number'
                ? payment.amount
                : 0;

          if (payment.paymentType === 'cash') {
            cashPayments += amount;
          } else if (payment.paymentType === 'card') {
            cardPayments += amount;
          } else {
            otherPayments += amount;
          }
        });
      } else {
        // Fallback to order payment method if no payment details
        if (order.paymentMethod === 'cash') {
          cashPayments += total;
        } else if (order.paymentMethod === 'card') {
          cardPayments += total;
        } else {
          otherPayments += total;
        }
      }
    });

    // Calculate cash in/out from transactions
    cashTransactions.forEach((transaction) => {
      const amount = typeof transaction.amount === 'object' && 'toNumber' in transaction.amount
        ? transaction.amount.toNumber()
        : typeof transaction.amount === 'string'
          ? parseFloat(transaction.amount)
          : typeof transaction.amount === 'number'
            ? transaction.amount
            : 0;

      if (transaction.transactionType === 'cash_in') {
        cashIn += amount;
      } else if (transaction.transactionType === 'cash_out') {
        cashOut += amount;
      }
    });

    // Calculate cash refunds from completed refunds
    refunds.forEach((refund) => {
      const amount = typeof refund.totalAmount === 'object' && 'toNumber' in refund.totalAmount
        ? refund.totalAmount.toNumber()
        : typeof refund.totalAmount === 'string'
          ? parseFloat(refund.totalAmount)
          : typeof refund.totalAmount === 'number'
            ? refund.totalAmount
            : 0;

      cashRefunds += amount;
    });

    // Update the session with calculated statistics
    const updatedSession = await prisma.registrySession.update({
      where: { id: sessionId },
      data: {
        totalSales,
        totalOrders: orders.length,
        cashPayments,
        cardPayments,
        otherPayments,
        cashIn,
        cashOut,
        cashRefunds,
        cashierCount: uniqueCashiers.size,
      },
      include: {
        openedByUser: {
          select: {
            id: true,
            fullName: true,
            email: true,
          },
        },
      },
    });

    return updatedSession;
  }
}
