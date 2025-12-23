import { Response } from 'express';
import { prisma } from '../models/db';
import { AuthRequest } from '../middleware/auth';
import { decimalToNumber } from '../utils/decimal';

export class ProductsController {
  static async getProducts(req: AuthRequest, res: Response) {
    try {
      const { isActive, limit, includeDeleted } = req.query;

      const where: any = {};

      // Exclude soft-deleted products by default
      if (includeDeleted !== 'true') {
        where.deletedAt = null;
      }

      if (isActive !== undefined) {
        where.isActive = isActive === 'true';
      }

      const take = limit ? Math.min(parseInt(limit as string), 1000) : 100;

      const products = await prisma.product.findMany({
        where,
        orderBy: {
          createdAt: 'desc',
        },
        take,
      });

      // Convert Prisma Decimal types to numbers for JSON serialization
      const serializedProducts = products.map((product) => ({
        ...product,
        defaultPricePerKg: decimalToNumber(product.defaultPricePerKg),
        costPrice: decimalToNumber(product.costPrice),
        stockQuantity: decimalToNumber(product.stockQuantity),
      }));

      return res.json(serializedProducts);
    } catch (error) {
      console.error('Get products error:', error);
      return res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
      });
    }
  }

  static async createProduct(req: AuthRequest, res: Response) {
    try {
      const {
        name,
        description,
        defaultPricePerKg,
        costPrice,
        category,
        sku,
        barcode,
        stockQuantity,
        reorderLevel,
        unitType,
        isActive,
        imageUrl,
        alertsEnabled,
        alertEmail,
        minStockLevel,
        maxStockLevel,
      } = req.body;

      if (!name) {
        return res.status(400).json({
          error: 'Product name is required',
          code: 'MISSING_NAME',
        });
      }

      // Validate stock quantity and reorder level based on unit type
      const stockQty = parseFloat(stockQuantity);
      const reorderLvl = parseFloat(reorderLevel || 0);

      if (unitType === 'unit') {
        // For units, must be whole numbers
        if (!Number.isInteger(stockQty) || stockQty < 0) {
          return res.status(400).json({
            error: 'Stock quantity for units must be a non-negative whole number',
            code: 'INVALID_UNIT_STOCK',
          });
        }
        if (!Number.isInteger(reorderLvl) || reorderLvl < 0) {
          return res.status(400).json({
            error: 'Reorder level for units must be a non-negative whole number',
            code: 'INVALID_UNIT_REORDER',
          });
        }
      } else if (unitType === 'weight') {
        // For weight, can be decimals
        if (stockQty < 0) {
          return res.status(400).json({
            error: 'Stock quantity for weight must be non-negative',
            code: 'INVALID_WEIGHT_STOCK',
          });
        }
        if (reorderLvl < 0) {
          return res.status(400).json({
            error: 'Reorder level for weight must be non-negative',
            code: 'INVALID_WEIGHT_REORDER',
          });
        }
      } else {
        return res.status(400).json({
          error: 'Invalid unit type. Must be "weight" or "unit"',
          code: 'INVALID_UNIT_TYPE',
        });
      }

      const product = await prisma.product.create({
        data: {
          name,
          description: description || null,
          defaultPricePerKg: defaultPricePerKg ? parseFloat(defaultPricePerKg) : null,
          costPrice: costPrice ? parseFloat(costPrice) : null,
          category: category || null,
          sku: sku || null,
          barcode: barcode || null,
          stockQuantity: stockQuantity ? parseFloat(stockQuantity) : 0,
          reorderLevel: reorderLevel ? parseFloat(reorderLevel) : 10,
          unitType: unitType || 'weight',
          isActive: isActive !== undefined ? isActive : true,
          imageUrl: imageUrl || null,
          alertsEnabled: alertsEnabled !== undefined ? alertsEnabled : true,
          alertEmail: alertEmail || null,
          minStockLevel: minStockLevel ? parseFloat(minStockLevel) : null,
          maxStockLevel: maxStockLevel ? parseFloat(maxStockLevel) : null,
        },
      });

      // Convert Decimal types to numbers
      const serializedProduct = {
        ...product,
        defaultPricePerKg: decimalToNumber(product.defaultPricePerKg),
        costPrice: decimalToNumber(product.costPrice),
        stockQuantity: decimalToNumber(product.stockQuantity),
      };

      return res.status(201).json(serializedProduct);
    } catch (error: any) {
      console.error('Create product error:', error);
      if (error.code === 'P2002') {
        return res.status(400).json({
          error: 'Product with this SKU or barcode already exists',
          code: 'DUPLICATE_PRODUCT',
        });
      }
      return res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
      });
    }
  }

  static async updateProduct(req: AuthRequest, res: Response) {
    try {
      const { id } = req.query;
      const {
        name,
        description,
        defaultPricePerKg,
        costPrice,
        category,
        sku,
        barcode,
        stockQuantity,
        reorderLevel,
        unitType,
        isActive,
        imageUrl,
        alertsEnabled,
        alertEmail,
        minStockLevel,
        maxStockLevel,
      } = req.body;

      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({
          error: 'User not authenticated',
          code: 'UNAUTHORIZED',
        });
      }

      if (!id) {
        return res.status(400).json({
          error: 'Product ID is required',
          code: 'MISSING_ID',
        });
      }

      const productId = parseInt(id as string);
      if (isNaN(productId)) {
        return res.status(400).json({
          error: 'Invalid product ID',
          code: 'INVALID_ID',
        });
      }

      // Validate stock quantity and reorder level based on unit type
      const stockQty = parseFloat(stockQuantity);
      const reorderLvl = parseFloat(reorderLevel || 0);

      if (unitType === 'unit') {
        // For units, must be whole numbers
        if (!Number.isInteger(stockQty) || stockQty < 0) {
          return res.status(400).json({
            error: 'Stock quantity for units must be a non-negative whole number',
            code: 'INVALID_UNIT_STOCK',
          });
        }
        if (!Number.isInteger(reorderLvl) || reorderLvl < 0) {
          return res.status(400).json({
            error: 'Reorder level for units must be a non-negative whole number',
            code: 'INVALID_UNIT_REORDER',
          });
        }
      } else if (unitType === 'weight') {
        // For weight, can be decimals
        if (stockQty < 0) {
          return res.status(400).json({
            error: 'Stock quantity for weight must be non-negative',
            code: 'INVALID_WEIGHT_STOCK',
          });
        }
        if (reorderLvl < 0) {
          return res.status(400).json({
            error: 'Reorder level for weight must be non-negative',
            code: 'INVALID_WEIGHT_REORDER',
          });
        }
      } else {
        return res.status(400).json({
          error: 'Invalid unit type. Must be "weight" or "unit"',
          code: 'INVALID_UNIT_TYPE',
        });
      }

      const updateData: any = {};
      if (name !== undefined) updateData.name = name;
      if (description !== undefined) updateData.description = description || null;
      if (defaultPricePerKg !== undefined) updateData.defaultPricePerKg = defaultPricePerKg ? parseFloat(defaultPricePerKg) : null;
      if (costPrice !== undefined) updateData.costPrice = costPrice ? parseFloat(costPrice) : null;
      if (category !== undefined) updateData.category = category || null;
      if (sku !== undefined) updateData.sku = sku || null;
      if (barcode !== undefined) updateData.barcode = barcode || null;
      if (stockQuantity !== undefined) updateData.stockQuantity = parseFloat(stockQuantity);
      if (reorderLevel !== undefined) updateData.reorderLevel = parseFloat(reorderLevel);
      if (unitType !== undefined) updateData.unitType = unitType;
      if (isActive !== undefined) updateData.isActive = isActive;
      if (imageUrl !== undefined) updateData.imageUrl = imageUrl || null;
      if (alertsEnabled !== undefined) updateData.alertsEnabled = alertsEnabled;
      if (alertEmail !== undefined) updateData.alertEmail = alertEmail || null;
      if (minStockLevel !== undefined) updateData.minStockLevel = minStockLevel ? parseFloat(minStockLevel) : null;
      if (maxStockLevel !== undefined) updateData.maxStockLevel = maxStockLevel ? parseFloat(maxStockLevel) : null;

      const existingProduct = await prisma.product.findUnique({
        where: { id: productId },
      });

      const product = await prisma.product.update({
        where: { id: productId },
        data: updateData,
      });

      // Track price changes
      if (existingProduct) {
        // Track Selling Price Change
        // updateData properties are numbers or null. We check strict undefined to see if it was in the payload.
        // We constructed updateData manually above, so checks like `if (defaultPricePerKg !== undefined)` were used.
        // But here we check `updateData` object properties.

        if ('defaultPricePerKg' in updateData && updateData.defaultPricePerKg !== null) {
          const oldPrice = existingProduct.defaultPricePerKg ? existingProduct.defaultPricePerKg.toNumber() : 0;
          const newPrice = updateData.defaultPricePerKg;

          // Only log if difference is significant
          if (Math.abs(oldPrice - newPrice) > 0.001) {
            await prisma.priceChangeHistory.create({
              data: {
                productId: product.id,
                userId,
                changeType: 'selling_price',
                oldPrice: oldPrice,
                newPrice: newPrice,
                notes: 'Admin Update',
              },
            });
          }
        }

        // Track Cost Price Change
        if ('costPrice' in updateData && updateData.costPrice !== null) {
          const oldCost = existingProduct.costPrice ? existingProduct.costPrice.toNumber() : 0;
          const newCost = updateData.costPrice;

          if (Math.abs(oldCost - newCost) > 0.001) {
            await prisma.priceChangeHistory.create({
              data: {
                productId: product.id,
                userId,
                changeType: 'cost_price',
                oldPrice: oldCost,
                newPrice: newCost,
                notes: 'Admin Update',
              },
            });
          }
        }
      }

      // Convert Decimal types to numbers
      const serializedProduct = {
        ...product,
        defaultPricePerKg: decimalToNumber(product.defaultPricePerKg),
        costPrice: decimalToNumber(product.costPrice),
        stockQuantity: decimalToNumber(product.stockQuantity),
      };

      return res.json(serializedProduct);
    } catch (error: any) {
      console.error('Update product error:', error);
      if (error.code === 'P2025') {
        return res.status(404).json({
          error: 'Product not found',
          code: 'PRODUCT_NOT_FOUND',
        });
      }
      if (error.code === 'P2002') {
        return res.status(400).json({
          error: 'Product with this SKU or barcode already exists',
          code: 'DUPLICATE_PRODUCT',
        });
      }
      return res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
      });
    }
  }

  static async deleteProduct(req: AuthRequest, res: Response) {
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
          error: 'Product ID is required',
          code: 'MISSING_ID',
        });
      }

      const productId = parseInt(id as string);
      if (isNaN(productId)) {
        return res.status(400).json({
          error: 'Invalid product ID',
          code: 'INVALID_ID',
        });
      }

      // Check if product exists
      const product = await prisma.product.findUnique({
        where: { id: productId },
      });

      if (!product) {
        return res.status(404).json({
          error: 'Product not found',
          code: 'PRODUCT_NOT_FOUND',
        });
      }

      if (product.deletedAt) {
        return res.status(400).json({
          error: 'Product is already deleted',
          code: 'ALREADY_DELETED',
        });
      }

      // Force delete flag - only admins can bypass safety checks
      const forceDelete = force === 'true' && userRole === 'admin';

      // Check for dependencies: active orders with this product (skip if force delete)
      if (!forceDelete) {
        const activeOrdersCount = await prisma.orderItem.count({
          where: {
            productId: productId,
            order: {
              status: 'completed',
              createdAt: {
                gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // Last 30 days
              },
            },
          },
        });

        if (activeOrdersCount > 0) {
          return res.status(400).json({
            error: `Cannot delete product. It has been used in ${activeOrdersCount} order(s) in the last 30 days.`,
            code: 'PRODUCT_IN_USE',
            details: {
              activeOrdersCount,
              suggestion: 'Consider marking the product as inactive instead of deleting it.',
              canForceDelete: userRole === 'admin', // Tell frontend if force delete is available
            },
          });
        }

        // Check for pending purchase orders
        const pendingPurchaseCount = await prisma.purchaseItem.count({
          where: {
            productId: productId,
            purchase: {
              status: {
                in: ['pending', 'partially_received'],
              },
            },
          },
        });

        if (pendingPurchaseCount > 0) {
          return res.status(400).json({
            error: `Cannot delete product. It has ${pendingPurchaseCount} pending purchase order(s).`,
            code: 'PENDING_PURCHASES',
            details: {
              pendingPurchaseCount,
              suggestion: 'Complete or cancel pending purchase orders before deleting this product.',
              canForceDelete: userRole === 'admin',
            },
          });
        }
      }

      // Perform soft delete
      const deletedProduct = await prisma.product.update({
        where: { id: productId },
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
          entityType: 'Product',
          entityId: productId,
          changes: JSON.stringify({
            productName: product.name,
            sku: product.sku,
            stockQuantity: product.stockQuantity.toString(),
            deletedAt: new Date().toISOString(),
            forceDelete: forceDelete,
          }),
          notes: `Product "${product.name}" (SKU: ${product.sku || 'N/A'}) soft deleted${forceDelete ? ' (FORCE DELETE - bypassed safety checks)' : ''}`,
        },
      });

      return res.json({
        success: true,
        message: 'Product deleted successfully',
        data: {
          id: deletedProduct.id,
          name: deletedProduct.name,
          deletedAt: deletedProduct.deletedAt,
        },
      });
    } catch (error: any) {
      console.error('Delete product error:', error);
      if (error.code === 'P2025') {
        return res.status(404).json({
          error: 'Product not found',
          code: 'PRODUCT_NOT_FOUND',
        });
      }
      return res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
      });
    }
  }

  // New method to restore soft-deleted products
  static async restoreProduct(req: AuthRequest, res: Response) {
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
          error: 'Product ID is required',
          code: 'MISSING_ID',
        });
      }

      const productId = parseInt(id as string);
      if (isNaN(productId)) {
        return res.status(400).json({
          error: 'Invalid product ID',
          code: 'INVALID_ID',
        });
      }

      const product = await prisma.product.findUnique({
        where: { id: productId },
      });

      if (!product) {
        return res.status(404).json({
          error: 'Product not found',
          code: 'PRODUCT_NOT_FOUND',
        });
      }

      if (!product.deletedAt) {
        return res.status(400).json({
          error: 'Product is not deleted',
          code: 'NOT_DELETED',
        });
      }

      const restoredProduct = await prisma.product.update({
        where: { id: productId },
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
          entityType: 'Product',
          entityId: productId,
          changes: JSON.stringify({
            productName: product.name,
            restoredAt: new Date().toISOString(),
          }),
          notes: `Product "${product.name}" restored from deletion`,
        },
      });

      const serializedProduct = {
        ...restoredProduct,
        defaultPricePerKg: decimalToNumber(restoredProduct.defaultPricePerKg),
        costPrice: decimalToNumber(restoredProduct.costPrice),
        stockQuantity: decimalToNumber(restoredProduct.stockQuantity),
      };

      return res.json({
        success: true,
        message: 'Product restored successfully',
        data: serializedProduct,
      });
    } catch (error: any) {
      console.error('Restore product error:', error);
      return res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
      });
    }
  }
}
