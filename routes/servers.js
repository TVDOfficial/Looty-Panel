const express = require('express');
const path = require('path');
const fs = require('fs');
const { getDb } = require('../database');
const { authMiddleware } = require('../middleware/auth');
const serverManager = require('../services/serverManager');
const jarDownloader = require('../services/jarDownloader');
const queryService = require('../services/queryService');
const config = require('../config');
const logger = require('../utils/logger');
const pathHelper = require('../utils/pathHelper');

const router = express.Router();
router.use(authMiddleware);

// List all servers (includes motd, status, player count for running servers)
router.get('/', async (req, res) => {
    try {
        const servers = getDb().prepare('SELECT * FROM servers ORDER BY created_at DESC').all();
        const states = serverManager.getAllServerStates();
        const runningIds = servers.filter(s => (states[s.id] || 'stopped') === 'running').map(s => s.id);
        const statusPromises = runningIds.map(async (id) => {
            const s = servers.find(x => x.id === id);
            if (!s) return { id, motd: null, playersOnline: 0, playersMax: 0 };
            try {
                const st = await queryService.getServerStatus('127.0.0.1', s.port, 2000);
                return st.online ? { id, motd: st.motd, playersOnline: st.playersOnline, playersMax: st.playersMax } : { id, motd: null, playersOnline: 0, playersMax: 0 };
            } catch (_) {
                return { id, motd: null, playersOnline: 0, playersMax: 0 };
            }
        });
        const statusResults = await Promise.all(statusPromises);
        const statusMap = Object.fromEntries(statusResults.map(r => [r.id, r]));

        const result = servers.map(s => {
            const status = states[s.id] || 'stopped';
            const live = statusMap[s.id];
            let motd = queryService.getMotdFromProperties(pathHelper.toAbsolute(s.server_dir));
            if (live && live.motd) motd = live.motd;
            return {
                ...s,
                status,
                motd: motd || null,
                playersOnline: live ? live.playersOnline : 0,
                playersMax: live ? live.playersMax : 0,
            };
        });
        res.json(result);
    } catch (err) {
        logger.error('ROUTE', 'List servers error', err.message);
        res.status(500).json({ error: 'Failed to list servers' });
    }
});

