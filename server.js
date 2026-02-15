const express = require('express');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const jwt = require('jsonwebtoken');

const config = require('./config');
const { initDatabase } = require('./database');
const logger = require('./utils/logger');
const { generateSelfSignedCert } = require('./utils/certGenerator');
const serverManager = require('./services/serverManager');
const scheduler = require('./services/scheduler');

// ========== Main Bootstrap ==========
async function main() {
    logger.info('APP', '═══════════════════════════════════════');
    logger.info('APP', '  Looty Panel - Minecraft Server Manager');
    logger.info('APP', '═══════════════════════════════════════');

    // Ensure directories exist
    [config.SERVERS_DIR, config.BACKUPS_DIR].forEach(dir => {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    });

    // Init database (async for sql.js)
    await initDatabase();

    // Load panel settings (e.g. log max size)
    try {
        const { getDb } = require('./database');
        const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get('panel_log_max_size_mb');
        if (row && row.value) {
            const val = parseInt(row.value, 10);
            if (val >= 1 && val <= 100) config.LOG_MAX_SIZE_MB = val;
        }
    } catch (e) { /* ignore */ }

    // ========== Express App ==========
    const app = express();
    app.use(express.json({ limit: '50mb' }));
    app.use(express.urlencoded({ extended: true, limit: '50mb' }));

    // Static files
    app.use(express.static(path.join(__dirname, 'public')));

    // API routes
    app.use('/api/auth', require('./routes/auth'));
    app.use('/api/servers', require('./routes/servers'));
    app.use('/api/servers', require('./routes/files'));
    app.use('/api/servers', require('./routes/plugins'));
    app.use('/api/servers', require('./routes/backups'));
    app.use('/api/users', require('./routes/users'));
    app.use('/api/system', require('./routes/system'));

    // SPA fallback
    app.get('*', (req, res) => {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    });

    // Error handler
    app.use((err, req, res, next) => {
        logger.error('APP', 'Unhandled error', err.message);
        res.status(500).json({ error: 'Internal server error' });
    });

    // ========== HTTP Server ==========
    const httpServer = http.createServer(app);

    // ========== HTTPS Server ==========
    let httpsServer;
    try {
        const { certPath, keyPath } = generateSelfSignedCert();
        const httpsOptions = {
            cert: fs.readFileSync(certPath),
            key: fs.readFileSync(keyPath),
        };
        httpsServer = https.createServer(httpsOptions, app);
    } catch (err) {
        logger.warn('APP', 'HTTPS setup failed, running HTTP only', err.message);
    }

    // ========== WebSocket ==========
    const wss = new WebSocketServer({ noServer: true });

    function handleUpgrade(server) {
        server.on('upgrade', (request, socket, head) => {
            const url = new URL(request.url, `http://${request.headers.host}`);
            const token = url.searchParams.get('token');
            const serverId = url.searchParams.get('serverId');

            if (!token || !serverId) {
                socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
                socket.destroy();
                return;
            }

            try {
                jwt.verify(token, config.JWT_SECRET);
                wss.handleUpgrade(request, socket, head, (ws) => {
                    ws.serverId = parseInt(serverId);
                    wss.emit('connection', ws, request);
                });
            } catch {
                socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
                socket.destroy();
            }
        });
    }

    handleUpgrade(httpServer);
    if (httpsServer) handleUpgrade(httpsServer);

    wss.on('connection', (ws) => {
        const serverId = ws.serverId;
        logger.debug('WS', `Client connected to server ${serverId} console`);

        const buffer = serverManager.getConsoleBuffer(serverId);
        if (buffer.length > 0) {
            ws.send(JSON.stringify({ type: 'buffer', lines: buffer }));
        }

        const state = serverManager.getServerState(serverId);
        ws.send(JSON.stringify({ type: 'status', status: state.status }));

        const removeListener = serverManager.addConsoleListener(serverId, (line) => {
            if (ws.readyState === ws.OPEN) {
                ws.send(JSON.stringify({ type: 'console', line }));
            }
        });

        ws.on('message', (data) => {
            try {
                const msg = JSON.parse(data);
                if (msg.type === 'command' && msg.command) {
                    serverManager.sendCommand(serverId, msg.command);
                }
            } catch { /* ignore */ }
        });

        ws.on('close', () => {
            removeListener();
        });
    });

    // Status broadcast
    setInterval(() => {
        wss.clients.forEach(client => {
            if (client.readyState === client.OPEN) {
                const state = serverManager.getServerState(client.serverId);
                client.send(JSON.stringify({ type: 'status', status: state.status }));
            }
        });
    }, 5000);

    // ========== Start ==========
    function onListenError(serverLabel, err) {
        logger.error('APP', `${serverLabel} failed to listen`, err.message);
        if (err.code === 'EACCES') {
            logger.error('APP', 'Port requires administrator. Run as admin or set HTTP_PORT/HTTPS_PORT to 8080/8443 in env.');
        }
        if (err.code === 'EADDRINUSE') {
            logger.error('APP', 'Port already in use. Stop the other app or set HTTP_PORT/HTTPS_PORT to different ports.');
        }
    }
    httpServer.on('error', (err) => onListenError('HTTP', err));
    httpServer.listen(config.HTTP_PORT, config.HOST, () => {
        logger.info('APP', `HTTP server running on http://${config.HOST}:${config.HTTP_PORT}`);
    });

    if (httpsServer) {
        httpsServer.on('error', (err) => onListenError('HTTPS', err));
        httpsServer.listen(config.HTTPS_PORT, config.HOST, () => {
            logger.info('APP', `HTTPS server running on https://${config.HOST}:${config.HTTPS_PORT}`);
        });
    }

    scheduler.loadSchedules();
    setTimeout(() => serverManager.autoStartServers(), 2000);

    // Graceful shutdown
    const shutdown = async () => {
        logger.info('APP', 'Shutting down...');
        const { saveDatabase } = require('./database');
        saveDatabase();
        scheduler.stopAll();
        await serverManager.shutdownAll();
        process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}

main().catch(err => {
    console.error('Failed to start MCPanel:', err);
    process.exit(1);
});
