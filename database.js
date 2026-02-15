const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const config = require('./config');
const logger = require('./utils/logger');

const DB_PATH = config.DB_PATH;
let db = null;

async function initDatabase() {
  const SQL = await initSqlJs();

  // Ensure data directory exists
  const dbDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

  // Load existing database or create new
  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
    logger.info('DB', 'Database loaded from disk');
  } else {
    db = new SQL.Database();
    logger.info('DB', 'New database created');
  }

  // Create tables
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT DEFAULT 'user',
    must_change_password INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS servers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'paper',
    mc_version TEXT NOT NULL DEFAULT '1.20.4',
    port INTEGER DEFAULT 25565,
    memory_min TEXT DEFAULT '512M',
    memory_max TEXT DEFAULT '2G',
    java_path TEXT DEFAULT 'java',
    jvm_args TEXT DEFAULT '',
    jar_file TEXT DEFAULT 'server.jar',
    server_dir TEXT,
    created_by INTEGER,
    auto_start INTEGER DEFAULT 0,
    auto_restart INTEGER DEFAULT 1,
    status TEXT DEFAULT 'stopped',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (created_by) REFERENCES users(id)
  )`);

  // Migration: add created_by if missing
  try {
    const tableInfo = db.exec("PRAGMA table_info(servers)");
    const columns = tableInfo[0].values.map(v => v[1]);
    if (!columns.includes('created_by')) {
      db.run("ALTER TABLE servers ADD COLUMN created_by INTEGER");
      logger.info('DB', 'Added created_by column to servers');
    }
  } catch (err) {
    logger.error('DB', 'Servers created_by migration failed', err.message);
  }

  // Migration: add server_dir if old schema had directory
  try {
    const tableInfo = db.exec("PRAGMA table_info(servers)");
    const columns = tableInfo[0].values.map(v => v[1]);
    if (columns.includes('directory') && !columns.includes('server_dir')) {
      db.run("ALTER TABLE servers ADD COLUMN server_dir TEXT");
      db.run("UPDATE servers SET server_dir = directory WHERE directory IS NOT NULL");
      logger.info('DB', 'Migrated servers.directory to server_dir');
    }
  } catch (err) {
    logger.error('DB', 'Servers migration failed', err.message);
  }

  db.run(`CREATE TABLE IF NOT EXISTS backups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    server_id INTEGER NOT NULL,
    filename TEXT NOT NULL,
    size INTEGER DEFAULT 0,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    server_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    cron_expression TEXT NOT NULL,
    payload TEXT DEFAULT '{}',
    enabled INTEGER DEFAULT 1,
    last_run TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    username TEXT,
    action TEXT NOT NULL,
    details TEXT,
    ip_address TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  )`);

  // Migration: Add ip_address to audit_log if missing
  try {
    const tableInfo = db.exec("PRAGMA table_info(audit_log)");
    const columns = tableInfo[0].values.map(v => v[1]);
    if (!columns.includes('ip_address')) {
      db.run("ALTER TABLE audit_log ADD COLUMN ip_address TEXT");
      logger.info('DB', 'Added missing ip_address column to audit_log table');
    }
  } catch (err) {
    logger.error('DB', 'Migration failed', err.message);
  }

  // Default admin seeding removed for First Run Setup flow

  saveDatabase();
  logger.info('DB', 'Database initialized');
  return db;
}

function saveDatabase() {
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

// Auto-save every 30 seconds
setInterval(() => saveDatabase(), 30000);

// Helper to check if val is a plain object for named params
function isPlainObject(val) {
  if (!val || typeof val !== 'object') return false;
  const proto = Object.getPrototypeOf(val);
  return proto === null || proto === Object.prototype;
}

// Helper to wrap sql.js in a better-sqlite3-like API
function getDb() {
  return {
    prepare(sql) {
      return {
        run(...params) {
          const stmt = db.prepare(sql);
          try {
            // Unwrapping logic for named params ({a:1}) vs positional params (1, 2)
            let bindIdx = params;
            if (params.length === 1 && isPlainObject(params[0])) {
              bindIdx = params[0];
            }
            stmt.run(bindIdx);
            saveDatabase();
            return { changes: db.getRowsModified(), lastInsertRowid: getLastInsertRowid() };
          } finally {
            stmt.free();
          }
        },
        get(...params) {
          const stmt = db.prepare(sql);
          try {
            let bindIdx = params;
            if (params.length === 1 && isPlainObject(params[0])) {
              bindIdx = params[0];
            }
            stmt.bind(bindIdx);
            if (stmt.step()) {
              return stmt.getAsObject();
            }
            return undefined;
          } finally {
            stmt.free();
          }
        },
        all(...params) {
          const stmt = db.prepare(sql);
          try {
            let bindIdx = params;
            if (params.length === 1 && isPlainObject(params[0])) {
              bindIdx = params[0];
            }
            stmt.bind(bindIdx);
            const rows = [];
            while (stmt.step()) {
              rows.push(stmt.getAsObject());
            }
            return rows;
          } finally {
            stmt.free();
          }
        },
      };
    },
    exec(sql) {
      db.exec(sql);
      saveDatabase();
    },
  };
}

function getLastInsertRowid() {
  const result = db.exec("SELECT last_insert_rowid() as id");
  if (result.length > 0 && result[0].values.length > 0) {
    return result[0].values[0][0];
  }
  return 0;
}

module.exports = { initDatabase, getDb, saveDatabase };
