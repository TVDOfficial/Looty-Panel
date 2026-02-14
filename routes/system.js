const express = require('express');
const os = require('os');
const { authMiddleware, adminOnly } = require('../middleware/auth');
const javaDetector = require('../services/javaDetector');
const daemonInstaller = require('../services/daemonInstaller');
const { getDb } = require('../database');
const logger = require('../utils/logger');

const router = express.Router();
router.use(authMiddleware);

// System info
router.get('/info', (req, res) => {
    try {
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        res.json({
            platform: os.platform(),
            arch: os.arch(),
            hostname: os.hostname(),
            uptime: os.uptime(),
            cpus: os.cpus().length,
            cpuModel: os.cpus()[0]?.model || 'Unknown',
            totalMemory: Math.round(totalMem / 1024 / 1024),
            freeMemory: Math.round(freeMem / 1024 / 1024),
            usedMemory: Math.round((totalMem - freeMem) / 1024 / 1024),
            nodeVersion: process.version,
        });
    } catch (err) {
        res.status(500).json({ error: 'Failed to get system info' });
    }
});

// Java installations
router.get('/java', (req, res) => {
    try {
        const installations = javaDetector.detectJavaInstallations();
        res.json(installations);
    } catch (err) {
        logger.error('ROUTE', 'Java detection error', err.message);
        res.status(500).json({ error: 'Failed to detect Java' });
    }
});

// Daemon status
router.get('/daemon', adminOnly, (req, res) => {
    try {
        const status = daemonInstaller.getDaemonStatus();
        res.json(status);
    } catch (err) {
        res.status(500).json({ error: 'Failed to get daemon status' });
    }
});

// Install daemon
router.post('/daemon/install', adminOnly, async (req, res) => {
    try {
        const result = await daemonInstaller.installDaemon();
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Uninstall daemon
router.post('/daemon/uninstall', adminOnly, async (req, res) => {
    try {
        const result = await daemonInstaller.uninstallDaemon();
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Audit log
router.get('/audit-log', adminOnly, (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        const logs = getDb().prepare(`
      SELECT al.*, u.username 
      FROM audit_log al 
      LEFT JOIN users u ON al.user_id = u.id 
      ORDER BY al.created_at DESC 
      LIMIT ?
    `).all(limit);
        res.json(logs);
    } catch (err) {
        res.status(500).json({ error: 'Failed to get audit log' });
    }
});

module.exports = router;
