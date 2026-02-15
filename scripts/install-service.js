/**
 * Install or uninstall the Loot Panel Windows service using node-windows.
 * Reports SERVICE_RUNNING to the SCM so Windows does not hit Error 1053.
 * Run elevated (as Administrator) for install/uninstall.
 *
 * Usage:
 *   node install-service.js <baseDir> [resultFilePath]     — install
 *   node install-service.js --uninstall <baseDir> [resultFilePath] — uninstall
 */
const path = require('path');
const fs = require('fs');

const args = process.argv.slice(2);
const isUninstall = args[0] === '--uninstall';
const baseDir = path.resolve(args[isUninstall ? 1 : 0] || path.join(__dirname, '..'));
const resultFile = args[isUninstall ? 2 : 1];

function writeResult(success, message) {
    if (resultFile) {
        try {
            fs.writeFileSync(resultFile, success ? 'SUCCESS' : `FAILED: ${message}`, 'utf8');
        } catch (e) {
            console.error('Could not write result file:', e.message);
        }
    }
    process.exit(success ? 0 : 1);
}

try {
    const Service = require('node-windows').Service;

    const svc = new Service({
        name: 'LootPanel',
        description: 'Loot Panel Minecraft Server Manager',
        script: path.join(baseDir, 'server.js'),
        workingDirectory: baseDir,
        allowServiceLogon: false,
    });

    if (isUninstall) {
        svc.on('uninstall', () => {
            console.log('Service uninstalled.');
            writeResult(true);
        });
        svc.on('error', (err) => {
            console.error('Uninstall error:', err);
            writeResult(false, err.message || 'Uninstall failed.');
        });
        svc.uninstall();
    } else {
        svc.on('install', () => {
            console.log('Service installed. Starting...');
            svc.start();
        });
        svc.on('start', () => {
            console.log('Service started.');
            writeResult(true);
        });
        svc.on('error', (err) => {
            console.error('Install/start error:', err);
            writeResult(false, err.message || 'Install failed.');
        });
        svc.on('alreadyinstalled', () => {
            console.log('Service already installed. Starting...');
            svc.start();
        });
        svc.install();
    }
} catch (err) {
    console.error(err);
    writeResult(false, err.message || 'Script failed.');
}
