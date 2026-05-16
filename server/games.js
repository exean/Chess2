'use strict';

const express = require('express');
const { query, dbAvailable } = require('./db');
const { Chess } = require('../shared/chess-engine');

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

/* Lightweight PGN parser: pulls tag pairs and SAN tokens out of plain
 * PGN text. Comments, variations, NAGs and result tokens are stripped.
 * Single-game PGNs only - if multiple games are pasted, just the first
 * one is parsed (everything after the first result token is ignored). */
function parsePgn(text) {
  const tags = {};
  const tagRx = /\[(\w+)\s+"((?:[^"\\]|\\.)*)"\]/g;
  let m;
  while ((m = tagRx.exec(text))) {
    tags[m[1]] = m[2].replace(/\\(.)/g, '$1');
  }
  // Everything after the last tag bracket is the movetext.
  const lastTagEnd = text.lastIndexOf(']');
  let movetext = (lastTagEnd >= 0 ? text.slice(lastTagEnd + 1) : text);
  movetext = movetext
    .replace(/\{[^}]*\}/g, ' ')  // comments
    .replace(/\([^()]*\)/g, ' ') // single-level variations
    .replace(/\$\d+/g, ' ')      // NAGs
    .replace(/\d+\.+/g, ' ')     // move numbers (1. / 1...)
    .replace(/[\r\n\t]+/g, ' ')
    .trim();
  const resultIdx = movetext.search(/\b(1-0|0-1|1\/2-1\/2|\*)\b/);
  if (resultIdx >= 0) movetext = movetext.slice(0, resultIdx).trim();
  const tokens = movetext.split(/\s+/).filter((t) => t && !/^(1-0|0-1|1\/2-1\/2|\*)$/.test(t));
  return { tags, moves: tokens };
}

// POST /api/games/import { pgn }  -> { id }
// Stores the imported game under the current user's white seat with no
// opponent. The user can review and delete it like any other archived game.
router.post('/import', async (req, res) => {
  if (!ensureAuth(req, res)) return;
  const pgnText = String((req.body && req.body.pgn) || '').trim();
  if (!pgnText) return res.status(400).json({ error: 'PGN fehlt.' });
  if (pgnText.length > 200_000) return res.status(400).json({ error: 'PGN zu groß.' });
  try {
    const { tags, moves } = parsePgn(pgnText);
    if (!moves.length) return res.status(400).json({ error: 'Keine gültigen Züge im PGN gefunden.' });
    const chess = new Chess();
    const moveList = [];
    for (let i = 0; i < moves.length; i++) {
      const san = moves[i];
      const applied = chess.move(san);
      if (!applied) {
        return res.status(400).json({ error: 'Ungültiger Zug an Position ' + (i + 1) + ': ' + san });
      }
      moveList.push(applied);
    }
    const result = tags.Result || (chess.isGameOver() ? chess.result() : '*');
    const whiteName = (tags.White || '?').slice(0, 64);
    const blackName = (tags.Black || '?').slice(0, 64);
    const finalFen = chess.fen();
    const insert = await query(
      `INSERT INTO games
        (room_code, white_user_id, black_user_id, white_name, black_name,
         time_initial, time_increment, rated, shape, shape_opts,
         result, termination, pgn, moves_json, final_fen, finished_at)
       VALUES ('IMPORT', ?, NULL, ?, ?, 0, 0, 0, 'standard', NULL, ?, ?, ?, ?, ?, NOW())`,
      [req.user.id, whiteName, blackName, result, chess.terminationReason() || 'imported',
       pgnText, JSON.stringify(moveList), finalFen]
    );
    res.json({ ok: true, id: insert.insertId });
  } catch (err) {
    console.error('pgn import failed', err);
    res.status(400).json({ error: err.message || 'PGN-Import fehlgeschlagen.' });
  }
});

module.exports = { router };
