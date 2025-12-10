import { Request, Response, NextFunction } from 'express';
import { prisma } from '../models/db';
import { AuthRequest } from './auth';

export interface AuditOptions {
    action: string;
    entityType: string;
    entityId?: number;
    changes?: any;
    notes?: string;
}

/**
 * Log an audit entry to the database
 */
export async function logAudit(
    userId: number,
    options: AuditOptions,
    req: Request
): Promise<void> {
    try {
        await prisma.auditLog.create({
            data: {
                userId,
                action: options.action,
                entityType: options.entityType,
                entityId: options.entityId,
                changes: options.changes ? JSON.stringify(options.changes) : null,
                ipAddress: req.ip || req.connection.remoteAddress || 'unknown',
                userAgent: req.get('User-Agent') || 'unknown',
                notes: options.notes,
            },
        });
    } catch (error) {
        console.error('Failed to log audit entry:', error);
        // Don't throw - audit logging failure shouldn't break the main operation
    }
}

/**
 * Middleware to automatically log certain actions
 */
export function auditMiddleware(action: string, entityType: string) {
    return async (req: AuthRequest, res: Response, next: NextFunction) => {
        // Store original send
        const originalSend = res.send;

        res.send = function (data: any) {
            // Restore original send
            res.send = originalSend;

            // Log if request was successful (2xx status)
            if (res.statusCode >= 200 && res.statusCode < 300 && req.user) {
                const entityId = req.params.id ? parseInt(req.params.id) : undefined;

                logAudit(req.user.id, {
                    action,
                    entityType,
                    entityId,
                    changes: req.method !== 'GET' ? req.body : undefined,
                }, req).catch(err => {
                    console.error('Audit logging failed:', err);
                });
            }

            return originalSend.call(this, data);
        };

        next();
    };
}

/**
 * Helper to log specific audit events from controllers
 */
export async function auditAction(
    req: AuthRequest,
    action: string,
    entityType: string,
    entityId?: number,
    changes?: any,
    notes?: string
): Promise<void> {
    if (!req.user) {
        return;
    }

    await logAudit(req.user.id, {
        action,
        entityType,
        entityId,
        changes,
        notes,
    }, req);
}
