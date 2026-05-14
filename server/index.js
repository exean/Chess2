'use strict';

require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const cookie = require('cookie');
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
