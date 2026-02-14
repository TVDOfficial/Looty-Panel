const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const logger = require('../utils/logger');

// Simple Windows service management using sc.exe and NSSM
// Since node-windows is removed, we use a simple approach
class DaemonInstaller {
    constructor() {
        this.serviceName = 'LootPanel';
    }

    getStatus() {
        try {
            const output = execSync(`sc query "${this.serviceName}" 2>&1`, { encoding: 'utf-8' });
            const installed = !output.includes('1060');
            const running = output.includes('RUNNING');
            return { installed, running };
        } catch {
            return { installed: false, running: false };
        }
    }

    install() {
        const nodePath = process.execPath;
        const serverJs = path.join(__dirname, '..', 'server.js');
        // Create a simple batch file that starts the server
        const batPath = path.join(__dirname, '..', 'mcpanel-service.bat');
        fs.writeFileSync(batPath, `@echo off\ncd /d "${path.join(__dirname, '..')}"\n"${nodePath}" "${serverJs}"\n`);

        try {
            // Try using sc to create service (requires admin)
            execSync(`sc create "${this.serviceName}" binPath= "${batPath}" start= auto DisplayName= "Loot Panel Minecraft Server Manager"`, { encoding: 'utf-8' });
            logger.info('DAEMON', 'Service installed successfully');
            return { success: true, message: 'Service installed. Start it from Windows Services or run: sc start LootPanel' };
        } catch (err) {
            logger.warn('DAEMON', 'sc create failed, requires admin privileges');
            return { success: false, message: 'Service installation requires running as Administrator. Please restart Loot Panel as admin and try again.' };
        }
    }

    uninstall() {
        try {
            execSync(`sc stop "${this.serviceName}" 2>&1`, { encoding: 'utf-8' });
        } catch { /* service may not be running */ }
        try {
            execSync(`sc delete "${this.serviceName}"`, { encoding: 'utf-8' });
            logger.info('DAEMON', 'Service uninstalled');
            return { success: true };
        } catch (err) {
            return { success: false, message: 'Failed to uninstall service. Requires admin.' };
        }
    }
}

module.exports = new DaemonInstaller();
