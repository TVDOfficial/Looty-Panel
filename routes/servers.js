const express = require('express');
const path = require('path');
const fs = require('fs');
const { getDb } = require('../database');
const { authMiddleware } = require('../middleware/auth');
const serverManager = require('../services/serverManager');
const jarDownloader = require('../services/jarDownloader');
const config = require('../config');
const logger = require('../utils/logger');

const router = express.Router();
router.use(authMiddleware);

// List all servers
router.get('/', (req, res) => {
    try {
        const servers = getDb().prepare('SELECT * FROM servers ORDER BY created_at DESC').all();
        const states = serverManager.getAllServerStates();
        const result = servers.map(s => ({
            ...s,
            status: states[s.id] || 'stopped',
        }));
        res.json(result);
    } catch (err) {
        logger.error('ROUTE', 'List servers error', err.message);
        res.status(500).json({ error: 'Failed to list servers' });
    }
});

// Get available server types and versions
router.get('/types', async (req, res) => {
    try {
        const types = ['paper', 'purpur', 'spigot', 'vanilla', 'fabric', 'forge'];
        res.json(types);
    } catch (err) {
        res.status(500).json({ error: 'Failed to get server types' });
    }
});

router.get('/versions/:type', async (req, res) => {
    try {
        const versions = await jarDownloader.getAvailableVersions(req.params.type);
        res.json(versions);
    } catch (err) {
        logger.error('ROUTE', 'Get versions error', err.message);
        res.status(500).json({ error: 'Failed to get versions' });
    }
});

// Create server
router.post('/', async (req, res) => {
    try {
        const { name, type, version, port, memoryMin, memoryMax, javaPath } = req.body;
        if (!name || !type || !version) {
            return res.status(400).json({ error: 'Name, type, and version are required' });
        }

        const mcPort = port || config.DEFAULT_MC_PORT;

        // Check port conflict
        const existing = getDb().prepare('SELECT id, name FROM servers WHERE port = ?').get(mcPort);
        if (existing) {
            return res.status(400).json({ error: `Port ${mcPort} is already used by server "${existing.name}"` });
        }

        // Create server directory
        const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '_');
        const serverDir = path.join(config.SERVERS_DIR, `${safeName}_${Date.now()}`);
        fs.mkdirSync(serverDir, { recursive: true });

        // Download JAR
        try {
            await jarDownloader.downloadServerJar(type, version, serverDir);
        } catch (dlErr) {
            // Clean up directory on download failure
            fs.rmSync(serverDir, { recursive: true, force: true });
            return res.status(500).json({ error: `Failed to download server JAR: ${dlErr.message}` });
        }

        // Accept EULA
        jarDownloader.acceptEula(serverDir);

        // Create server.properties with default settings
        const propsPath = path.join(serverDir, 'server.properties');
        if (!fs.existsSync(propsPath)) {
            fs.writeFileSync(propsPath, `server-port=${mcPort}\nmotd=A Loot Panel Minecraft Server\nonline-mode=true\nmax-players=20\n`);
        }

        // Insert into database
        const result = getDb().prepare(
            `INSERT INTO servers (name, type, mc_version, port, memory_min, memory_max, java_path, jar_file, server_dir, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
            name, type, version, mcPort,
            memoryMin || config.DEFAULT_MIN_MEMORY,
            memoryMax || config.DEFAULT_MAX_MEMORY,
            javaPath || 'java',
            'server.jar',
            serverDir,
            req.user.id
        );

        const server = getDb().prepare('SELECT * FROM servers WHERE id = ?').get(result.lastInsertRowid);

        getDb().prepare('INSERT INTO audit_log (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)').run(
            req.user.id, 'server_create', `Created server: ${name}`, req.ip
        );

        res.status(201).json({ ...server, status: 'stopped' });
    } catch (err) {
        logger.error('ROUTE', 'Create server error', err.message);
        res.status(500).json({ error: 'Failed to create server: ' + err.message });
    }
});

// Get server details
router.get('/:id', (req, res) => {
    try {
        const server = getDb().prepare('SELECT * FROM servers WHERE id = ?').get(req.params.id);
        if (!server) return res.status(404).json({ error: 'Server not found' });

        const state = serverManager.getServerState(server.id);
        res.json({ ...server, status: state.status });
    } catch (err) {
        res.status(500).json({ error: 'Failed to get server' });
    }
});

// Update server
router.put('/:id', (req, res) => {
    try {
        const server = getDb().prepare('SELECT * FROM servers WHERE id = ?').get(req.params.id);
        if (!server) return res.status(404).json({ error: 'Server not found' });

        const updates = req.body;
        const allowed = ['name', 'port', 'memory_min', 'memory_max', 'java_path', 'auto_start', 'auto_restart', 'jvm_args'];
        const setClauses = [];
        const values = [];

        for (const field of allowed) {
            // support camelCase from frontend
            const camelField = field.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
            if (updates[field] !== undefined || updates[camelField] !== undefined) {
                const val = updates[field] !== undefined ? updates[field] : updates[camelField];
                setClauses.push(`${field} = ?`);
                values.push(val);
            }
        }

        if (setClauses.length === 0) return res.status(400).json({ error: 'No valid fields to update' });

        setClauses.push('updated_at = datetime(\'now\')');
        values.push(req.params.id);

        getDb().prepare(`UPDATE servers SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);
        const updated = getDb().prepare('SELECT * FROM servers WHERE id = ?').get(req.params.id);
        res.json(updated);
    } catch (err) {
        logger.error('ROUTE', 'Update server error', err.message);
        res.status(500).json({ error: 'Failed to update server' });
    }
});