// Get available server types and versions
router.get('/types', async (req, res) => {
    try {
        const types = ['paper', 'purpur', 'spigot', 'velocity', 'vanilla', 'fabric', 'forge'];
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

// Import existing server from folder
router.post('/import', async (req, res) => {
    try {
        const { serverDir, name, port } = req.body;
        if (!serverDir || !fs.existsSync(serverDir)) {
            return res.status(400).json({ error: 'Valid server directory path is required' });
        }

        const dir = path.resolve(serverDir);
        let jarFile = 'server.jar';
        const files = fs.readdirSync(dir).filter(f => f.endsWith('.jar'));
        if (files.length === 0) return res.status(400).json({ error: 'No JAR file found in directory' });
        if (files.length === 1) jarFile = files[0];
        else if (files.includes('server.jar')) jarFile = 'server.jar';
        else jarFile = files[0];

        let mcPort = port;
        const propsPath = path.join(dir, 'server.properties');
        if (mcPort == null && fs.existsSync(propsPath)) {
            const content = fs.readFileSync(propsPath, 'utf-8');
            for (const line of content.split('\n')) {
                const m = line.match(/^server-port\s*=\s*(\d+)/i);
                if (m) { mcPort = parseInt(m[1], 10); break; }
            }
        }
        mcPort = mcPort || config.DEFAULT_MC_PORT;

        const existing = getDb().prepare('SELECT id, name FROM servers WHERE port = ?').get(mcPort);
        if (existing) {
            return res.status(400).json({ error: `Port ${mcPort} is already used by server "${existing.name}"` });
        }

        const serverName = name || path.basename(dir) || 'Imported Server';

        const result = getDb().prepare(
            `INSERT INTO servers (name, type, mc_version, port, memory_min, memory_max, java_path, jar_file, server_dir, created_by, auto_start)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`
        ).run(
            serverName, 'paper', 'unknown', mcPort,
            config.DEFAULT_MIN_MEMORY,
            config.DEFAULT_MAX_MEMORY,
            'java',
            jarFile,
            pathHelper.toRelative(dir),
            req.user.id
        );

        const server = getDb().prepare('SELECT * FROM servers WHERE id = ?').get(result.lastInsertRowid);
        getDb().prepare('INSERT INTO audit_log (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)').run(
            req.user.id, 'server_import', `Imported server: ${serverName} from ${dir}`, req.ip
        );

        res.status(201).json({ ...server, status: 'stopped' });
    } catch (err) {
        logger.error('ROUTE', 'Import server error', err.message);
        res.status(500).json({ error: 'Failed to import server: ' + err.message });
    }
});

// Clone/duplicate server
router.post('/:id/clone', async (req, res) => {
    try {
        const source = getDb().prepare('SELECT * FROM servers WHERE id = ?').get(req.params.id);
        if (!source) return res.status(404).json({ error: 'Server not found' });

        const { name } = req.body;
        const cloneName = (name || source.name + ' (copy)').trim();
        if (!cloneName) return res.status(400).json({ error: 'Clone name is required' });

        let newPort = source.port;
        while (getDb().prepare('SELECT id FROM servers WHERE port = ?').get(newPort)) {
            newPort++;
        }

        const safeName = cloneName.replace(/[^a-zA-Z0-9_-]/g, '_');
        const cloneDir = path.join(config.SERVERS_DIR, `${safeName}_${Date.now()}`);
        fs.mkdirSync(cloneDir, { recursive: true });

        // Copy files (exclude logs, cache, lock files)
        const excludeDirs = ['logs', 'cache', 'crash-reports'];
        const excludeFiles = /\.lock$|^usercache\.json$/;
        function copyRecursive(src, dest) {
            const entries = fs.readdirSync(src, { withFileTypes: true });
            for (const e of entries) {
                const srcPath = path.join(src, e.name);
                const destPath = path.join(dest, e.name);
                if (e.isDirectory()) {
                    if (excludeDirs.includes(e.name)) continue;
                    fs.mkdirSync(destPath, { recursive: true });
                    copyRecursive(srcPath, destPath);
                } else {
                    if (excludeFiles.test(e.name)) continue;
                    fs.copyFileSync(srcPath, destPath);
                }
            }
        }
        copyRecursive(source.server_dir, cloneDir);

        const result = getDb().prepare(
            `INSERT INTO servers (name, type, mc_version, port, memory_min, memory_max, java_path, jvm_args, jar_file, server_dir, created_by, auto_start, auto_restart)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
            cloneName, source.type, source.mc_version, newPort,
            source.memory_min, source.memory_max,
            source.java_path || 'java',
            source.jvm_args || '',
            source.jar_file,
            pathHelper.toRelative(cloneDir),
            req.user.id,
            0,
            source.auto_restart ?? 1
        );

        // Update server.properties port
        const propsPath = path.join(cloneDir, 'server.properties');
        if (fs.existsSync(propsPath)) {
            let content = fs.readFileSync(propsPath, 'utf-8');
            content = content.replace(/server-port=\d+/i, `server-port=${newPort}`);
            fs.writeFileSync(propsPath, content);
        }

        const server = getDb().prepare('SELECT * FROM servers WHERE id = ?').get(result.lastInsertRowid);
        getDb().prepare('INSERT INTO audit_log (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)').run(
            req.user.id, 'server_clone', `Cloned server: ${cloneName} from ${source.name}`, req.ip
        );

        res.status(201).json({ ...server, status: 'stopped' });
    } catch (err) {
        logger.error('ROUTE', 'Clone server error', err.message);
        res.status(500).json({ error: 'Failed to clone server: ' + err.message });
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
            fs.writeFileSync(propsPath, `server-port=${mcPort}\nmotd=A Looty Panel Minecraft Server\nonline-mode=true\nmax-players=20\n`);
        }

        // Insert into database (auto_start=1 by default so server starts when panel comes online)
        const result = getDb().prepare(
            `INSERT INTO servers (name, type, mc_version, port, memory_min, memory_max, java_path, jar_file, server_dir, created_by, auto_start)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
        ).run(
            name, type, version, mcPort,
            memoryMin || config.DEFAULT_MIN_MEMORY,
            memoryMax || config.DEFAULT_MAX_MEMORY,
            javaPath || 'java',
            'server.jar',
            pathHelper.toRelative(serverDir),
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
        const absServerDir = pathHelper.toAbsolute(server.server_dir);
        if (req.query.deleteFiles === 'true' && fs.existsSync(absServerDir)) {
            fs.rmSync(absServerDir, { recursive: true, force: true });
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

// Kill server (force stop - immediate, no graceful shutdown)
router.post('/:id/kill', async (req, res) => {
    try {
        const result = await serverManager.stopServer(parseInt(req.params.id), true);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Restart server
router.post('/:id/restart', async (req, res) => {
    try {
        const serverId = parseInt(req.params.id);
        const server = getDb().prepare('SELECT name FROM servers WHERE id = ?').get(serverId);
        const result = await serverManager.restartServer(serverId);
        const alertService = require('../services/alertService');
        alertService.notifyRestart(server?.name || 'Server', serverId, 'Manual restart').catch(() => { });
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

        const propsPath = path.join(pathHelper.toAbsolute(server.server_dir), 'server.properties');
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

        const propsPath = path.join(pathHelper.toAbsolute(server.server_dir), 'server.properties');
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

// Get EULA status
router.get('/:id/eula', (req, res) => {
    try {
        const server = getDb().prepare('SELECT server_dir FROM servers WHERE id = ?').get(req.params.id);
        if (!server) return res.status(404).json({ error: 'Server not found' });
        const eulaPath = path.join(pathHelper.toAbsolute(server.server_dir), 'eula.txt');
        if (!fs.existsSync(eulaPath)) return res.json({ agreed: false });
        const content = fs.readFileSync(eulaPath, 'utf-8');
        const agreed = /eula\s*=\s*true/i.test(content);
        res.json({ agreed });
    } catch (err) {
        res.status(500).json({ error: 'Failed to read EULA' });
    }
});

// Set EULA agreed
router.post('/:id/eula', (req, res) => {
    try {
        const server = getDb().prepare('SELECT server_dir FROM servers WHERE id = ?').get(req.params.id);
        if (!server) return res.status(404).json({ error: 'Server not found' });
        const eulaPath = path.join(pathHelper.toAbsolute(server.server_dir), 'eula.txt');
        const defaultContent = '#By changing the setting below to TRUE you are indicating your agreement to our EULA (https://aka.ms/MinecraftEULA).\neula=true\n';
        if (fs.existsSync(eulaPath)) {
            let content = fs.readFileSync(eulaPath, 'utf-8');
            content = content.replace(/eula\s*=\s*false/i, 'eula=true');
            if (!/eula\s*=\s*true/i.test(content)) content += '\neula=true\n';
            fs.writeFileSync(eulaPath, content);
        } else {
            fs.writeFileSync(eulaPath, defaultContent);
        }
        res.json({ agreed: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to set EULA' });
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
