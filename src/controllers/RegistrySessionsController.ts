import { Response } from 'express';
import { prisma } from '../models/db';
import { AuthRequest } from '../middleware/auth';
import { decimalToNumber } from '../utils/decimal';

export class RegistrySessionsController {
  /**
   * Clean up old open registry sessions (force close with zero variance if needed)
   */
  static async cleanupOldSessions(req: AuthRequest, res: Response) {
    try {
      // Find sessions that are more than 24 hours old and still open
      const oneDayAgo = new Date();
      oneDayAgo.setDate(oneDayAgo.getDate() - 1);

      const oldOpenSessions = await prisma.registrySession.findMany({
        where: {
          status: 'open',
          openedAt: {
            lt: oneDayAgo,
          },
        },
      });

      let cleanedCount = 0;
      for (const session of oldOpenSessions) {
        // Force close with zero variance (assume cash was properly counted)
        const today = new Date(session.sessionDate);
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        // Update stats first
        await RegistrySessionsController.updateSessionStats(session.id, today, tomorrow);

        // Force close with zero variance
        await prisma.registrySession.update({
          where: { id: session.id },
          data: {
            status: 'closed',
            closedBy: session.openedBy, // Closed by the same person who opened
            actualCash: 0, // Assume zero for cleanup
            variance: 0, // No variance for cleanup
            closingNotes: 'Auto-closed due to no activity (cleanup)',
            closedAt: new Date(),
          },
        });

        cleanedCount++;
      }

      return res.json({
        message: `Cleaned up ${cleanedCount} old open registry sessions`,
        cleanedCount,
      });
    } catch (error) {
      console.error('Error cleaning up old sessions:', error);
      return res.status(500).json({
        error: 'Failed to cleanup old sessions',
        code: 'CLEANUP_ERROR',
      });
    }
  }

  /**
   * Get all registry sessions (for history/reports)
   */
  static async getSessions(req: AuthRequest, res: Response) {
    try {
      const { limit = 50 } = req.query;

      const sessions = await prisma.registrySession.findMany({
        take: Math.min(parseInt(limit as string), 100),
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
   * Get current open session for today (one session per day, shared by all cashiers)
   */
  static async getCurrentSession(req: AuthRequest, res: Response) {
    try {
      // Get today's date string (YYYY-MM-DD)
      const todayStr = new Date().toISOString().split('T')[0];
      console.log('[Registry] Checking for current session. Today:', todayStr);

      // AUTO CLEANUP: Close sessions that are more than 24 hours old
      const oneDayAgo = new Date();
      oneDayAgo.setDate(oneDayAgo.getDate() - 1);

      const oldSessions = await prisma.registrySession.findMany({
        where: {
          status: 'open',
          openedAt: {
            lt: oneDayAgo,
          },
        },
      });

      if (oldSessions.length > 0) {
        console.log(`[Registry] Found ${oldSessions.length} old open sessions, auto-closing...`);
        for (const oldSession of oldSessions) {
          // Force close old sessions with zero variance
          await prisma.registrySession.update({
            where: { id: oldSession.id },
            data: {
              status: 'closed',
              closedBy: oldSession.openedBy, // Closed by opener
              actualCash: 0,
              variance: 0,
              closingNotes: 'Auto-closed due to age (24+ hours)',
              closedAt: new Date(),
            },
          });
          console.log(`[Registry] Auto-closed session ${oldSession.sessionNumber}`);
        }
      }

      // Find all open sessions (after cleanup)
      const openSessions = await prisma.registrySession.findMany({
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

      console.log(`[Registry] Found ${openSessions.length} open session(s)`);

      // Find session for today by comparing date strings
      let session = openSessions.find((s) => {
        const sessionDateStr = s.sessionDate.toISOString().split('T')[0];
        const isToday = sessionDateStr === todayStr;
        console.log(`[Registry] Session ${s.sessionNumber}: date=${sessionDateStr}, isToday=${isToday}`);
        return isToday;
      });

      // If no session found for today, try to find the most recent open session (might be from today but timezone issue)
      if (!session && openSessions.length > 0) {
        const mostRecentSession = openSessions[0];
        const sessionDateStr = mostRecentSession.sessionDate.toISOString().split('T')[0];
        console.log(`[Registry] No exact match for today. Most recent session: ${mostRecentSession.sessionNumber}, date: ${sessionDateStr}`);

        // If the most recent session was opened today (check openedAt), use it
        const openedToday = mostRecentSession.openedAt.toISOString().split('T')[0] === todayStr;
        if (openedToday) {
          console.log(`[Registry] Using most recent session opened today: ${mostRecentSession.sessionNumber}`);
          session = mostRecentSession;
        }
      }

      // Auto-close old open sessions that aren't from today (in background, don't block)
      // Only close sessions that are definitely not from today and not the current session
      for (const oldSession of openSessions) {
        const sessionDateStr = oldSession.sessionDate.toISOString().split('T')[0];
        const openedToday = oldSession.openedAt.toISOString().split('T')[0] === todayStr;

        // Only close if definitely not from today AND not the session we're using
        if (sessionDateStr !== todayStr && !openedToday && (!session || oldSession.id !== session.id)) {
          console.log(`[Registry] Auto-closing old session: ${oldSession.sessionNumber} (date: ${sessionDateStr})`);
          // Auto-close old session in background (don't await)
          prisma.registrySession.update({
            where: { id: oldSession.id },
            data: {
              status: 'closed',
              closingNotes: 'Auto-closed: Session date is not today',
            },
          }).catch((err) => {
            console.error('Error auto-closing old session:', err);
          });
        }
      }

      // If no session found yet, use the most recent open session (regardless of date)
      // This handles edge cases where date comparison might fail or registry stays open across days
      if (!session && openSessions.length > 0) {
        session = openSessions[0];
        console.log(`[Registry] Using most recent open session as fallback: ${session.sessionNumber}`);
      }

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
   * Create a new registry session (only if no open session exists for today)
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

      // Get today's date string (YYYY-MM-DD)
      const todayStr = new Date().toISOString().split('T')[0];
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Check if there's already an open session for today
      // Use the same logic as getCurrentSession for consistency
      const openSessions = await prisma.registrySession.findMany({
        where: {
          status: 'open',
        },
        orderBy: {
          openedAt: 'desc',
        },
      });

      // Filter to find session for today by comparing date strings
      const existingSession = openSessions.find((s) => {
        const sessionDateStr = s.sessionDate.toISOString().split('T')[0];
        return sessionDateStr === todayStr;
      });

      if (existingSession) {
        return res.status(409).json({
          error: 'A registry session is already open for today',
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
  private static async updateSessionStats(sessionId: number, startDate: Date, endDate: Date) {
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

    // Get all completed refunds with cash refund method for the session date
    const refunds = await prisma.refund.findMany({
      where: {
        status: 'completed',
        refundMethod: 'cash',
        createdAt: {
          gte: startDate,
          lt: endDate,
        },
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
        : parseFloat(order.total.toString());

      totalSales += total;
      uniqueCashiers.add(order.cashierId);

      // Calculate payment breakdown from payment details
      if (order.paymentDetails && order.paymentDetails.length > 0) {
        order.paymentDetails.forEach((payment) => {
          const amount = typeof payment.amount === 'object' && 'toNumber' in payment.amount
            ? payment.amount.toNumber()
            : parseFloat(payment.amount.toString());

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
        : parseFloat(transaction.amount.toString());

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
        : parseFloat(refund.totalAmount.toString());

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
