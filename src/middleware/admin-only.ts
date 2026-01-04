import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth';

/**
 * Middleware to check if user is an admin
 * Must be used after auth middleware
 */
export function adminOnly(req: AuthRequest, res: Response, next: NextFunction) {
  // Check if user is authenticated
  if (!req.user) {
    return res.status(401).json({
      error: 'Authentication required',
      code: 'UNAUTHORIZED',
    });
  }

  // Check if user is admin
  if (req.user.role !== 'admin') {
    return res.status(403).json({
      error: 'Admin access required. Only administrators can perform this action.',
      code: 'FORBIDDEN',
    });
  }

  // User is admin, proceed
  next();
}

/**
 * Middleware to check if user is admin or manager
 */
export function adminOrManager(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({
      error: 'Authentication required',
      code: 'UNAUTHORIZED',
    });
  }

  if (req.user.role !== 'admin' && req.user.role !== 'manager') {
    return res.status(403).json({
      error: 'Admin or Manager access required',
      code: 'FORBIDDEN',
    });
  }

  next();
}
