const express = require('express');
const { getDb } = require('../database');
const { authMiddleware } = require('../middleware/auth');
const pluginManager = require('../services/pluginManager');
const logger = require('../utils/logger');

const router = express.Router();
router.use(authMiddleware);

// Get installed plugins
router.get('/:id/plugins', (req, res) => {
    try {
        const server = getDb().prepare('SELECT server_dir FROM servers WHERE id = ?').get(req.params.id);
        if (!server) return res.status(404).json({ error: 'Server not found' });

        const plugins = pluginManager.getInstalledPlugins(server.server_dir);
        res.json(plugins);
    } catch (err) {
        logger.error('ROUTE', 'List plugins error', err.message);
        res.status(500).json({ error: 'Failed to list plugins' });
    }
});

// Search plugins
router.get('/:id/plugins/search', async (req, res) => {
    try {
        const server = getDb().prepare('SELECT type, mc_version FROM servers WHERE id = ?').get(req.params.id);
        if (!server) return res.status(404).json({ error: 'Server not found' });

        const { q, source } = req.query;
        if (!q) return res.status(400).json({ error: 'Search query is required' });

        const results = await pluginManager.searchPlugins(q, server.type, server.mc_version, source || 'all');
        res.json(results);
    } catch (err) {
        logger.error('ROUTE', 'Search plugins error', err.message);
        res.status(500).json({ error: 'Failed to search plugins' });
    }
});

// Get plugin versions (Modrinth)
router.get('/:id/plugins/versions/:projectId', async (req, res) => {
    try {
        const versions = await pluginManager.getPluginVersions(req.params.projectId);
        res.json(versions);
    } catch (err) {
        res.status(500).json({ error: 'Failed to get plugin versions' });
    }
});

// Install plugin
router.post('/:id/plugins/install', async (req, res) => {
    try {
        const server = getDb().prepare('SELECT server_dir FROM servers WHERE id = ?').get(req.params.id);
        if (!server) return res.status(404).json({ error: 'Server not found' });

        const { url, filename } = req.body;
        if (!url || !filename) return res.status(400).json({ error: 'URL and filename are required' });

        const result = await pluginManager.installPlugin(server.server_dir, url, filename);
        res.json({ message: 'Plugin installed', ...result });
    } catch (err) {
        logger.error('ROUTE', 'Install plugin error', err.message);
        res.status(500).json({ error: 'Failed to install plugin: ' + err.message });
    }
});

// Remove plugin
router.delete('/:id/plugins/:filename', (req, res) => {
    try {
        const server = getDb().prepare('SELECT server_dir FROM servers WHERE id = ?').get(req.params.id);
        if (!server) return res.status(404).json({ error: 'Server not found' });

        pluginManager.removePlugin(server.server_dir, req.params.filename);
        res.json({ message: 'Plugin removed' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
