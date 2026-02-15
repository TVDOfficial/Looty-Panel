const path = require('path');
const fs = require('fs');
const config = require('../config');

/**
 * Utility to handle dynamic path resolution for server directories.
 * This allows the panel to function even if the installation directory is moved.
 */

const BASE_DIR = config.BASE_DIR;

/**
 * Converts an absolute path to a path relative to the application BASE_DIR.
 * If the path is outside BASE_DIR, it returns the absolute path.
 * @param {string} absolutePath 
 * @returns {string}
 */
function toRelative(absolutePath) {
    if (!absolutePath) return absolutePath;
    const resolved = path.resolve(absolutePath);
    if (resolved.startsWith(BASE_DIR)) {
        return path.relative(BASE_DIR, resolved);
    }
    return absolutePath;
}

/**
 * Resolves a stored path to an absolute path.
 * Handles:
 * 1. Relative paths (resolves against BASE_DIR)
 * 2. Absolute paths that still exist
 * 3. Legacy absolute paths that no longer exist but might be "re-mappable"
 * @param {string} storedPath 
 * @returns {string}
 */
function toAbsolute(storedPath) {
    if (!storedPath) return storedPath;

    // 1. If it's already a relative path, resolve it against BASE_DIR
    if (!path.isAbsolute(storedPath)) {
        return path.join(BASE_DIR, storedPath);
    }

    // 2. If it's an absolute path and exists, use it
    if (fs.existsSync(storedPath)) {
        return storedPath;
    }

    // 3. Legacy path re-mapping:
    // If an absolute path was stored but no longer exists (directory moved),
    // try to see if the directory exists relative to the new BASE_DIR instead.

    // Normalize path separators to handle inconsistent input
    const normalized = storedPath.replace(/\//g, '\\');
    const lowerPath = normalized.toLowerCase();

    let suffix = '';
    // Look for common markers that indicate where the relative part starts
    const markers = ['\\servers\\', '\\backups\\', '\\data\\'];

    for (const marker of markers) {
        const idx = lowerPath.lastIndexOf(marker);
        if (idx !== -1) {
            suffix = normalized.substring(idx + 1); // e.g., "servers\server1"
            break;
        }
    }

    if (suffix) {
        const remapped = path.join(BASE_DIR, suffix);
        if (fs.existsSync(remapped)) {
            return remapped;
        }
    }

    return storedPath;
}

module.exports = {
    toRelative,
    toAbsolute,
};
