'use strict';

const express = require('express');
const { query, dbAvailable } = require('./db');

const router = express.Router();

function ensureAuth(req, res) {
  if (!req.user) { res.status(401).json({ error: 'Login erforderlich.' }); return false; }
  if (!dbAvailable()) { res.status(503).json({ error: 'Datenbank nicht konfiguriert.' }); return false; }
  return true;
}

// GET /api/friends -> { friends, incoming, outgoing }
router.get('/', async (req, res) => {
  if (!ensureAuth(req, res)) return;
  const me = req.user.id;
  try {
    // Accepted friendships - join with users to fetch the OTHER side's profile.
    const friends = await query(
      `SELECT u.id, u.username, u.rating, f.responded_at AS since,
              CASE WHEN f.requester_id = ? THEN f.addressee_id ELSE f.requester_id END AS friend_id
         FROM friendships f
         JOIN users u
           ON u.id = (CASE WHEN f.requester_id = ? THEN f.addressee_id ELSE f.requester_id END)
        WHERE (f.requester_id = ? OR f.addressee_id = ?)
          AND f.status = 'accepted'
        ORDER BY u.username ASC`,
      [me, me, me, me]
    );
    // Incoming pending requests (someone asked us).
    const incoming = await query(
      `SELECT f.id AS request_id, u.id AS user_id, u.username, u.rating, f.created_at
         FROM friendships f
         JOIN users u ON u.id = f.requester_id
        WHERE f.addressee_id = ? AND f.status = 'pending'
        ORDER BY f.created_at DESC`,
      [me]
    );
    // Outgoing pending requests (we asked someone).
    const outgoing = await query(
      `SELECT f.id AS request_id, u.id AS user_id, u.username, u.rating, f.created_at
         FROM friendships f
         JOIN users u ON u.id = f.addressee_id
        WHERE f.requester_id = ? AND f.status = 'pending'
        ORDER BY f.created_at DESC`,
      [me]
    );
    res.json({ friends, incoming, outgoing });
  } catch (err) {
    console.error('list friends failed', err);
    res.status(500).json({ error: 'Liste konnte nicht geladen werden.' });
  }
});

// POST /api/friends/requests  { username }
//   - 404 if username unknown
//   - 400 self-request
//   - 409 if already friends or pending request from me
//   - if there's a pending request FROM the other person to me -> auto-accept
//   - otherwise insert new pending row
router.post('/requests', async (req, res) => {
  if (!ensureAuth(req, res)) return;
  const me = req.user.id;
  const username = String((req.body && req.body.username) || '').trim();
  if (!username) return res.status(400).json({ error: 'Username erforderlich.' });
  try {
    const userRows = await query('SELECT id, username FROM users WHERE username = ?', [username]);
    if (!userRows.length) return res.status(404).json({ error: 'Username nicht gefunden.' });
    const other = userRows[0];
    if (other.id === me) return res.status(400).json({ error: 'Du kannst dich nicht selbst hinzufügen.' });
    // Existing relationship?
    const existing = await query(
      `SELECT id, requester_id, addressee_id, status FROM friendships
        WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)`,
      [me, other.id, other.id, me]
    );
    if (existing.length) {
      const row = existing[0];
      if (row.status === 'accepted') return res.status(409).json({ error: 'Ihr seid schon Freunde.' });
      // Pending - if THEY asked first, auto-accept the mutual interest.
      if (row.requester_id === other.id) {
        await query(
          "UPDATE friendships SET status = 'accepted', responded_at = NOW() WHERE id = ?",
          [row.id]
        );
        return res.json({ ok: true, status: 'accepted', friendId: other.id, friendUsername: other.username });
      }
      // I already asked them.
      return res.status(409).json({ error: 'Anfrage läuft bereits.' });
    }
    const result = await query(
      "INSERT INTO friendships (requester_id, addressee_id, status) VALUES (?, ?, 'pending')",
      [me, other.id]
    );
    res.json({ ok: true, status: 'pending', requestId: result.insertId, addresseeUsername: other.username });
  } catch (err) {
    console.error('create friend request failed', err);
    res.status(500).json({ error: 'Anfrage fehlgeschlagen.' });
  }
});

// POST /api/friends/requests/:id/accept (only the addressee can accept)
router.post('/requests/:id/accept', async (req, res) => {
  if (!ensureAuth(req, res)) return;
  const me = req.user.id;
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Ungültige ID.' });
  try {
    const r = await query(
      "UPDATE friendships SET status = 'accepted', responded_at = NOW() WHERE id = ? AND addressee_id = ? AND status = 'pending'",
      [id, me]
    );
    if (r.affectedRows === 0) return res.status(404).json({ error: 'Anfrage nicht gefunden.' });
    res.json({ ok: true });
  } catch (err) {
    console.error('accept friend failed', err);
    res.status(500).json({ error: 'Annehmen fehlgeschlagen.' });
  }
});

// POST /api/friends/requests/:id/decline   (addressee declines)
// DELETE /api/friends/requests/:id          (requester cancels)
// Both effectively drop the pending row.
async function dropPendingRequest(id, me) {
  return query(
    "DELETE FROM friendships WHERE id = ? AND status = 'pending' AND (requester_id = ? OR addressee_id = ?)",
    [id, me, me]
  );
}
router.post('/requests/:id/decline', async (req, res) => {
  if (!ensureAuth(req, res)) return;
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Ungültige ID.' });
  try {
    const r = await dropPendingRequest(id, req.user.id);
    if (r.affectedRows === 0) return res.status(404).json({ error: 'Anfrage nicht gefunden.' });
    res.json({ ok: true });
  } catch (err) {
    console.error('decline friend failed', err);
    res.status(500).json({ error: 'Ablehnen fehlgeschlagen.' });
  }
});
router.delete('/requests/:id', async (req, res) => {
  if (!ensureAuth(req, res)) return;
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Ungültige ID.' });
  try {
    const r = await dropPendingRequest(id, req.user.id);
    if (r.affectedRows === 0) return res.status(404).json({ error: 'Anfrage nicht gefunden.' });
    res.json({ ok: true });
  } catch (err) {
    console.error('cancel friend request failed', err);
    res.status(500).json({ error: 'Zurückziehen fehlgeschlagen.' });
  }
});

// DELETE /api/friends/:friendId - remove accepted friendship in either direction.
// Both sides lose the friend simultaneously - the row is gone for everyone.
router.delete('/:friendId', async (req, res) => {
  if (!ensureAuth(req, res)) return;
  const me = req.user.id;
  const friendId = parseInt(req.params.friendId, 10);
  if (!Number.isFinite(friendId)) return res.status(400).json({ error: 'Ungültige ID.' });
  try {
    const r = await query(
      `DELETE FROM friendships
        WHERE status = 'accepted'
          AND ((requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?))`,
      [me, friendId, friendId, me]
    );
    if (r.affectedRows === 0) return res.status(404).json({ error: 'Freundschaft nicht gefunden.' });
    res.json({ ok: true });
  } catch (err) {
    console.error('remove friend failed', err);
    res.status(500).json({ error: 'Entfernen fehlgeschlagen.' });
  }
});

module.exports = { router };
