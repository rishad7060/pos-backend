import { Response } from 'express';
import { prisma } from '../models/db';
import { AuthRequest } from '../middleware/auth';
import { decimalToNumber } from '../utils/decimal';

export class CustomersController {
  static async getCustomers(req: AuthRequest, res: Response) {
    try {
      const { limit, search } = req.query;

      const where: any = {};
      if (search) {
        const searchLower = (search as string).toLowerCase();
        where.OR = [
          { name: { contains: searchLower, mode: 'insensitive' } },
          { email: { contains: searchLower, mode: 'insensitive' } },
          { phone: { contains: searchLower, mode: 'insensitive' } },
        ];
      }

      const take = limit ? Math.min(parseInt(limit as string), 1000) : 100;

      const customers = await prisma.customer.findMany({
        where,
        orderBy: {
          createdAt: 'desc',
        },
        take,
      });

      // Convert Decimal types to numbers
      const serialized = customers.map(customer => ({
        ...customer,
        totalPurchases: decimalToNumber(customer.totalPurchases) ?? 0,
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

      const customer = await prisma.customer.create({
        data: {
          name,
          email: email || null,
          phone: phone || null,
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
      const { id } = req.query;

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

      await prisma.customer.delete({
        where: { id: customerId },
      });

      return res.json({ message: 'Customer deleted successfully' });
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
}

