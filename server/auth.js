'use strict';

const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const express = require('express');
const { query, dbAvailable } = require('./db');
const { sendMail } = require('./mailer');

const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  const { username, password, email } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username und Passwort erforderlich.' });
  if (!/^[a-zA-Z0-9_-]{3,32}$/.test(username)) {
    return res.status(400).json({ error: 'Username 3-32 Zeichen, nur a-z A-Z 0-9 _ -' });
  }
  if (password.length < 6) return res.status(400).json({ error: 'Passwort min. 6 Zeichen.' });
  const cleanEmail = email ? String(email).trim().toLowerCase() : null;
  if (cleanEmail && !EMAIL_RX.test(cleanEmail)) {
    return res.status(400).json({ error: 'E-Mail ungültig.' });
  }
  try {
    const existing = await query('SELECT id FROM users WHERE username = ?', [username]);
    if (existing.length) return res.status(409).json({ error: 'Username bereits vergeben.' });
    if (cleanEmail) {
      const eExists = await query('SELECT id FROM users WHERE email = ?', [cleanEmail]);
      if (eExists.length) return res.status(409).json({ error: 'E-Mail bereits registriert.' });
    }
    const hash = await bcrypt.hash(password, 10);
    const result = await query(
      'INSERT INTO users (username, password_hash, email) VALUES (?, ?, ?)',
      [username, hash, cleanEmail]
    );
    const user = await findUserById(result.insertId);
    const token = sign(user);
    res.json({ token, user });
  } catch (err) {
    console.error('register failed', err);
    res.status(500).json({ error: 'Registrierung fehlgeschlagen.' });
  }
});

// POST /api/auth/forgot { email } - generate token and email it.
// Always returns 200 to avoid email enumeration; only really sends mail if the
// address belongs to an account.
router.post('/forgot', async (req, res) => {
  if (!dbAvailable()) return res.status(503).json({ error: 'Account-System nicht konfiguriert.' });
  const email = String((req.body && req.body.email) || '').trim().toLowerCase();
  if (!email || !EMAIL_RX.test(email)) return res.status(400).json({ error: 'E-Mail erforderlich.' });
  try {
    const rows = await query('SELECT id, username FROM users WHERE email = ?', [email]);
    if (rows.length) {
      const user = rows[0];
      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1h
      await query(
        'INSERT INTO password_resets (user_id, token, expires_at) VALUES (?, ?, ?)',
        [user.id, token, expiresAt]
      );
      const origin = process.env.PUBLIC_ORIGIN
        ? process.env.PUBLIC_ORIGIN.split(',')[0].trim()
        : null;
      const link = (origin || '') + '/reset.html?token=' + token;
      const text =
        'Hallo ' + user.username + '!\n\n' +
        'Klicke auf diesen Link, um dein Chess²-Passwort zurückzusetzen:\n\n' +
        link + '\n\n' +
        'Der Link ist 1 Stunde gültig. Falls du das nicht angefordert hast, ignoriere diese Mail.';
      const html =
        '<p>Hallo ' + user.username + '!</p>' +
        '<p>Klicke auf diesen Link, um dein Chess²-Passwort zurückzusetzen:</p>' +
        '<p><a href="' + link + '">' + link + '</a></p>' +
        '<p>Der Link ist 1 Stunde gültig. Falls du das nicht angefordert hast, ignoriere diese Mail.</p>';
      sendMail({ to: email, subject: 'Chess² - Passwort zurücksetzen', text, html })
        .catch((err) => console.error('reset mail failed', err));
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('forgot failed', err);
    res.status(500).json({ error: 'Fehler beim Versenden.' });
  }
});

// POST /api/auth/reset { token, password } - consume the token and set a new password.
router.post('/reset', async (req, res) => {
  if (!dbAvailable()) return res.status(503).json({ error: 'Account-System nicht konfiguriert.' });
  const token = (req.body && req.body.token) || '';
  const password = (req.body && req.body.password) || '';
  if (!token || !password) return res.status(400).json({ error: 'Token und Passwort erforderlich.' });
  if (password.length < 6) return res.status(400).json({ error: 'Passwort min. 6 Zeichen.' });
  try {
    const rows = await query(
      'SELECT id, user_id, expires_at, used_at FROM password_resets WHERE token = ?',
      [token]
    );
    if (!rows.length) return res.status(404).json({ error: 'Token ungültig.' });
    const row = rows[0];
    if (row.used_at) return res.status(400).json({ error: 'Token bereits verwendet.' });
    if (new Date(row.expires_at) < new Date()) return res.status(400).json({ error: 'Token abgelaufen.' });
    const hash = await bcrypt.hash(password, 10);
    await query('UPDATE users SET password_hash = ? WHERE id = ?', [hash, row.user_id]);
    await query('UPDATE password_resets SET used_at = NOW() WHERE id = ?', [row.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('reset failed', err);
    res.status(500).json({ error: 'Reset fehlgeschlagen.' });
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
