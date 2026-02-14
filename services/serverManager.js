const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const pidusage = require('pidusage');
const { getDb } = require('../database');
const logger = require('../utils/logger');
const config = require('../config');

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

        const serverDir = serverConfig.server_dir;
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

async function getResourceUsage(serverId) {
    const state = runningServers.get(serverId);
    if (!state || !state.process) {
        return { cpu: 0, memory: 0, uptime: 0 };
    }
    try {
        const stats = await pidusage(state.process.pid);
        return {
            cpu: Math.round(stats.cpu * 100) / 100,
            memory: Math.round(stats.memory / 1024 / 1024),  // MB
            uptime: Math.round((Date.now() - state.startedAt) / 1000),
        };
    } catch {
        return { cpu: 0, memory: 0, uptime: 0 };
    }
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
