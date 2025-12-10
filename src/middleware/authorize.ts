import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth';
import { prisma } from '../models/db';

export const authorize = (allowedRoles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        error: 'Authentication required',
        code: 'NOT_AUTHENTICATED'
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        error: 'Insufficient permissions',
        code: 'INSUFFICIENT_PERMISSIONS'
      });
    }

    next();
  };
};

export const requireAdmin = authorize(['admin']);
export const requireManager = authorize(['admin', 'manager']);
export const requireCashier = authorize(['admin', 'manager', 'cashier']);

// Middleware to check specific manager permissions
export const checkManagerPermission = (permission: string) => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        error: 'Authentication required',
        code: 'NOT_AUTHENTICATED'
      });
    }

    // Admins have all permissions
    if (req.user.role === 'admin') {
      return next();
    }

    // Only managers need permission checks
    if (req.user.role !== 'manager') {
      return res.status(403).json({
        error: 'Manager access required',
        code: 'MANAGER_REQUIRED'
      });
    }

    try {
      const managerPermissions = await prisma.managerPermission.findUnique({
        where: { managerId: req.user.id }
      });

      if (!managerPermissions) {
        return res.status(403).json({
          error: 'Manager permissions not configured',
          code: 'PERMISSIONS_NOT_CONFIGURED'
        });
      }

      if (!(managerPermissions as any)[permission]) {
        return res.status(403).json({
          error: 'Insufficient manager permissions',
          code: 'INSUFFICIENT_MANAGER_PERMISSIONS'
        });
      }

      next();
    } catch (error) {
      console.error('Manager permission check error:', error);
      return res.status(500).json({
        error: 'Permission check failed',
        code: 'PERMISSION_CHECK_ERROR'
      });
    }
  };
};

// Generic permission check for Manager or Cashier
export const checkPermission = (permission: string) => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        error: 'Authentication required',
        code: 'NOT_AUTHENTICATED'
      });
    }

    // Admins have all permissions
    if (req.user.role === 'admin') {
      return next();
    }

    try {
      let hasPermission = false;

      if (req.user.role === 'manager') {
        const perms = await prisma.managerPermission.findUnique({
          where: { managerId: req.user.id }
        });
        hasPermission = perms ? (perms as any)[permission] : false;
      } else if (req.user.role === 'cashier') {
        const perms = await prisma.cashierPermission.findUnique({
          where: { cashierId: req.user.id }
        });
        hasPermission = perms ? (perms as any)[permission] : false;
      }

      if (!hasPermission) {
        return res.status(403).json({
          error: `Insufficient permissions: ${permission}`,
          code: 'INSUFFICIENT_PERMISSIONS'
        });
      }

      next();
    } catch (error) {
      console.error('Permission check error:', error);
      return res.status(500).json({
        error: 'Permission check failed',
        code: 'PERMISSION_CHECK_ERROR'
      });
    }
  };
};



