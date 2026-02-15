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
        let results;
        if (!q || q.trim() === '') {
            results = await pluginManager.getFeaturedPlugins(server.type, server.mc_version);
        } else {
            results = await pluginManager.searchPlugins(q, server.type, server.mc_version, source || 'all');
        }
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

// Install from Spiget
router.post('/:id/plugins/install-spiget', async (req, res) => {
    try {
        const server = getDb().prepare('SELECT server_dir FROM servers WHERE id = ?').get(req.params.id);
        if (!server) return res.status(404).json({ error: 'Server not found' });

        const { resourceId } = req.body;
        if (!resourceId) return res.status(400).json({ error: 'resourceId is required' });

        const { url, filename } = await pluginManager.getSpigetDownload(resourceId);
        const result = await pluginManager.installPlugin(server.server_dir, url, filename);
        res.json({ message: 'Plugin installed', ...result });
    } catch (err) {
        logger.error('ROUTE', 'Spiget install error', err.message);
        const msg = err.message || '';
        const isPremiumOrExternal = /premium|external|cannot install/i.test(msg);
        const status = isPremiumOrExternal ? 400 : 500;
        const errorMsg = isPremiumOrExternal
            ? 'This plugin is premium or requires manual download. Purchase it on SpigotMC, download the JAR, and place it in your server\'s plugins folder.'
            : msg;
        res.status(status).json({ error: errorMsg });
    }
});

// Install from Hangar
router.post('/:id/plugins/install-hangar', async (req, res) => {
    try {
        const server = getDb().prepare('SELECT server_dir, type FROM servers WHERE id = ?').get(req.params.id);
        if (!server) return res.status(404).json({ error: 'Server not found' });

        const { author, slug } = req.body;
        if (!author || !slug) return res.status(400).json({ error: 'author and slug are required' });

        const platform = server.type === 'velocity' ? 'VELOCITY' : 'PAPER';
        const { url, filename } = await pluginManager.getHangarDownload(author, slug, platform);
        const result = await pluginManager.installPlugin(server.server_dir, url, filename);
        res.json({ message: 'Plugin installed', ...result });
    } catch (err) {
        logger.error('ROUTE', 'Hangar install error', err.message);
        res.status(500).json({ error: err.message });
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
