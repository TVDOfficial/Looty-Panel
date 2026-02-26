const { initDatabase, getDb } = require('./database');

async function run() {
    try {
        await initDatabase();
        const db = getDb();

        console.log('Updating server ID 1 to use servers/server1...');
        const result = db.prepare('UPDATE servers SET server_dir = ? WHERE id = ?').run('servers/server1', 1);

        console.log('Update result:', result);

        const updated = db.prepare('SELECT * FROM servers WHERE id = 1').get();
        console.log('Updated server record:', updated);

        // Also check if there are ANY other servers with auto_start = 1 that might be causing issues
        const others = db.prepare('SELECT id, name, server_dir FROM servers WHERE id != 1 AND auto_start = 1').all();
        if (others.length > 0) {
            console.log('Found other auto-start servers:', others);
        } else {
            console.log('No other auto-start servers found.');
        }

    } catch (err) {
        console.error('Update failed:', err);
    }
}

run();
