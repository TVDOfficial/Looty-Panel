const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync, spawnSync } = require('child_process');
const logger = require('../utils/logger');

// Windows service management using node-windows so the service reports
// SERVICE_RUNNING to the SCM (avoids Error 1053 timeout).
// Uses PowerShell Start-Process -Verb RunAs to trigger UAC when installing/uninstalling.
// node-windows registers the service as "lootpanel.exe" (id from name), not "LootPanel"
const SERVICE_NAME = 'lootpanel.exe';

class DaemonInstaller {
    constructor() {
        this.serviceName = SERVICE_NAME;
    }

    getStatus() {
        try {
            const systemRoot = process.env.SystemRoot || process.env.WINDIR || (process.env.SystemDrive ? path.join(process.env.SystemDrive, 'Windows') : null);
            if (!systemRoot) {
                logger.debug('DAEMON', 'SystemRoot/WINDIR not set, cannot query service');
                return { installed: false, running: false };
            }
            const scPath = path.join(systemRoot, 'System32', 'sc.exe');
            const output = execSync(`"${scPath}" query "${this.serviceName}" 2>&1`, { encoding: 'utf-8' });
            const installed = !output.includes('1060');
            const running = output.includes('RUNNING');
            return { installed, running };
        } catch (err) {
            logger.debug('DAEMON', 'getStatus failed', err.message);
            return { installed: false, running: false };
        }
    }

    _runElevatedScript(args, resultFile) {
        const nodePath = process.execPath;
        const baseDir = path.join(__dirname, '..');
        const scriptPath = path.join(baseDir, 'scripts', 'install-service.js');
        const resultFilePath = resultFile || path.join(os.tmpdir(), `lootpanel-daemon-result-${Date.now()}.txt`);
        const argList = [nodePath, scriptPath, ...args, resultFilePath].map(a => `'${String(a).replace(/'/g, "''")}'`);
        const psScript = `
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath '${baseDir.replace(/'/g, "''")}'
& ${argList.join(' ')}
`;
        const psScriptPath = path.join(os.tmpdir(), `lootpanel-daemon-${Date.now()}.ps1`);
        fs.writeFileSync(psScriptPath, psScript);
        const spawnResult = spawnSync('powershell.exe', [
            '-ExecutionPolicy', 'Bypass',
            '-NoProfile',
            '-Command',
            `Start-Process powershell -ArgumentList '-ExecutionPolicy','Bypass','-NoProfile','-File','${psScriptPath.replace(/'/g, "''")}' -Verb RunAs -Wait`
        ], { encoding: 'utf-8', timeout: 90000 });
        try { fs.unlinkSync(psScriptPath); } catch (e) { /* ignore */ }
        return resultFilePath;
    }

    install() {
        const baseDir = path.join(__dirname, '..');
        const resultFile = path.join(os.tmpdir(), `lootpanel-daemon-result-${Date.now()}.txt`);
        try {
            this._runElevatedScript([baseDir], resultFile);
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
            logger.warn('DAEMON', 'Install failed', err.message);
            return { success: false, message: err.message || 'Installation failed. A UAC prompt should appear—click Yes to allow.' };
        }
    }

    uninstall() {
        const baseDir = path.join(__dirname, '..');
        const resultFile = path.join(os.tmpdir(), `lootpanel-daemon-result-${Date.now()}.txt`);
        try {
            this._runElevatedScript(['--uninstall', baseDir], resultFile);
            if (!fs.existsSync(resultFile)) {
                logger.warn('DAEMON', 'Elevated uninstall may have been cancelled by user');
                return { success: false, message: 'Uninstall was cancelled or UAC was denied.' };
            }
            const resultContent = fs.readFileSync(resultFile, 'utf-8').trim();
            try { fs.unlinkSync(resultFile); } catch (e) { /* ignore */ }
            if (resultContent.startsWith('SUCCESS')) {
                logger.info('DAEMON', 'Service uninstalled');
                return { success: true };
            }
            // Fallback: remove old .bat-based service (created with sc.exe) if node-windows didn't own it
            try {
                execSync(`sc stop "${this.serviceName}" 2>&1`, { encoding: 'utf-8' });
            } catch { /* may not be running */ }
            try {
                execSync(`sc delete "${this.serviceName}" 2>&1`, { encoding: 'utf-8' });
                logger.info('DAEMON', 'Service uninstalled (legacy)');
                return { success: true };
            } catch (e) {
                const errMsg = resultContent.replace(/^FAILED:\s*/, '');
                return { success: false, message: errMsg || 'Uninstall failed.' };
            }
        } catch (err) {
            logger.warn('DAEMON', 'Uninstall failed', err.message);
            return { success: false, message: err.message || 'Uninstall failed. Try running as Administrator.' };
        }
    }
}

module.exports = new DaemonInstaller();
