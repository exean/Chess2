'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const express = require('express');
const http = require('http');
const cookie = require('cookie');
const QRCode = require('qrcode');
const { Server } = require('socket.io');

const { router: authRouter, attachUser } = require('./auth');
const { dbAvailable } = require('./db');
const { registerHandlers } = require('./socket');

const app = express();
app.use(express.json({ limit: '64kb' }));
app.use((req, _res, next) => {
  req.cookies = cookie.parse(req.headers.cookie || '');
  next();
});
app.use(attachUser);
app.use('/api/auth', authRouter);

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, db: dbAvailable(), time: new Date().toISOString() });
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

const PORT = Number(process.env.PORT) || 3000;
server.listen(PORT, () => {
  console.log(`Chess2 listening on port ${PORT} (DB: ${dbAvailable() ? 'on' : 'off'})`);
});
