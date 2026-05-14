'use strict';

const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

(async () => {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  const cfg = {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  };
  console.log('Migration target:', {
    host: cfg.host, port: cfg.port, user: cfg.user, database: cfg.database,
    password: cfg.password ? '(set)' : '(missing)',
  });
  if (!cfg.user || !cfg.database) {
    console.error('DB_USER and DB_NAME must be set. Check .env or the Plesk environment variables.');
    process.exit(2);
  }
  const conn = await mysql.createConnection(Object.assign({ multipleStatements: true }, cfg));
  try {
    await conn.query(sql);
    console.log('Migration applied.');
  } finally {
    await conn.end();
  }
})().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
