#!/usr/bin/env node
/**
 * LootyPanel Launcher
 * 
 * This is the entry point for the portable package.
 * It checks for Node.js, downloads if missing, and starts the server.
 */

const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const APP_DIR = path.join(__dirname, 'app');
const NODE_DIR = path.join(__dirname, 'node');
const DATA_DIR = path.join(__dirname, 'data');
const NODE_EXE = path.join(NODE_DIR, 'node.exe');

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m'
};

function log(msg, type = 'info') {
  const timestamp = new Date().toLocaleTimeString();
  const color = type === 'error' ? colors.red : type === 'success' ? colors.green : type === 'warn' ? colors.yellow : colors.cyan;
  console.log(`${color}[${timestamp}]${colors.reset} ${msg}`);
}

function checkNode() {
  if (fs.existsSync(NODE_EXE)) {
    try {
      const version = execSync(`"${NODE_EXE}" --version`, { encoding: 'utf8' }).trim();
      log(`Node.js found: ${version}`, 'success');
      return true;
    } catch (e) {
      return false;
    }
  }
  return false;
}

async function downloadNode() {
  log('Node.js not found. Downloading...', 'warn');
  
  const nodeUrl = 'https://nodejs.org/dist/v20.11.0/win-x64/node.exe';
  const npmUrl = 'https://nodejs.org/dist/v20.11.0/win-x64/npm.cmd';
  const npxUrl = 'https://nodejs.org/dist/v20.11.0/win-x64/npx.cmd';
  
  if (!fs.existsSync(NODE_DIR)) {
    fs.mkdirSync(NODE_DIR, { recursive: true });
  }

  // Download node.exe
  await downloadFile(nodeUrl, NODE_EXE);
  log('Downloaded node.exe', 'success');

  // We also need npm - but for portable we bundle node_modules
  log('Node.js ready!', 'success');
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const protocol = url.startsWith('https') ? https : http;
    
    protocol.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        // Follow redirect
        downloadFile(response.headers.location, dest).then(resolve).catch(reject);
        return;
      }
      
      if (response.statusCode !== 200) {
        reject(new Error(`Download failed: ${response.statusCode}`));
        return;
      }

      const totalSize = parseInt(response.headers['content-length'], 10);
      let downloaded = 0;
      let lastPercent = 0;

      response.on('data', (chunk) => {
        downloaded += chunk.length;
        const percent = Math.floor((downloaded / totalSize) * 100);
        if (percent !== lastPercent && percent % 10 === 0) {
          process.stdout.write(`\rDownloading... ${percent}%`);
          lastPercent = percent;
        }
      });

      response.pipe(file);
      file.on('finish', () => {
        file.close();
        console.log(''); // New line after progress
        resolve();
      });
    }).on('error', reject);
  });
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    log('Created data directory', 'info');
  }
}

function startServer() {
  log('Starting LootyPanel...', 'info');
  
  const env = {
    ...process.env,
    NODE_ENV: 'production',
    LOOTYPANEL_PORTABLE: 'true',
    LOOTYPANEL_DATA_DIR: DATA_DIR
  };

  const child = spawn(NODE_EXE, ['server.js'], {
    cwd: APP_DIR,
    env,
    stdio: 'inherit'
  });

  child.on('close', (code) => {
    log(`Server exited with code ${code}`, code === 0 ? 'info' : 'error');
    process.exit(code);
  });

  // Open browser after short delay
  setTimeout(() => {
    const port = process.env.PORT || 8080;
    const url = `http://localhost:${port}`;
    log(`Opening ${url}...`, 'info');
    
    try {
      execSync(`start "" "${url}"`);
    } catch (e) {
      log(`Please open ${url} in your browser`, 'warn');
    }
  }, 3000);
}

function showBanner() {
  console.log(`
${colors.bright}${colors.cyan}
  ┌─────────────────────────────────────────┐
  │                                         │
  │      🎮 LootyPanel Launcher v1.0       │
  │                                         │
  │   Minecraft Server Management Made Easy │
  │                                         │
  └─────────────────────────────────────────┘
${colors.reset}
`);
}

// Main
async function main() {
  showBanner();
  
  ensureDataDir();
  
  if (!checkNode()) {
    try {
      await downloadNode();
    } catch (e) {
      log(`Failed to download Node.js: ${e.message}`, 'error');
      log('Please install Node.js manually from https://nodejs.org', 'warn');
      process.exit(1);
    }
  }
  
  startServer();
}

main().catch(e => {
  log(`Fatal error: ${e.message}`, 'error');
  process.exit(1);
});
