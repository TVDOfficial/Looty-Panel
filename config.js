const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

const BASE_DIR = path.resolve(__dirname);
const DATA_DIR = path.join(BASE_DIR, 'data');
const JWT_SECRET_PATH = path.join(DATA_DIR, '.jwt_secret');

function getOrCreateJwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(JWT_SECRET_PATH)) {
    return fs.readFileSync(JWT_SECRET_PATH, 'utf8').trim();
  }
  const secret = crypto.randomBytes(64).toString('hex');
  fs.writeFileSync(JWT_SECRET_PATH, secret, { mode: 0o600 });
  return secret;
}

module.exports = {
  // Server
  HTTP_PORT: process.env.HTTP_PORT || 80,
  HTTPS_PORT: process.env.HTTPS_PORT || 443,
  HOST: process.env.HOST || '0.0.0.0',

  // Paths
  BASE_DIR,
  SERVERS_DIR: path.join(BASE_DIR, 'servers'),
  BACKUPS_DIR: path.join(BASE_DIR, 'backups'),
  CERTS_DIR: path.join(BASE_DIR, 'certs'),
  DB_PATH: path.join(BASE_DIR, 'data', 'mcpanel.db'),
  LOG_DIR: path.join(BASE_DIR, 'logs'),

  // Auth (persisted so tokens survive server restarts)
  JWT_SECRET: getOrCreateJwtSecret(),
  JWT_EXPIRY: '24h',
  DEFAULT_ADMIN_USER: 'admin',
  DEFAULT_ADMIN_PASS: 'admin',

  // Server defaults
  DEFAULT_MIN_MEMORY: '512M',
  DEFAULT_MAX_MEMORY: '2G',
  DEFAULT_MC_PORT: 25565,

  // Backups
  MAX_BACKUPS_PER_SERVER: 10,
  BACKUP_EXCLUDE: ['logs', 'cache', '*.log'],

  // Logging - max size per log file in MB (configurable via panel settings)
  LOG_MAX_SIZE_MB: 10,

  // Java common paths (Windows)
  JAVA_SEARCH_PATHS: [
    'C:\\Program Files\\Java',
    'C:\\Program Files (x86)\\Java',
    'C:\\Program Files\\Eclipse Adoptium',
    'C:\\Program Files\\AdoptOpenJDK',
    'C:\\Program Files\\Zulu',
    'C:\\Program Files\\Microsoft\\jdk',
    'C:\\Program Files\\BellSoft',
  ],
};
