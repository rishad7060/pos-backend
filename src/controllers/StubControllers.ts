// Stub controllers for endpoints that don't have database models yet
import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { prisma } from '../models/db';
import bcrypt from 'bcrypt';
import { decimalToNumber } from '../utils/decimal';

export class UserSessionsController {
  static async getUserSessions(req: AuthRequest, res: Response) {
    try {
      const { limit = 100, userId, startDate, endDate, status = 'all' } = req.query;

      const where: any = {};

      if (userId) {
        const userIdNum = parseInt(userId as string);
        if (!isNaN(userIdNum)) {
          where.userId = userIdNum;
        }
      }

      if (startDate || endDate) {
        where.loginTime = {};
        if (startDate) {
          where.loginTime.gte = new Date(startDate as string);
        }
        if (endDate) {
          const end = new Date(endDate as string);
          end.setHours(23, 59, 59, 999);
          where.loginTime.lte = end;
        }
      }

      // Filter by session status
      if (status === 'active') {
        where.logoutTime = null;
      } else if (status === 'completed') {
        where.logoutTime = { not: null };
      }

      const take = Math.min(parseInt(limit as string) || 100, 1000);

      try {
        const sessions = await prisma.userSession.findMany({
          where,
          include: {
            user: {
              select: {
                id: true,
                fullName: true,
                email: true,
                role: true
              },
            },
          },
          orderBy: {
            loginTime: 'desc',
          },
          take,
        });

        // Convert and add computed fields
        const serialized = sessions.map(session => ({
          ...session,
          sessionDuration: session.logoutTime
            ? Math.round((new Date(session.logoutTime).getTime() - new Date(session.loginTime).getTime()) / (1000 * 60))
            : null,
          registrySession: null, // Simplified for now
        }));

        return res.json(serialized);
      } catch (dbError: any) {
        console.error('Database error in getUserSessions:', dbError);
        // Handle case where UserSession table doesn't exist yet
        if (dbError.code === 'P2021' || dbError.message?.includes('user_sessions') || dbError.message?.includes('relation') || dbError.message?.includes('column')) {
          console.log('UserSession table or relations not found, returning empty array');
          return res.json([]);
        }
        return res.status(500).json({
          error: 'Internal server error',
          code: 'INTERNAL_ERROR',
          message: dbError.message,
        });
      }
    } catch (error) {
      console.error('Get user sessions error:', error);
      return res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
      });
    }
  }

  static async recordLogin(req: AuthRequest, res: Response) {
    try {
      const { loginMethod = 'password', ipAddress, userAgent } = req.body;

      const session = await prisma.userSession.create({
        data: {
          userId: req.user.id,
          loginMethod,
          ipAddress,
          userAgent,
          registryOpened: false,
        },
        include: {
          user: {
            select: { id: true, fullName: true, email: true, role: true },
          },
        },
      });

      return res.status(201).json(session);
    } catch (error: any) {
      // Handle case where UserSession table doesn't exist yet
      if (error.code === 'P2021' || error.message?.includes('user_sessions')) {
        console.log('UserSession table not found, login not recorded');
        return res.status(201).json({ message: 'Login successful (session tracking not available)' });
      }
      console.error('Record login error:', error);
      return res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
      });
    }
  }

  static async recordLogout(req: AuthRequest, res: Response) {
    try {
      // Find the active session for the authenticated user
      const activeSession = await prisma.userSession.findFirst({
        where: {
          userId: req.user.id,
          logoutTime: null, // Active session
        },
        orderBy: {
          loginTime: 'desc',
        },
      });

      if (!activeSession) {
        return res.status(404).json({
          error: 'No active session found',
          code: 'NO_ACTIVE_SESSION',
        });
      }

      const session = await prisma.userSession.update({
        where: { id: activeSession.id },
        data: {
          logoutTime: new Date(),
        },
        include: {
          user: {
            select: { id: true, fullName: true, email: true, role: true },
          },
        },
      });

      // Calculate session duration
      const duration = Math.round(
        (new Date(session.logoutTime!).getTime() - new Date(session.loginTime).getTime()) / (1000 * 60)
      );

      await prisma.userSession.update({
        where: { id: session.id },
        data: { sessionDuration: duration },
      });

      return res.json({
        ...session,
        sessionDuration: duration,
      });
    } catch (error: any) {
      // Handle case where UserSession table doesn't exist yet
      if (error.code === 'P2021' || error.message?.includes('user_sessions')) {
        console.log('UserSession table not found, logout not recorded');
        return res.json({ message: 'Logout successful (session tracking not available)' });
      }
      console.error('Record logout error:', error);
      return res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
      });
    }
  }

  static async recordRegistryOpen(req: AuthRequest, res: Response) {
    try {
      const { sessionId, registrySessionId } = req.body;

      if (!sessionId || !registrySessionId) {
        return res.status(400).json({
          error: 'Session ID and Registry Session ID are required',
          code: 'MISSING_IDS',
        });
      }

      const session = await prisma.userSession.update({
        where: { id: parseInt(sessionId) },
        data: {
          registryOpened: true,
          registrySessionId: parseInt(registrySessionId),
        },
        include: {
          user: {
            select: { id: true, fullName: true, email: true, role: true },
          },
          registrySession: {
            select: {
              id: true,
              sessionNumber: true,
              status: true,
              openedAt: true,
            },
          },
        },
      });

      return res.json(session);
    } catch (error: any) {
      // Handle case where UserSession table doesn't exist yet
      if (error.code === 'P2021' || error.message?.includes('user_sessions')) {
        console.log('UserSession table not found, registry open not recorded');
        return res.json({ message: 'Registry opened (session tracking not available)' });
      }
      console.error('Record registry open error:', error);
      return res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
      });
    }
  }
}

