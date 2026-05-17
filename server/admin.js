'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const { query, dbAvailable } = require('./db');
const { requireAdmin } = require('./auth');

const PIECES_DIR = path.join(__dirname, '..', 'public', 'pieces');
const PIECE_SLOTS = ['wp','wn','wb','wr','wq','wk','bp','bn','bb','br','bq','bk'];
const BUILTIN_SET_IDS = new Set(['unicode', 'modern']);
const MAX_SVG_BYTES = 256 * 1024;

function safeSetId(id) {
  return typeof id === 'string'
    && /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/.test(id)
    && !BUILTIN_SET_IDS.has(id);
}

// Conservative SVG check: must start with <svg, must not contain script tags,
// on*=" event handlers, foreignObject, or javascript:/data: URIs in href.
// Pieces are usually served via <img src>, which sandboxes scripts, but the
// file is also reachable as a top-level document at /pieces/<id>/<slot>.svg
// where scripts would execute - so we reject anything dangerous up front.
function validSvg(s) {
  if (typeof s !== 'string') return false;
  if (s.length === 0 || s.length > MAX_SVG_BYTES) return false;
  const stripped = s.replace(/^[\uFEFF\s]*(?:<\?xml[^>]*\?>)?\s*(?:<!DOCTYPE[^>]*>)?\s*/i, '');
  if (!/^<svg[\s>]/i.test(stripped)) return false;
  if (/<\s*script\b/i.test(s)) return false;
  if (/\son\w+\s*=/i.test(s)) return false;
  if (/<\s*foreignObject\b/i.test(s)) return false;
  if (/(?:xlink:)?href\s*=\s*["']?\s*(?:javascript|data):/i.test(s)) return false;
  return true;
}

function readMeta(id) {
  try {
    const raw = fs.readFileSync(path.join(PIECES_DIR, id, 'meta.json'), 'utf8');
    const m = JSON.parse(raw);
    return {
      name: typeof m.name === 'string' ? m.name : '',
      author: typeof m.author === 'string' ? m.author : '',
      sourceUrl: typeof m.sourceUrl === 'string' ? m.sourceUrl : '',
      license: typeof m.license === 'string' ? m.license : '',
      updatedAt: typeof m.updatedAt === 'string' ? m.updatedAt : '',
    };
  } catch {
    return { name: '', author: '', sourceUrl: '', license: '', updatedAt: '' };
  }
}

function writeMeta(id, meta) {
  const dir = path.join(PIECES_DIR, id);
  const existing = readMeta(id);
  // Merge: keep prior values for keys the caller omitted entirely.
  const pick = (k, max) => {
    const v = meta && Object.prototype.hasOwnProperty.call(meta, k) ? meta[k] : existing[k];
    return String(v || '').slice(0, max);
  };
  const payload = {
    name: pick('name', 80),
    author: pick('author', 120),
    sourceUrl: pick('sourceUrl', 300),
    license: pick('license', 200),
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(payload, null, 2));
  return payload;
}

function describeSet(id) {
  const setDir = path.join(PIECES_DIR, id);
  const present = {};
  let complete = true;
  for (const slot of PIECE_SLOTS) {
    let ok = false;
    try { ok = fs.statSync(path.join(setDir, slot + '.svg')).isFile(); } catch {}
    present[slot] = ok;
    if (!ok) complete = false;
  }
  return { id, complete, files: present, meta: readMeta(id) };
}

function listInstalledSets() {
  let entries = [];
  try { entries = fs.readdirSync(PIECES_DIR, { withFileTypes: true }); } catch {}
  const out = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (!safeSetId(e.name)) continue;
    out.push(describeSet(e.name));
  }
  return out;
}

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

// Piece-set management ----------------------------------------------------
// SVGs can total ~3MB across 12 files so this route gets its own json parser
// with a higher limit. The global parser stays at 64kb for everything else.
const pieceBody = express.json({ limit: '8mb' });

// GET /api/admin/piece-sets - list all installed sets with metadata + which
// slots are filled, so the UI can render a preview grid and surface gaps.
adminRouter.get('/piece-sets', (_req, res) => {
  res.json({ sets: listInstalledSets(), slots: PIECE_SLOTS });
});

// POST /api/admin/piece-sets/:id { meta?, files? }
// Idempotent upsert: creates the set dir if missing, writes any provided
// files, and (re)writes meta.json. Partial uploads are supported - existing
// slots are kept when the body omits them, so admins can fix one piece at a
// time without re-uploading the whole set.
adminRouter.post('/piece-sets/:id', pieceBody, (req, res) => {
  const id = req.params.id;
  if (!safeSetId(id)) {
    return res.status(400).json({
      error: 'Ungültige ID. Erlaubt: a-z, 0-9, Bindestrich, 2-32 Zeichen. Reservierte Namen (unicode, modern) sind nicht zulässig.',
    });
  }
  const body = req.body || {};
  const files = (body.files && typeof body.files === 'object') ? body.files : {};
  // Validate every provided file up front so we don't write half a set.
  for (const slot of Object.keys(files)) {
    if (!PIECE_SLOTS.includes(slot)) {
      return res.status(400).json({ error: 'Unbekannter Slot: ' + slot });
    }
    if (!validSvg(files[slot])) {
      return res.status(400).json({ error: 'SVG nicht akzeptiert für ' + slot + ' (max. 256 KB, keine <script>/Event-Handler).' });
    }
  }
  try {
    const dir = path.join(PIECES_DIR, id);
    if (path.relative(PIECES_DIR, dir).startsWith('..')) {
      return res.status(400).json({ error: 'Ungültige ID.' });
    }
    fs.mkdirSync(dir, { recursive: true });
    for (const [slot, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(dir, slot + '.svg'), content, 'utf8');
    }
    writeMeta(id, body.meta || {});
    res.json({ ok: true, set: describeSet(id) });
  } catch (err) {
    console.error('piece-set upsert failed', err);
    res.status(500).json({ error: 'Speichern fehlgeschlagen.' });
  }
});

// DELETE /api/admin/piece-sets/:id - remove the entire set directory.
adminRouter.delete('/piece-sets/:id', (req, res) => {
  const id = req.params.id;
  if (!safeSetId(id)) return res.status(400).json({ error: 'Ungültige ID.' });
  const dir = path.join(PIECES_DIR, id);
  if (path.relative(PIECES_DIR, dir).startsWith('..')) {
    return res.status(400).json({ error: 'Ungültige ID.' });
  }
  try {
    if (!fs.existsSync(dir)) return res.status(404).json({ error: 'Set nicht gefunden.' });
    fs.rmSync(dir, { recursive: true, force: true });
    res.json({ ok: true });
  } catch (err) {
    console.error('piece-set delete failed', err);
    res.status(500).json({ error: 'Löschen fehlgeschlagen.' });
  }
});

// DELETE /api/admin/piece-sets/:id/files/:slot - clear a single slot without
// touching the rest of the set.
adminRouter.delete('/piece-sets/:id/files/:slot', (req, res) => {
  const { id, slot } = req.params;
  if (!safeSetId(id)) return res.status(400).json({ error: 'Ungültige ID.' });
  if (!PIECE_SLOTS.includes(slot)) return res.status(400).json({ error: 'Unbekannter Slot.' });
  try {
    fs.rmSync(path.join(PIECES_DIR, id, slot + '.svg'), { force: true });
    res.json({ ok: true, set: describeSet(id) });
  } catch (err) {
    console.error('piece-set file delete failed', err);
    res.status(500).json({ error: 'Löschen fehlgeschlagen.' });
  }
});

module.exports = { publicRouter, adminRouter, listInstalledSets, readMeta, PIECE_SLOTS };
