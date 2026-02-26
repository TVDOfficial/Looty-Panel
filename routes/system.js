const express = require('express');
const os = require('os');
const { authMiddleware, adminOnly } = require('../middleware/auth');
const javaDetector = require('../services/javaDetector');
const daemonInstaller = require('../services/daemonInstaller');
const serverManager = require('../services/serverManager');
const { getDb } = require('../database');
const config = require('../config');
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
        const status = daemonInstaller.getStatus();
        res.json(status);
    } catch (err) {
        res.status(500).json({ error: 'Failed to get daemon status' });
    }
});

// Install daemon
router.post('/daemon/install', adminOnly, async (req, res) => {
    try {
        const result = daemonInstaller.install();
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Uninstall daemon
router.post('/daemon/uninstall', adminOnly, async (req, res) => {
    try {
        const result = daemonInstaller.uninstall();
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Panel settings (admin only)
router.get('/panel-settings', adminOnly, (req, res) => {
    try {
        const rows = getDb().prepare('SELECT key, value FROM settings WHERE key LIKE "panel_%"').all();
        const settings = { log_max_size_mb: 10, http_port: config.HTTP_PORT };
        for (const r of rows) {
            if (r.key === 'panel_log_max_size_mb') settings.log_max_size_mb = parseInt(r.value, 10) || 10;
            if (r.key === 'panel_http_port') settings.http_port = parseInt(r.value, 10) || config.HTTP_PORT;
        }
        res.json(settings);
    } catch (err) {
        res.status(500).json({ error: 'Failed to get settings' });
    }
});

router.put('/panel-settings', adminOnly, (req, res) => {
    try {
        const { log_max_size_mb, http_port } = req.body;
        if (typeof log_max_size_mb !== 'undefined') {
            const val = Math.max(1, Math.min(100, parseInt(log_max_size_mb, 10) || 10));
            getDb().prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('panel_log_max_size_mb', String(val));
            config.LOG_MAX_SIZE_MB = val;
        }
        if (typeof http_port !== 'undefined') {
            const val = parseInt(http_port, 10);
            if (val >= 1 && val <= 65535) {
                getDb().prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('panel_http_port', String(val));
                // Note: config.HTTP_PORT is NOT updated here because a restart is required
            }
        }
        res.json({ message: 'Settings saved' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to save settings' });
    }
});

// Alert settings (admin only)
router.get('/alert-settings', adminOnly, (req, res) => {
    try {
        const alertService = require('../services/alertService');
        res.json(alertService.getSettings());
    } catch (err) {
        res.status(500).json({ error: 'Failed to get alert settings' });
    }
});

router.put('/alert-settings', adminOnly, (req, res) => {
    try {
        const alertService = require('../services/alertService');
        const keys = [
            'alert_discord_webhook', 'alert_discord_on_crash', 'alert_discord_on_backup_fail', 'alert_discord_on_restart',
            'alert_email_enabled', 'alert_email_host', 'alert_email_port', 'alert_email_secure',
            'alert_email_user', 'alert_email_pass', 'alert_email_to',
            'alert_email_on_crash', 'alert_email_on_backup_fail', 'alert_email_on_restart',
        ];
        const body = req.body;
        for (const k of keys) {
            if (body[k] !== undefined) {
                const v = body[k];
                alertService.saveSetting(k, typeof v === 'boolean' ? (v ? '1' : '0') : v);
            }
        }
        res.json({ message: 'Alert settings saved' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to save alert settings' });
    }
});

// Preferences (per-user)
router.get('/preferences', (req, res) => {
    try {
        const row = getDb().prepare('SELECT preferences FROM user_preferences WHERE user_id = ?').get(req.user.id);
        res.json(row ? JSON.parse(row.preferences) : {});
    } catch (err) {
        res.status(500).json({ error: 'Failed to get preferences' });
    }
});

router.put('/preferences', (req, res) => {
    try {
        const prefs = JSON.stringify(req.body);
        getDb().prepare('INSERT OR REPLACE INTO user_preferences (user_id, preferences) VALUES (?, ?)').run(req.user.id, prefs);
        res.json({ message: 'Preferences saved' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to save preferences' });
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

// Restart panel (admin only)
router.post('/restart', adminOnly, async (req, res) => {
    try {
        logger.info('SYSTEM', `Restart requested by user: ${req.user.username}`);

        // Notify client that we are starting shutdown
        res.json({ message: 'Panel is restarting. All servers will be shut down.' });

        // Give the response a moment to reach the client
        setTimeout(async () => {
            logger.info('SYSTEM', 'Shutting down all servers before panel restart...');
            await serverManager.shutdownAll();

            const { installed, running } = daemonInstaller.getStatus();
            if (installed && running) {
                logger.info('SYSTEM', 'Running as service, triggering service restart...');
                const { spawn } = require('child_process');
                // Use a detached powershell to restart the service so we can exit cleanly
                spawn('powershell.exe', ['-Command', 'Start-Sleep -s 2; Restart-Service lootpanel.exe'], {
                    detached: true,
                    stdio: 'ignore'
                }).unref();
                process.exit(0);
            } else {
                logger.info('SYSTEM', 'Not running as service (or service stopped), exiting process...');
                process.exit(0);
            }
        }, 1000);
    } catch (err) {
        logger.error('SYSTEM', 'Restart failed', err.message);
        res.status(500).json({ error: 'Failed to initiate restart' });
    }
});

module.exports = router;