export class ShiftsController {
  static async getShifts(req: AuthRequest, res: Response) {
    try {
      const { limit = 100, cashierId, branchId, status } = req.query;

      const where: any = {};

      if (cashierId) {
        const cashierIdNum = parseInt(cashierId as string);
        if (!isNaN(cashierIdNum)) {
          where.cashierId = cashierIdNum;
        }
      }

      if (branchId) {
        const branchIdNum = parseInt(branchId as string);
        if (!isNaN(branchIdNum)) {
          where.branchId = branchIdNum;
        }
      }

      if (status) {
        where.status = status;
      }

      const take = Math.min(parseInt(limit as string) || 100, 1000);

      const shifts = await prisma.cashierShift.findMany({
        where,
        include: {
          cashier: {
            select: { id: true, fullName: true, email: true },
          },
          branch: {
            select: { id: true, name: true, code: true },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
        take,
      });

      // Convert Decimal types to numbers
      const serialized = shifts.map(shift => ({
        ...shift,
        openingCash: decimalToNumber(shift.openingCash) ?? 0,
        closingCash: decimalToNumber(shift.closingCash),
        expectedCash: decimalToNumber(shift.expectedCash),
        actualCash: decimalToNumber(shift.actualCash),
        variance: decimalToNumber(shift.variance),
        totalSales: decimalToNumber(shift.totalSales) ?? 0,
        totalRefunds: decimalToNumber(shift.totalRefunds) ?? 0,
        cashPayments: decimalToNumber(shift.cashPayments) ?? 0,
        cardPayments: decimalToNumber(shift.cardPayments) ?? 0,
        otherPayments: decimalToNumber(shift.otherPayments) ?? 0,
      }));

      return res.json(serialized);
    } catch (error) {
      console.error('Get shifts error:', error);
      return res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
      });
    }
  }

  static async updateShift(req: AuthRequest, res: Response) {
    try {
      const { id } = req.query;
      const { closingCash, actualCash, notes } = req.body;

      if (!id) {
        return res.status(400).json({
          error: 'Shift ID is required',
          code: 'MISSING_SHIFT_ID',
        });
      }

      const shiftId = parseInt(id as string);
      if (isNaN(shiftId)) {
        return res.status(400).json({
          error: 'Invalid shift ID',
          code: 'INVALID_SHIFT_ID',
        });
      }

      // Get the current shift
      const currentShift = await prisma.cashierShift.findUnique({
        where: { id: shiftId },
      });

      if (!currentShift) {
        return res.status(404).json({
          error: 'Shift not found',
          code: 'SHIFT_NOT_FOUND',
        });
      }

      if (currentShift.status === 'closed') {
        return res.status(400).json({
          error: 'Shift is already closed',
          code: 'SHIFT_ALREADY_CLOSED',
        });
      }

      // Calculate variance and expected cash
      const closingCashNum = closingCash ? parseFloat(closingCash) : 0;
      const actualCashNum = actualCash ? parseFloat(actualCash) : 0;
      const expectedCash = decimalToNumber(currentShift.openingCash) ?? 0;
      const variance = actualCashNum - expectedCash;

      const updatedShift = await prisma.cashierShift.update({
        where: { id: shiftId },
        data: {
          status: 'closed',
          closingCash: closingCashNum,
          actualCash: actualCashNum,
          expectedCash: expectedCash,
          variance: variance,
          closedAt: new Date(),
          notes: notes || currentShift.notes,
        },
        include: {
          cashier: {
            select: { id: true, fullName: true, email: true },
          },
          branch: {
            select: { id: true, name: true, code: true },
          },
        },
      });

      // Convert Decimal types to numbers
      const serialized = {
        ...updatedShift,
        openingCash: decimalToNumber(updatedShift.openingCash) ?? 0,
        closingCash: decimalToNumber(updatedShift.closingCash),
        expectedCash: decimalToNumber(updatedShift.expectedCash),
        actualCash: decimalToNumber(updatedShift.actualCash),
        variance: decimalToNumber(updatedShift.variance),
        totalSales: decimalToNumber(updatedShift.totalSales) ?? 0,
        totalRefunds: decimalToNumber(updatedShift.totalRefunds) ?? 0,
        cashPayments: decimalToNumber(updatedShift.cashPayments) ?? 0,
        cardPayments: decimalToNumber(updatedShift.cardPayments) ?? 0,
        otherPayments: decimalToNumber(updatedShift.otherPayments) ?? 0,
      };

      return res.json(serialized);
    } catch (error) {
      console.error('Update shift error:', error);
      return res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
      });
    }
  }
}

