const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const pidusage = require('pidusage');
const { getDb } = require('../database');
const logger = require('../utils/logger');
const config = require('../config');
const pathHelper = require('../utils/pathHelper');

// In-memory map of running server processes
const runningServers = new Map();

/**
 * Server state: { process, status, consoleBuffer, listeners }
 * status: 'stopped' | 'starting' | 'running' | 'stopping' | 'crashed'
 */

function getServerState(serverId) {
    return runningServers.get(serverId) || { status: 'stopped', consoleBuffer: [], listeners: new Set() };
}

function getAllServerStates() {
    const states = {};
    const servers = getDb().prepare('SELECT id FROM servers').all();
    for (const s of servers) {
        const state = getServerState(s.id);
        states[s.id] = state.status;
    }
    return states;
}

function startServer(serverId) {
    return new Promise((resolve, reject) => {
        const serverConfig = getDb().prepare('SELECT * FROM servers WHERE id = ?').get(serverId);
        if (!serverConfig) return reject(new Error('Server not found'));

        const existing = runningServers.get(serverId);
        if (existing && existing.status === 'running') {
            return reject(new Error('Server is already running'));
        }

        const serverDir = pathHelper.toAbsolute(serverConfig.server_dir);
        const jarFile = serverConfig.jar_file;
        const jarPath = path.join(serverDir, jarFile);

        if (!fs.existsSync(jarPath)) {
            return reject(new Error(`JAR file not found: ${jarPath}`));
        }

        const jvmArgs = [
            `-Xms${serverConfig.memory_min}`,
            `-Xmx${serverConfig.memory_max}`,
        ];

        // Add custom JVM args
        if (serverConfig.jvm_args) {
            const extraArgs = serverConfig.jvm_args.split(' ').filter(a => a.trim());
            jvmArgs.push(...extraArgs);
        }

        jvmArgs.push('-jar', jarFile, 'nogui');

        logger.info('SERVER', `Starting server ${serverConfig.name} (ID: ${serverId})`);

        const proc = spawn(serverConfig.java_path || 'java', jvmArgs, {
            cwd: serverDir,
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        const state = {
            process: proc,
            status: 'starting',
            consoleBuffer: [],
            listeners: existing ? existing.listeners : new Set(),
            startedAt: Date.now(),
        };

        runningServers.set(serverId, state);

        const addLine = (line) => {
            state.consoleBuffer.push(line);
            // Keep buffer size manageable
            if (state.consoleBuffer.length > 1000) {
                state.consoleBuffer = state.consoleBuffer.slice(-500);
            }
            // Notify WebSocket listeners
            for (const listener of state.listeners) {
                try { listener(line); } catch (e) { /* ignore */ }
            }
        };

        proc.stdout.on('data', (data) => {
            const lines = data.toString().split('\n').filter(l => l.trim());
            for (const line of lines) {
                addLine(line);
                // Detect when server is ready
                if (line.includes('Done (') && line.includes('For help,')) {
                    state.status = 'running';
                    logger.info('SERVER', `Server ${serverConfig.name} is now running`);
                }
            }
        });

        proc.stderr.on('data', (data) => {
            const lines = data.toString().split('\n').filter(l => l.trim());
            for (const line of lines) {
                addLine(`[STDERR] ${line}`);
            }
        });

        proc.on('close', (code) => {
            const wasRunning = state.status === 'running' || state.status === 'starting';
            if (state.status === 'stopping') {
                state.status = 'stopped';
                logger.info('SERVER', `Server ${serverConfig.name} stopped gracefully`);
            } else if (code !== 0 && wasRunning) {
                state.status = 'crashed';
                logger.warn('SERVER', `Server ${serverConfig.name} crashed with code ${code}`);
                addLine(`[Loot Panel] Server crashed with exit code ${code}`);

                // Send crash alert
                const alertService = require('./alertService');
                alertService.notifyCrash(serverConfig.name, serverId).catch(() => { });

                // Auto-restart if enabled
                if (serverConfig.auto_restart) {
                    addLine('[Loot Panel] Auto-restarting in 10 seconds...');
                    setTimeout(() => {
                        if (getServerState(serverId).status === 'crashed') {
                            startServer(serverId).catch(e => {
                                logger.error('SERVER', `Auto-restart failed for ${serverConfig.name}`, e.message);
                            });
                        }
                    }, 10000);
                }
            } else {
                state.status = 'stopped';
                logger.info('SERVER', `Server ${serverConfig.name} stopped (exit code: ${code})`);
            }
            state.process = null;
        });

        proc.on('error', (err) => {
            state.status = 'crashed';
            state.process = null;
            addLine(`[Loot Panel] Failed to start: ${err.message}`);
            logger.error('SERVER', `Failed to start server ${serverConfig.name}`, err.message);
            reject(err);
        });

        // Give it a moment to check for immediate errors
        setTimeout(() => {
            if (state.status !== 'crashed') {
                resolve({ message: 'Server starting', status: state.status });
            }
        }, 1000);
    });
}

function stopServer(serverId, force = false) {
    return new Promise((resolve, reject) => {
        const state = runningServers.get(serverId);
        if (!state || !state.process) {
            return reject(new Error('Server is not running'));
        }

        state.status = 'stopping';
        logger.info('SERVER', `Stopping server ${serverId}${force ? ' (force)' : ''}`);

        if (force) {
            state.process.kill('SIGKILL');
            state.status = 'stopped';
            return resolve({ message: 'Server force stopped' });
        }

        // Send 'stop' command gracefully
        try {
            state.process.stdin.write('stop\n');
        } catch (e) { /* ignore write errors */ }

        // Force kill after 30 seconds if not stopped
        const timeout = setTimeout(() => {
            if (state.process) {
                logger.warn('SERVER', `Server ${serverId} did not stop gracefully, force killing`);
                state.process.kill('SIGKILL');
            }
        }, 30000);

        const checkStopped = setInterval(() => {
            if (!state.process || state.status === 'stopped') {
                clearInterval(checkStopped);
                clearTimeout(timeout);
                resolve({ message: 'Server stopped' });
            }
        }, 500);
    });
}

async function restartServer(serverId) {
    const state = runningServers.get(serverId);
    if (state && state.process) {
        await stopServer(serverId);
        // Wait a moment before restarting
        await new Promise(r => setTimeout(r, 2000));
    }
    return await startServer(serverId);
}

function sendCommand(serverId, command) {
    const state = runningServers.get(serverId);
    if (!state || !state.process) {
        throw new Error('Server is not running');
    }
    state.process.stdin.write(command + '\n');
    state.consoleBuffer.push(`> ${command}`);
}

// Windows fallback: pidusage often returns 0 or fails (wmic deprecated). Use PowerShell.
function getProcessStatsWindows(pid) {
    let memory = 0;
    let cpuSeconds = 0;
    try {
        const memOut = execSync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-Process -Id ${pid} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty WorkingSet64"`, {
            encoding: 'utf8',
            timeout: 3000,
            windowsHide: true,
        });
        const mem = parseInt(String(memOut).trim(), 10);
        if (!isNaN(mem)) memory = Math.round(mem / 1024 / 1024);
    } catch (_) { /* ignore */ }
    try {
        const cpuOut = execSync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).TotalProcessorTime.TotalSeconds"`, {
            encoding: 'utf8',
            timeout: 3000,
            windowsHide: true,
        });
        const cpu = parseFloat(String(cpuOut).trim());
        if (!isNaN(cpu)) cpuSeconds = cpu;
    } catch (_) { /* ignore */ }
    return { memory, cpuSeconds };
}

