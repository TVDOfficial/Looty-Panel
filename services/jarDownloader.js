const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

/**
 * Download server JAR files from official sources.
 * Supports: Paper, Purpur, Spigot, Vanilla, Fabric, Forge, Velocity
 *
 * Version sources:
 * - Paper:   https://api.papermc.io/v2/projects/paper
 * - Purpur:  https://api.purpurmc.org/v2/purpur
 * - Velocity: https://api.papermc.io/v2/projects/velocity
 * - Vanilla: https://piston-meta.mojang.com/mc/game/version_manifest_v2.json
 * - Fabric:  https://meta.fabricmc.net/v2/versions/game
 * - Forge:   https://files.minecraftforge.net/.../promotions_slim.json
 * - Spigot:  hardcoded (no public API)
 */

// Fetch JSON from URL
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

// Download file from URL
function downloadFile(url, destPath, onProgress) {
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https') ? https : http;
        const doRequest = (reqUrl) => {
            client.get(reqUrl, { headers: { 'User-Agent': 'LootPanel/1.0' } }, (res) => {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    return doRequest(res.headers.location);
                }
                if (res.statusCode !== 200) {
                    return reject(new Error(`HTTP ${res.statusCode} for ${reqUrl}`));
                }
                const totalSize = parseInt(res.headers['content-length'] || '0', 10);
                let downloaded = 0;
                const file = fs.createWriteStream(destPath);
                res.on('data', (chunk) => {
                    downloaded += chunk.length;
                    if (onProgress && totalSize > 0) {
                        onProgress(Math.round((downloaded / totalSize) * 100));
                    }
                });
                res.pipe(file);
                file.on('finish', () => { file.close(); resolve(destPath); });
                file.on('error', (err) => { fs.unlinkSync(destPath); reject(err); });
            }).on('error', reject);
        };
        doRequest(url);
    });
}

// ========== Version Lists ==========

async function getPaperVersions() {
    const data = await fetchJson('https://api.papermc.io/v2/projects/paper');
    const versions = data.versions || [];
    return versions.reverse(); // API returns oldest first; show newest first
}

async function getPurpurVersions() {
    try {
        const data = await fetchJson('https://api.purpurmc.org/v2/purpur');
        const versions = data.versions || [];
        return versions.reverse(); // API returns oldest first; show newest first
    } catch {
        return [];
    }
}

async function getVelocityVersions() {
    try {
        const data = await fetchJson('https://api.papermc.io/v2/projects/velocity');
        const versions = (data.versions || []).filter(v => !v.includes('-SNAPSHOT'));
        return versions.reverse(); // Newest first
    } catch {
        return [];
    }
}

async function getVanillaVersions() {
    const data = await fetchJson('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json');
    return data.versions
        .filter(v => v.type === 'release')
        .map(v => v.id);
    // Mojang manifest is already newest first
}

async function getFabricGameVersions() {
    const data = await fetchJson('https://meta.fabricmc.net/v2/versions/game');
    return data.filter(v => v.stable).map(v => v.version);
}

async function getForgeVersions() {
    try {
        const data = await fetchJson('https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json');
        const versions = new Set();
        for (const key of Object.keys(data.promos || {})) {
            const mcVer = key.split('-')[0];
            if (mcVer) versions.add(mcVer);
        }
        return Array.from(versions).reverse();
    } catch {
        return [];
    }
}

async function getSpigotVersions() {
    // Use GetBukkit API for Spigot versions
    try {
        // Fallback: return common versions
        return [
            '1.21.4', '1.21.3', '1.21.2', '1.21.1', '1.21',
            '1.20.6', '1.20.4', '1.20.2', '1.20.1', '1.20',
            '1.19.4', '1.19.3', '1.19.2', '1.19.1', '1.19',
            '1.18.2', '1.18.1', '1.18',
            '1.17.1', '1.17',
            '1.16.5', '1.16.4', '1.16.3', '1.16.2', '1.16.1',
            '1.15.2', '1.14.4', '1.13.2', '1.12.2',
        ];
    } catch {
        return [];
    }
}

// ========== Get available versions by type ==========

async function getAvailableVersions(type) {
    try {
        switch (type.toLowerCase()) {
            case 'paper': return await getPaperVersions();
            case 'purpur': return await getPurpurVersions();
            case 'velocity': return await getVelocityVersions();
            case 'vanilla': return await getVanillaVersions();
            case 'spigot':
            case 'bukkit':
            case 'craftbukkit':
                return await getSpigotVersions();
            case 'fabric': return await getFabricGameVersions();
            case 'forge': return await getForgeVersions();
            default: return [];
        }
    } catch (err) {
        logger.error('JAR', `Failed to get versions for ${type}`, err.message);
        return [];
    }
}

// ========== Download JAR ==========

