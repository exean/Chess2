'use strict';

const express = require('express');
const { query, dbAvailable } = require('./db');
const { requireAdmin } = require('./auth');

// Keys we expose / accept for the site_settings table. Anything outside this
// list is rejected so the table can't be used as a free-form storage area.
const ALLOWED_KEYS = [
  'impressum.name',
  'impressum.street',
  'impressum.city',
  'impressum.country',
  'impressum.email',
  'impressum.phone',
  'impressum.responsible_name',
  'datenschutz.updated_date',
];

async function loadSettings() {
  const rows = await query('SELECT key_name, value FROM site_settings');
  const out = {};
  for (const r of rows) out[r.key_name] = r.value;
  return out;
}

async function saveSettings(updates) {
  const entries = Object.entries(updates || {}).filter(([k]) => ALLOWED_KEYS.includes(k));
  for (const [key, value] of entries) {
    if (value === null || value === '') {
      await query('DELETE FROM site_settings WHERE key_name = ?', [key]);
    } else {
      await query(
        'INSERT INTO site_settings (key_name, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
        [key, String(value).slice(0, 4000)]
      );
    }
  }
}

const publicRouter = express.Router();

// Public read of impressum/datenschutz fields used by the two static pages.
publicRouter.get('/impressum', async (_req, res) => {
  if (!dbAvailable()) return res.json({});
  try {
    const all = await loadSettings();
    res.json({
      name:             all['impressum.name'] || '',
      street:           all['impressum.street'] || '',
      city:             all['impressum.city'] || '',
      country:          all['impressum.country'] || '',
      email:            all['impressum.email'] || '',
      phone:            all['impressum.phone'] || '',
      responsibleName:  all['impressum.responsible_name'] || all['impressum.name'] || '',
      updatedDate:      all['datenschutz.updated_date'] || '',
    });
  } catch (err) {
    console.error('public impressum failed', err);
    res.json({});
  }
});

const adminRouter = express.Router();
adminRouter.use(requireAdmin);

// All admin endpoints below also implicitly require dbAvailable() since they
// all hit the DB. requireAdmin already ensures req.user is set, which only
// happens when the auth layer's DB call succeeded.

// GET /api/admin/users - paginated list with id, username, rating, etc.
adminRouter.get('/users', async (_req, res) => {
  try {
    const rows = await query(
      `SELECT id, username, email, rating, games_played, wins, losses, draws,
              is_admin, created_at
         FROM users
        ORDER BY id ASC`
    );
    const total = rows.length;
    res.json({
      total,
      users: rows.map((r) => ({
        id: r.id,
        username: r.username,
        email: r.email || null,
        rating: r.rating,
        gamesPlayed: r.games_played,
        wins: r.wins,
        losses: r.losses,
        draws: r.draws,
        isAdmin: !!r.is_admin,
        createdAt: r.created_at,
      })),
    });
  } catch (err) {
    console.error('admin/users failed', err);
    res.status(500).json({ error: 'Liste konnte nicht geladen werden.' });
  }
});

// POST /api/admin/users/:id/admin { admin: true|false }
adminRouter.post('/users/:id/admin', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Ungültige ID.' });
  const wantAdmin = Boolean(req.body && req.body.admin);
  // Safety: don't let an admin demote themselves into a state where there are
  // zero admins, and never demote yourself outright (must be done by another
  // admin or by adjusting the DB).
  if (id === req.user.id && !wantAdmin) {
    return res.status(400).json({ error: 'Du kannst dir selbst die Admin-Rechte nicht entziehen.' });
  }
  try {
    if (!wantAdmin) {
      const otherAdmins = await query(
        'SELECT COUNT(*) AS n FROM users WHERE is_admin = 1 AND id != ?',
        [id]
      );
      if (otherAdmins[0].n === 0) {
        return res.status(400).json({ error: 'Es muss mindestens ein Admin übrig bleiben.' });
      }
    }
    const r = await query(
      'UPDATE users SET is_admin = ? WHERE id = ?',
      [wantAdmin ? 1 : 0, id]
    );
    if (r.affectedRows === 0) return res.status(404).json({ error: 'User nicht gefunden.' });
    res.json({ ok: true, isAdmin: wantAdmin });
  } catch (err) {
    console.error('admin toggle failed', err);
    res.status(500).json({ error: 'Update fehlgeschlagen.' });
  }
});

// DELETE /api/admin/users/:id - kick a user. Cascades through FKs.
adminRouter.delete('/users/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Ungültige ID.' });
  if (id === req.user.id) return res.status(400).json({ error: 'Du kannst dich nicht selbst löschen.' });
  try {
    const r = await query('DELETE FROM users WHERE id = ?', [id]);
    if (r.affectedRows === 0) return res.status(404).json({ error: 'User nicht gefunden.' });
    res.json({ ok: true });
  } catch (err) {
    console.error('admin delete user failed', err);
    res.status(500).json({ error: 'Löschen fehlgeschlagen.' });
  }
});

// GET /api/admin/settings - returns all editable site settings.
adminRouter.get('/settings', async (_req, res) => {
  try {
    const all = await loadSettings();
    res.json({ settings: all, allowedKeys: ALLOWED_KEYS });
  } catch (err) {
    console.error('admin/settings GET failed', err);
    res.status(500).json({ error: 'Einstellungen nicht ladbar.' });
  }
});

// PUT /api/admin/settings { key: value, ... } - bulk upsert of allowed keys.
adminRouter.put('/settings', async (req, res) => {
  try {
    await saveSettings(req.body || {});
    res.json({ ok: true });
  } catch (err) {
    console.error('admin/settings PUT failed', err);
    res.status(500).json({ error: 'Speichern fehlgeschlagen.' });
  }
});

module.exports = { publicRouter, adminRouter };
