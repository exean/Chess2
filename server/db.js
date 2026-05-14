'use strict';

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

module.exports = { getPool, query, dbAvailable };
