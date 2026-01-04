import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import {
  createDatabaseBackup,
  restoreDatabaseFromBackup,
  listBackups,
  deleteBackup,
  cleanupOldBackups,
  getBackupPath,
  validateBackupFile,
} from '../utils/database-backup';
import { prisma } from '../models/db';
import * as fs from 'fs';

export class BackupController {
  /**
   * Create a new database backup
   * POST /api/backup/create
   */
  static async createBackup(req: AuthRequest, res: Response) {
    try {
      console.log(`[BackupController] Creating backup requested by user ${req.user?.id}`);

      // Create backup
      const backup = await createDatabaseBackup();

      // Log audit trail
      await prisma.auditLog.create({
        data: {
          userId: req.user!.id,
          action: 'DATABASE_BACKUP_CREATED',
          entityType: 'DATABASE',
          entityId: null,
          changes: JSON.stringify({
            filename: backup.filename,
            size: backup.size,
          }),
          ipAddress: req.ip,
          userAgent: req.get('user-agent'),
          notes: 'Database backup created successfully',
        },
      });

      // Clean up old backups (keep last 10)
      cleanupOldBackups(10);

      return res.json({
        success: true,
        message: 'Database backup created successfully',
        data: {
          filename: backup.filename,
          size: backup.size,
          sizeMB: (backup.size / 1024 / 1024).toFixed(2),
          createdAt: new Date(),
        },
      });
    } catch (error: any) {
      console.error('[BackupController] Create backup error:', error);

      // Log failed attempt
      if (req.user) {
        await prisma.auditLog.create({
          data: {
            userId: req.user.id,
            action: 'DATABASE_BACKUP_FAILED',
            entityType: 'DATABASE',
            entityId: null,
            changes: JSON.stringify({ error: error.message }),
            ipAddress: req.ip,
            userAgent: req.get('user-agent'),
            notes: 'Database backup failed',
          },
        });
      }

      return res.status(500).json({
        success: false,
        error: 'Failed to create database backup',
        details: error.message,
        code: 'BACKUP_FAILED',
      });
    }
  }

  /**
   * Download a backup file
   * GET /api/backup/download/:filename
   */
  static async downloadBackup(req: AuthRequest, res: Response) {
    try {
      const { filename } = req.params;

      // Validate filename (security check)
      if (!filename.match(/^pos_backup_[\d\-_]+\.zip$/)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid backup filename',
          code: 'INVALID_FILENAME',
        });
      }

      const filepath = getBackupPath(filename);

      // Check if file exists
      if (!fs.existsSync(filepath)) {
        return res.status(404).json({
          success: false,
          error: 'Backup file not found',
          code: 'FILE_NOT_FOUND',
        });
      }

      console.log(`[BackupController] Downloading backup: ${filename} by user ${req.user?.id}`);

      // Log audit trail
      await prisma.auditLog.create({
        data: {
          userId: req.user!.id,
          action: 'DATABASE_BACKUP_DOWNLOADED',
          entityType: 'DATABASE',
          entityId: null,
          changes: JSON.stringify({ filename }),
          ipAddress: req.ip,
          userAgent: req.get('user-agent'),
          notes: 'Database backup downloaded',
        },
      });

      // Send file for download
      return res.download(filepath, filename, (err) => {
        if (err) {
          console.error('[BackupController] Download error:', err);
        }
      });
    } catch (error: any) {
      console.error('[BackupController] Download backup error:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to download backup',
        details: error.message,
        code: 'DOWNLOAD_FAILED',
      });
    }
  }

  /**
   * Upload and restore from backup file
   * POST /api/backup/restore
   */
  static async restoreBackup(req: AuthRequest, res: Response) {
    try {
      console.log(`[BackupController] Restore requested by user ${req.user?.id}`);

      // Check if file was uploaded
      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: 'No backup file uploaded',
          code: 'NO_FILE',
        });
      }

      const filepath = req.file.path;

      // Validate backup file
      try {
        validateBackupFile(filepath);
      } catch (validationError: any) {
        // Delete invalid file
        fs.unlinkSync(filepath);
        return res.status(400).json({
          success: false,
          error: 'Invalid backup file',
          details: validationError.message,
          code: 'INVALID_BACKUP',
        });
      }

      console.log('[BackupController] Backup file validated, starting restore...');

      // Log audit trail BEFORE restore (in case restore fails)
      await prisma.auditLog.create({
        data: {
          userId: req.user!.id,
          action: 'DATABASE_RESTORE_STARTED',
          entityType: 'DATABASE',
          entityId: null,
          changes: JSON.stringify({
            filename: req.file.originalname,
            size: req.file.size,
          }),
          ipAddress: req.ip,
          userAgent: req.get('user-agent'),
          notes: 'Database restore started',
        },
      });

      // Perform restore (WARNING: This will wipe all current data!)
      await restoreDatabaseFromBackup(filepath);

      // Delete uploaded file after successful restore
      if (fs.existsSync(filepath)) {
        fs.unlinkSync(filepath);
      }

      console.log('[BackupController] Database restored successfully');

      // Note: We can't log to database after restore because connection is reset
      // The log above will be overwritten by the restore

      return res.json({
        success: true,
        message: 'Database restored successfully from backup',
        warning: 'All previous data has been replaced with backup data',
      });
    } catch (error: any) {
      console.error('[BackupController] Restore backup error:', error);

      // Clean up uploaded file
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }

      return res.status(500).json({
        success: false,
        error: 'Failed to restore database',
        details: error.message,
        code: 'RESTORE_FAILED',
      });
    }
  }

  /**
   * Get list of available backups
   * GET /api/backup/list
   */
  static async listBackups(req: AuthRequest, res: Response) {
    try {
      const backups = listBackups();

      const backupsWithDetails = backups.map(backup => ({
        filename: backup.filename,
        size: backup.size,
        sizeMB: (backup.size / 1024 / 1024).toFixed(2),
        createdAt: backup.createdAt,
      }));

      return res.json({
        success: true,
        data: backupsWithDetails,
        count: backupsWithDetails.length,
      });
    } catch (error: any) {
      console.error('[BackupController] List backups error:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to list backups',
        details: error.message,
        code: 'LIST_FAILED',
      });
    }
  }

  /**
   * Delete a backup file
   * DELETE /api/backup/:filename
   */
  static async deleteBackupFile(req: AuthRequest, res: Response) {
    try {
      const { filename } = req.params;

      // Validate filename (security check)
      if (!filename.match(/^pos_backup_[\d\-_]+\.zip$/)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid backup filename',
          code: 'INVALID_FILENAME',
        });
      }

      deleteBackup(filename);

      // Log audit trail
      await prisma.auditLog.create({
        data: {
          userId: req.user!.id,
          action: 'DATABASE_BACKUP_DELETED',
          entityType: 'DATABASE',
          entityId: null,
          changes: JSON.stringify({ filename }),
          ipAddress: req.ip,
          userAgent: req.get('user-agent'),
          notes: 'Database backup deleted',
        },
      });

      return res.json({
        success: true,
        message: 'Backup deleted successfully',
      });
    } catch (error: any) {
      console.error('[BackupController] Delete backup error:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to delete backup',
        details: error.message,
        code: 'DELETE_FAILED',
      });
    }
  }
}