export class BranchesController {
  static async getBranches(req: AuthRequest, res: Response) {
    try {
      const { limit = 10, isActive } = req.query;

      const where: any = {};
      if (isActive !== undefined) {
        where.isActive = isActive === 'true';
      }

      const take = Math.min(parseInt(limit as string) || 10, 100);

      const branches = await prisma.branch.findMany({
        where,
        include: {
          manager: {
            select: { id: true, fullName: true, email: true },
          },
          _count: {
            select: {
              purchases: true,
              expenses: true,
              cashierShifts: true,
              registrySessions: true,
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
        take,
      });

      return res.json(branches);
    } catch (error) {
      console.error('Get branches error:', error);
      return res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
      });
    }
  }

  static async createBranch(req: AuthRequest, res: Response) {
    try {
      const { name, code, address, phone, email, managerId, isActive = true } = req.body;

      if (!name || !code) {
        return res.status(400).json({
          error: 'Branch name and code are required',
          code: 'MISSING_REQUIRED_FIELDS',
        });
      }

      // Check if name or code already exists
      const existingBranch = await prisma.branch.findFirst({
        where: {
          OR: [
            { name: name.trim() },
            { code: code.trim() },
          ],
        },
      });

      if (existingBranch) {
        return res.status(400).json({
          error: 'Branch with this name or code already exists',
          code: 'DUPLICATE_BRANCH',
        });
      }

      const branchData: any = {
        name: name.trim(),
        code: code.trim(),
        address: address?.trim() || null,
        phone: phone?.trim() || null,
        email: email?.trim() || null,
        isActive: Boolean(isActive),
      };

      // Validate manager if provided
      if (managerId) {
        const managerIdNum = parseInt(managerId);
        if (isNaN(managerIdNum)) {
          return res.status(400).json({
            error: 'Invalid manager ID',
            code: 'INVALID_MANAGER_ID',
          });
        }

        const manager = await prisma.user.findUnique({
          where: { id: managerIdNum },
          select: { id: true, role: true, isActive: true },
        });

        if (!manager || manager.role !== 'admin' || !manager.isActive) {
          return res.status(400).json({
            error: 'Invalid manager - must be an active admin user',
            code: 'INVALID_MANAGER',
          });
        }

        branchData.managerId = managerIdNum;
      }

      const branch = await prisma.branch.create({
        data: branchData,
        include: {
          manager: {
            select: { id: true, fullName: true, email: true },
          },
          _count: {
            select: {
              purchases: true,
              expenses: true,
              cashierShifts: true,
              registrySessions: true,
            },
          },
        },
      });

      return res.status(201).json(branch);
    } catch (error: any) {
      console.error('Create branch error:', error);

      if (error.code === 'P2002') {
        return res.status(400).json({
          error: 'Branch with this name or code already exists',
          code: 'DUPLICATE_BRANCH',
        });
      }

      return res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
      });
    }
  }
}

