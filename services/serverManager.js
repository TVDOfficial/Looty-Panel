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

/**
 * Detects Java processes that are already running server jars
 * and syncs them with the panel's tracking system.
 * This fixes the issue where the panel doesn't recognize servers
 * that were started before the panel (e.g., after a service restart).
 */
async function detectRunningServers() {
    logger.info('SERVER', 'Scanning for already-running servers...');

    try {
        const servers = getDb().prepare('SELECT * FROM servers').all();
        let foundCount = 0;

        for (const server of servers) {
            const serverDir = pathHelper.toAbsolute(server.server_dir);
            const jarFile = server.jar_file || 'server.jar';

            // Check if Java is running this specific jar
            const pid = getJavaPidForServer(serverDir, jarFile);

            if (pid) {
                foundCount++;
                logger.info('SERVER', `Found running server: ${server.name} (PID: ${pid})`);

                const existing = runningServers.get(server.id);
                if (!existing || existing.status !== 'running') {
                    // Create state for detected server
                    const state = {
                        process: { pid: pid },  // Store PID for status checks
                        status: 'running',
                        consoleBuffer: [`[Loot Panel] Server detected as running (PID: ${pid})`],
                        listeners: new Set(),
                        startedAt: Date.now(),
                        isDetected: true
                    };

                    runningServers.set(server.id, state);

                    // Start monitoring this PID
                    monitorDetectedProcess(server.id, pid);

                    logger.info('SERVER', `Synced ${server.name} with panel`);
                } else {
                    logger.debug('SERVER', `Server ${server.name} already tracked`);
                }
            }
        }

        if (foundCount > 0) {
            logger.info('SERVER', `Synced ${foundCount} running server(s) with panel`);
        } else {
            logger.info('SERVER', 'No running servers detected');
        }

    } catch (err) {
        logger.error('SERVER', 'Failed to detect running servers', err.message);
    }
}

/**
 * Get the PID of a Java process running a specific server jar
 */
function getJavaPidForServer(serverDir, jarFile) {
    try {
        // Escape backslashes for PowerShell
        const escapedDir = serverDir.replace(/\\/g, '\\\\');

        const cmd = `powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process -Filter \\"Name='java.exe'\\" | Where-Object { \$_.CommandLine -like '*${jarFile}*' -and \$_.CommandLine -like '*${escapedDir}*' } | Select-Object -First 1 -ExpandProperty ProcessId"`;

        const output = execSync(cmd, {
            encoding: 'utf8',
            timeout: 5000,
            windowsHide: true
        }).trim();

        // Parse PID from output
        const match = output.match(/^(\d+)$/);
        if (match) {
            return parseInt(match[1]);
        }

        return null;
    } catch (err) {
        // No matching process found
        return null;
    }
}

/**
 * Monitor a detected process and update panel status when it exits
 */
function monitorDetectedProcess(serverId, pid) {
    const interval = setInterval(() => {
        try {
            // Check if process still exists using tasklist
            execSync(`tasklist /FI "PID eq ${pid}" /FO CSV | findstr "${pid}"`, {
                windowsHide: true,
                encoding: 'utf8'
            });
            // Process still running - do nothing
        } catch (err) {
            // Process has exited
            clearInterval(interval);

            const state = runningServers.get(serverId);
            if (state && state.status === 'running') {
                state.status = 'stopped';
                state.process = null;
                state.consoleBuffer.push(`[Loot Panel] Server stopped (PID ${pid} exited)`);
                logger.info('SERVER', `Server ${serverId} stopped (monitored PID ${pid})`);
            }
        }
    }, 5000); // Check every 5 seconds

    // Store interval reference
    const state = runningServers.get(serverId);
    if (state) {
        state._monitorInterval = interval;
    }
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
                const readyPatterns = ['Done (', 'Listening on', 'Done!', 'Done in '];
                if (state.status === 'starting' && readyPatterns.some(p => line.includes(p))) {
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

        // Handle detected servers (no direct process handle)
        if (state && state.isDetected && state.status === 'running') {
            logger.info('SERVER', `Stopping detected server ${serverId}${force ? ' (force)' : ''}`);

            // Clear monitoring interval
            if (state._monitorInterval) {
                clearInterval(state._monitorInterval);
            }

            if (force) {
                // Kill by PID
                try {
                    execSync(`taskkill /PID ${state.process.pid} /F`, { windowsHide: true });
                } catch (e) {
                    logger.warn('SERVER', `Force kill may have failed: ${e.message}`);
                }
            } else {
                // Try graceful stop via rcon or just kill (detected servers don't have stdin)
                logger.info('SERVER', 'Detected server - using force stop (no stdin access)');
                try {
                    execSync(`taskkill /PID ${state.process.pid} /F`, { windowsHide: true });
                } catch (e) { }
            }

            state.status = 'stopped';
            state.process = null;
            return resolve({ message: 'Server stopped' });
        }

        // Normal stop for panel-started servers
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

    // Can't send commands to detected servers (no stdin access)
    if (state.isDetected) {
        throw new Error('Cannot send commands to detected server (restart server from panel to enable commands)');
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
                const numCpus = os.cpus().length || 1;
                cpu = Math.round((deltaCpu / deltaSec) * 100 / numCpus * 100) / 100; // normalized %
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

// Auto-start servers on panel startup - NOW WITH DETECTION
async function autoStartServers() {
    // First, detect any servers that are already running
    await detectRunningServers();

    // Small delay to ensure detection completes
    await new Promise(r => setTimeout(r, 500));

    const servers = getDb().prepare('SELECT * FROM servers WHERE auto_start = 1').all();
    for (const server of servers) {
        const state = runningServers.get(server.id);

        // Skip if already detected as running
        if (state && state.status === 'running') {
            logger.info('SERVER', `Server ${server.name} already running (detected), skipping auto-start`);
            continue;
        }

        try {
            logger.info('SERVER', `Auto-starting server: ${server.name}`);
            await startServer(server.id);
        } catch (err) {
            // "Already running" is OK - we just detected it
            if (err.message && err.message.toLowerCase().includes('already running')) {
                logger.info('SERVER', `Server ${server.name} already running (confirmed)`);
            } else {
                logger.error('SERVER', `Failed to auto-start ${server.name}`, err.message);
            }
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
    // Export new function
    detectRunningServers,
};
