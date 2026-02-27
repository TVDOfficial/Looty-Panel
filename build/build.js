#!/usr/bin/env node
/**
 * Build Script for LootyPanel Portable Package
 * 
 * Usage:
 *   node build.js [target]
 * 
 * Targets:
 *   portable  - Create portable folder in dist/
 *   installer - Create NSIS installer (requires NSIS on Windows)
 *   all       - Do both
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const BUILD = __dirname;
const DIST = path.join(ROOT, 'dist');

const NODE_VERSION = 'v20.11.0';
const NODE_URL = `https://nodejs.org/dist/${NODE_VERSION}/win-x64/node.exe`;

// Files to exclude from app copy
const EXCLUDE = [
  '.git',
  '.gitignore',
  'node_modules',
  'dist',
  'build',
  'data',
  'logs',
  '*.log',
  'test',
  'tests',
  '.env.local',
  '.cursorrules'
];

function log(msg, type = 'info') {
  const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    cyan: '\x1b[36m'
  };
  const color = type === 'error' ? colors.red : type === 'success' ? colors.green : type === 'warn' ? colors.yellow : colors.cyan;
  console.log(`${color}[BUILD]${colors.reset} ${msg}`);
}

function cleanDist() {
  log('Cleaning dist folder...');
  if (fs.existsSync(DIST)) {
    fs.rmSync(DIST, { recursive: true });
  }
  fs.mkdirSync(DIST, { recursive: true });
}

function copyAppFiles(dest) {
  log('Copying application files...');
  
  const appDir = path.join(dest, 'app');
  fs.mkdirSync(appDir, { recursive: true });
  
  function shouldExclude(file) {
    const basename = path.basename(file);
    return EXCLUDE.some(pattern => {
      if (pattern.includes('*')) {
        const regex = new RegExp(pattern.replace('*', '.*'));
        return regex.test(basename);
      }
      return basename === pattern;
    });
  }
  
  function copyRecursive(src, dest) {
    const entries = fs.readdirSync(src, { withFileTypes: true });
    
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      
      if (shouldExclude(srcPath)) {
        log(`  Skipping: ${entry.name}`, 'warn');
        continue;
      }
      
      if (entry.isDirectory()) {
        fs.mkdirSync(destPath, { recursive: true });
        copyRecursive(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }
  
  copyRecursive(ROOT, appDir);
  log('Application files copied', 'success');
}

async function downloadNode(dest) {
  log('Downloading Node.js runtime...');
  
  const nodeDir = path.join(dest, 'node');
  fs.mkdirSync(nodeDir, { recursive: true });
  
  const nodeExe = path.join(nodeDir, 'node.exe');
  
  // Check if node.exe already exists in build cache
  const cachedNode = path.join(BUILD, 'cache', 'node.exe');
  if (fs.existsSync(cachedNode)) {
    log('Using cached Node.js');
    fs.copyFileSync(cachedNode, nodeExe);
    return;
  }
  
  // Download
  const https = require('https');
  const file = fs.createWriteStream(nodeExe);
  
  await new Promise((resolve, reject) => {
    https.get(NODE_URL, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        https.get(response.headers.location, (res) => {
          res.pipe(file);
          file.on('finish', () => {
            file.close();
            resolve();
          });
        }).on('error', reject);
      } else {
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve();
        });
      }
    }).on('error', reject);
  });
  
  log('Node.js downloaded', 'success');
}

function createLauncher(dest) {
  log('Creating launcher...');
  
  // For now, copy the launcher.js and create a batch wrapper
  // In production, you'd compile launcher.js to exe using pkg
  
  const launcherJs = path.join(BUILD, 'launcher.js');
  const launcherDest = path.join(dest, 'launcher.js');
  
  fs.copyFileSync(launcherJs, launcherDest);
  
  // Create batch file wrapper
  const batchContent = `@echo off
chcp 65001 >nul
title LootyPanel
cd /d "%~dp0"
echo Starting LootyPanel...
node launcher.js
pause`;
  
  fs.writeFileSync(path.join(dest, 'LootyPanel.bat'), batchContent);
  
  log('Launcher created', 'success');
}

function createDataDir(dest) {
  log('Creating data directory...');
  fs.mkdirSync(path.join(dest, 'data'), { recursive: true });
}

function copyDaemonFiles(dest) {
  log('Copying daemon files...');
  const daemonSrc = path.join(ROOT, 'daemon');
  const daemonDest = path.join(dest, 'daemon');
  
  if (fs.existsSync(daemonSrc)) {
    fs.mkdirSync(daemonDest, { recursive: true });
    const files = fs.readdirSync(daemonSrc);
    for (const file of files) {
      fs.copyFileSync(path.join(daemonSrc, file), path.join(daemonDest, file));
    }
  }
}

function createReadme(dest) {
  log('Creating README...');
  
  const content = `# LootyPanel

Minecraft Server Management Made Easy

## Quick Start

1. Double-click **LootyPanel.bat** to start
2. Your browser will open automatically
3. Create your admin account on first run

## Windows Service (Optional)

To run LootyPanel as a Windows Service (starts on boot):

1. Open Command Prompt as Administrator
2. Run: 
   cd "${dest.replace(/\\/g, '\\\\')}"
   node app/services/daemonInstaller.js install

## Files

- **app/** - Application code
- **node/** - Node.js runtime
- **data/** - Your servers, backups, and database
- **daemon/** - Windows service files

## Support

Visit: https://github.com/TVDOfficial/Looty-Panel
`;
  
  fs.writeFileSync(path.join(dest, 'README.txt'), content);
}

async function buildPortable() {
  log('Building portable package...', 'bright');
  
  const dest = path.join(DIST, 'LootyPanel-Portable');
  
  cleanDist();
  copyAppFiles(dest);
  await downloadNode(dest);
  createLauncher(dest);
  createDataDir(dest);
  copyDaemonFiles(dest);
  createReadme(dest);
  
  log('Portable package created!', 'success');
  log(`Location: ${dest}`);
  
  return dest;
}

function buildInstaller() {
  log('Building installer...', 'bright');
  
  // Check for NSIS
  try {
    execSync('makensis -VERSION', { stdio: 'pipe' });
  } catch (e) {
    log('NSIS not found. Please install NSIS:', 'error');
    log('  Windows: https://nsis.sourceforge.io/Download');
    log('  Linux: sudo apt-get install nsis');
    log('  macOS: brew install nsis');
    process.exit(1);
  }
  
  // Build portable first
  const portableDir = path.join(DIST, 'LootyPanel-Portable');
  if (!fs.existsSync(portableDir)) {
    log('Portable package not found. Run build portable first.', 'error');
    process.exit(1);
  }
  
  // Copy portable to NSIS source
  const nsisSource = path.join(BUILD, 'nsis', 'source');
  if (fs.existsSync(nsisSource)) {
    fs.rmSync(nsisSource, { recursive: true });
  }
  fs.mkdirSync(nsisSource, { recursive: true });
  
  // Copy files
  function copyDir(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        copyDir(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }
  
  copyDir(portableDir, nsisSource);
  
  // Build installer
  const nsiPath = path.join(BUILD, 'nsis', 'installer.nsi');
  log('Compiling installer with NSIS...');
  
  try {
    execSync(`makensis "${nsiPath}"`, { stdio: 'inherit' });
    
    const installerPath = path.join(BUILD, 'nsis', 'LootyPanel-Setup.exe');
    const finalPath = path.join(DIST, 'LootyPanel-Setup.exe');
    
    if (fs.existsSync(installerPath)) {
      fs.renameSync(installerPath, finalPath);
      log('Installer created!', 'success');
      log(`Location: ${finalPath}`);
    }
  } catch (e) {
    log('Installer build failed', 'error');
    process.exit(1);
  }
}

// Main
async function main() {
  const target = process.argv[2] || 'portable';
  
  switch (target) {
    case 'portable':
      await buildPortable();
      break;
    case 'installer':
      buildInstaller();
      break;
    case 'all':
      await buildPortable();
      buildInstaller();
      break;
    default:
      console.log(`
Usage: node build.js [target]

Targets:
  portable  - Create portable folder in dist/
  installer - Create NSIS installer (requires NSIS)
  all       - Do both
`);
      process.exit(1);
  }
}

main().catch(e => {
  log(`Build failed: ${e.message}`, 'error');
  process.exit(1);
});
