import { Response } from 'express';
import { prisma } from '../models/db';
import { AuthRequest } from '../middleware/auth';
import { decimalToNumber } from '../utils/decimal';

export class SuppliersController {
  static async getSuppliers(req: AuthRequest, res: Response) {
    try {
      const { isActive, limit, id, includeDeleted } = req.query;

      const where: any = {};

      // Exclude soft-deleted suppliers by default
      if (includeDeleted !== 'true') {
        where.deletedAt = null;
      }

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
          supplierCredits: true,
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

        // Get the latest credit balance (which includes all manual credits/debits)
        const latestCredit = supplier.supplierCredits.length > 0
          ? supplier.supplierCredits.sort((a, b) =>
              new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
            )[0]
          : null;

        // Outstanding balance = (purchases - payments) + manual credits balance
        const manualCreditsBalance = latestCredit
          ? (decimalToNumber(latestCredit.balance) ?? 0)
          : 0;

        const outstandingBalance = totalPurchases - totalPaid + manualCreditsBalance;

        return {
          ...supplier,
          totalPurchases: Number(totalPurchases.toFixed(2)),
          outstandingBalance: Number(outstandingBalance.toFixed(2)),
          manualCreditsBalance: Number(manualCreditsBalance.toFixed(2)),
          // Remove the purchases and supplierCredits arrays from response to keep it clean
          purchases: undefined,
          supplierCredits: undefined,
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
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({
          error: 'User not authenticated',
          code: 'UNAUTHORIZED',
        });
      }

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

      // Check if supplier exists
      const supplier = await prisma.supplier.findUnique({
        where: { id: supplierId },
      });

      if (!supplier) {
        return res.status(404).json({
          error: 'Supplier not found',
          code: 'SUPPLIER_NOT_FOUND',
        });
      }

      if (supplier.deletedAt) {
        return res.status(400).json({
          error: 'Supplier is already deleted',
          code: 'ALREADY_DELETED',
        });
      }

      // Check if supplier has any purchases
      const purchaseCount = await prisma.purchase.count({
        where: {
          supplierId,
          deletedAt: null, // Only count non-deleted purchases
        },
      });

      if (purchaseCount > 0) {
        return res.status(400).json({
          error: `Cannot delete supplier. ${purchaseCount} purchase(s) are associated with it.`,
          code: 'SUPPLIER_IN_USE',
          details: {
            purchaseCount,
            suggestion: 'Consider marking the supplier as inactive instead of deleting it.',
          },
        });
      }

      // Check for outstanding balance
      const outstandingBalance = decimalToNumber(supplier.outstandingBalance) ?? 0;
      if (Math.abs(outstandingBalance) > 0.01) {
        return res.status(400).json({
          error: `Cannot delete supplier. Supplier has an outstanding balance of $${Math.abs(outstandingBalance).toFixed(2)}.`,
          code: 'OUTSTANDING_BALANCE',
          details: {
            outstandingBalance,
            suggestion: 'Settle the outstanding balance before deleting this supplier.',
          },
        });
      }

      // Perform soft delete
      const deletedSupplier = await prisma.supplier.update({
        where: { id: supplierId },
        data: {
          deletedAt: new Date(),
          deletedBy: userId,
          isActive: false, // Also mark as inactive
        },
      });

      // Create audit log entry
      await prisma.auditLog.create({
        data: {
          userId,
          action: 'DELETE',
          entityType: 'Supplier',
          entityId: supplierId,
          changes: JSON.stringify({
            supplierName: supplier.name,
            contactPerson: supplier.contactPerson,
            phone: supplier.phone,
            email: supplier.email,
            totalPurchases: supplier.totalPurchases.toString(),
            deletedAt: new Date().toISOString(),
          }),
          notes: `Supplier "${supplier.name}" (Contact: ${supplier.contactPerson || 'N/A'}) soft deleted`,
        },
      });

      return res.json({
        success: true,
        message: 'Supplier deleted successfully',
        data: {
          id: deletedSupplier.id,
          name: deletedSupplier.name,
          deletedAt: deletedSupplier.deletedAt,
        },
      });
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

  // New method to restore soft-deleted suppliers
  static async restoreSupplier(req: AuthRequest, res: Response) {
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

      const supplier = await prisma.supplier.findUnique({
        where: { id: supplierId },
      });

      if (!supplier) {
        return res.status(404).json({
          error: 'Supplier not found',
          code: 'SUPPLIER_NOT_FOUND',
        });
      }

      if (!supplier.deletedAt) {
        return res.status(400).json({
          error: 'Supplier is not deleted',
          code: 'NOT_DELETED',
        });
      }

      const restoredSupplier = await prisma.supplier.update({
        where: { id: supplierId },
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
          entityType: 'Supplier',
          entityId: supplierId,
          changes: JSON.stringify({
            supplierName: supplier.name,
            restoredAt: new Date().toISOString(),
          }),
          notes: `Supplier "${supplier.name}" restored from deletion`,
        },
      });

      const serialized = {
        ...restoredSupplier,
        totalPurchases: decimalToNumber(restoredSupplier.totalPurchases) ?? 0,
        outstandingBalance: decimalToNumber(restoredSupplier.outstandingBalance) ?? 0,
      };

      return res.json({
        success: true,
        message: 'Supplier restored successfully',
        data: serialized,
      });
    } catch (error: any) {
      console.error('Restore supplier error:', error);
      return res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
        message: error.message,
      });
    }
  }
}

