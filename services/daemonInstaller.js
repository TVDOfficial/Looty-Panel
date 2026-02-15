const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync, spawnSync } = require('child_process');
const logger = require('../utils/logger');

// Simple Windows service management using sc.exe
// Uses PowerShell Start-Process -Verb RunAs to trigger UAC when installing
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
        const baseDir = path.join(__dirname, '..');
        const batPath = path.join(baseDir, 'mcpanel-service.bat');

        // Create the batch file (does not require admin)
        fs.writeFileSync(batPath, `@echo off\ncd /d "${baseDir}"\n"${nodePath}" "${serverJs}"\n`);

        // Use PowerShell to run sc create with UAC elevation
        const resultFile = path.join(os.tmpdir(), `lootpanel-daemon-result-${Date.now()}.txt`);
        const scPath = process.env.SystemRoot ? path.join(process.env.SystemRoot, 'System32', 'sc.exe') : 'C:\\Windows\\System32\\sc.exe';
        const psScript = `
$ErrorActionPreference = 'Stop'
try {
    & '${scPath.replace(/'/g, "''")}' create "${this.serviceName}" binPath= "${batPath.replace(/"/g, '`"')}" start= auto DisplayName= "Loot Panel Minecraft Server Manager"
    "SUCCESS" | Out-File -FilePath "${resultFile.replace(/\\/g, '\\\\')}" -Encoding utf8
} catch {
    "FAILED: $($_.Exception.Message)" | Out-File -FilePath "${resultFile.replace(/\\/g, '\\\\')}" -Encoding utf8
}
`;
        const psScriptPath = path.join(os.tmpdir(), `lootpanel-daemon-install-${Date.now()}.ps1`);
        fs.writeFileSync(psScriptPath, psScript);

        try {
            // Start PowerShell elevated - this triggers UAC prompt
            const result = spawnSync('powershell.exe', [
                '-ExecutionPolicy', 'Bypass',
                '-NoProfile',
                '-Command',
                `Start-Process powershell -ArgumentList '-ExecutionPolicy','Bypass','-NoProfile','-File','${psScriptPath.replace(/'/g, "''")}' -Verb RunAs -Wait`
            ], { encoding: 'utf-8', timeout: 60000 });

            // Clean up script
            try { fs.unlinkSync(psScriptPath); } catch (e) { /* ignore */ }

            if (!fs.existsSync(resultFile)) {
                logger.warn('DAEMON', 'Elevated install may have been cancelled by user');
                return { success: false, message: 'Installation was cancelled or UAC was denied. Click "Yes" on the prompt to allow installation.' };
            }

            const resultContent = fs.readFileSync(resultFile, 'utf-8').trim();
            try { fs.unlinkSync(resultFile); } catch (e) { /* ignore */ }

            if (resultContent.startsWith('SUCCESS')) {
                logger.info('DAEMON', 'Service installed successfully');
                return { success: true, message: 'Service installed. Start it from Windows Services or run: sc start LootPanel' };
            }

            const errMsg = resultContent.replace(/^FAILED:\s*/, '');
            logger.warn('DAEMON', 'Service install failed', errMsg);
            return { success: false, message: errMsg || 'Service installation failed.' };
        } catch (err) {
            logger.warn('DAEMON', 'sc create failed', err.message);
            return { success: false, message: err.message || 'Installation failed. A UAC prompt should appear—click Yes to allow.' };
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
