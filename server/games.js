'use strict';

const express = require('express');
const { query, dbAvailable } = require('./db');

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

/* Translate a row into the shape the frontend expects. Hides the
 * 'side' the requesting user wasn't on so we don't leak deleted-at
 * timestamps. */
function rowToGame(row, viewerId) {
  const side = row.white_user_id === viewerId ? 'w'
            : row.black_user_id === viewerId ? 'b'
            : null;
  const opponentName = side === 'w' ? row.black_name : row.white_name;
  const myResult = (() => {
    if (row.result === '1/2-1/2') return 'draw';
    if (row.result === '1-0') return side === 'w' ? 'win' : 'loss';
    if (row.result === '0-1') return side === 'b' ? 'win' : 'loss';
    return null;
  })();
  return {
    id: row.id,
    side,
    opponentName,
    whiteName: row.white_name,
    blackName: row.black_name,
    result: row.result,
    myResult,
    termination: row.termination,
    shape: row.shape || 'standard',
    shapeOpts: row.shape_opts ? safeJson(row.shape_opts) : null,
    timeControl: { initial: row.time_initial, increment: row.time_increment },
    rated: !!row.rated,
    finishedAt: row.finished_at,
    startedAt: row.started_at,
    moveCount: row.move_count != null ? row.move_count : null,
  };
}

function safeJson(s) {
  try { return JSON.parse(s); } catch { return null; }
}

// GET /api/games?from&to&opponent&result&limit&offset
router.get('/', async (req, res) => {
  if (!ensureAuth(req, res)) return;
  const uid = req.user.id;
  const filters = ['(white_user_id = ? OR black_user_id = ?)'];
  const params = [uid, uid];
  // Hide soft-deleted rows from the requesting user's view.
  filters.push('((white_user_id = ? AND white_deleted_at IS NULL) OR (black_user_id = ? AND black_deleted_at IS NULL))');
  params.push(uid, uid);

  const from = (req.query.from || '').trim();
  const to   = (req.query.to   || '').trim();
  const opponent = (req.query.opponent || '').trim();
  const result = (req.query.result || '').trim();

  if (from && /^\d{4}-\d{2}-\d{2}/.test(from)) {
    filters.push('finished_at >= ?');
    params.push(from);
  }
  if (to && /^\d{4}-\d{2}-\d{2}/.test(to)) {
    filters.push('finished_at <= ?');
    params.push(to + ' 23:59:59');
  }
  if (opponent) {
    // Match against whichever side is the opponent.
    filters.push('((white_user_id = ? AND black_name LIKE ?) OR (black_user_id = ? AND white_name LIKE ?))');
    const like = '%' + opponent + '%';
    params.push(uid, like, uid, like);
  }
  if (result === 'win') {
    filters.push('((white_user_id = ? AND result = "1-0") OR (black_user_id = ? AND result = "0-1"))');
    params.push(uid, uid);
  } else if (result === 'loss') {
    filters.push('((white_user_id = ? AND result = "0-1") OR (black_user_id = ? AND result = "1-0"))');
    params.push(uid, uid);
  } else if (result === 'draw') {
    filters.push('result = "1/2-1/2"');
  }
  const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 30));
  const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);

  try {
    const sql = `SELECT id, room_code, white_user_id, black_user_id, white_name, black_name,
                        time_initial, time_increment, rated, shape, shape_opts,
                        result, termination, started_at, finished_at,
                        CASE WHEN moves_json IS NULL THEN NULL ELSE LENGTH(moves_json) END AS move_size
                 FROM games
                 WHERE ${filters.join(' AND ')}
                 ORDER BY finished_at DESC, id DESC
                 LIMIT ${limit} OFFSET ${offset}`;
    const rows = await query(sql, params);
    res.json({ entries: rows.map((r) => rowToGame(r, uid)) });
  } catch (err) {
    console.error('list games failed', err);
    res.status(500).json({ error: 'Partien konnten nicht geladen werden.' });
  }
});

// GET /api/games/:id - full game with moves for review
router.get('/:id', async (req, res) => {
  if (!ensureAuth(req, res)) return;
  const uid = req.user.id;
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Ungültige ID.' });
  try {
    const rows = await query(
      `SELECT * FROM games
       WHERE id = ?
         AND (white_user_id = ? OR black_user_id = ?)
         AND ((white_user_id = ? AND white_deleted_at IS NULL) OR (black_user_id = ? AND black_deleted_at IS NULL))
       LIMIT 1`,
      [id, uid, uid, uid, uid]
    );
    if (!rows.length) return res.status(404).json({ error: 'Partie nicht gefunden.' });
    const row = rows[0];
    const meta = rowToGame(row, uid);
    res.json({
      ...meta,
      pgn: row.pgn,
      finalFen: row.final_fen,
      moves: row.moves_json ? safeJson(row.moves_json) : [],
    });
  } catch (err) {
    console.error('get game failed', err);
    res.status(500).json({ error: 'Partie konnte nicht geladen werden.' });
  }
});

// DELETE /api/games/:id - soft-delete only from the requesting user's view.
// The opponent (if logged in) keeps their copy. When BOTH sides are deleted
// the row is hard-deleted from the table to reclaim storage.
router.delete('/:id', async (req, res) => {
  if (!ensureAuth(req, res)) return;
  const uid = req.user.id;
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Ungültige ID.' });
  try {
    const rows = await query(
      'SELECT id, white_user_id, black_user_id, white_deleted_at, black_deleted_at FROM games WHERE id = ?',
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Partie nicht gefunden.' });
    const row = rows[0];
    const onWhite = row.white_user_id === uid;
    const onBlack = row.black_user_id === uid;
    if (!onWhite && !onBlack) return res.status(403).json({ error: 'Keine Berechtigung.' });
    const col = onWhite ? 'white_deleted_at' : 'black_deleted_at';
    const oppCol = onWhite ? 'black_deleted_at' : 'white_deleted_at';
    const oppUser = onWhite ? row.black_user_id : row.white_user_id;
    // If opponent has no account, or has already deleted, hard-delete the row.
    const opponentInactive = !oppUser || row[oppCol] != null;
    if (opponentInactive) {
      await query('DELETE FROM games WHERE id = ?', [id]);
    } else {
      await query(`UPDATE games SET ${col} = NOW() WHERE id = ?`, [id]);
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('delete game failed', err);
    res.status(500).json({ error: 'Löschen fehlgeschlagen.' });
  }
});

module.exports = { router };