async function downloadServerJar(type, version, destDir, onProgress) {
    if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
    }

    const jarPath = path.join(destDir, 'server.jar');
    logger.info('JAR', `Downloading ${type} ${version}...`);

    switch (type.toLowerCase()) {
        case 'paper':
            return await downloadPaper(version, jarPath, onProgress);
        case 'purpur':
            return await downloadPurpur(version, jarPath, onProgress);
        case 'velocity':
            return await downloadVelocity(version, jarPath, onProgress);
        case 'vanilla':
            return await downloadVanilla(version, jarPath, onProgress);
        case 'spigot':
            return await downloadSpigot(version, jarPath, onProgress);
        case 'fabric':
            return await downloadFabric(version, jarPath, onProgress);
        case 'forge':
            return await downloadForge(version, destDir, onProgress);
        default:
            throw new Error(`Unknown server type: ${type}`);
    }
}

async function downloadPaper(version, jarPath, onProgress) {
    const builds = await fetchJson(`https://api.papermc.io/v2/projects/paper/versions/${version}/builds`);
    if (!builds.builds || builds.builds.length === 0) {
        throw new Error(`No Paper builds found for ${version}`);
    }
    const latestBuild = builds.builds[builds.builds.length - 1];
    const downloadName = latestBuild.downloads.application.name;
    const url = `https://api.papermc.io/v2/projects/paper/versions/${version}/builds/${latestBuild.build}/downloads/${downloadName}`;
    await downloadFile(url, jarPath, onProgress);
    return jarPath;
}

async function downloadPurpur(version, jarPath, onProgress) {
    const url = `https://api.purpurmc.org/v2/purpur/${version}/latest/download`;
    await downloadFile(url, jarPath, onProgress);
    return jarPath;
}

async function downloadVelocity(version, jarPath, onProgress) {
    const builds = await fetchJson(`https://api.papermc.io/v2/projects/velocity/versions/${version}/builds`);
    if (!builds.builds || builds.builds.length === 0) {
        throw new Error(`No Velocity builds found for ${version}`);
    }
    const latestBuild = builds.builds[builds.builds.length - 1];
    const downloadName = latestBuild.downloads.application.name;
    const url = `https://api.papermc.io/v2/projects/velocity/versions/${version}/builds/${latestBuild.build}/downloads/${downloadName}`;
    await downloadFile(url, jarPath, onProgress);
    return jarPath;
}

async function downloadVanilla(version, jarPath, onProgress) {
    const manifest = await fetchJson('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json');
    const versionInfo = manifest.versions.find(v => v.id === version);
    if (!versionInfo) throw new Error(`Vanilla version ${version} not found`);

    const versionMeta = await fetchJson(versionInfo.url);
    const serverUrl = versionMeta.downloads.server.url;
    await downloadFile(serverUrl, jarPath, onProgress);
    return jarPath;
}

async function downloadSpigot(version, jarPath, onProgress) {
    // Try GetBukkit mirror
    const url = `https://download.getbukkit.org/spigot/spigot-${version}.jar`;
    try {
        await downloadFile(url, jarPath, onProgress);
        return jarPath;
    } catch {
        // Fallback: try alternative URL
        const altUrl = `https://cdn.getbukkit.org/spigot/spigot-${version}.jar`;
        await downloadFile(altUrl, jarPath, onProgress);
        return jarPath;
    }
}

async function downloadFabric(version, jarPath, onProgress) {
    // Get latest loader and installer versions
    const loaders = await fetchJson('https://meta.fabricmc.net/v2/versions/loader');
    const installers = await fetchJson('https://meta.fabricmc.net/v2/versions/installer');
    if (!loaders.length || !installers.length) {
        throw new Error('Could not fetch Fabric loader/installer versions');
    }
    const loaderVersion = loaders[0].version;
    const installerVersion = installers[0].version;
    const url = `https://meta.fabricmc.net/v2/versions/loader/${version}/${loaderVersion}/${installerVersion}/server/jar`;
    await downloadFile(url, jarPath, onProgress);
    return jarPath;
}

async function downloadForge(version, destDir, onProgress) {
    // Get promoted forge version for this MC version
    const promos = await fetchJson('https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json');
    let forgeVersion = promos.promos[`${version}-recommended`] || promos.promos[`${version}-latest`];
    if (!forgeVersion) throw new Error(`No Forge version found for MC ${version}`);

    const fullVersion = `${version}-${forgeVersion}`;
    const jarName = `forge-${fullVersion}-installer.jar`;
    const url = `https://maven.minecraftforge.net/net/minecraftforge/forge/${fullVersion}/${jarName}`;
    const installerPath = path.join(destDir, jarName);

    await downloadFile(url, installerPath, onProgress);

    // The Forge installer JAR is downloaded - user needs to run it
    // We'll store the installer path and the user will need Java to run it
    logger.info('JAR', `Forge installer downloaded. Needs to be run with: java -jar ${jarName} --installServer`);
    return installerPath;
}

// Create eula.txt
function acceptEula(serverDir) {
    const eulaPath = path.join(serverDir, 'eula.txt');
    fs.writeFileSync(eulaPath, '#By changing the setting below to TRUE you are indicating your agreement to our EULA (https://aka.ms/MinecraftEULA).\neula=true\n');
}

module.exports = { getAvailableVersions, downloadServerJar, acceptEula };
