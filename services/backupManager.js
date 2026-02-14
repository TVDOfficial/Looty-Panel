const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const unzipper = require('unzipper');
const { getDb } = require('../database');
const config = require('../config');
const logger = require('../utils/logger');

function ensureBackupDir() {
    if (!fs.existsSync(config.BACKUPS_DIR)) {
        fs.mkdirSync(config.BACKUPS_DIR, { recursive: true });
    }
}

async function createBackup(serverId, notes = '') {
    ensureBackupDir();

    const server = getDb().prepare('SELECT * FROM servers WHERE id = ?').get(serverId);
    if (!server) throw new Error('Server not found');

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${server.name}_${timestamp}.zip`;
    const backupPath = path.join(config.BACKUPS_DIR, filename);

    logger.info('BACKUP', `Creating backup for ${server.name}...`);

    return new Promise((resolve, reject) => {
        const output = fs.createWriteStream(backupPath);
        const archive = archiver('zip', { zlib: { level: 6 } });

        output.on('close', () => {
            const size = archive.pointer();
            const result = getDb().prepare(
                'INSERT INTO backups (server_id, filename, size, notes) VALUES (?, ?, ?, ?)'
            ).run(serverId, filename, size, notes);

            logger.info('BACKUP', `Backup created: ${filename} (${formatSize(size)})`);

            // Enforce retention
            enforceRetention(serverId);

            resolve({
                id: result.lastInsertRowid,
                filename,
                size,
                notes,
                created_at: new Date().toISOString(),
            });
        });

        archive.on('error', (err) => {
            logger.error('BACKUP', 'Backup failed', err.message);
            reject(err);
        });

        archive.pipe(output);

        // Add server directory, excluding certain patterns
        const excludePatterns = config.BACKUP_EXCLUDE || [];
        archive.glob('**/*', {
            cwd: server.server_dir,
            ignore: excludePatterns,
            dot: true,
        });

        archive.finalize();
    });
}

async function restoreBackup(backupId, serverId) {
    const backup = getDb().prepare('SELECT * FROM backups WHERE id = ? AND server_id = ?').get(backupId, serverId);
    if (!backup) throw new Error('Backup not found');

    const server = getDb().prepare('SELECT * FROM servers WHERE id = ?').get(serverId);
    if (!server) throw new Error('Server not found');

    const backupPath = path.join(config.BACKUPS_DIR, backup.filename);
    if (!fs.existsSync(backupPath)) throw new Error('Backup file not found on disk');

    logger.info('BACKUP', `Restoring backup ${backup.filename} for ${server.name}...`);

    // Clear server directory (except the backup itself)
    const serverDir = server.server_dir;

    // Extract backup
    return new Promise((resolve, reject) => {
        fs.createReadStream(backupPath)
            .pipe(unzipper.Extract({ path: serverDir }))
            .on('close', () => {
                logger.info('BACKUP', `Backup ${backup.filename} restored successfully`);
                resolve({ message: 'Backup restored successfully' });
            })
            .on('error', (err) => {
                logger.error('BACKUP', 'Restore failed', err.message);
                reject(err);
            });
    });
}

function listBackups(serverId) {
    return getDb().prepare('SELECT * FROM backups WHERE server_id = ? ORDER BY created_at DESC').all(serverId);
}

function deleteBackup(backupId, serverId) {
    const backup = getDb().prepare('SELECT * FROM backups WHERE id = ? AND server_id = ?').get(backupId, serverId);
    if (!backup) throw new Error('Backup not found');

    const backupPath = path.join(config.BACKUPS_DIR, backup.filename);
    if (fs.existsSync(backupPath)) {
        fs.unlinkSync(backupPath);
    }
    getDb().prepare('DELETE FROM backups WHERE id = ?').run(backupId);
    logger.info('BACKUP', `Backup ${backup.filename} deleted`);
}

function enforceRetention(serverId) {
    const backups = getDb().prepare(
        'SELECT * FROM backups WHERE server_id = ? ORDER BY created_at DESC'
    ).all(serverId);

    if (backups.length > config.MAX_BACKUPS_PER_SERVER) {
        const toDelete = backups.slice(config.MAX_BACKUPS_PER_SERVER);
        for (const backup of toDelete) {
            deleteBackup(backup.id, serverId);
        }
    }
}

function getBackupPath(backupId, serverId) {
    const backup = getDb().prepare('SELECT * FROM backups WHERE id = ? AND server_id = ?').get(backupId, serverId);
    if (!backup) throw new Error('Backup not found');
    return path.join(config.BACKUPS_DIR, backup.filename);
}

function formatSize(bytes) {
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    let size = bytes;
    while (size >= 1024 && i < units.length - 1) {
        size /= 1024;
        i++;
    }
    return `${size.toFixed(1)} ${units[i]}`;
}

module.exports = { createBackup, restoreBackup, listBackups, deleteBackup, getBackupPath };
