const fs = require('fs');
const path = require('path');
const config = require('../config');

// Ensure log directory exists
if (!fs.existsSync(config.LOG_DIR)) {
    fs.mkdirSync(config.LOG_DIR, { recursive: true });
}

const logFile = path.join(config.LOG_DIR, 'mcpanel.log');
const LOG_MAX_BYTES = () => (config.LOG_MAX_SIZE_MB || 10) * 1024 * 1024;

function rotateLogIfNeeded() {
    try {
        if (!fs.existsSync(logFile)) return;
        const stat = fs.statSync(logFile);
        if (stat.size < LOG_MAX_BYTES()) return;

        // Rotate: mcpanel.log -> mcpanel.log.1, mcpanel.log.1 -> mcpanel.log.2, etc. Keep 3 backups
        for (let i = 2; i >= 1; i--) {
            const oldPath = i === 1 ? logFile : path.join(config.LOG_DIR, `mcpanel.log.${i - 1}`);
            const newPath = path.join(config.LOG_DIR, `mcpanel.log.${i}`);
            if (fs.existsSync(oldPath)) {
                if (fs.existsSync(newPath)) fs.unlinkSync(newPath);
                fs.renameSync(oldPath, newPath);
            }
        }
        const rotated = path.join(config.LOG_DIR, 'mcpanel.log.1');
        if (fs.existsSync(logFile)) {
            if (fs.existsSync(rotated)) fs.unlinkSync(rotated);
            fs.renameSync(logFile, rotated);
        }
    } catch (e) { /* ignore rotate errors */ }
}

const LEVELS = { ERROR: 0, WARN: 1, INFO: 2, DEBUG: 3 };
const LEVEL_NAMES = ['ERROR', 'WARN', 'INFO', 'DEBUG'];
const COLORS = {
    ERROR: '\x1b[31m',
    WARN: '\x1b[33m',
    INFO: '\x1b[36m',
    DEBUG: '\x1b[90m',
    RESET: '\x1b[0m',
};

let currentLevel = LEVELS.INFO;

function timestamp() {
    return new Date().toISOString();
}

function log(level, category, message, data) {
    if (LEVELS[level] > currentLevel) return;

    const ts = timestamp();
    const prefix = `[${ts}] [${level}]${category ? ` [${category}]` : ''}`;
    const logLine = data
        ? `${prefix} ${message} ${JSON.stringify(data)}`
        : `${prefix} ${message}`;

    // Console output with colors
    const coloredLine = `${COLORS[level]}${prefix}${COLORS.RESET} ${message}`;
    if (level === 'ERROR') {
        console.error(coloredLine, data || '');
    } else {
        console.log(coloredLine, data ? JSON.stringify(data) : '');
    }

    // File output
    try {
        rotateLogIfNeeded();
        fs.appendFileSync(logFile, logLine + '\n');
    } catch (e) {
        // Ignore file write errors
    }
}

module.exports = {
    error: (cat, msg, data) => log('ERROR', cat, msg, data),
    warn: (cat, msg, data) => log('WARN', cat, msg, data),
    info: (cat, msg, data) => log('INFO', cat, msg, data),
    debug: (cat, msg, data) => log('DEBUG', cat, msg, data),
    setLevel: (level) => {
        if (LEVELS[level] !== undefined) currentLevel = LEVELS[level];
    },
};
