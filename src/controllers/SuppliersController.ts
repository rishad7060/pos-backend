import { Response } from 'express';
import { prisma } from '../models/db';
import { AuthRequest } from '../middleware/auth';
import { decimalToNumber } from '../utils/decimal';

export class SuppliersController {
  static async getSuppliers(req: AuthRequest, res: Response) {
    try {
      const { isActive, limit, id } = req.query;

      const where: any = {};

      if (isActive !== undefined) {
        where.isActive = isActive === 'true';
      }

      if (id) {
        where.id = parseInt(id as string);
      }

      const suppliers = await prisma.supplier.findMany({
        where,
        orderBy: {
          createdAt: 'desc',
        },
        take: limit ? Math.min(parseInt(limit as string), 1000) : 100,
        include: {
          purchases: {
            include: {
              purchasePayments: true,
            },
          },
        },
      });

      // Calculate totals dynamically
      const serialized = suppliers.map(supplier => {
        // Calculate total purchases (sum of all purchase totals)
        const totalPurchases = supplier.purchases.reduce((sum, purchase) => {
          const total = decimalToNumber(purchase.total);
          return sum + (total ?? 0);
        }, 0);

        // Calculate outstanding balance (total purchases - total payments)
        const totalPaid = supplier.purchases.reduce((sum, purchase) => {
          const paid = purchase.purchasePayments.reduce((paymentSum, payment) => {
            const amount = decimalToNumber(payment.amount);
            return paymentSum + (amount ?? 0);
          }, 0);
          return sum + paid;
        }, 0);

        const outstandingBalance = totalPurchases - totalPaid;

        return {
          ...supplier,
          totalPurchases: Number(totalPurchases.toFixed(2)),
          outstandingBalance: Number(outstandingBalance.toFixed(2)),
          // Remove the purchases array from response to keep it clean
          purchases: undefined,
        };
      });

      return res.json(serialized);
    } catch (error: any) {
      console.error('Get suppliers error:', error);
      // Always return an array, even on error
      return res.json([]);
    }
  }

  static async createSupplier(req: AuthRequest, res: Response) {
    try {
      const {
        name,
        contactPerson,
        phone,
        email,
        address,
        taxId,
        paymentTerms,
        notes,
        isActive,
      } = req.body;

      if (!name || !name.trim()) {
        return res.status(400).json({
          error: 'Supplier name is required',
          code: 'MISSING_NAME',
        });
      }

      const supplier = await prisma.supplier.create({
        data: {
          name: name.trim(),
          contactPerson: contactPerson || null,
          phone: phone || null,
          email: email || null,
          address: address || null,
          taxId: taxId || null,
          paymentTerms: paymentTerms || null,
          notes: notes || null,
          isActive: isActive !== undefined ? isActive : true,
        },
      });

      // Convert Decimal to numbers
      const serialized = {
        ...supplier,
        totalPurchases: decimalToNumber(supplier.totalPurchases) ?? 0,
        outstandingBalance: decimalToNumber(supplier.outstandingBalance) ?? 0,
      };

      return res.status(201).json(serialized);
    } catch (error: any) {
      console.error('Create supplier error:', error);
      if (error.code === 'P2002') {
        return res.status(400).json({
          error: 'Supplier with this name already exists',
          code: 'DUPLICATE_SUPPLIER',
        });
      }
      return res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
        message: error.message,
      });
    }
  }

  static async updateSupplier(req: AuthRequest, res: Response) {
    try {
      const { id } = req.query;
      const {
        name,
        contactPerson,
        phone,
        email,
        address,
        taxId,
        paymentTerms,
        notes,
        isActive,
      } = req.body;

      if (!id) {
        return res.status(400).json({
          error: 'Supplier ID is required',
          code: 'MISSING_ID',
        });
      }

      const supplierId = parseInt(id as string);
      if (isNaN(supplierId)) {
        return res.status(400).json({
          error: 'Invalid supplier ID',
          code: 'INVALID_ID',
        });
      }

      const updateData: any = {};
      if (name !== undefined) updateData.name = name.trim();
      if (contactPerson !== undefined) updateData.contactPerson = contactPerson || null;
      if (phone !== undefined) updateData.phone = phone || null;
      if (email !== undefined) updateData.email = email || null;
      if (address !== undefined) updateData.address = address || null;
      if (taxId !== undefined) updateData.taxId = taxId || null;
      if (paymentTerms !== undefined) updateData.paymentTerms = paymentTerms || null;
      if (notes !== undefined) updateData.notes = notes || null;
      if (isActive !== undefined) updateData.isActive = isActive;

      const supplier = await prisma.supplier.update({
        where: { id: supplierId },
        data: updateData,
      });

      // Convert Decimal to numbers
      const serialized = {
        ...supplier,
        totalPurchases: decimalToNumber(supplier.totalPurchases) ?? 0,
        outstandingBalance: decimalToNumber(supplier.outstandingBalance) ?? 0,
      };

      return res.json(serialized);
    } catch (error: any) {
      console.error('Update supplier error:', error);
      if (error.code === 'P2025') {
        return res.status(404).json({
          error: 'Supplier not found',
          code: 'SUPPLIER_NOT_FOUND',
        });
      }
      if (error.code === 'P2002') {
        return res.status(400).json({
          error: 'Supplier with this name already exists',
          code: 'DUPLICATE_SUPPLIER',
        });
      }
      return res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
        message: error.message,
      });
    }
  }

  static async deleteSupplier(req: AuthRequest, res: Response) {
    try {
      const { id } = req.query;

      if (!id) {
        return res.status(400).json({
          error: 'Supplier ID is required',
          code: 'MISSING_ID',
        });
      }

      const supplierId = parseInt(id as string);
      if (isNaN(supplierId)) {
        return res.status(400).json({
          error: 'Invalid supplier ID',
          code: 'INVALID_ID',
        });
      }

      // Check if supplier has any purchases
      const purchaseCount = await prisma.purchase.count({
        where: { supplierId },
      });

      if (purchaseCount > 0) {
        return res.status(400).json({
          error: `Cannot delete supplier. ${purchaseCount} purchase(s) are associated with it.`,
          code: 'SUPPLIER_IN_USE',
        });
      }

      await prisma.supplier.delete({
        where: { id: supplierId },
      });

      return res.json({ message: 'Supplier deleted successfully' });
    } catch (error: any) {
      console.error('Delete supplier error:', error);
      if (error.code === 'P2025') {
        return res.status(404).json({
          error: 'Supplier not found',
          code: 'SUPPLIER_NOT_FOUND',
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

