const { execSync } = require('child_process');
const { initDatabase, getDb, saveDatabase } = require('./database');

async function run() {
    try {
        const myPid = process.pid;
        console.log('My PID:', myPid);

        // Find other node processes
        const output = execSync('tasklist /FI "IMAGENAME eq node.exe" /FO CSV').toString();
        const lines = output.split('\n').filter(l => l.trim().length > 0);

        for (let i = 1; i < lines.length; i++) {
            const parts = lines[i].split(',');
            const pid = parseInt(parts[1].replace(/\"/g, ''));
            if (pid && pid !== myPid) {
                console.log('Killing other node process:', pid);
                try {
                    execSync(`taskkill /F /T /PID ${pid}`);
                } catch (e) {
                    console.error(`Failed to kill ${pid}:`, e.message);
                }
            }
        }

        // Now wait a moment and apply the fix
        console.log('Applying path fix to database...');
        await initDatabase();
        const db = getDb();
        db.prepare('UPDATE servers SET server_dir = ? WHERE id = ?').run('servers/server1', 1);
        console.log('Update applied and saved.');

        const check = db.prepare('SELECT server_dir FROM servers WHERE id=1').get();
        console.log('Verified server_dir:', check.server_dir);

    } catch (err) {
        console.error('Operation failed:', err);
    }
}

run();
