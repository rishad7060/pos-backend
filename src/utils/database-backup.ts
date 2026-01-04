import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import archiver from 'archiver';
import AdmZip from 'adm-zip';

const execPromise = promisify(exec);

// Create backups directory if it doesn't exist
const BACKUPS_DIR = path.join(__dirname, '../../backups');
if (!fs.existsSync(BACKUPS_DIR)) {
  fs.mkdirSync(BACKUPS_DIR, { recursive: true });
}

/**
 * Parse DATABASE_URL to get connection parameters
 */
function parseDatabaseUrl(url: string) {
  // Format: postgresql://user:password@host:port/database
  const regex = /postgresql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/([^?]+)/;
  const match = url.match(regex);

  if (!match) {
    throw new Error('Invalid DATABASE_URL format');
  }

  return {
    user: match[1],
    password: match[2],
    host: match[3],
    port: match[4],
    database: match[5],
  };
}

/**
 * Create a database backup using pg_dump
 * Returns the path to the created backup file
 */
export async function createDatabaseBackup(): Promise<{
  filename: string;
  filepath: string;
  size: number
}> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    throw new Error('DATABASE_URL not configured');
  }

  const dbConfig = parseDatabaseUrl(dbUrl);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0] + '_' +
                    new Date().toTimeString().split(' ')[0].replace(/:/g, '-');
  const backupFilename = `pos_backup_${timestamp}.sql`;
  const backupPath = path.join(BACKUPS_DIR, backupFilename);
  const zipFilename = `pos_backup_${timestamp}.zip`;
  const zipPath = path.join(BACKUPS_DIR, zipFilename);

  try {
    // Set password environment variable for pg_dump
    const env = {
      ...process.env,
      PGPASSWORD: dbConfig.password,
    };

    // Create SQL dump
    console.log('[Backup] Creating database dump...');
    const dumpCommand = `pg_dump -h ${dbConfig.host} -p ${dbConfig.port} -U ${dbConfig.user} -d ${dbConfig.database} -F p -f "${backupPath}"`;

    await execPromise(dumpCommand, { env, maxBuffer: 50 * 1024 * 1024 }); // 50MB buffer

    // Verify backup file was created
    if (!fs.existsSync(backupPath)) {
      throw new Error('Backup file was not created');
    }

    // Create ZIP archive
    console.log('[Backup] Creating ZIP archive...');
    await createZipArchive(backupPath, zipPath);

    // Delete the SQL file (keep only ZIP)
    fs.unlinkSync(backupPath);

    // Get file size
    const stats = fs.statSync(zipPath);

    console.log(`[Backup] Success! Created ${zipFilename} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);

    return {
      filename: zipFilename,
      filepath: zipPath,
      size: stats.size,
    };
  } catch (error: any) {
    // Clean up any partial files
    if (fs.existsSync(backupPath)) {
      fs.unlinkSync(backupPath);
    }
    if (fs.existsSync(zipPath)) {
      fs.unlinkSync(zipPath);
    }

    console.error('[Backup] Error:', error);
    throw new Error(`Database backup failed: ${error.message}`);
  }
}

/**
 * Create a ZIP archive from a file
 */
function createZipArchive(sourceFile: string, outputZip: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputZip);
    const archive = archiver('zip', { zlib: { level: 9 } }); // Maximum compression

    output.on('close', () => {
      console.log(`[Backup] ZIP created: ${archive.pointer()} bytes`);
      resolve();
    });

    archive.on('error', (err) => {
      reject(err);
    });

    archive.pipe(output);
    archive.file(sourceFile, { name: path.basename(sourceFile) });
    archive.finalize();
  });
}

/**
 * Restore database from a backup ZIP file
 */
export async function restoreDatabaseFromBackup(zipFilePath: string): Promise<void> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    throw new Error('DATABASE_URL not configured');
  }

  const dbConfig = parseDatabaseUrl(dbUrl);
  const extractDir = path.join(BACKUPS_DIR, 'temp_restore');

  try {
    // Create temp directory
    if (!fs.existsSync(extractDir)) {
      fs.mkdirSync(extractDir, { recursive: true });
    }

    // Extract ZIP file
    console.log('[Restore] Extracting ZIP file...');
    const zip = new AdmZip(zipFilePath);
    zip.extractAllTo(extractDir, true);

    // Find the SQL file
    const files = fs.readdirSync(extractDir);
    const sqlFile = files.find(f => f.endsWith('.sql'));

    if (!sqlFile) {
      throw new Error('No SQL file found in backup ZIP');
    }

    const sqlPath = path.join(extractDir, sqlFile);

    // Set password environment variable for psql
    const env = {
      ...process.env,
      PGPASSWORD: dbConfig.password,
    };

    // Drop and recreate database (WARNING: This deletes all data!)
    console.log('[Restore] WARNING: Dropping existing database...');

    // Connect to postgres database to drop and recreate
    const dropCommand = `psql -h ${dbConfig.host} -p ${dbConfig.port} -U ${dbConfig.user} -d postgres -c "DROP DATABASE IF EXISTS ${dbConfig.database};"`;
    await execPromise(dropCommand, { env });

    const createCommand = `psql -h ${dbConfig.host} -p ${dbConfig.port} -U ${dbConfig.user} -d postgres -c "CREATE DATABASE ${dbConfig.database};"`;
    await execPromise(createCommand, { env });

    // Restore from SQL dump
    console.log('[Restore] Restoring database from backup...');
    const restoreCommand = `psql -h ${dbConfig.host} -p ${dbConfig.port} -U ${dbConfig.user} -d ${dbConfig.database} -f "${sqlPath}"`;

    await execPromise(restoreCommand, { env, maxBuffer: 50 * 1024 * 1024 }); // 50MB buffer

    console.log('[Restore] Database restored successfully!');

    // Clean up temp files
    fs.rmSync(extractDir, { recursive: true, force: true });

  } catch (error: any) {
    // Clean up temp files on error
    if (fs.existsSync(extractDir)) {
      fs.rmSync(extractDir, { recursive: true, force: true });
    }

    console.error('[Restore] Error:', error);
    throw new Error(`Database restore failed: ${error.message}`);
  }
}

/**
 * List all available backups
 */
export function listBackups(): Array<{
  filename: string;
  filepath: string;
  size: number;
  createdAt: Date;
}> {
  if (!fs.existsSync(BACKUPS_DIR)) {
    return [];
  }

  const files = fs.readdirSync(BACKUPS_DIR);
  const backups = files
    .filter(f => f.endsWith('.zip') && f.startsWith('pos_backup_'))
    .map(filename => {
      const filepath = path.join(BACKUPS_DIR, filename);
      const stats = fs.statSync(filepath);
      return {
        filename,
        filepath,
        size: stats.size,
        createdAt: stats.mtime,
      };
    })
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()); // Newest first

  return backups;
}

/**
 * Delete a backup file
 */
export function deleteBackup(filename: string): void {
  const filepath = path.join(BACKUPS_DIR, filename);

  if (!fs.existsSync(filepath)) {
    throw new Error('Backup file not found');
  }

  fs.unlinkSync(filepath);
  console.log(`[Backup] Deleted: ${filename}`);
}

/**
 * Clean up old backups (keep only last N backups)
 */
export function cleanupOldBackups(keepCount: number = 10): number {
  const backups = listBackups();

  if (backups.length <= keepCount) {
    return 0;
  }

  const toDelete = backups.slice(keepCount);
  toDelete.forEach(backup => {
    deleteBackup(backup.filename);
  });

  return toDelete.length;
}

/**
 * Get backup file path
 */
export function getBackupPath(filename: string): string {
  return path.join(BACKUPS_DIR, filename);
}

/**
 * Validate backup file
 */
export function validateBackupFile(filepath: string): boolean {
  if (!fs.existsSync(filepath)) {
    throw new Error('Backup file not found');
  }

  const stats = fs.statSync(filepath);

  // Check file size (max 100MB for safety)
  if (stats.size > 100 * 1024 * 1024) {
    throw new Error('Backup file too large (max 100MB)');
  }

  // Check if it's a valid ZIP
  try {
    const zip = new AdmZip(filepath);
    const entries = zip.getEntries();

    // Must contain at least one .sql file
    const hasSqlFile = entries.some(entry => entry.entryName.endsWith('.sql'));
    if (!hasSqlFile) {
      throw new Error('Invalid backup: No SQL file found in ZIP');
    }

    return true;
  } catch (error) {
    throw new Error('Invalid backup file format');
  }
}
