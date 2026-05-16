'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const express = require('express');
const http = require('http');
const cookie = require('cookie');
const QRCode = require('qrcode');
const { Server } = require('socket.io');

const { router: authRouter, attachUser } = require('./auth');
const { router: gamesRouter } = require('./games');
const { router: botSessionsRouter } = require('./bot-sessions');
const { dbAvailable, runMigrations } = require('./db');
const { registerHandlers, saveAllBotSessions } = require('./socket');

const app = express();
app.use(express.json({ limit: '64kb' }));
app.use((req, _res, next) => {
  req.cookies = cookie.parse(req.headers.cookie || '');
  next();
});
app.use(attachUser);
app.use('/api/auth', authRouter);
app.use('/api/games', gamesRouter);
app.use('/api/bot-sessions', botSessionsRouter);

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, db: dbAvailable(), time: new Date().toISOString() });
});

// Discover installed piece sets: subdirectories of public/pieces/ that contain
// all 12 SVG files (w/b pieces for the 6 standard types). Lets users add a
// new set by dropping a folder in - no code change required.
app.get('/api/piece-sets', (_req, res) => {
  const fs = require('fs');
  const dir = path.join(__dirname, '..', 'public', 'pieces');
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { /* dir missing - empty */ }
  const out = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const setDir = path.join(dir, e.name);
    const required = ['p','n','b','r','q','k'].flatMap((t) => [`w${t}.svg`, `b${t}.svg`]);
    const ok = required.every((f) => {
      try { return fs.statSync(path.join(setDir, f)).isFile(); } catch { return false; }
    });
    if (ok) out.push({ id: e.name, name: e.name.charAt(0).toUpperCase() + e.name.slice(1) });
  }
  res.json({ sets: out });
});

app.get('/api/qr', async (req, res) => {
  const text = String(req.query.text || '').slice(0, 1024);
  if (!text) return res.status(400).json({ error: 'text required' });
  try {
    const svg = await QRCode.toString(text, {
      type: 'svg',
      errorCorrectionLevel: 'M',
      margin: 1,
      color: { dark: '#0d1117', light: '#ffffff' },
    });
    res.type('image/svg+xml');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.send(svg);
  } catch (err) {
    res.status(500).json({ error: 'qr generation failed' });
  }
});

const publicDir = path.join(__dirname, '..', 'public');
app.use(express.static(publicDir, { extensions: ['html'] }));

// Expose the shared chess engine to the browser without bundling.
app.get('/lib/chess-engine.js', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'shared', 'chess-engine.js'));
});

const server = http.createServer(app);
const origin = process.env.PUBLIC_ORIGIN
  ? process.env.PUBLIC_ORIGIN.split(',').map((s) => s.trim())
  : true; // allow same-origin / any
const io = new Server(server, {
  cors: { origin, credentials: true },
  pingTimeout: 30000,
});

io.on('connection', (socket) => registerHandlers(io, socket));

async function start() {
  if (dbAvailable()) {
    try {
      await runMigrations();
      console.log('Schema migration ok.');
    } catch (err) {
      console.error('Schema migration FAILED - starting anyway, DB features will be broken:', err.message);
    }
  } else {
    console.log('DB not configured - skipping migration (anonymous-only mode).');
  }
  const PORT = Number(process.env.PORT) || 3000;
  server.listen(PORT, () => {
    console.log(`Chess2 listening on port ${PORT} (DB: ${dbAvailable() ? 'on' : 'off'})`);
  });
}

// Best-effort: snapshot in-flight bot games to bot_sessions before the
// process exits on Plesk restart / SIGTERM, so logged-in users don't lose
// progress to a graceful shutdown.
let shuttingDown = false;
async function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(signal + ' received - snapshotting bot games...');
  try { await saveAllBotSessions(); } catch (err) { console.error('shutdown save failed:', err); }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));

start();