export class CashiersController {
  static async getCashiers(req: AuthRequest, res: Response) {
    try {
      // Get users with cashier role, including their PINs
      const cashiers = await prisma.user.findMany({
        where: { role: 'cashier', isActive: true },
        select: {
          id: true,
          email: true,
          fullName: true,
          role: true,
          isActive: true,
          createdAt: true,
          cashierPin: {
            select: {
              pin: true,
              isActive: true,
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      // Transform to include pins array
      const cashiersWithPins = cashiers.map((cashier) => ({
        ...cashier,
        pins: cashier.cashierPin?.isActive ? [cashier.cashierPin.pin] : [],
      }));

      return res.json(cashiersWithPins);
    } catch (error) {
      console.error('Get cashiers error:', error);
      return res.json([]);
    }
  }

  static async createCashier(req: AuthRequest, res: Response) {
    try {
      const { fullName, pin } = req.body;

      if (!fullName || !pin) {
        return res.status(400).json({
          error: 'Full name and PIN are required',
          code: 'VALIDATION_ERROR',
        });
      }

      // Validate PIN format (6 digits)
      if (!/^\d{6}$/.test(pin)) {
        return res.status(400).json({
          error: 'PIN must be exactly 6 digits',
          code: 'VALIDATION_ERROR',
        });
      }

      // Check if name is already in use by another active cashier (case-insensitive)
      const trimmedName = fullName.trim();
      const normalizedName = trimmedName.toLowerCase();

      // Find existing cashiers and check case-insensitively
      const allCashiers = await prisma.user.findMany({
        where: {
          role: 'cashier',
          isActive: true,
        },
        select: {
          id: true,
          fullName: true,
        },
      });

      const existingCashier = allCashiers.find(cashier =>
        cashier.fullName.toLowerCase() === normalizedName
      );

      if (existingCashier) {
        console.log(`Duplicate name detected: "${trimmedName}" matches existing cashier "${existingCashier.fullName}" (ID: ${existingCashier.id})`);
        return res.status(400).json({
          error: `This name "${trimmedName}" is already in use by another cashier (case-insensitive match with "${existingCashier.fullName}"). Please choose a different name.`,
          code: 'DUPLICATE_NAME',
        });
      }

      // Check if PIN is already in use by another active cashier
      const existingPin = await prisma.cashierPin.findFirst({
        where: {
          pin: pin,
          isActive: true,
        },
      });

      if (existingPin) {
        return res.status(400).json({
          error: 'This PIN is already in use by another cashier. Please choose a different PIN.',
          code: 'DUPLICATE_PIN',
        });
      }

      // Generate email from fullName (lowercase, replace spaces with dots)
      const emailBase = fullName.toLowerCase().replace(/\s+/g, '.');
      let email = `${emailBase}@cashier.pos.com`;
      let emailCounter = 1;

      // Ensure unique email
      while (await prisma.user.findUnique({ where: { email } })) {
        email = `${emailBase}${emailCounter}@cashier.pos.com`;
        emailCounter++;
      }

      // Create user with default password hash (cashiers use PIN, not password)
      const defaultPassword = await bcrypt.hash('cashier123', 12);

      const user = await prisma.user.create({
        data: {
          email,
          passwordHash: defaultPassword,
          fullName,
          role: 'cashier',
          isActive: true,
        },
      });

      // Create PIN for the cashier
      const cashierPin = await prisma.cashierPin.create({
        data: {
          userId: user.id,
          pin,
          isActive: true,
          assignedBy: req.user!.id, // Assigned by the admin creating it
        },
      });

      return res.status(201).json({
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        isActive: user.isActive,
        createdAt: user.createdAt,
        pins: [cashierPin.pin],
      });
    } catch (error: any) {
      console.error('Create cashier error:', error);
      if (error.code === 'P2002') {
        return res.status(409).json({
          error: 'A cashier with this information already exists',
          code: 'DUPLICATE_ERROR',
        });
      }
      return res.status(500).json({
        error: 'Failed to create cashier',
        code: 'INTERNAL_ERROR',
        message: error.message,
      });
    }
  }

  static async updateCashier(req: AuthRequest, res: Response) {
    try {
      const { cashierId, fullName, pin } = req.body;

      if (!cashierId) {
        return res.status(400).json({
          error: 'Cashier ID is required',
          code: 'VALIDATION_ERROR',
        });
      }

      const updateData: any = {};
      if (fullName) {
        // Check if name is already in use by another active cashier (excluding current cashier, case-insensitive)
        const trimmedName = fullName.trim();
        const normalizedName = trimmedName.toLowerCase();

        // Find existing cashiers (excluding current) and check case-insensitively
        const allOtherCashiers = await prisma.user.findMany({
          where: {
            role: 'cashier',
            isActive: true,
            id: {
              not: parseInt(cashierId), // Exclude current cashier
            },
          },
          select: {
            id: true,
            fullName: true,
          },
        });

        const existingCashier = allOtherCashiers.find(cashier =>
          cashier.fullName.toLowerCase() === normalizedName
        );

        if (existingCashier) {
          console.log(`Duplicate name detected during update: "${trimmedName}" matches existing cashier "${existingCashier.fullName}" (ID: ${existingCashier.id}, current cashier: ${cashierId})`);
          return res.status(400).json({
            error: `This name "${trimmedName}" is already in use by another cashier (case-insensitive match with "${existingCashier.fullName}"). Please choose a different name.`,
            code: 'DUPLICATE_NAME',
          });
        }

        updateData.fullName = trimmedName;
      }

      // Update user if name changed
      if (Object.keys(updateData).length > 0) {
        await prisma.user.update({
          where: { id: parseInt(cashierId) },
          data: updateData,
        });
      }

      // Update PIN if provided
      if (pin) {
        if (!/^\d{6}$/.test(pin)) {
          return res.status(400).json({
            error: 'PIN must be exactly 6 digits',
            code: 'VALIDATION_ERROR',
          });
        }

        // Check if PIN is already in use by another active cashier (excluding current cashier)
        const existingPin = await prisma.cashierPin.findFirst({
          where: {
            pin: pin,
            isActive: true,
            userId: {
              not: parseInt(cashierId), // Exclude current cashier
            },
          },
        });

        if (existingPin) {
          return res.status(400).json({
            error: 'This PIN is already in use by another cashier. Please choose a different PIN.',
            code: 'DUPLICATE_PIN',
          });
        }

        await prisma.cashierPin.upsert({
          where: { userId: parseInt(cashierId) },
          update: {
            pin,
            isActive: true,
            assignedBy: req.user!.id,
          },
          create: {
            userId: parseInt(cashierId),
            pin,
            isActive: true,
            assignedBy: req.user!.id,
          },
        });
      }

      // Fetch updated user
      const updatedUser = await prisma.user.findUnique({
        where: { id: parseInt(cashierId) },
        select: {
          id: true,
          email: true,
          fullName: true,
          role: true,
          isActive: true,
          createdAt: true,
          cashierPin: {
            select: {
              pin: true,
              isActive: true,
            },
          },
        },
      });

      if (!updatedUser) {
        return res.status(404).json({
          error: 'Cashier not found',
          code: 'NOT_FOUND',
        });
      }

      return res.json({
        ...updatedUser,
        pins: updatedUser.cashierPin?.isActive ? [updatedUser.cashierPin.pin] : [],
      });
    } catch (error: any) {
      console.error('Update cashier error:', error);
      return res.status(500).json({
        error: 'Failed to update cashier',
        code: 'INTERNAL_ERROR',
        message: error.message,
      });
    }
  }
}

export class CashierPinsController {
  static async getPins(req: AuthRequest, res: Response) {
    return res.json([]);
  }

  static async createPin(req: AuthRequest, res: Response) {
    return res.status(201).json({ id: Date.now(), ...req.body, createdAt: new Date() });
  }

  static async updatePin(req: AuthRequest, res: Response) {
    return res.json({ id: req.query.id, ...req.body, updatedAt: new Date() });
  }

  static async deletePin(req: AuthRequest, res: Response) {
    return res.json({ success: true });
  }
}

export class ManagerPermissionsController {
  static async getPermissions(req: AuthRequest, res: Response) {
    try {
      const { managerId } = req.query;

      if (managerId) {
        try {
          // Get permissions for specific manager
          const permission = await prisma.managerPermission.findUnique({
            where: { managerId: parseInt(managerId as string) },
          });

          if (permission) {
            return res.json(permission);
          } else {
            // Return default permissions if none exist
            return res.json({
              managerId: parseInt(managerId as string),
              canViewDashboard: true,
              canViewReports: true,
              canExportReports: true,
              canViewUsers: false,
              canCreateUsers: false,
              canEditUsers: false,
              canDeleteUsers: false,
              canViewProducts: true,
              canCreateProducts: true,
              canEditProducts: true,
              canDeleteProducts: false,
              canUpdateStock: true,
              canViewOrders: true,
              canEditOrders: false,
              canVoidOrders: false,
              canViewCustomers: true,
              canCreateCustomers: true,
              canEditCustomers: true,
              canDeleteCustomers: false,
              canViewPurchases: true,
              canCreatePurchases: true,
              canEditPurchases: false,
              canApprovePurchases: false,
              canViewExpenses: true,
              canCreateExpenses: false,
              canViewFinancialSummary: true,
              canViewSettings: false,
              canEditSettings: false,
            });
          }
        } catch (error: any) {
          console.warn('ManagerPermission table may not exist yet, returning defaults:', error.message);
          // Return default permissions if table doesn't exist
          return res.json({
            managerId: parseInt(managerId as string),
            canViewDashboard: true,
            canViewReports: true,
            canExportReports: true,
            canViewUsers: false,
            canCreateUsers: false,
            canEditUsers: false,
            canDeleteUsers: false,
            canViewProducts: true,
            canCreateProducts: true,
            canEditProducts: true,
            canDeleteProducts: false,
            canUpdateStock: true,
            canViewOrders: true,
            canEditOrders: false,
            canVoidOrders: false,
            canViewCustomers: true,
            canCreateCustomers: true,
            canEditCustomers: true,
            canDeleteCustomers: false,
            canViewPurchases: true,
            canCreatePurchases: true,
            canEditPurchases: false,
            canApprovePurchases: false,
            canViewExpenses: true,
            canCreateExpenses: false,
            canViewFinancialSummary: true,
            canViewSettings: false,
            canEditSettings: false,
          });
        }
      }

      // Get all manager permissions
      try {
        const allPermissions = await prisma.managerPermission.findMany({
          include: {
            manager: {
              select: { id: true, fullName: true, email: true }
            }
          }
        });

        return res.json(allPermissions);
      } catch (error: any) {
        console.warn('ManagerPermission table may not exist yet, returning empty array:', error.message);
        return res.json([]);
      }
    } catch (error: any) {
      console.error('Get manager permissions error:', error);
      return res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
        message: error.message,
      });
    }
  }

  static async createPermission(req: AuthRequest, res: Response) {
    try {
      const {
        managerId,
        canViewDashboard = true,
        canViewReports = true,
        canExportReports = true,
        canViewUsers = false,
        canCreateUsers = false,
        canEditUsers = false,
        canDeleteUsers = false,
        canViewProducts = true,
        canCreateProducts = true,
        canEditProducts = true,
        canDeleteProducts = false,
        canUpdateStock = true,
        canViewOrders = true,
        canEditOrders = false,
        canVoidOrders = false,
        canViewCustomers = true,
        canCreateCustomers = true,
        canEditCustomers = true,
        canDeleteCustomers = false,
        canViewPurchases = true,
        canCreatePurchases = true,
        canEditPurchases = false,
        canApprovePurchases = false,
        canViewExpenses = true,
        canCreateExpenses = false,
        canViewFinancialSummary = true,
        canViewSettings = false,
        canEditSettings = false,
      } = req.body;

      if (!managerId) {
        return res.status(400).json({
          error: 'Manager ID is required',
          code: 'MISSING_MANAGER_ID',
        });
      }

      // Check if permission already exists
      const existing = await prisma.managerPermission.findUnique({
        where: { managerId: parseInt(managerId) },
      });

      if (existing) {
        return res.status(400).json({
          error: 'Permissions already exist for this manager',
          code: 'PERMISSIONS_EXIST',
        });
      }

      try {
        const permission = await prisma.managerPermission.create({
          data: {
            managerId: parseInt(managerId),
            canViewDashboard,
            canViewReports,
            canExportReports,
            canViewUsers,
            canCreateUsers,
            canEditUsers,
            canDeleteUsers,
            canViewProducts,
            canCreateProducts,
            canEditProducts,
            canDeleteProducts,
            canUpdateStock,
            canViewOrders,
            canEditOrders,
            canVoidOrders,
            canViewCustomers,
            canCreateCustomers,
            canEditCustomers,
            canDeleteCustomers,
            canViewPurchases,
            canCreatePurchases,
            canEditPurchases,
            canApprovePurchases,
            canViewExpenses,
            canCreateExpenses,
            canViewFinancialSummary,
            canViewSettings,
            canEditSettings,
          },
          include: {
            manager: {
              select: { id: true, fullName: true, email: true },
            },
          },
        });

        return res.status(201).json(permission);
      } catch (error: any) {
        console.warn('ManagerPermission table may not exist yet:', error.message);
        return res.status(400).json({
          error: 'Manager permissions cannot be created yet. Database migration may be required.',
          code: 'TABLE_NOT_READY',
        });
      }
    } catch (error: any) {
      console.error('Create manager permission error:', error);
      if (error.code === 'P2002') {
        return res.status(400).json({
          error: 'Permissions already exist for this manager',
          code: 'DUPLICATE_PERMISSION',
        });
      }
      return res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
        message: error.message,
      });
    }
  }

  static async updatePermission(req: AuthRequest, res: Response) {
    try {
      const { id } = req.query;
      const updates = req.body;

      if (!id) {
        return res.status(400).json({
          error: 'Permission ID is required',
          code: 'MISSING_ID',
        });
      }

      const permissionId = parseInt(id as string);
      if (isNaN(permissionId)) {
        return res.status(400).json({
          error: 'Invalid permission ID',
          code: 'INVALID_ID',
        });
      }

      // Prepare update data
      const updateData: any = {};
      const permissionFields = [
        'canViewDashboard', 'canViewReports', 'canExportReports',
        'canViewUsers', 'canCreateUsers', 'canEditUsers', 'canDeleteUsers',
        'canViewProducts', 'canCreateProducts', 'canEditProducts', 'canDeleteProducts',
        'canUpdateStock', 'canViewOrders', 'canEditOrders', 'canVoidOrders',
        'canViewCustomers', 'canCreateCustomers', 'canEditCustomers', 'canDeleteCustomers',
        'canViewPurchases', 'canCreatePurchases', 'canEditPurchases', 'canApprovePurchases',
        'canViewExpenses', 'canCreateExpenses', 'canViewFinancialSummary',
        'canViewSettings', 'canEditSettings'
      ];

      permissionFields.forEach(field => {
        if (updates[field] !== undefined) {
          updateData[field] = updates[field];
        }
      });

      try {
        const permission = await prisma.managerPermission.update({
          where: { id: permissionId },
          data: updateData,
          include: {
            manager: {
              select: { id: true, fullName: true, email: true },
            },
          },
        });

        return res.json(permission);
      } catch (error: any) {
        console.warn('ManagerPermission table may not exist yet:', error.message);
        return res.status(400).json({
          error: 'Manager permissions cannot be updated yet. Database migration may be required.',
          code: 'TABLE_NOT_READY',
        });
      }
    } catch (error: any) {
      console.error('Update manager permission error:', error);
      if (error.code === 'P2025') {
        return res.status(404).json({
          error: 'Permission not found',
          code: 'PERMISSION_NOT_FOUND',
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

export class CashierPermissionsController {
  static async getPermissions(req: AuthRequest, res: Response) {
    try {
      const { cashierId, limit = 100 } = req.query;

      if (cashierId) {
        // Get permissions for specific cashier
        const permission = await prisma.cashierPermission.findUnique({
          where: { cashierId: parseInt(cashierId as string) },
        });

        if (permission) {
          // Convert Decimal types to numbers
          const serialized = {
            ...permission,
            maxDiscountPercent: decimalToNumber(permission.maxDiscountPercent),
          };
          return res.json(serialized);
        } else {
          // Return default permissions if none exist
          return res.json({
            cashierId: parseInt(cashierId as string),
            canApplyDiscount: true,
            maxDiscountPercent: 20,
            canVoidOrders: false,
            canEditPrices: false,
            canAccessReports: false,
            requireManagerApproval: false,
            canUpdateStock: false,
            canProcessRefunds: false,
            canAutoApproveRefunds: false,
          });
        }
      }

      // Get all permissions
      const permissions = await prisma.cashierPermission.findMany({
        take: Math.min(parseInt(limit as string), 1000),
        include: {
          cashier: {
            select: { id: true, fullName: true, email: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      // Convert Decimal types to numbers
      const serialized = permissions.map(perm => ({
        ...perm,
        maxDiscountPercent: decimalToNumber(perm.maxDiscountPercent),
      }));

      return res.json(serialized);
    } catch (error: any) {
      console.error('Get cashier permissions error:', error);
      return res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
      });
    }
  }

  static async createPermission(req: AuthRequest, res: Response) {
    try {
      const {
        cashierId,
        canApplyDiscount,
        maxDiscountPercent,
        canVoidOrders,
        canEditPrices,
        canAccessReports,
        requireManagerApproval,
        canUpdateStock,
        canProcessRefunds,
        canAutoApproveRefunds,
      } = req.body;

      if (!cashierId) {
        return res.status(400).json({
          error: 'Cashier ID is required',
          code: 'MISSING_CASHIER_ID',
        });
      }

      // Build update data - only include fields that are explicitly provided
      const updateData: any = {};
      if (canApplyDiscount !== undefined) updateData.canApplyDiscount = canApplyDiscount;
      if (maxDiscountPercent !== undefined) updateData.maxDiscountPercent = parseFloat(maxDiscountPercent);
      if (canVoidOrders !== undefined) updateData.canVoidOrders = canVoidOrders;
      if (canEditPrices !== undefined) updateData.canEditPrices = canEditPrices;
      if (canAccessReports !== undefined) updateData.canAccessReports = canAccessReports;
      if (requireManagerApproval !== undefined) updateData.requireManagerApproval = requireManagerApproval;
      if (canUpdateStock !== undefined) updateData.canUpdateStock = canUpdateStock;
      if (canProcessRefunds !== undefined) updateData.canProcessRefunds = canProcessRefunds;
      if (canAutoApproveRefunds !== undefined) updateData.canAutoApproveRefunds = canAutoApproveRefunds;

      // Check if permission already exists
      const existingPermission = await prisma.cashierPermission.findUnique({
        where: { cashierId: parseInt(cashierId) },
      });

      let permission;
      if (existingPermission) {
        // Update existing permission - only update provided fields
        permission = await prisma.cashierPermission.update({
          where: { cashierId: parseInt(cashierId) },
          data: updateData,
          include: {
            cashier: {
              select: { id: true, fullName: true, email: true },
            },
          },
        });
      } else {
        // Create new permission with defaults for fields not provided
        permission = await prisma.cashierPermission.create({
          data: {
            cashierId: parseInt(cashierId),
            canApplyDiscount: canApplyDiscount ?? true,
            maxDiscountPercent: maxDiscountPercent !== undefined ? parseFloat(maxDiscountPercent) : 20,
            canVoidOrders: canVoidOrders ?? false,
            canEditPrices: canEditPrices ?? false,
            canAccessReports: canAccessReports ?? false,
            requireManagerApproval: requireManagerApproval ?? false,
            canUpdateStock: canUpdateStock ?? false,
            canProcessRefunds: canProcessRefunds ?? false,
            canAutoApproveRefunds: canAutoApproveRefunds ?? false,
          },
          include: {
            cashier: {
              select: { id: true, fullName: true, email: true },
            },
          },
        });
      }

      // Convert Decimal types to numbers
      const serialized = {
        ...permission,
        maxDiscountPercent: decimalToNumber(permission.maxDiscountPercent),
      };

      return res.status(201).json(serialized);
    } catch (error: any) {
      console.error('Create cashier permission error:', error);
      if (error.code === 'P2002') {
        return res.status(400).json({
          error: 'Permissions already exist for this cashier',
          code: 'DUPLICATE_PERMISSION',
        });
      }
      return res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
      });
    }
  }

  static async updatePermission(req: AuthRequest, res: Response) {
    try {
      const { id } = req.query;
      const updates = req.body;

      if (!id) {
        return res.status(400).json({
          error: 'Permission ID is required',
          code: 'MISSING_ID',
        });
      }

      const permissionId = parseInt(id as string);
      if (isNaN(permissionId)) {
        return res.status(400).json({
          error: 'Invalid permission ID',
          code: 'INVALID_ID',
        });
      }

      // Prepare update data
      const updateData: any = {};
      if (updates.canApplyDiscount !== undefined) updateData.canApplyDiscount = updates.canApplyDiscount;
      if (updates.maxDiscountPercent !== undefined) updateData.maxDiscountPercent = parseFloat(updates.maxDiscountPercent);
      if (updates.canVoidOrders !== undefined) updateData.canVoidOrders = updates.canVoidOrders;
      if (updates.canEditPrices !== undefined) updateData.canEditPrices = updates.canEditPrices;
      if (updates.canAccessReports !== undefined) updateData.canAccessReports = updates.canAccessReports;
      if (updates.requireManagerApproval !== undefined) updateData.requireManagerApproval = updates.requireManagerApproval;
      if (updates.canUpdateStock !== undefined) updateData.canUpdateStock = updates.canUpdateStock;
      if (updates.canProcessRefunds !== undefined) updateData.canProcessRefunds = updates.canProcessRefunds;
      if (updates.canAutoApproveRefunds !== undefined) updateData.canAutoApproveRefunds = updates.canAutoApproveRefunds;

      const permission = await prisma.cashierPermission.update({
        where: { id: permissionId },
        data: updateData,
        include: {
          cashier: {
            select: { id: true, fullName: true, email: true },
          },
        },
      });

      // Convert Decimal types to numbers
      const serialized = {
        ...permission,
        maxDiscountPercent: decimalToNumber(permission.maxDiscountPercent),
      };

      return res.json(serialized);
    } catch (error: any) {
      console.error('Update cashier permission error:', error);
      if (error.code === 'P2025') {
        return res.status(404).json({
          error: 'Permission not found',
          code: 'PERMISSION_NOT_FOUND',
        });
      }
      return res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
      });
    }
  }
}

export class PrinterSettingsController {
  static async getSettings(req: AuthRequest, res: Response) {
    return res.json({
      id: 1,
      printerName: 'Default Printer',
      printerType: 'thermal',
      paperSize: '80mm',
      autoPrint: true,
      printCopies: 1,
      businessName: '',
      address: '',
      phone: '',
      email: '',
      logoUrl: '',
      receiptHeader: '',
      receiptFooter: '',
      showLogo: true,
      showBarcode: false,
      ipAddress: '',
      port: 9100,
    });
  }

  static async updateSettings(req: AuthRequest, res: Response) {
    return res.json({ id: req.query.id || 1, ...req.body, updatedAt: new Date() });
  }
}

export class UploadController {
  static async uploadLogo(req: AuthRequest, res: Response) {
    return res.status(201).json({ url: '/logo.png', message: 'Logo uploaded successfully' });
  }

  static async deleteLogo(req: AuthRequest, res: Response) {
    return res.json({ success: true });
  }
}

export class PrintController {
  static async print(req: AuthRequest, res: Response) {
    try {
      const { printerIP, printerPort = 9100, content, copies = 1 } = req.body;

      // Validate required parameters
      if (!content || content.trim().length === 0) {
        return res.status(400).json({
          error: 'Print content is required',
          code: 'MISSING_CONTENT'
        });
      }

      // If no printer IP is provided, we'll return success (for browser printing fallback)
      if (!printerIP) {
        console.log('No printer IP provided, assuming browser printing');
        return res.json({ success: true, message: 'Print content ready for browser printing' });
      }

      // Validate IP address format
      const ipRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
      if (!ipRegex.test(printerIP)) {
        return res.status(400).json({
          error: 'Invalid printer IP address format',
          code: 'INVALID_IP'
        });
      }

      // Validate port
      const port = parseInt(printerPort);
      if (isNaN(port) || port < 1 || port > 65535) {
        return res.status(400).json({
          error: 'Invalid printer port',
          code: 'INVALID_PORT'
        });
      }

      // Validate copies
      const numCopies = parseInt(copies);
      if (isNaN(numCopies) || numCopies < 1 || numCopies > 10) {
        return res.status(400).json({
          error: 'Invalid number of copies (1-10 allowed)',
          code: 'INVALID_COPIES'
        });
      }

      // Import net module for network printing
      const net = require('net');

      // ESC/POS commands for thermal printer
      const ESC = '\x1B';
      const GS = '\x1D';
      const LF = '\x0A';

      // Initialize printer
      const initCommands = [
        ESC + '@',  // Initialize printer
        ESC + 'a' + '\x01',  // Center alignment
        GS + 'V' + '\x42' + '\x00'  // Full cut
      ].join('');

      // Format content for ESC/POS printing
      const formattedContent = content
        .split('\n')
        .map((line: string) => {
          // Handle center alignment (lines with '=' or '-' for dividers)
          if (line.includes('=') && line.trim().length > 10) {
            return ESC + 'a' + '\x01' + line + LF + ESC + 'a' + '\x00'; // Center then left align
          }
          // Handle left alignment for regular text
          return ESC + 'a' + '\x00' + line + LF;
        })
        .join('');

      // Combine commands
      const printData = initCommands + formattedContent + LF + LF + LF + ESC + 'd' + '\x05'; // Feed and cut

      // Print multiple copies
      const printPromises = [];
      for (let i = 0; i < numCopies; i++) {
        printPromises.push(new Promise((resolve, reject) => {
          const client = new net.Socket();

          client.connect(port, printerIP, () => {
            console.log(`Connected to printer at ${printerIP}:${port}`);
            client.write(printData, 'binary', (err: any) => {
              if (err) {
                console.error('Error sending data to printer:', err);
                reject(err);
              } else {
                console.log('Print data sent successfully');
                // Wait a moment before closing
                setTimeout(() => {
                  client.end();
                  resolve(true);
                }, 100);
              }
            });
          });

          client.on('error', (err: any) => {
            console.error('Printer connection error:', err);
            reject(err);
          });

          client.on('timeout', () => {
            console.error('Printer connection timeout');
            client.destroy();
            reject(new Error('Printer connection timeout'));
          });

          // Set timeout
          client.setTimeout(5000);
        }));
      }

      try {
        await Promise.all(printPromises);
        console.log(`Successfully printed ${numCopies} copies to ${printerIP}:${port}`);
        return res.json({
          success: true,
          message: `Print job sent to ${printerIP}:${port} (${numCopies} copies)`
        });
      } catch (printError) {
        console.error('Print error:', printError);
        return res.status(500).json({
          error: `Failed to print to ${printerIP}:${port}: ${(printError as Error).message}`,
          code: 'PRINT_FAILED'
        });
      }

    } catch (error: any) {
      console.error('Print controller error:', error);
      return res.status(500).json({
        error: error.message || 'Internal server error',
        code: 'INTERNAL_ERROR'
      });
    }
  }
}

