const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const logger = require('../utils/logger');

/**
 * Plugin Manager - handles local plugin listing and remote plugin search/download.
 * Sources: Modrinth, Spiget (SpigotMC), Hangar (PaperMC)
 */

function fetchJson(url) {
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https') ? https : http;
        client.get(url, { headers: { 'User-Agent': 'LootPanel/1.0' } }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return fetchJson(res.headers.location).then(resolve).catch(reject);
            }
            if (res.statusCode !== 200) {
                return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
            }
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch (e) { reject(new Error('Invalid JSON response')); }
            });
            res.on('error', reject);
        }).on('error', reject);
    });
}

function downloadFile(url, destPath) {
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https') ? https : http;
        const doRequest = (reqUrl) => {
            client.get(reqUrl, { headers: { 'User-Agent': 'LootPanel/1.0' } }, (res) => {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    return doRequest(res.headers.location);
                }
                if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
                const file = fs.createWriteStream(destPath);
                res.pipe(file);
                file.on('finish', () => { file.close(); resolve(destPath); });
                file.on('error', (err) => { fs.unlinkSync(destPath); reject(err); });
            }).on('error', reject);
        };
        doRequest(url);
    });
}

// ========== Local Plugin Listing ==========

function getInstalledPlugins(serverDir) {
    const pluginsDir = path.join(serverDir, 'plugins');
    if (!fs.existsSync(pluginsDir)) return [];

    const plugins = [];
    const files = fs.readdirSync(pluginsDir);

    for (const file of files) {
        if (!file.endsWith('.jar')) continue;
        const filePath = path.join(pluginsDir, file);
        const stats = fs.statSync(filePath);
        plugins.push({
            filename: file,
            name: file.replace('.jar', ''),
            size: stats.size,
            modified: stats.mtime.toISOString(),
        });
    }

    return plugins;
}

// ========== Modrinth Search ==========

async function searchModrinth(query, serverType, mcVersion, offset = 0, limit = 20) {
    const facets = [];

    // Map server type to Modrinth categories
    const loaderMap = {
        'paper': 'paper',
        'spigot': 'spigot',
        'bukkit': 'bukkit',
        'purpur': 'purpur',
        'fabric': 'fabric',
        'forge': 'forge',
    };

    const loader = loaderMap[serverType.toLowerCase()] || 'paper';
    facets.push(`["categories:${loader}"]`);
    facets.push('["project_type:mod"]');

    if (mcVersion) {
        facets.push(`["versions:${mcVersion}"]`);
    }

    const facetStr = `[${facets.join(',')}]`;
    const url = `https://api.modrinth.com/v2/search?query=${encodeURIComponent(query)}&facets=${encodeURIComponent(facetStr)}&offset=${offset}&limit=${limit}`;

    try {
        const data = await fetchJson(url);
        return {
            source: 'modrinth',
            total: data.total_hits || 0,
            results: (data.hits || []).map(hit => ({
                id: hit.project_id || hit.slug,
                name: hit.title,
                description: hit.description,
                author: hit.author,
                downloads: hit.downloads,
                icon_url: hit.icon_url,
                page_url: `https://modrinth.com/${hit.project_type}/${hit.slug}`,
                source: 'modrinth',
                versions: hit.versions || [],
                updated: hit.date_modified,
            })),
        };
    } catch (err) {
        logger.error('PLUGINS', 'Modrinth search failed', err.message);
        return { source: 'modrinth', total: 0, results: [] };
    }
}

// ========== Spiget (SpigotMC) Search ==========

