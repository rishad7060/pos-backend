import { Response } from 'express';
import { prisma } from '../models/db';
import { AuthRequest } from '../middleware/auth';
import { decimalToNumber } from '../utils/decimal';

export class ProductsController {
  static async getProducts(req: AuthRequest, res: Response) {
    try {
      const { isActive, limit } = req.query;

      const where: any = {};
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

      const product = await prisma.product.update({
        where: { id: productId },
        data: updateData,
      });

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
      const { id } = req.query;

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

      await prisma.product.delete({
        where: { id: productId },
      });

      return res.json({ message: 'Product deleted successfully' });
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
}
