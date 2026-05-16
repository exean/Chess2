'use strict';

const express = require('express');
const { query, dbAvailable } = require('./db');
const { restoreBotSession } = require('./rooms');

const router = express.Router();

function ensureAuth(req, res) {
  if (!req.user) {
    res.status(401).json({ error: 'Login erforderlich.' });
    return false;
  }
  if (!dbAvailable()) {
    res.status(503).json({ error: 'Datenbank nicht konfiguriert.' });
    return false;
  }
  return true;
}

function rowToSession(r) {
  return {
    id: r.id,
    userColor: r.user_color,
    botDifficulty: r.bot_difficulty,
    shape: r.shape,
    shapeOpts: r.shape_opts ? safeJson(r.shape_opts) : null,
    timeControl: { initial: r.time_initial, increment: r.time_increment },
    moveCount: r.move_count != null ? r.move_count : null,
    pausedAt: r.paused_at,
  };
}

function safeJson(s) {
  try { return JSON.parse(s); } catch { return null; }
}

// GET /api/bot-sessions - list current user's paused sessions
router.get('/', async (req, res) => {
  if (!ensureAuth(req, res)) return;
  try {
    const rows = await query(
      `SELECT id, user_color, bot_difficulty, shape, shape_opts,
              time_initial, time_increment, paused_at,
              (CASE WHEN moves_json IS NULL THEN 0
                    ELSE (LENGTH(moves_json) - LENGTH(REPLACE(moves_json, '"san"', '')) ) / 5 END)
                AS move_count
         FROM bot_sessions
        WHERE user_id = ?
        ORDER BY paused_at DESC`,
      [req.user.id]
    );
    res.json({ entries: rows.map(rowToSession) });
  } catch (err) {
    console.error('list bot sessions failed', err);
    res.status(500).json({ error: 'Pausierte Partien nicht abrufbar.' });
  }
});

// DELETE /api/bot-sessions/:id - discard
router.delete('/:id', async (req, res) => {
  if (!ensureAuth(req, res)) return;
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Ungültige ID.' });
  try {
    const r = await query('DELETE FROM bot_sessions WHERE id = ? AND user_id = ?', [id, req.user.id]);
    if (r.affectedRows === 0) return res.status(404).json({ error: 'Nicht gefunden.' });
    res.json({ ok: true });
  } catch (err) {
    console.error('delete bot session failed', err);
    res.status(500).json({ error: 'Löschen fehlgeschlagen.' });
  }
});

// POST /api/bot-sessions/:id/resume - create an in-memory room from the
// saved state and return the new room code + seatToken so the client can
// reclaim its seat via room:join.
router.post('/:id/resume', async (req, res) => {
  if (!ensureAuth(req, res)) return;
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Ungültige ID.' });
  try {
    const rows = await query('SELECT * FROM bot_sessions WHERE id = ? AND user_id = ?', [id, req.user.id]);
    if (!rows.length) return res.status(404).json({ error: 'Nicht gefunden.' });
    const saved = rows[0];
    const userInfo = {
      userId: req.user.id,
      username: req.user.username,
      rating: req.user.rating || null,
    };
    let info;
    try { info = restoreBotSession(saved, userInfo); }
    catch (err) {
      console.error('restoreBotSession failed', err);
      return res.status(500).json({ error: 'Wiederherstellung fehlgeschlagen.' });
    }
    // Remove the saved row so the same game isn't restored twice.
    await query('DELETE FROM bot_sessions WHERE id = ?', [id]);
    res.json({ ok: true, code: info.code, color: info.color, seatToken: info.seatToken });
  } catch (err) {
    console.error('resume bot session failed', err);
    res.status(500).json({ error: 'Wiederherstellung fehlgeschlagen.' });
  }
});

module.exports = { router };
