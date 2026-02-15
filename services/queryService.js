/**
 * Minecraft server status service - retrieves MOTD, player count via Server List Ping (TCP).
 * Falls back to reading server.properties for MOTD when server is offline.
 */
const util = require('minecraft-server-util');
const path = require('path');
const fs = require('fs');

/**
 * Get server status (MOTD, players online/max) when server is running.
 * Uses Server List Ping - works without enable-query.
 */
async function getServerStatus(host, port, timeoutMs = 3000) {
    try {
        const options = { timeout: timeoutMs };
        const response = await util.status(host || '127.0.0.1', parseInt(port, 10) || 25565, options);

        // MOTD can be string or object with text
        let motd = '';
        if (response.motd) {
            if (typeof response.motd === 'string') {
                motd = response.motd;
            } else if (response.motd.raw) {
                motd = response.motd.raw;
            } else if (Array.isArray(response.motd.extra)) {
                motd = response.motd.extra.map(e => e.text || '').join('');
            } else if (response.motd.clean) {
                motd = response.motd.clean;
            }
        }

        return {
            online: true,
            motd: stripMinecraftFormatting(motd) || 'A Minecraft Server',
            playersOnline: response.players?.online ?? 0,
            playersMax: response.players?.max ?? 0,
            version: response.version?.name ?? null,
        };
    } catch (err) {
        return { online: false, motd: null, playersOnline: 0, playersMax: 0, version: null };
    }
}

/**
 * Get MOTD from server.properties (fallback when server is offline).
 */
function getMotdFromProperties(serverDir) {
    const propsPath = path.join(serverDir, 'server.properties');
    if (!fs.existsSync(propsPath)) return null;

    const content = fs.readFileSync(propsPath, 'utf-8');
    for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.startsWith('#') || !trimmed) continue;
        const eq = trimmed.indexOf('=');
        if (eq > 0 && trimmed.substring(0, eq).toLowerCase() === 'motd') {
            let motd = trimmed.substring(eq + 1).trim();
            motd = motd.replace(/^"|"$/g, '');
            return stripMinecraftFormatting(motd) || 'A Minecraft Server';
        }
    }
    return null;
}

/**
 * Strip Minecraft formatting codes (§a, §l, etc.)
 */
function stripMinecraftFormatting(str) {
    if (!str || typeof str !== 'string') return str;
    return str.replace(/§[0-9a-fk-or]/gi, '').trim();
}

module.exports = {
    getServerStatus,
    getMotdFromProperties,
    stripMinecraftFormatting,
};
