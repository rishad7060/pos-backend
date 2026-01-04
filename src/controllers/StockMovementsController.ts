import { Response } from 'express';
import { prisma } from '../models/db';
import { AuthRequest } from '../middleware/auth';
import { decimalToNumber } from '../utils/decimal';
import { parseLimit } from '../config/pagination';

export class StockMovementsController {
    static async getStockMovements(req: AuthRequest, res: Response) {
        try {
            const { productId, movementType, limit, offset = 0 } = req.query;

            const where: any = {};

            if (productId) {
                where.productId = parseInt(productId as string);
            }

            if (movementType) {
                where.movementType = movementType as string;
            }

            const stockMovements = await prisma.stockMovement.findMany({
                where,
                include: {
                    product: {
                        select: {
                            id: true,
                            name: true,
                            sku: true,
                        },
                    },
                    order: {
                        select: {
                            id: true,
                            orderNumber: true,
                        },
                    },
                    user: {
                        select: {
                            id: true,
                            fullName: true,
                            email: true,
                        },
                    },
                },
                orderBy: {
                    createdAt: 'desc',
                },
                take: Math.min(parseLimit(limit, 'orders'), 1000),
                skip: parseInt(offset as string) || 0,
            });

            // Convert Decimal to numbers
            const serialized = stockMovements.map((movement) => ({
                ...movement,
                quantityChange: decimalToNumber(movement.quantityChange) ?? 0,
                quantityAfter: decimalToNumber(movement.quantityAfter) ?? 0,
            }));

            return res.json(serialized);
        } catch (error: any) {
            console.error('Get stock movements error:', error);
            return res.status(500).json({
                error: 'Internal server error',
                code: 'INTERNAL_ERROR',
                message: error.message,
            });
        }
    }

    static async createStockMovement(req: AuthRequest, res: Response) {
        try {
            const {
                productId,
                movementType,
                quantityChange,
                orderId,
                notes,
            } = req.body;

            if (!productId || !movementType || quantityChange === undefined) {
                return res.status(400).json({
                    error: 'Product ID, movement type, and quantity change are required',
                    code: 'MISSING_REQUIRED_FIELDS',
                });
            }

            // Get current product stock
            const product = await prisma.product.findUnique({
                where: { id: parseInt(productId) },
            });

            if (!product) {
                return res.status(404).json({
                    error: 'Product not found',
                    code: 'PRODUCT_NOT_FOUND',
                });
            }

            const currentStock = decimalToNumber(product.stockQuantity) ?? 0;
            const change = parseFloat(quantityChange);
            const newStock = currentStock + change;

            if (newStock < 0) {
                return res.status(400).json({
                    error: 'Insufficient stock',
                    code: 'INSUFFICIENT_STOCK',
                });
            }

            // Create stock movement and update product in transaction
            const result = await prisma.$transaction(async (tx) => {
                // Create stock movement record
                const stockMovement = await tx.stockMovement.create({
                    data: {
                        productId: parseInt(productId),
                        movementType,
                        quantityChange: change,
                        quantityAfter: newStock,
                        orderId: orderId ? parseInt(orderId) : null,
                        userId: req.user?.id || 1,
                        notes: notes || null,
                    },
                    include: {
                        product: {
                            select: {
                                id: true,
                                name: true,
                                sku: true,
                            },
                        },
                        user: {
                            select: {
                                id: true,
                                fullName: true,
                                email: true,
                            },
                        },
                    },
                });

                // Update product stock
                await tx.product.update({
                    where: { id: parseInt(productId) },
                    data: { stockQuantity: newStock },
                });

                return stockMovement;
            });

            // Convert Decimal to numbers
            const serialized = {
                ...result,
                quantityChange: decimalToNumber(result.quantityChange) ?? 0,
                quantityAfter: decimalToNumber(result.quantityAfter) ?? 0,
            };

            return res.status(201).json(serialized);
        } catch (error: any) {
            console.error('Create stock movement error:', error);
            return res.status(500).json({
                error: 'Internal server error',
                code: 'INTERNAL_ERROR',
                message: error.message,
            });
        }
    }
}
