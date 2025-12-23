import { Response } from 'express';
import { prisma } from '../models/db';
import { AuthRequest } from '../middleware/auth';
import { decimalToNumber } from '../utils/decimal';

export class CustomersController {
  static async getCustomers(req: AuthRequest, res: Response) {
    try {
      const { limit, search, includeDeleted } = req.query;

      const where: any = {};

      // Exclude soft-deleted customers by default
      if (includeDeleted !== 'true') {
        where.deletedAt = null;
      }

      if (search) {
        const searchLower = (search as string).toLowerCase();
        where.OR = [
          { name: { contains: searchLower, mode: 'insensitive' } },
          { email: { contains: searchLower, mode: 'insensitive' } },
          { phone: { contains: searchLower, mode: 'insensitive' } },
        ];
      }

      const take = limit ? Math.min(parseInt(limit as string), 1000) : 100;

      // PERFORMANCE FIX: Include credit balance in single query to avoid N+1 problem
      // Previously: 1 query for customers + N queries for credit balance = 101 API calls
      // Now: 1 query with JOIN = 1 API call (100x faster!)
      const customers = await prisma.customer.findMany({
        where,
        orderBy: {
          createdAt: 'desc',
        },
        take,
        include: {
          customerCredits: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { balance: true },
          },
        },
      });

      // Convert Decimal types to numbers and include creditBalance
      const serialized = customers.map(customer => ({
        ...customer,
        totalPurchases: decimalToNumber(customer.totalPurchases) ?? 0,
        creditBalance: customer.customerCredits[0] ? decimalToNumber(customer.customerCredits[0].balance) ?? 0 : 0,
        customerCredits: undefined, // Remove customerCredits array from response
      }));

      return res.json(serialized);
    } catch (error) {
      console.error('Get customers error:', error);
      return res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
      });
    }
  }

  static async createCustomer(req: AuthRequest, res: Response) {
    try {
      const { name, email, phone, address } = req.body;

      if (!name) {
        return res.status(400).json({
          error: 'Name is required',
          code: 'MISSING_NAME',
        });
      }

      // CRITICAL FIX CUST-005: Explicitly check for duplicate phone BEFORE creating customer
      if (phone && phone.trim() !== '') {
        const existingCustomerWithPhone = await prisma.customer.findFirst({
          where: { phone: phone.trim() },
        });

        if (existingCustomerWithPhone) {
          return res.status(400).json({
            error: 'A customer with this phone number already exists',
            code: 'DUPLICATE_PHONE',
          });
        }
      }

      // CRITICAL FIX CUST-005: Explicitly check for duplicate email BEFORE creating customer
      if (email && email.trim() !== '') {
        const existingCustomerWithEmail = await prisma.customer.findFirst({
          where: { email: email.trim() },
        });

        if (existingCustomerWithEmail) {
          return res.status(400).json({
            error: 'A customer with this email already exists',
            code: 'DUPLICATE_EMAIL',
          });
        }
      }

      const customer = await prisma.customer.create({
        data: {
          name,
          email: email && email.trim() !== '' ? email.trim() : null,
          phone: phone && phone.trim() !== '' ? phone.trim() : null,
          address: address || null,
        },
      });

      // Convert Decimal types to numbers
      const serialized = {
        ...customer,
        totalPurchases: decimalToNumber(customer.totalPurchases) ?? 0,
      };

      return res.status(201).json(serialized);
    } catch (error: any) {
      console.error('Create customer error:', error);
      if (error.code === 'P2002') {
        // Fallback: Database-level unique constraint violation
        return res.status(400).json({
          error: 'Customer with this email or phone already exists',
          code: 'DUPLICATE_CUSTOMER',
        });
      }
      return res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
      });
    }
  }

  static async getCustomerById(req: AuthRequest, res: Response) {
    try {
      const { id } = req.params;

      if (!id) {
        return res.status(400).json({
          error: 'Customer ID is required',
          code: 'MISSING_ID',
        });
      }

      const customerId = parseInt(id);
      if (isNaN(customerId)) {
        return res.status(400).json({
          error: 'Invalid customer ID',
          code: 'INVALID_ID',
        });
      }

      // Get customer with orders (simplified first)
      const customer = await prisma.customer.findUnique({
        where: { id: customerId },
        include: {
          orders: {
            take: 20,
            orderBy: { createdAt: 'desc' },
            include: {
              orderItems: {
                include: {
                  product: true
                }
              },
              cashier: {
                select: {
                  fullName: true,
                },
              },
            },
          },
        },
      });

      if (!customer) {
        return res.status(404).json({
          error: 'Customer not found',
          code: 'CUSTOMER_NOT_FOUND',
        });
      }

      // Get credit transactions
      const creditTransactions = await prisma.customerCredit.findMany({
        where: { customerId },
        include: {
          user: {
            select: { id: true, fullName: true, email: true },
          },
          order: {
            select: { id: true, orderNumber: true, total: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      // Calculate current credit balance
      const creditBalance = creditTransactions.length > 0 ? creditTransactions[0].balance : 0;

      // Calculate stats
      const totalOrders = customer.orders.length;
      const totalCreditSales = customer.orders
        .filter(order => order.paymentMethod === 'credit')
        .reduce((sum, order) => sum + (decimalToNumber(order.total) ?? 0), 0);
      const totalPayments = creditTransactions
        .filter(credit => credit.transactionType === 'payment')
        .reduce((sum, credit) => sum + Math.abs(decimalToNumber(credit.amount) ?? 0), 0);

      const stats = {
        totalOrders,
        totalCreditSales: Number(totalCreditSales),
        totalPayments: Number(totalPayments),
        pendingBalance: Number(creditBalance),
      };

      // Convert customer data
      const serializedCustomer = {
        ...customer,
        totalPurchases: decimalToNumber(customer.totalPurchases) ?? 0,
      };

      // Convert orders data
      const serializedOrders = customer.orders.map(order => ({
        ...order,
        subtotal: decimalToNumber(order.subtotal) ?? 0,
        discountAmount: decimalToNumber(order.discountAmount) ?? 0,
        total: decimalToNumber(order.total) ?? 0,
        cashierName: order.cashier?.fullName || null,
        items: order.orderItems.map(item => {
          // Map quantityType from database values to frontend expected values
          const quantityType = item.quantityType === 'kg' || item.quantityType === 'g' || item.quantityType === 'box' ? 'weight' : 'unit';

          return {
            id: item.id,
            itemName: item.product?.name || 'Unknown Product',
            netWeightKg: decimalToNumber(item.netWeightKg) ?? 0,
            pricePerKg: decimalToNumber(item.pricePerKg) ?? 0,
            finalTotal: decimalToNumber(item.finalTotal) ?? 0,
            quantityType: quantityType,
          };
        }),
      }));

      // Convert credit transactions
      const serializedCreditTransactions = creditTransactions.map(credit => ({
        ...credit,
        amount: decimalToNumber(credit.amount) ?? 0,
        balance: decimalToNumber(credit.balance) ?? 0,
        order: credit.order ? {
          ...credit.order,
          total: decimalToNumber(credit.order.total) ?? 0,
        } : null,
      }));

      return res.json({
        customer: serializedCustomer,
        creditBalance: Number(creditBalance),
        creditTransactions: serializedCreditTransactions,
        orders: serializedOrders,
        stats,
      });
    } catch (error) {
      console.error('Get customer by ID error:', error);
      return res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
      });
    }
  }

  static async updateCustomer(req: AuthRequest, res: Response) {
    try {
      const { id } = req.query;
      const { name, email, phone, address } = req.body;

      if (!id) {
        return res.status(400).json({
          error: 'Customer ID is required',
          code: 'MISSING_ID',
        });
      }

      const customerId = parseInt(id as string);
      if (isNaN(customerId)) {
        return res.status(400).json({
          error: 'Invalid customer ID',
          code: 'INVALID_ID',
        });
      }

      const updateData: any = {};
      if (name !== undefined) updateData.name = name;
      if (email !== undefined) updateData.email = email || null;
      if (phone !== undefined) updateData.phone = phone || null;
      if (address !== undefined) updateData.address = address || null;

      const customer = await prisma.customer.update({
        where: { id: customerId },
        data: updateData,
      });

      // Convert Decimal types to numbers
      const serialized = {
        ...customer,
        totalPurchases: decimalToNumber(customer.totalPurchases) ?? 0,
      };

      return res.json(serialized);
    } catch (error: any) {
      console.error('Update customer error:', error);
      if (error.code === 'P2025') {
        return res.status(404).json({
          error: 'Customer not found',
          code: 'CUSTOMER_NOT_FOUND',
        });
      }
      if (error.code === 'P2002') {
        return res.status(400).json({
          error: 'Customer with this email or phone already exists',
          code: 'DUPLICATE_CUSTOMER',
        });
      }
      return res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
      });
    }
  }

  static async deleteCustomer(req: AuthRequest, res: Response) {
    try {
      const { id, force } = req.query;
      const userId = req.user?.id;
      const userRole = req.user?.role;

      if (!userId) {
        return res.status(401).json({
          error: 'User not authenticated',
          code: 'UNAUTHORIZED',
        });
      }

      if (!id) {
        return res.status(400).json({
          error: 'Customer ID is required',
          code: 'MISSING_ID',
        });
      }

      const customerId = parseInt(id as string);
      if (isNaN(customerId)) {
        return res.status(400).json({
          error: 'Invalid customer ID',
          code: 'INVALID_ID',
        });
      }

      // Check if customer exists
      const customer = await prisma.customer.findUnique({
        where: { id: customerId },
        include: {
          customerCredits: {
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      });

      if (!customer) {
        return res.status(404).json({
          error: 'Customer not found',
          code: 'CUSTOMER_NOT_FOUND',
        });
      }

      if (customer.deletedAt) {
        return res.status(400).json({
          error: 'Customer is already deleted',
          code: 'ALREADY_DELETED',
        });
      }

      // Force delete flag - only admins can bypass safety checks
      const forceDelete = force === 'true' && userRole === 'admin';

      // Get credit balance for validation and audit logging
      const creditBalance = customer.customerCredits[0]
        ? decimalToNumber(customer.customerCredits[0].balance) ?? 0
        : 0;

      // Check for pending credit balance (skip if force delete)
      if (!forceDelete && creditBalance !== 0) {
        const balanceType = creditBalance > 0 ? 'debt' : 'credit';
        const absoluteBalance = Math.abs(creditBalance);

        return res.status(400).json({
          error: `Cannot delete customer. Customer has a pending ${balanceType} balance of $${absoluteBalance.toFixed(2)}.`,
          code: 'PENDING_CREDIT_BALANCE',
          details: {
            creditBalance,
            balanceType,
            absoluteBalance,
            suggestion: 'Settle the credit balance to $0.00 before deleting this customer.',
            canForceDelete: userRole === 'admin',
          },
        });
      }

      // Check for recent orders (last 90 days) - skip if force delete
      if (!forceDelete) {
        const recentOrdersCount = await prisma.order.count({
          where: {
            customerId: customerId,
            createdAt: {
              gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
            },
          },
        });

        if (recentOrdersCount > 0) {
          return res.status(400).json({
            error: `Cannot delete customer. Customer has ${recentOrdersCount} order(s) in the last 90 days.`,
            code: 'RECENT_ORDERS_EXIST',
            details: {
              recentOrdersCount,
              creditBalance,
              suggestion: 'This customer has recent order history. Consider keeping the record for reporting purposes.',
              canForceDelete: userRole === 'admin',
            },
          });
        }
      }

      // Perform soft delete
      const deletedCustomer = await prisma.customer.update({
        where: { id: customerId },
        data: {
          deletedAt: new Date(),
          deletedBy: userId,
        },
      });

      // Create audit log entry
      await prisma.auditLog.create({
        data: {
          userId,
          action: 'DELETE',
          entityType: 'Customer',
          entityId: customerId,
          changes: JSON.stringify({
            customerName: customer.name,
            phone: customer.phone,
            email: customer.email,
            totalPurchases: customer.totalPurchases.toString(),
            visitCount: customer.visitCount,
            creditBalance: creditBalance,
            deletedAt: new Date().toISOString(),
            forceDelete: forceDelete,
          }),
          notes: `Customer "${customer.name}" (Phone: ${customer.phone || 'N/A'}) soft deleted${forceDelete ? ` (FORCE DELETE - bypassed safety checks, Credit Balance: $${creditBalance.toFixed(2)})` : ''}`,
        },
      });

      return res.json({
        success: true,
        message: 'Customer deleted successfully',
        data: {
          id: deletedCustomer.id,
          name: deletedCustomer.name,
          deletedAt: deletedCustomer.deletedAt,
        },
      });
    } catch (error: any) {
      console.error('Delete customer error:', error);
      if (error.code === 'P2025') {
        return res.status(404).json({
          error: 'Customer not found',
          code: 'CUSTOMER_NOT_FOUND',
        });
      }
      return res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
      });
    }
  }

  // New method to restore soft-deleted customers
  static async restoreCustomer(req: AuthRequest, res: Response) {
    try {
      const { id } = req.query;
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({
          error: 'User not authenticated',
          code: 'UNAUTHORIZED',
        });
      }

      if (!id) {
        return res.status(400).json({
          error: 'Customer ID is required',
          code: 'MISSING_ID',
        });
      }

      const customerId = parseInt(id as string);
      if (isNaN(customerId)) {
        return res.status(400).json({
          error: 'Invalid customer ID',
          code: 'INVALID_ID',
        });
      }

      const customer = await prisma.customer.findUnique({
        where: { id: customerId },
      });

      if (!customer) {
        return res.status(404).json({
          error: 'Customer not found',
          code: 'CUSTOMER_NOT_FOUND',
        });
      }

      if (!customer.deletedAt) {
        return res.status(400).json({
          error: 'Customer is not deleted',
          code: 'NOT_DELETED',
        });
      }

      const restoredCustomer = await prisma.customer.update({
        where: { id: customerId },
        data: {
          deletedAt: null,
          deletedBy: null,
        },
      });

      // Create audit log entry
      await prisma.auditLog.create({
        data: {
          userId,
          action: 'RESTORE',
          entityType: 'Customer',
          entityId: customerId,
          changes: JSON.stringify({
            customerName: customer.name,
            restoredAt: new Date().toISOString(),
          }),
          notes: `Customer "${customer.name}" restored from deletion`,
        },
      });

      const serialized = {
        ...restoredCustomer,
        totalPurchases: decimalToNumber(restoredCustomer.totalPurchases) ?? 0,
      };

      return res.json({
        success: true,
        message: 'Customer restored successfully',
        data: serialized,
      });
    } catch (error: any) {
      console.error('Restore customer error:', error);
      return res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
      });
    }
  }

  static async addManualCredit(req: AuthRequest, res: Response) {
    try {
      const { customerId, amount, type, description } = req.body;
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({ error: 'User not authenticated', code: 'UNAUTHORIZED' });
      }

      if (!customerId || !amount || !type) {
        return res.status(400).json({
          error: 'Missing required fields (customerId, amount, type)',
          code: 'MISSING_FIELDS',
        });
      }

      if (amount <= 0) {
        return res.status(400).json({
          error: 'Amount must be positive',
          code: 'INVALID_AMOUNT',
        });
      }

      if (type !== 'credit' && type !== 'debit') {
        return res.status(400).json({
          error: 'Type must be "credit" (reduce debt) or "debit" (increase debt)',
          code: 'INVALID_TYPE',
        });
      }

      // Check if customer exists
      const customer = await prisma.customer.findUnique({
        where: { id: customerId },
      });

      if (!customer) {
        return res.status(404).json({
          error: 'Customer not found',
          code: 'CUSTOMER_NOT_FOUND',
        });
      }

      // Get latest transaction to determine current balance
      const lastTransaction = await prisma.customerCredit.findFirst({
        where: { customerId },
        orderBy: { createdAt: 'desc' },
      });

      const currentBalance = lastTransaction ? decimalToNumber(lastTransaction.balance) ?? 0 : 0;
      let newBalance = 0;

      // Calculate new balance
      // Note: Positive balance = Debt (Customer owes money)
      // 'credit' = Customer pays or gets credit => Debt decreases
      // 'debit' = Customer is charged => Debt increases
      if (type === 'credit') {
        newBalance = currentBalance - parseFloat(amount);
      } else {
        newBalance = currentBalance + parseFloat(amount);
      }

      const creditTransaction = await prisma.customerCredit.create({
        data: {
          customerId,
          transactionType: 'admin_adjustment',
          amount: parseFloat(amount),
          balance: newBalance,
          description: description || `Admin Manual ${type === 'credit' ? 'Credit' : 'Debit'}`,
          userId,
        },
      });

      return res.status(201).json({
        ...creditTransaction,
        amount: decimalToNumber(creditTransaction.amount),
        balance: decimalToNumber(creditTransaction.balance),
      });

    } catch (error: any) {
      console.error('Add manual credit error:', error);
      return res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
      });
    }
  }
}

