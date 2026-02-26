const { initDatabase, getDb } = require('./database');
const path = require('path');
const fs = require('fs');
const pathHelper = require('./utils/pathHelper');
const config = require('./config');

async function run() {
    try {
        await initDatabase();
        const servers = getDb().prepare('SELECT id, name, server_dir, jar_file, auto_start FROM servers').all();

        console.log('BASE_DIR:', config.BASE_DIR);
        console.log('Total servers in DB:', servers.length);

        for (const s of servers) {
            const absolute = pathHelper.toAbsolute(s.server_dir);
            const jarPath = path.join(absolute, s.jar_file || 'server.jar');
            console.log('-----------------------------------');
            console.log('ID:', s.id);
            console.log('Name:', s.name);
            console.log('Auto Start:', s.auto_start);
            console.log('Stored Dir:', s.server_dir);
            console.log('Resolved Dir:', absolute);
            console.log('Jar File:', s.jar_file);
            console.log('Jar Path:', jarPath);
            console.log('Jar Exists:', fs.existsSync(jarPath));
        }
    } catch (err) {
        console.error('Diagnostic failed:', err);
    }
}

run();