async function searchSpiget(query, limit = 20) {
    const url = `https://api.spiget.org/v2/search/resources/${encodeURIComponent(query)}?size=${limit}&sort=-downloads`;

    try {
        const data = await fetchJson(url);
        return {
            source: 'spiget',
            total: data.length || 0,
            results: (data || []).map(resource => ({
                id: resource.id,
                name: resource.name,
                description: resource.tag || '',
                author: resource.author ? resource.author.name : 'Unknown',
                downloads: resource.downloads,
                icon_url: resource.icon ? `https://api.spiget.org/v2/resources/${resource.id}/icon` : null,
                page_url: `https://www.spigotmc.org/resources/${resource.id}`,
                source: 'spiget',
                rating: resource.rating ? resource.rating.average : 0,
                updated: resource.updateDate ? new Date(resource.updateDate * 1000).toISOString() : null,
                premium: resource.premium || false,
            })),
        };
    } catch (err) {
        logger.error('PLUGINS', 'Spiget search failed', err.message);
        return { source: 'spiget', total: 0, results: [] };
    }
}

// ========== Hangar (PaperMC) Search ==========

async function searchHangar(query, limit = 20) {
    const url = `https://hangar.papermc.io/api/v1/projects?q=${encodeURIComponent(query)}&limit=${limit}&sort=-downloads`;

    try {
        const data = await fetchJson(url);
        return {
            source: 'hangar',
            total: data.pagination ? data.pagination.count : 0,
            results: (data.result || []).map(project => ({
                id: project.name,
                name: project.name,
                namespace: project.namespace,
                description: project.description,
                author: project.namespace ? project.namespace.owner : 'Unknown',
                downloads: project.stats ? project.stats.downloads : 0,
                icon_url: project.avatarUrl,
                page_url: `https://hangar.papermc.io/${project.namespace.owner}/${project.name}`,
                source: 'hangar',
                updated: project.lastUpdated,
            })),
        };
    } catch (err) {
        logger.error('PLUGINS', 'Hangar search failed', err.message);
        return { source: 'hangar', total: 0, results: [] };
    }
}

// ========== Combined Search ==========

async function searchPlugins(query, serverType, mcVersion, source = 'all') {
    const results = [];

    const isModded = ['forge', 'fabric'].includes(serverType.toLowerCase());

    if (source === 'all' || source === 'modrinth') {
        results.push(searchModrinth(query, serverType, mcVersion));
    }
    if (!isModded && (source === 'all' || source === 'spiget')) {
        results.push(searchSpiget(query));
    }
    if (!isModded && (source === 'all' || source === 'hangar')) {
        results.push(searchHangar(query));
    }

    const resolved = await Promise.all(results);
    return resolved;
}

// ========== Get Plugin Versions from Modrinth ==========

async function getPluginVersions(projectId) {
    try {
        const url = `https://api.modrinth.com/v2/project/${projectId}/version`;
        const versions = await fetchJson(url);
        return versions.map(v => ({
            id: v.id,
            name: v.name,
            version_number: v.version_number,
            game_versions: v.game_versions,
            loaders: v.loaders,
            downloads: v.downloads,
            date_published: v.date_published,
            files: v.files.map(f => ({
                url: f.url,
                filename: f.filename,
                size: f.size,
                primary: f.primary,
            })),
        }));
    } catch (err) {
        logger.error('PLUGINS', 'Failed to get plugin versions', err.message);
        return [];
    }
}

// ========== Install Plugin ==========

async function installPlugin(serverDir, downloadUrl, filename) {
    const pluginsDir = path.join(serverDir, 'plugins');
    if (!fs.existsSync(pluginsDir)) {
        fs.mkdirSync(pluginsDir, { recursive: true });
    }

    const destPath = path.join(pluginsDir, filename);
    await downloadFile(downloadUrl, destPath);
    logger.info('PLUGINS', `Installed plugin: ${filename}`);
    return { filename, path: destPath };
}

// ========== Remove Plugin ==========

function removePlugin(serverDir, filename) {
    const filePath = path.join(serverDir, 'plugins', filename);
    if (!fs.existsSync(filePath)) throw new Error('Plugin file not found');
    fs.unlinkSync(filePath);
    logger.info('PLUGINS', `Removed plugin: ${filename}`);
}

module.exports = {
    getInstalledPlugins,
    searchPlugins,
    getPluginVersions,
    installPlugin,
    removePlugin,
};
