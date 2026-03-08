#!/usr/bin/env node
/**
 * Service Install Helper
 * Called by the Windows installer to set up the service
 * 
 * Usage:
 *   node install-service.js [install-dir]
 *   node install-service.js --uninstall [install-dir]
 */

const path = require('path');
const fs = require('fs');

const isUninstall = process.argv.includes('--uninstall');
const installDir = process.argv.find((arg, i) => i > 0 && !arg.startsWith('--') && !arg.includes('node')) || process.cwd();

const resultFile = process.argv[process.argv.length - 1];

async function install() {
  try {
    // Change to app directory
    const appDir = path.join(installDir, 'app');
    process.chdir(appDir);
    
    // Set up environment
    process.env.LOOTYPANEL_DATA_DIR = path.join(installDir, 'data');
    
    // Load the daemon installer
    const daemonInstaller = require(path.join(appDir, 'services', 'daemonInstaller.js'));
    
    const result = await daemonInstaller.install();
    
    if (result.success) {
      fs.writeFileSync(resultFile, `SUCCESS: ${result.message}`);
      console.log('Service installed successfully');
    } else {
      fs.writeFileSync(resultFile, `FAILED: ${result.message}`);
      console.error('Service installation failed:', result.message);
      process.exit(1);
    }
  } catch (e) {
    fs.writeFileSync(resultFile, `FAILED: ${e.message}`);
    console.error('Error:', e.message);
    process.exit(1);
  }
}

async function uninstall() {
  try {
    const appDir = path.join(installDir, 'app');
    process.chdir(appDir);
    
    const daemonInstaller = require(path.join(appDir, 'services', 'daemonInstaller.js'));
    
    const result = await daemonInstaller.uninstall();
    
    if (result.success) {
      fs.writeFileSync(resultFile, 'SUCCESS: Service uninstalled');
      console.log('Service uninstalled successfully');
    } else {
      fs.writeFileSync(resultFile, `FAILED: ${result.message}`);
      console.error('Service uninstall failed:', result.message);
      process.exit(1);
    }
  } catch (e) {
    fs.writeFileSync(resultFile, `FAILED: ${e.message}`);
    console.error('Error:', e.message);
    process.exit(1);
  }
}

if (isUninstall) {
  uninstall();
} else {
  install();
}
