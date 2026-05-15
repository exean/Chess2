'use strict';

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

let pool = null;

function getPool() {
  if (pool) return pool;
  if (!process.env.DB_NAME) return null;
  pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    charset: 'utf8mb4',
  });
  return pool;
}

async function query(sql, params) {
  const p = getPool();
  if (!p) throw new Error('Database not configured');
  const [rows] = await p.execute(sql, params || []);
  return rows;
}

function dbAvailable() { return Boolean(process.env.DB_NAME); }

// Idempotent schema migration. Safe to call on every app start - the SQL
// uses CREATE TABLE IF NOT EXISTS, and the ALTER TABLE block below catches
// 'duplicate column' errors so columns added later don't blow up on existing
// installs.
async function runMigrations() {
  if (!dbAvailable()) return { skipped: true, reason: 'DB not configured' };
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    multipleStatements: true,
  });
  try {
    await conn.query(sql);
    // Backfill columns on legacy installs of the games table.
    const addColumns = [
      "ALTER TABLE games ADD COLUMN shape VARCHAR(32) NOT NULL DEFAULT 'standard'",
      "ALTER TABLE games ADD COLUMN shape_opts VARCHAR(255) NULL",
      "ALTER TABLE games ADD COLUMN moves_json MEDIUMTEXT NULL",
      "ALTER TABLE games ADD COLUMN white_deleted_at DATETIME NULL",
      "ALTER TABLE games ADD COLUMN black_deleted_at DATETIME NULL",
      "ALTER TABLE games MODIFY COLUMN final_fen VARCHAR(255) NULL",
    ];
    for (const stmt of addColumns) {
      try { await conn.query(stmt); }
      catch (err) {
        // 1060 = duplicate column name; 1091 = can't drop nonexistent; both ignorable.
        if (err.errno !== 1060 && err.code !== 'ER_DUP_FIELDNAME') {
          // Ignore "MODIFY COLUMN" no-op too.
          if (err.errno !== 1060) {
            // Log but don't abort start.
            console.warn('Migration warning:', stmt, '->', err.message);
          }
        }
      }
    }
    try { await conn.query("CREATE INDEX idx_finished ON games (finished_at)"); }
    catch (err) { /* duplicate index, fine */ }
    return { ok: true };
  } finally {
    await conn.end();
  }
}

module.exports = { getPool, query, dbAvailable, runMigrations };
