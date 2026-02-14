const path = require('path');
const crypto = require('crypto');

const BASE_DIR = path.resolve(__dirname);

module.exports = {
  // Server
  HTTP_PORT: process.env.HTTP_PORT || 3000,
  HTTPS_PORT: process.env.HTTPS_PORT || 3443,
  HOST: process.env.HOST || 'localhost',

  // Paths
  BASE_DIR,
  SERVERS_DIR: path.join(BASE_DIR, 'servers'),
  BACKUPS_DIR: path.join(BASE_DIR, 'backups'),
  CERTS_DIR: path.join(BASE_DIR, 'certs'),
  DB_PATH: path.join(BASE_DIR, 'data', 'mcpanel.db'),
  LOG_DIR: path.join(BASE_DIR, 'logs'),

  // Auth
  JWT_SECRET: process.env.JWT_SECRET || crypto.randomBytes(64).toString('hex'),
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
