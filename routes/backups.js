const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const backupManager = require('../services/backupManager');
const serverManager = require('../services/serverManager');
const logger = require('../utils/logger');

const router = express.Router();
router.use(authMiddleware);

// List backups
router.get('/:id/backups', (req, res) => {
    try {
        const backups = backupManager.listBackups(parseInt(req.params.id));
        res.json(backups);
    } catch (err) {
        res.status(500).json({ error: 'Failed to list backups' });
    }
});

// Create backup
router.post('/:id/backups', async (req, res) => {
    try {
        const backup = await backupManager.createBackup(parseInt(req.params.id), req.body.notes || '');
        res.status(201).json(backup);
    } catch (err) {
        logger.error('ROUTE', 'Create backup error', err.message);
        res.status(500).json({ error: 'Failed to create backup: ' + err.message });
    }
});

// Restore backup
router.post('/:id/backups/:backupId/restore', async (req, res) => {
    try {
        const serverId = parseInt(req.params.id);
        // Stop server if running
        const state = serverManager.getServerState(serverId);
        if (state.status === 'running') {
            await serverManager.stopServer(serverId);
        }

        const result = await backupManager.restoreBackup(parseInt(req.params.backupId), serverId);
        res.json(result);
    } catch (err) {
        logger.error('ROUTE', 'Restore backup error', err.message);
        res.status(500).json({ error: 'Failed to restore backup: ' + err.message });
    }
});

// Delete backup
router.delete('/:id/backups/:backupId', (req, res) => {
    try {
        backupManager.deleteBackup(parseInt(req.params.backupId), parseInt(req.params.id));
        res.json({ message: 'Backup deleted' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Download backup
router.get('/:id/backups/:backupId/download', (req, res) => {
    try {
        const backupPath = backupManager.getBackupPath(parseInt(req.params.backupId), parseInt(req.params.id));
        res.download(backupPath);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
