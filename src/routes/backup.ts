import express from 'express';
import multer from 'multer';
import path from 'path';
import { authenticate } from '../middleware/auth';
import { adminOnly } from '../middleware/admin-only';
import { BackupController } from '../controllers/BackupController';

const router = express.Router();

// Configure multer for file uploads
const upload = multer({
  dest: path.join(__dirname, '../../backups/temp/'),
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB max file size
  },
  fileFilter: (req, file, cb) => {
    // Only allow ZIP files
    if (file.mimetype === 'application/zip' || file.originalname.endsWith('.zip')) {
      cb(null, true);
    } else {
      cb(new Error('Only ZIP files are allowed'));
    }
  },
});

// All backup routes require authentication and admin access
router.use(authenticate);
router.use(adminOnly);

/**
 * Create a new database backup
 * POST /api/backup/create
 */
router.post('/create', BackupController.createBackup);

/**
 * Download a backup file
 * GET /api/backup/download/:filename
 */
router.get('/download/:filename', BackupController.downloadBackup);

/**
 * Upload and restore from backup file
 * POST /api/backup/restore
 * Requires multipart/form-data with 'backup' file field
 */
router.post('/restore', upload.single('backup'), BackupController.restoreBackup);

/**
 * Get list of available backups
 * GET /api/backup/list
 */
router.get('/list', BackupController.listBackups);

/**
 * Delete a backup file
 * DELETE /api/backup/:filename
 */
router.delete('/:filename', BackupController.deleteBackupFile);

export default router;
