import { Response } from 'express';
import { prisma } from '../models/db';
import { AuthRequest } from '../middleware/auth';

export class UsersController {
  static async getUsers(req: AuthRequest, res: Response) {
    try {
      const { role } = req.query;

      const where: any = {};
      if (role) {
        where.role = role as string;
      }
      // Filter only active users when fetching by role
      if (role) {
        where.isActive = true;
      }

      const users = await prisma.user.findMany({
        where,
        select: {
          id: true,
          email: true,
          fullName: true,
          role: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
          cashierPin: {
            where: { isActive: true },
            select: {
              pin: true,
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      // Transform to include pins array for cashiers
      const usersWithPins = users.map((user) => ({
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        isActive: user.isActive,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        pins: user.cashierPin?.pin ? [user.cashierPin.pin] : [],
      }));

      return res.json(usersWithPins);
    } catch (error) {
      console.error('Get users error:', error);
      return res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
      });
    }
  }

  static async updateUser(req: AuthRequest, res: Response) {
    try {
      const { id } = req.params;
      const { fullName, email, role, isActive, pin } = req.body;

      if (!id) {
        return res.status(400).json({
          error: 'User ID is required',
          code: 'MISSING_USER_ID',
        });
      }

      const userId = parseInt(id);
      if (isNaN(userId)) {
        return res.status(400).json({
          error: 'Invalid user ID',
          code: 'INVALID_USER_ID',
        });
      }

      // Validate role
      if (role && !['admin', 'manager', 'cashier'].includes(role)) {
        return res.status(400).json({
          error: 'Invalid role. Must be admin, manager, or cashier',
          code: 'INVALID_ROLE',
        });
      }

      // Check if user exists
      const existingUser = await prisma.user.findUnique({
        where: { id: userId },
      });

      if (!existingUser) {
        return res.status(404).json({
          error: 'User not found',
          code: 'USER_NOT_FOUND',
        });
      }

      // For cashiers, validate PIN if provided
      if (existingUser.role === 'cashier' && pin !== undefined) {
        if (!pin || pin.length < 4) {
          return res.status(400).json({
            error: 'PIN must be at least 4 digits for cashiers',
            code: 'INVALID_PIN',
          });
        }
      }

      // For managers/admins, validate email if provided
      if ((role === 'manager' || role === 'admin' || existingUser.role === 'manager' || existingUser.role === 'admin') && email !== undefined) {
        if (!email) {
          return res.status(400).json({
            error: 'Email is required for managers and admins',
            code: 'MISSING_EMAIL',
          });
        }
      }

      // Prepare update data
      const updateData: any = {};
      if (fullName !== undefined) updateData.fullName = fullName;
      if (email !== undefined) updateData.email = email;
      if (role !== undefined) updateData.role = role;
      if (isActive !== undefined) updateData.isActive = isActive;

      // Use transaction to handle role changes
      const result = await prisma.$transaction(async (tx) => {
        const updatedUser = await tx.user.update({
          where: { id: userId },
          data: updateData,
          select: {
            id: true,
            email: true,
            fullName: true,
            role: true,
            isActive: true,
            createdAt: true,
          },
        });

        // Handle PIN updates for cashiers
        if (existingUser.role === 'cashier' && pin !== undefined) {
          await tx.cashierPin.upsert({
            where: { userId: userId },
            update: {
              pin: pin.toString(),
              assignedBy: req.user?.id || 1,
            },
            create: {
              userId: userId,
              pin: pin.toString(),
              assignedBy: req.user?.id || 1,
            },
          });
        }

        // If role changed to/from manager, handle permissions
        if (role !== undefined && role !== existingUser.role) {
          if (role === 'manager') {
            // Create default manager permissions
            try {
              await tx.managerPermission.upsert({
                where: { managerId: userId },
                update: {},
                create: {
                  managerId: userId,
                  // Default manager permissions
                  canViewDashboard: true,
                  canViewReports: true,
                  canExportReports: true,
                  canViewProducts: true,
                  canCreateProducts: true,
                  canEditProducts: true,
                  canUpdateStock: true,
                  canViewOrders: true,
                  canViewCustomers: true,
                  canCreateCustomers: true,
                  canEditCustomers: true,
                  canViewPurchases: true,
                  canCreatePurchases: true,
                  canViewExpenses: true,
                  canViewFinancialSummary: true,
                },
              });
            } catch (permissionError: any) {
              console.warn('ManagerPermission table may not exist yet, skipping permission creation:', permissionError.message);
            }
          } else if (existingUser.role === 'manager') {
            // Remove manager permissions when demoting from manager
            await tx.managerPermission.deleteMany({
              where: { managerId: userId },
            });
          }

          if (role === 'cashier') {
            // Create default cashier permissions and PIN if needed
            await tx.cashierPermission.upsert({
              where: { cashierId: userId },
              update: {},
              create: {
                cashierId: userId,
                canApplyDiscount: true,
                maxDiscountPercent: 20,
              },
            });

            // Create PIN if not provided and doesn't exist
            if (!pin) {
              const existingPin = await tx.cashierPin.findUnique({
                where: { userId: userId },
              });
              if (!existingPin) {
                // Generate a default PIN
                const defaultPin = Math.floor(1000 + Math.random() * 9000).toString();
                await tx.cashierPin.create({
                  data: {
                    userId: userId,
                    pin: defaultPin,
                    assignedBy: req.user?.id || 1,
                  },
                });
              }
            }
          } else if (existingUser.role === 'cashier') {
            // Remove cashier permissions when promoting from cashier
            await tx.cashierPermission.deleteMany({
              where: { cashierId: userId },
            });
          }
        }

        return updatedUser;
      });

      return res.json(result);
    } catch (error: any) {
      console.error('Update user error:', error);
      if (error.code === 'P2002') {
        return res.status(400).json({
          error: 'Email already in use',
          code: 'DUPLICATE_EMAIL',
        });
      }
      return res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
        message: error.message,
      });
    }
  }

  static async createUser(req: AuthRequest, res: Response) {
    try {
      const { email, password, fullName, role = 'cashier', pin } = req.body;

      if (!fullName) {
        return res.status(400).json({
          error: 'Full name is required',
          code: 'MISSING_REQUIRED_FIELDS',
        });
      }

      // Validate role
      if (!['admin', 'manager', 'cashier'].includes(role)) {
        return res.status(400).json({
          error: 'Invalid role. Must be admin, manager, or cashier',
          code: 'INVALID_ROLE',
        });
      }

      // For cashiers, require PIN instead of email/password
      if (role === 'cashier') {
        if (!pin || pin.length < 4) {
          return res.status(400).json({
            error: 'PIN must be at least 4 digits for cashiers',
            code: 'INVALID_PIN',
          });
        }

        // Generate a dummy email and password for cashiers
        const dummyEmail = `cashier_${Date.now()}@internal.local`;
        const dummyPassword = `cashier_${pin}`;
        const bcrypt = require('bcrypt');
        const passwordHash = await bcrypt.hash(dummyPassword, 10);

        const result = await prisma.$transaction(async (tx) => {
          const user = await tx.user.create({
            data: {
              email: dummyEmail,
              passwordHash,
              fullName,
              role,
            },
            select: {
              id: true,
              email: true,
              fullName: true,
              role: true,
              isActive: true,
              createdAt: true,
            },
          });

          // Create cashier PIN
          await tx.cashierPin.create({
            data: {
              userId: user.id,
              pin: pin.toString(),
              assignedBy: req.user?.id || 1,
            },
          });

          // Create cashier permissions
          await tx.cashierPermission.create({
            data: {
              cashierId: user.id,
              canApplyDiscount: true,
              maxDiscountPercent: 20,
            },
          });

          return user;
        });

        return res.status(201).json(result);
      }

      // For managers and admins, require email and password
      if (!email || !password) {
        return res.status(400).json({
          error: 'Email and password are required for managers and admins',
          code: 'MISSING_CREDENTIALS',
        });
      }

      // Hash password
      const bcrypt = require('bcrypt');
      const passwordHash = await bcrypt.hash(password, 10);

      // First create the user
      const user = await prisma.user.create({
        data: {
          email,
          passwordHash,
          fullName,
          role,
        },
        select: {
          id: true,
          email: true,
          fullName: true,
          role: true,
          isActive: true,
          createdAt: true,
        },
      });

      // Try to create role-specific permissions (don't fail if table doesn't exist)
      try {
        if (role === 'manager') {
          await prisma.managerPermission.create({
            data: {
              managerId: user.id,
              canViewDashboard: true,
              canViewReports: true,
              canExportReports: true,
              canViewProducts: true,
              canCreateProducts: true,
              canEditProducts: true,
              canUpdateStock: true,
              canViewOrders: true,
              canViewCustomers: true,
              canCreateCustomers: true,
              canEditCustomers: true,
              canViewPurchases: true,
              canCreatePurchases: true,
              canViewExpenses: true,
              canViewFinancialSummary: true,
            },
          });
        } else if (role === 'cashier') {
          await prisma.cashierPermission.create({
            data: {
              cashierId: user.id,
              canApplyDiscount: true,
              maxDiscountPercent: 20,
            },
          });
        }
      } catch (permissionError: any) {
        console.warn('Permission table may not exist yet, skipping permission creation:', permissionError.message);
        // Continue - user is created successfully even without permissions
      }

      return res.json(user);
    } catch (error: any) {
      console.error('Create user error:', error);
      console.error('Error details:', {
        code: error.code,
        message: error.message,
        meta: error.meta,
        stack: error.stack
      });

      if (error.code === 'P2002') {
        return res.status(400).json({
          error: 'Email already in use',
          code: 'DUPLICATE_EMAIL',
        });
      }

      // Check for table not found errors
      if (error.code === 'P2021' || error.message?.includes('does not exist')) {
        return res.status(400).json({
          error: 'Database schema not updated. Please run database migrations.',
          code: 'SCHEMA_OUTDATED',
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