// Cache for CPU % calculation on Windows (need two samples)
const cpuCache = new Map();

async function getResourceUsage(serverId) {
    const state = runningServers.get(serverId);
    if (!state || !state.process) {
        cpuCache.delete(serverId);
        return { cpu: 0, memory: 0, uptime: 0 };
    }
    const pid = state.process.pid;
    const uptime = Math.round((Date.now() - (state.startedAt || Date.now())) / 1000);
    let memoryMb = 0;
    let cpu = 0;

    if (os.platform() === 'win32') {
        // pidusage is unreliable on Windows (CPU "Not Accurate", wmic deprecated)
        const win = getProcessStatsWindows(pid);
        memoryMb = win.memory;
        // CPU %: sample twice to compute rate
        const now = Date.now();
        const prev = cpuCache.get(serverId);
        cpuCache.set(serverId, { cpuSec: win.cpuSeconds, ts: now });
        if (prev && (now - prev.ts) > 500) {
            const deltaSec = (now - prev.ts) / 1000;
            const deltaCpu = win.cpuSeconds - prev.cpuSec;
            if (deltaSec > 0 && deltaCpu >= 0) {
                cpu = Math.round((deltaCpu / deltaSec) * 100 * 100) / 100; // % across all cores
            }
        }
    } else {
        try {
            const stats = await pidusage(pid);
            memoryMb = stats && typeof stats.memory === 'number'
                ? Math.round(stats.memory / 1024 / 1024)
                : 0;
            cpu = stats && typeof stats.cpu === 'number'
                ? Math.round(stats.cpu * 100) / 100
                : 0;
        } catch (err) {
            logger.debug('SERVER', 'pidusage failed for server ' + serverId, err.message);
        }
    }

    // If still 0 on Windows, try pidusage as fallback (sometimes works)
    if (os.platform() === 'win32' && memoryMb === 0) {
        try {
            const stats = await pidusage(pid);
            if (stats && typeof stats.memory === 'number') {
                memoryMb = Math.round(stats.memory / 1024 / 1024);
            }
            if (stats && typeof stats.cpu === 'number' && cpu === 0) {
                cpu = Math.round(stats.cpu * 100) / 100;
            }
        } catch (_) { /* ignore */ }
    }

    return { cpu, memory: memoryMb, uptime };
}

function addConsoleListener(serverId, listener) {
    let state = runningServers.get(serverId);
    if (!state) {
        state = { status: 'stopped', consoleBuffer: [], listeners: new Set() };
        runningServers.set(serverId, state);
    }
    state.listeners.add(listener);
    return () => state.listeners.delete(listener);
}

function getConsoleBuffer(serverId) {
    const state = runningServers.get(serverId);
    return state ? state.consoleBuffer : [];
}

// Auto-start servers on panel startup
async function autoStartServers() {
    const servers = getDb().prepare('SELECT * FROM servers WHERE auto_start = 1').all();
    for (const server of servers) {
        try {
            logger.info('SERVER', `Auto-starting server: ${server.name}`);
            await startServer(server.id);
        } catch (err) {
            logger.error('SERVER', `Failed to auto-start ${server.name}`, err.message);
        }
    }
}

// Graceful shutdown all servers
async function shutdownAll() {
    const promises = [];
    for (const [serverId, state] of runningServers) {
        if (state.process) {
            promises.push(stopServer(serverId).catch(() => { }));
        }
    }
    await Promise.all(promises);
}

module.exports = {
    getServerState,
    getAllServerStates,
    startServer,
    stopServer,
    restartServer,
    sendCommand,
    getResourceUsage,
    addConsoleListener,
    getConsoleBuffer,
    autoStartServers,
    shutdownAll,
};
