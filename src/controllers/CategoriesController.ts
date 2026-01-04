import { Response } from 'express';
import { prisma } from '../models/db';
import { AuthRequest } from '../middleware/auth';
import { parseLimit, createPaginatedResponse } from '../config/pagination';

export class CategoriesController {
  static async getCategories(req: AuthRequest, res: Response) {
    try {
      const { limit } = req.query;

      // Try to get from Category model first, fallback to product categories
      // POS needs ALL categories available
      const take = parseLimit(limit, 'categories');

      try {
        // Get total count
        const totalCount = await prisma.category.count();

        const categories = await prisma.category.findMany({
          take,
          orderBy: { name: 'asc' },
        });

        if (categories.length > 0) {
          const response = createPaginatedResponse(
            categories,
            totalCount,
            take,
            'categories'
          );
          return res.json(response);
        }
      } catch (err) {
        // Category model might not be in use, fallback to product categories
      }

      // Get unique categories from products (fallback)
      const products = await prisma.product.findMany({
        where: {
          category: { not: null },
        },
        select: {
          category: true,
        },
        take,
      });

      const uniqueCategories = new Set<string>();
      products.forEach((p) => {
        if (p.category) {
          uniqueCategories.add(p.category);
        }
      });

      const categories = Array.from(uniqueCategories)
        .map((name, index) => ({ id: index + 1, name }));

      // For fallback, total = returned
      const response = createPaginatedResponse(
        categories,
        categories.length,
        take,
        'categories'
      );

      return res.json(response);
    } catch (error) {
      console.error('Get categories error:', error);
      return res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
      });
    }
  }

  static async createCategory(req: AuthRequest, res: Response) {
    try {
      const { name, description } = req.body;

      if (!name || !name.trim()) {
        return res.status(400).json({
          error: 'Category name is required',
          code: 'MISSING_NAME',
        });
      }

      // Try to create in Category model
      try {
        const category = await prisma.category.create({
          data: {
            name: name.trim(),
            description: description || null,
          },
        });

        return res.status(201).json(category);
      } catch (err: any) {
        if (err.code === 'P2002') {
          return res.status(400).json({
            error: 'Category with this name already exists',
            code: 'DUPLICATE_CATEGORY',
          });
        }
        throw err;
      }
    } catch (error: any) {
      console.error('Create category error:', error);
      return res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
        message: error.message,
      });
    }
  }

  static async updateCategory(req: AuthRequest, res: Response) {
    try {
      const { id } = req.query;
      const { name, description } = req.body;

      if (!id) {
        return res.status(400).json({
          error: 'Category ID is required',
          code: 'MISSING_ID',
        });
      }

      const categoryId = parseInt(id as string);
      if (isNaN(categoryId)) {
        return res.status(400).json({
          error: 'Invalid category ID',
          code: 'INVALID_ID',
        });
      }

      const updateData: any = {};
      if (name !== undefined) updateData.name = name.trim();
      if (description !== undefined) updateData.description = description || null;

      const category = await prisma.category.update({
        where: { id: categoryId },
        data: updateData,
      });

      return res.json(category);
    } catch (error: any) {
      console.error('Update category error:', error);
      if (error.code === 'P2025') {
        return res.status(404).json({
          error: 'Category not found',
          code: 'CATEGORY_NOT_FOUND',
        });
      }
      if (error.code === 'P2002') {
        return res.status(400).json({
          error: 'Category with this name already exists',
          code: 'DUPLICATE_CATEGORY',
        });
      }
      return res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
        message: error.message,
      });
    }
  }

  static async deleteCategory(req: AuthRequest, res: Response) {
    try {
      const { id } = req.query;

      if (!id) {
        return res.status(400).json({
          error: 'Category ID is required',
          code: 'MISSING_ID',
        });
      }

      const categoryId = parseInt(id as string);
      if (isNaN(categoryId)) {
        return res.status(400).json({
          error: 'Invalid category ID',
          code: 'INVALID_ID',
        });
      }

      // Check if category exists
      const category = await prisma.category.findUnique({
        where: { id: categoryId },
      });

      if (!category) {
        return res.status(404).json({
          error: 'Category not found',
          code: 'CATEGORY_NOT_FOUND',
        });
      }

      // Unlink products that use this category name
      // This ensures the category disappears from the list (which is derived from products)
      await prisma.product.updateMany({
        where: {
          category: category.name,
        },
        data: {
          category: null,
        },
      });

      // Delete the category record
      await prisma.category.delete({
        where: { id: categoryId },
      });

      return res.json({ message: 'Category deleted successfully' });
    } catch (error: any) {
      console.error('Delete category error:', error);
      if (error.code === 'P2025') {
        return res.status(404).json({
          error: 'Category not found',
          code: 'CATEGORY_NOT_FOUND',
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

