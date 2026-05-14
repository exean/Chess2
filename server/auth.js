'use strict';

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const express = require('express');
const { query, dbAvailable } = require('./db');

const TOKEN_TTL = '30d';

function sign(user) {
  return jwt.sign(
    { sub: user.id, username: user.username },
    process.env.JWT_SECRET || 'dev-secret-change-me',
    { expiresIn: TOKEN_TTL }
  );
}

function verifyToken(token) {
  try {
    return jwt.verify(token, process.env.JWT_SECRET || 'dev-secret-change-me');
  } catch {
    return null;
  }
}

function tokenFromReq(req) {
  const h = req.headers.authorization;
  if (h && h.startsWith('Bearer ')) return h.slice(7);
  if (req.cookies && req.cookies.token) return req.cookies.token;
  return null;
}

async function findUserById(id) {
  const rows = await query(
    'SELECT id, username, rating, games_played, wins, losses, draws FROM users WHERE id = ?',
    [id]
  );
  return rows[0] || null;
}

async function attachUser(req, _res, next) {
  const token = tokenFromReq(req);
  if (!token || !dbAvailable()) return next();
  const payload = verifyToken(token);
  if (!payload) return next();
  try {
    req.user = await findUserById(payload.sub);
  } catch (e) { /* ignore */ }
  next();
}

const router = express.Router();

router.post('/register', async (req, res) => {
  if (!dbAvailable()) return res.status(503).json({ error: 'Account-System nicht konfiguriert.' });
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username und Passwort erforderlich.' });
  if (!/^[a-zA-Z0-9_-]{3,32}$/.test(username)) {
    return res.status(400).json({ error: 'Username 3-32 Zeichen, nur a-z A-Z 0-9 _ -' });
  }
  if (password.length < 6) return res.status(400).json({ error: 'Passwort min. 6 Zeichen.' });
  try {
    const existing = await query('SELECT id FROM users WHERE username = ?', [username]);
    if (existing.length) return res.status(409).json({ error: 'Username bereits vergeben.' });
    const hash = await bcrypt.hash(password, 10);
    const result = await query(
      'INSERT INTO users (username, password_hash) VALUES (?, ?)',
      [username, hash]
    );
    const user = await findUserById(result.insertId);
    const token = sign(user);
    res.json({ token, user });
  } catch (err) {
    console.error('register failed', err);
    res.status(500).json({ error: 'Registrierung fehlgeschlagen.' });
  }
});

router.post('/login', async (req, res) => {
  if (!dbAvailable()) return res.status(503).json({ error: 'Account-System nicht konfiguriert.' });
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username und Passwort erforderlich.' });
  try {
    const rows = await query(
      'SELECT id, username, password_hash FROM users WHERE username = ?',
      [username]
    );
    if (!rows.length) return res.status(401).json({ error: 'Falsche Zugangsdaten.' });
    const ok = await bcrypt.compare(password, rows[0].password_hash);
    if (!ok) return res.status(401).json({ error: 'Falsche Zugangsdaten.' });
    const user = await findUserById(rows[0].id);
    const token = sign(user);
    res.json({ token, user });
  } catch (err) {
    console.error('login failed', err);
    res.status(500).json({ error: 'Login fehlgeschlagen.' });
  }
});

router.get('/me', async (req, res) => {
  if (!req.user) return res.json({ user: null });
  res.json({ user: req.user });
});

router.get('/leaderboard', async (_req, res) => {
  if (!dbAvailable()) return res.json({ entries: [] });
  try {
    const rows = await query(
      'SELECT username, rating, games_played, wins, losses, draws FROM users ORDER BY rating DESC, games_played DESC LIMIT 50'
    );
    res.json({ entries: rows });
  } catch (err) {
    res.status(500).json({ error: 'Bestenliste nicht verfügbar.' });
  }
});

module.exports = { router, attachUser, verifyToken, sign };
