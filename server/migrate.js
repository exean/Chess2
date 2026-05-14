'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { runMigrations } = require('./db');

(async () => {
  console.log('Migration target:', {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || '(missing)',
    database: process.env.DB_NAME || '(missing)',
    password: process.env.DB_PASSWORD ? '(set)' : '(missing)',
  });
  if (!process.env.DB_USER || !process.env.DB_NAME) {
    console.error('DB_USER and DB_NAME must be set. Note: the server now runs the migration automatically on startup using Plesk environment variables - you usually do not need to run this script manually.');
    process.exit(2);
  }
  await runMigrations();
  console.log('Migration applied.');
})().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
