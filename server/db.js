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
// uses CREATE TABLE IF NOT EXISTS.
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
    return { ok: true };
  } finally {
    await conn.end();
  }
}

module.exports = { getPool, query, dbAvailable, runMigrations };
