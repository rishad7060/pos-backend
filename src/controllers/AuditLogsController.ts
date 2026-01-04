import { Response } from 'express';
import { prisma } from '../models/db';
import { AuthRequest } from '../middleware/auth';
import { parseLimit } from '../config/pagination';

export class AuditLogsController {
  static async getAuditLogs(req: AuthRequest, res: Response) {
    try {
      const {
        userId,
        action,
        entityType,
        entityId,
        startDate,
        endDate,
        limit,
        offset = 0,
      } = req.query;

      const where: any = {};

      if (userId) {
        where.userId = parseInt(userId as string);
      }

      if (action) {
        where.action = action as string;
      }

      if (entityType) {
        where.entityType = entityType as string;
      }

      if (entityId) {
        where.entityId = parseInt(entityId as string);
      }

      if (startDate || endDate) {
        where.createdAt = {};
        if (startDate) {
          where.createdAt.gte = new Date(startDate as string);
        }
        if (endDate) {
          const end = new Date(endDate as string);
          end.setHours(23, 59, 59, 999);
          where.createdAt.lte = end;
        }
      }

      const logs = await prisma.auditLog.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              fullName: true,
              email: true,
              role: true,
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
        take: Math.min(parseLimit(limit, 'orders'), 1000),
        skip: parseInt(offset as string) || 0,
      });

      return res.json(logs);
    } catch (error: any) {
      console.error('Get audit logs error:', error);
      console.error('Error stack:', error.stack);
      return res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
        message: error.message,
      });
    }
  }
}