// Delete server
router.delete('/:id', async (req, res) => {
    try {
        const server = getDb().prepare('SELECT * FROM servers WHERE id = ?').get(req.params.id);
        if (!server) return res.status(404).json({ error: 'Server not found' });

        // Stop if running
        const state = serverManager.getServerState(server.id);
        if (state.status === 'running' || state.status === 'starting') {
            await serverManager.stopServer(server.id, true);
        }

        // Delete files if requested
        if (req.query.deleteFiles === 'true' && fs.existsSync(server.server_dir)) {
            fs.rmSync(server.server_dir, { recursive: true, force: true });
        }

        getDb().prepare('DELETE FROM servers WHERE id = ?').run(req.params.id);

        getDb().prepare('INSERT INTO audit_log (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)').run(
            req.user.id, 'server_delete', `Deleted server: ${server.name}`, req.ip
        );

        res.json({ message: 'Server deleted' });
    } catch (err) {
        logger.error('ROUTE', 'Delete server error', err.message);
        res.status(500).json({ error: 'Failed to delete server' });
    }
});

// Start server
router.post('/:id/start', async (req, res) => {
    try {
        const result = await serverManager.startServer(parseInt(req.params.id));
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Stop server
router.post('/:id/stop', async (req, res) => {
    try {
        const result = await serverManager.stopServer(parseInt(req.params.id), req.body.force === true);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Restart server
router.post('/:id/restart', async (req, res) => {
    try {
        const result = await serverManager.restartServer(parseInt(req.params.id));
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Send command
router.post('/:id/command', (req, res) => {
    try {
        const { command } = req.body;
        if (!command) return res.status(400).json({ error: 'Command is required' });
        serverManager.sendCommand(parseInt(req.params.id), command);
        res.json({ message: 'Command sent' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get resource usage
router.get('/:id/resources', async (req, res) => {
    try {
        const usage = await serverManager.getResourceUsage(parseInt(req.params.id));
        res.json(usage);
    } catch (err) {
        res.status(500).json({ error: 'Failed to get resource usage' });
    }
});

// Get console buffer
router.get('/:id/console', (req, res) => {
    try {
        const buffer = serverManager.getConsoleBuffer(parseInt(req.params.id));
        res.json({ lines: buffer });
    } catch (err) {
        res.status(500).json({ error: 'Failed to get console' });
    }
});

// Get server.properties
router.get('/:id/properties', (req, res) => {
    try {
        const server = getDb().prepare('SELECT * FROM servers WHERE id = ?').get(req.params.id);
        if (!server) return res.status(404).json({ error: 'Server not found' });

        const propsPath = path.join(server.server_dir, 'server.properties');
        if (!fs.existsSync(propsPath)) return res.json({});

        const content = fs.readFileSync(propsPath, 'utf-8');
        const props = {};
        for (const line of content.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            const eqIndex = trimmed.indexOf('=');
            if (eqIndex > 0) {
                props[trimmed.substring(0, eqIndex)] = trimmed.substring(eqIndex + 1);
            }
        }
        res.json(props);
    } catch (err) {
        res.status(500).json({ error: 'Failed to read properties' });
    }
});

// Update server.properties
router.put('/:id/properties', (req, res) => {
    try {
        const server = getDb().prepare('SELECT * FROM servers WHERE id = ?').get(req.params.id);
        if (!server) return res.status(404).json({ error: 'Server not found' });

        const propsPath = path.join(server.server_dir, 'server.properties');
        const newProps = req.body;

        // Read existing props to preserve comments and order
        let content = '';
        if (fs.existsSync(propsPath)) {
            const lines = fs.readFileSync(propsPath, 'utf-8').split('\n');
            const updatedKeys = new Set();

            for (let line of lines) {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith('#')) {
                    content += line + '\n';
                    continue;
                }
                const eqIndex = trimmed.indexOf('=');
                if (eqIndex > 0) {
                    const key = trimmed.substring(0, eqIndex);
                    if (newProps[key] !== undefined) {
                        content += `${key}=${newProps[key]}\n`;
                        updatedKeys.add(key);
                    } else {
                        content += line + '\n';
                    }
                }
            }

            // Add new keys
            for (const [key, value] of Object.entries(newProps)) {
                if (!updatedKeys.has(key)) {
                    content += `${key}=${value}\n`;
                }
            }
        } else {
            for (const [key, value] of Object.entries(newProps)) {
                content += `${key}=${value}\n`;
            }
        }

        fs.writeFileSync(propsPath, content);
        res.json({ message: 'Properties updated' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to update properties' });
    }
});

// ========== Schedules ==========
const scheduler = require('../services/scheduler');

router.get('/:id/schedules', (req, res) => {
    try {
        const schedules = scheduler.getSchedules(parseInt(req.params.id));
        res.json(schedules);
    } catch (err) {
        res.status(500).json({ error: 'Failed to get schedules' });
    }
});

router.post('/:id/schedules', (req, res) => {
    try {
        const schedule = scheduler.createSchedule({
            ...req.body,
            server_id: parseInt(req.params.id),
        });
        res.status(201).json(schedule);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

router.put('/:id/schedules/:schedId', (req, res) => {
    try {
        const schedule = scheduler.updateSchedule(parseInt(req.params.schedId), req.body);
        res.json(schedule);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

router.delete('/:id/schedules/:schedId', (req, res) => {
    try {
        scheduler.deleteSchedule(parseInt(req.params.schedId));
        res.json({ message: 'Schedule deleted' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete schedule' });
    }
});

module.exports = router;
