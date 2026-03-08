/**
 * Automatic database backups: daily, keep latest 4.
 */
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const config = require('../config');
const logger = require('../utils/logger');

const DB_BACKUPS_DIR = path.join(config.DATA_DIR, 'db-backups');
const MAX_BACKUPS = 4;

function runBackup() {
    try {
        const { saveDatabase } = require('../database');
        saveDatabase();

        if (!fs.existsSync(DB_BACKUPS_DIR)) {
            fs.mkdirSync(DB_BACKUPS_DIR, { recursive: true });
        }

        const date = new Date();
        const name = `mcpanel_${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}_${String(date.getHours()).padStart(2, '0')}${String(date.getMinutes()).padStart(2, '0')}${String(date.getSeconds()).padStart(2, '0')}.db`;
        const dest = path.join(DB_BACKUPS_DIR, name);

        fs.copyFileSync(config.DB_PATH, dest);
        logger.info('DB', `Backup created: ${name}`);

        const files = fs.readdirSync(DB_BACKUPS_DIR)
            .filter(f => f.startsWith('mcpanel_') && f.endsWith('.db'))
            .map(f => ({
                name: f,
                path: path.join(DB_BACKUPS_DIR, f),
                mtime: fs.statSync(path.join(DB_BACKUPS_DIR, f)).mtimeMs,
            }))
            .sort((a, b) => b.mtime - a.mtime);

        if (files.length > MAX_BACKUPS) {
            for (let i = MAX_BACKUPS; i < files.length; i++) {
                fs.unlinkSync(files[i].path);
                logger.info('DB', `Old backup removed: ${files[i].name}`);
            }
        }
    } catch (err) {
        logger.error('DB', 'Database backup failed', err.message);
    }
}

let cronTask = null;

function start() {
    runBackup();
    cronTask = cron.schedule('0 0 * * *', runBackup, { timezone: 'UTC' });
    logger.info('DB', 'Daily database backup scheduled (00:00 UTC), keeping latest 4');
}

function stop() {
    if (cronTask) {
        cronTask.stop();
        cronTask = null;
    }
}

module.exports = { runBackup, start, stop };
