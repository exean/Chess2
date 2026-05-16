'use strict';

const crypto = require('crypto');
const { verifyToken } = require('./auth');
const { query, dbAvailable } = require('./db');
const { computeRatings } = require('./rating');
const {
  rooms, userIndex, createRoom, createBotSeat, getRoom, deleteRoom,
  listPublicLobbies, publicRoom, clockSnapshot,
} = require('./rooms');
const ai = require('./ai');

const VALID_DIFFICULTIES = ['easy', 'medium', 'hard'];

function newSeatToken() { return crypto.randomBytes(16).toString('hex'); }

function emitRoomState(io, room) {
  io.to(roomChannel(room.code)).emit('room:state', publicRoom(room));
}

function emitClockTick(io, room) {
  io.to(roomChannel(room.code)).emit('clock:tick', clockSnapshot(room));
}

function roomChannel(code) { return `room:${code}`; }

function startClock(io, room) {
  if (room.clock.timerHandle) clearInterval(room.clock.timerHandle);
  if (!room.timeControl.initial) return;
  room.clock.timerHandle = setInterval(() => {
    const snap = clockSnapshot(room);
    if (!snap) return;
    if (snap.whiteMs <= 0) return endGame(io, room, '0-1', 'timeout');
    if (snap.blackMs <= 0) return endGame(io, room, '1-0', 'timeout');
    emitClockTick(io, room);
  }, 1000);
}

function stopClock(room) {
  if (room.clock.timerHandle) {
    clearInterval(room.clock.timerHandle);
    room.clock.timerHandle = null;
  }
}

function applyClockAfterMove(room) {
  if (!room.timeControl.initial) return;
  const now = Date.now();
  if (room.clock.lastMoveAt) {
    const elapsed = now - room.clock.lastMoveAt;
    // The clock that just moved is the OPPOSITE of current turn (turn already flipped).
    const justMoved = room.chess.turn === 'w' ? 'b' : 'w';
    if (justMoved === 'w') {
      room.clock.whiteMs = Math.max(0, room.clock.whiteMs - elapsed) + room.timeControl.increment * 1000;
    } else {
      room.clock.blackMs = Math.max(0, room.clock.blackMs - elapsed) + room.timeControl.increment * 1000;
    }
  }
  room.clock.lastMoveAt = now;
}

async function persistFinishedGame(room) {
  if (!dbAvailable()) return;
  if (!room.white || !room.black) return;
  // Aborted games don't earn a place in the history table - nothing happened.
  if (room.termination === 'aborted') return;
  // Only persist games that involve at least one logged-in account.
  // Anonymous-vs-anonymous matches don't need to live in the DB.
  if (!room.white.userId && !room.black.userId) return;
  try {
    const wUser = room.white.userId || null;
    const bUser = room.black.userId || null;
    const pgn = room.chess.pgn({
      White: room.white.name,
      Black: room.black.name,
      Result: room.result,
      TimeControl: room.timeControl.initial
        ? `${room.timeControl.initial}+${room.timeControl.increment}`
        : '-',
    });
    let whiteBefore = null, blackBefore = null, whiteAfter = null, blackAfter = null;
    if (room.rated && wUser && bUser) {
      const wRows = await query('SELECT rating, games_played FROM users WHERE id = ?', [wUser]);
      const bRows = await query('SELECT rating, games_played FROM users WHERE id = ?', [bUser]);
      const wRow = wRows[0];
      const bRow = bRows[0];
      if (wRow && bRow) {
        whiteBefore = wRow.rating;
        blackBefore = bRow.rating;
        const score = room.result === '1-0' ? 1 : room.result === '0-1' ? 0 : 0.5;
        const { whiteAfter: wa, blackAfter: ba } = computeRatings(
          wRow.rating, bRow.rating, wRow.games_played, bRow.games_played, score
        );
        whiteAfter = wa;
        blackAfter = ba;
        await query(
          `UPDATE users SET rating = ?, games_played = games_played + 1,
             wins = wins + ?, losses = losses + ?, draws = draws + ?
           WHERE id = ?`,
          [whiteAfter,
           score === 1 ? 1 : 0,
           score === 0 ? 1 : 0,
           score === 0.5 ? 1 : 0,
           wUser]
        );
        await query(
          `UPDATE users SET rating = ?, games_played = games_played + 1,
             wins = wins + ?, losses = losses + ?, draws = draws + ?
           WHERE id = ?`,
          [blackAfter,
           score === 0 ? 1 : 0,
           score === 1 ? 1 : 0,
           score === 0.5 ? 1 : 0,
           bUser]
        );
      }
    }
    const movesJson = JSON.stringify(room.moveList || []);
    const shapeOpts = room.shapeOpts ? JSON.stringify(room.shapeOpts) : null;
    await query(
      `INSERT INTO games
        (room_code, white_user_id, black_user_id, white_name, black_name,
         time_initial, time_increment, rated, shape, shape_opts,
         result, termination, pgn, moves_json, final_fen,
         white_rating_before, black_rating_before, white_rating_after, black_rating_after,
         finished_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW())`,
      [room.code, wUser, bUser, room.white.name, room.black.name,
       room.timeControl.initial, room.timeControl.increment, room.rated ? 1 : 0,
       room.shape || 'standard', shapeOpts,
       room.result, room.termination, pgn, movesJson, room.chess.fen(),
       whiteBefore, blackBefore, whiteAfter, blackAfter]
    );
  } catch (err) {
    console.error('Failed to persist game', err);
  }
}

function scheduleBotMoveIfNeeded(io, room) {
  if (room.status !== 'active') return;
  const seat = room.chess.turn === 'w' ? room.white : room.black;
  if (!seat || !seat.bot) return;
  // Defer to next tick so the previous emit/socket event finishes first.
  setImmediate(() => {
    if (room.status !== 'active') return;
    const stillBot = (room.chess.turn === 'w' ? room.white : room.black);
    if (!stillBot || !stillBot.bot) return;
    let aiPick;
    try {
      aiPick = ai.chooseMove(room.chess, stillBot.bot.difficulty);
    } catch (err) {
      console.error('Bot crashed:', err.message);
      return;
    }
    if (!aiPick) return;
    const result = room.chess.move(aiPick);
    if (!result) return;
    room.moveList.push(result);
    applyClockAfterMove(room);
    room.lastActivity = Date.now();
    room.drawOffer = null;
    io.to(roomChannel(room.code)).emit('game:move', {
      move: result,
      fen: result.fen,
      clock: clockSnapshot(room),
      turn: room.chess.turn,
    });
    if (room.chess.isGameOver()) {
      const r = room.chess.result();
      const t = room.chess.terminationReason();
      return endGame(io, room, r, t);
    }
    // No infinite loop: only schedule the next bot move if the next side is
    // also a bot (bot-vs-bot is unusual but safe due to the active check).
    scheduleBotMoveIfNeeded(io, room);
  });
}

function endGame(io, room, result, termination) {
  if (room.status === 'finished') return;
  room.status = 'finished';
  room.result = result;
  room.termination = termination;
  stopClock(room);
  emitRoomState(io, room);
  io.to(roomChannel(room.code)).emit('game:end', {
    result, termination,
    pgn: room.chess.pgn({
      White: room.white ? room.white.name : '?',
      Black: room.black ? room.black.name : '?',
      Result: result,
    }),
  });
  persistFinishedGame(room);
}

function seatBySocket(room, socketId) {
  if (room.white && room.white.socketId === socketId) return { color: 'w', seat: room.white };
  if (room.black && room.black.socketId === socketId) return { color: 'b', seat: room.black };
  return null;
}

function emitError(socket, message) {
  socket.emit('app:error', { message });
}

/* ----- Online presence + friend challenges ----------------------------- */

// userId -> Set<socketId>: every socket the user has open. The user counts
// as 'online' for friends as long as at least one socket is connected.
const onlineUsers = new Map();
// challengeToken -> { fromUserId, toUserId, roomCode, expiresAt, seatToken }
const pendingChallenges = new Map();
let ioInstance = null;

function setUserOnline(userId, socketId) {
  if (!userId) return false;
  let set = onlineUsers.get(userId);
  if (!set) { set = new Set(); onlineUsers.set(userId, set); }
  const wasEmpty = set.size === 0;
  set.add(socketId);
  return wasEmpty;
}
function setUserOffline(userId, socketId) {
  if (!userId) return false;
  const set = onlineUsers.get(userId);
  if (!set) return false;
  set.delete(socketId);
  if (set.size === 0) { onlineUsers.delete(userId); return true; }
  return false;
}
function isUserOnline(userId) {
  const set = onlineUsers.get(userId);
  return !!(set && set.size > 0);
}

async function broadcastStatusToFriends(userId, online) {
  if (!dbAvailable() || !ioInstance) return;
  try {
    const friends = await query(
      `SELECT CASE WHEN requester_id = ? THEN addressee_id ELSE requester_id END AS friend_id
         FROM friendships
        WHERE (requester_id = ? OR addressee_id = ?) AND status = 'accepted'`,
      [userId, userId, userId]
    );
    for (const f of friends) {
      ioInstance.to('user:' + f.friend_id).emit('friend:status', { userId, online });
    }
  } catch (err) {
    console.error('broadcastStatusToFriends failed', err);
  }
}

// Periodically prune expired challenges so they don't accumulate.
setInterval(() => {
  const now = Date.now();
  for (const [token, ch] of pendingChallenges.entries()) {
    if (ch.expiresAt < now) pendingChallenges.delete(token);
  }
}, 30_000);

function registerHandlers(io, socket) {
  ioInstance = io;
  // identity is resolved on first auth message
  socket.data.user = null;

  socket.on('auth', (data, ack) => {
    if (data && data.token) {
      const payload = verifyToken(data.token);
      if (payload) {
        socket.data.user = { id: payload.sub, username: payload.username };
        socket.join('user:' + payload.sub);
        const cameOnline = setUserOnline(payload.sub, socket.id);
        if (cameOnline) broadcastStatusToFriends(payload.sub, true);
      }
    }
    if (typeof ack === 'function') ack({ ok: true, user: socket.data.user });
  });

  socket.on('lobby:list', (_data, ack) => {
    const list = listPublicLobbies();
    if (typeof ack === 'function') ack({ rooms: list });
    socket.emit('lobby:list', { rooms: list });
  });

  socket.on('room:create', async (data, ack) => {
    const name = sanitizeName(data && data.name, socket);
    if (!name) return ack && ack({ error: 'Name fehlt.' });
    const rated = Boolean(data && data.rated) && dbAvailable() && socket.data.user;
    const visibility = data && data.visibility === 'public' ? 'public' : 'private';
    const seat = (data && data.seat === 'b') ? 'b' : (data && data.seat === 'w') ? 'w' : 'random';
    const tc = (data && data.timeControl) || { initial: 0, increment: 0 };
    const opponent = data && data.opponent;
    const isBotGame = typeof opponent === 'string' && opponent.startsWith('bot-');
    const botDifficulty = isBotGame ? opponent.slice(4) : null;
    if (isBotGame && !VALID_DIFFICULTIES.includes(botDifficulty)) {
      return ack && ack({ error: 'Unbekannter Schwierigkeitsgrad.' });
    }
    let rating = null;
    if (socket.data.user && dbAvailable()) {
      try {
        const rows = await query('SELECT rating FROM users WHERE id = ?', [socket.data.user.id]);
        if (rows[0]) rating = rows[0].rating;
      } catch {}
    }
    const shape = (data && data.shape) || 'standard';
    const customSize = data && data.customSize;
    const room = createRoom({
      visibility: isBotGame ? 'private' : visibility,
      rated,
      timeControl: tc,
      shape,
      customSize,
      botColor: isBotGame ? (seat === 'w' ? 'b' : seat === 'b' ? 'w' : (Math.random() < 0.5 ? 'b' : 'w')) : null,
      createdBy: socket.data.user ? socket.data.user.id : null,
    });
    let chosen;
    if (isBotGame) {
      const botColor = seat === 'w' ? 'b' : seat === 'b' ? 'w' : (Math.random() < 0.5 ? 'b' : 'w');
      chosen = botColor === 'w' ? 'b' : 'w';
      if (botColor === 'w') room.white = createBotSeat(botDifficulty);
      else room.black = createBotSeat(botDifficulty);
      assignSeat(room, chosen, socket, name, rating);
      // Bot game starts immediately.
      room.status = 'active';
      room.clock.lastMoveAt = null;
      startClock(io, room);
    } else {
      chosen = seat === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : seat;
      assignSeat(room, chosen, socket, name, rating);
    }
    socket.join(roomChannel(room.code));
    userIndex.set(socket.id, room.code);
    if (typeof ack === 'function') {
      ack({
        ok: true,
        code: room.code,
        color: chosen,
        seatToken: chosen === 'w' ? room.white.seatToken : room.black.seatToken,
        state: publicRoom(room),
      });
    }
    emitRoomState(io, room);
    // If the bot has the first move, schedule it after sending the initial state.
    if (isBotGame) scheduleBotMoveIfNeeded(io, room);
  });

  socket.on('room:join', async (data, ack) => {
    const code = (data && data.code || '').toUpperCase().trim();
    const name = sanitizeName(data && data.name, socket);
    const room = getRoom(code);
    if (!room) return ack && ack({ error: 'Raum nicht gefunden.' });
    if (room.status === 'finished') {
      // spectator only
      addSpectator(room, socket, name);
      socket.join(roomChannel(code));
      userIndex.set(socket.id, code);
      return ack && ack({ ok: true, code, color: 'spectator', state: publicRoom(room) });
    }
    // Reconnect via seatToken?
    if (data && data.seatToken) {
      const reclaim = tryReclaimSeat(room, data.seatToken, socket);
      if (reclaim) {
        socket.join(roomChannel(code));
        userIndex.set(socket.id, code);
        // Reconnect within the grace window cancels any pending auto-pause.
        cancelPendingPause(code);
        // Resumed room: kick the active clock off so time starts ticking from
        // the moment the user actually reconnects, not from API-resume time.
        if (room.timeControl.initial && !room.clock.lastMoveAt) {
          room.clock.lastMoveAt = Date.now();
        }
        if (!room.clock.timerHandle) startClock(io, room);
        emitRoomState(io, room);
        // If the bot already had the move when the room was paused/restored,
        // give it a nudge so the game continues right away.
        scheduleBotMoveIfNeeded(io, room);
        return ack && ack({ ok: true, code, color: reclaim, seatToken: data.seatToken, state: publicRoom(room) });
      }
    }
    // Reconnect via account?
    if (socket.data.user) {
      if (room.white && room.white.userId === socket.data.user.id) {
        room.white.socketId = socket.id;
        room.white.connected = true;
        room.white.disconnectedAt = null;
        room.lastActivity = Date.now();
        socket.join(roomChannel(code));
        userIndex.set(socket.id, code);
        cancelPendingPause(code);
        emitRoomState(io, room);
        return ack && ack({ ok: true, code, color: 'w', seatToken: room.white.seatToken, state: publicRoom(room) });
      }
      if (room.black && room.black.userId === socket.data.user.id) {
        room.black.socketId = socket.id;
        room.black.connected = true;
        room.black.disconnectedAt = null;
        room.lastActivity = Date.now();
        socket.join(roomChannel(code));
        userIndex.set(socket.id, code);
        cancelPendingPause(code);
        emitRoomState(io, room);
        return ack && ack({ ok: true, code, color: 'b', seatToken: room.black.seatToken, state: publicRoom(room) });
      }
    }
    if (!name) return ack && ack({ error: 'Name fehlt.' });
    // Take empty seat or become spectator
    let rating = null;
    if (socket.data.user && dbAvailable()) {
      try {
        const rows = await query('SELECT rating FROM users WHERE id = ?', [socket.data.user.id]);
        if (rows[0]) rating = rows[0].rating;
      } catch {}
    }
    let color = null;
    if (!room.white) { assignSeat(room, 'w', socket, name, rating); color = 'w'; }
    else if (!room.black) { assignSeat(room, 'b', socket, name, rating); color = 'b'; }
    else if (data && data.spectate) { addSpectator(room, socket, name); color = 'spectator'; }
    else { addSpectator(room, socket, name); color = 'spectator'; }
    socket.join(roomChannel(code));
    userIndex.set(socket.id, code);
    // Start game if both seats filled
    if (room.white && room.black && room.status === 'waiting') {
      room.status = 'active';
      room.clock.lastMoveAt = null;
      startClock(io, room);
    }
    if (typeof ack === 'function') {
      ack({
        ok: true,
        code,
        color,
        seatToken: color === 'w' ? room.white.seatToken : color === 'b' ? room.black.seatToken : null,
        state: publicRoom(room),
      });
    }
    emitRoomState(io, room);
  });

  socket.on('room:leave', () => leaveCurrentRoom(io, socket));

  socket.on('game:move', (data, ack) => {
    const room = getCurrentRoom(socket);
    if (!room) return ack && ack({ error: 'Kein Raum.' });
    if (room.status !== 'active') return ack && ack({ error: 'Spiel ist nicht aktiv.' });
    const seatInfo = seatBySocket(room, socket.id);
    if (!seatInfo) return ack && ack({ error: 'Du bist kein Spieler in diesem Raum.' });
    if (seatInfo.color !== room.chess.turn) return ack && ack({ error: 'Nicht dein Zug.' });
    const move = room.chess.move({ from: data.from, to: data.to, promotion: data.promotion });
    if (!move) return ack && ack({ error: 'Ungültiger Zug.' });
    room.moveList.push(move);
    applyClockAfterMove(room);
    room.lastActivity = Date.now();
    room.drawOffer = null;
    io.to(roomChannel(room.code)).emit('game:move', {
      move,
      fen: move.fen,
      clock: clockSnapshot(room),
      turn: room.chess.turn,
    });
    if (room.chess.isGameOver()) {
      const result = room.chess.result();
      const term = room.chess.terminationReason();
      return endGame(io, room, result, term);
    }
    if (typeof ack === 'function') ack({ ok: true, move });
    scheduleBotMoveIfNeeded(io, room);
  });

  socket.on('game:resign', () => {
    const room = getCurrentRoom(socket);
    if (!room || room.status !== 'active') return;
    const seatInfo = seatBySocket(room, socket.id);
    if (!seatInfo) return;
    const result = seatInfo.color === 'w' ? '0-1' : '1-0';
    endGame(io, room, result, 'resignation');
  });

  socket.on('game:draw_offer', () => {
    const room = getCurrentRoom(socket);
    if (!room || room.status !== 'active') return;
    const seatInfo = seatBySocket(room, socket.id);
    if (!seatInfo) return;
    room.drawOffer = { by: seatInfo.color };
    emitRoomState(io, room);
    // Bot decision: accept if losing by at least ~500 cp, otherwise decline.
    const opponent = seatInfo.color === 'w' ? room.black : room.white;
    if (opponent && opponent.bot) {
      const ev = ai.evaluate(room.chess);
      const fromBotPerspective = (seatInfo.color === 'w' ? -ev : ev);
      // fromBotPerspective is positive when bot is winning, negative when losing.
      if (fromBotPerspective <= -500) endGame(io, room, '1/2-1/2', 'draw_agreement');
      else { room.drawOffer = null; emitRoomState(io, room); }
    }
  });

  socket.on('game:draw_accept', () => {
    const room = getCurrentRoom(socket);
    if (!room || room.status !== 'active' || !room.drawOffer) return;
    const seatInfo = seatBySocket(room, socket.id);
    if (!seatInfo || seatInfo.color === room.drawOffer.by) return;
    endGame(io, room, '1/2-1/2', 'draw_agreement');
  });

  socket.on('game:draw_decline', () => {
    const room = getCurrentRoom(socket);
    if (!room || !room.drawOffer) return;
    room.drawOffer = null;
    emitRoomState(io, room);
  });

  socket.on('game:rematch_offer', () => {
    const room = getCurrentRoom(socket);
    if (!room || room.status !== 'finished') return;
    const seatInfo = seatBySocket(room, socket.id);
    if (!seatInfo) return;
    const opponent = seatInfo.color === 'w' ? room.black : room.white;
    if (opponent && opponent.bot) {
      // Bot opponent: rematch is immediate.
      return restartRoom(io, room);
    }
    if (room.rematchOffer && room.rematchOffer.by !== seatInfo.color) {
      restartRoom(io, room);
    } else {
      room.rematchOffer = { by: seatInfo.color };
      emitRoomState(io, room);
    }
  });

  socket.on('game:claim_timeout', () => {
    const room = getCurrentRoom(socket);
    if (!room || room.status !== 'active') return;
    const snap = clockSnapshot(room);
    if (!snap) return;
    if (snap.whiteMs <= 0) endGame(io, room, '0-1', 'timeout');
    else if (snap.blackMs <= 0) endGame(io, room, '1-0', 'timeout');
  });

  socket.on('chat:send', (data) => {
    const room = getCurrentRoom(socket);
    if (!room) return;
    const text = String((data && data.text) || '').trim().slice(0, 500);
    if (!text) return;
    const seatInfo = seatBySocket(room, socket.id);
    const speaker = seatInfo
      ? (seatInfo.color === 'w' ? room.white.name : room.black.name)
      : findSpectatorName(room, socket.id) || 'Gast';
    const msg = { name: speaker, text, at: Date.now(), color: seatInfo ? seatInfo.color : null };
    room.chat.push(msg);
    if (room.chat.length > 200) room.chat.shift();
    io.to(roomChannel(room.code)).emit('chat:message', msg);
  });

  socket.on('room:chat_history', (_d, ack) => {
    const room = getCurrentRoom(socket);
    if (!room) return ack && ack({ messages: [] });
    ack && ack({ messages: room.chat });
  });

  // --- Voice chat signaling ----------------------------------------------
  // The server is just a dumb relay between the two seats. It also tracks
  // each seat's voice-active flag so the second-to-activate side knows to
  // open the WebRTC offer.
  socket.on('voice:signal', (data) => {
    const room = getCurrentRoom(socket);
    if (!room) return;
    const seatInfo = seatBySocket(room, socket.id);
    if (!seatInfo) return;
    const opponent = seatInfo.color === 'w' ? room.black : room.white;
    if (!opponent || !opponent.socketId) return;
    io.to(opponent.socketId).emit('voice:signal', data);
  });

  socket.on('voice:state', (data) => {
    const room = getCurrentRoom(socket);
    if (!room) return;
    const seatInfo = seatBySocket(room, socket.id);
    if (!seatInfo) return;
    const mySeat = seatInfo.color === 'w' ? room.white : room.black;
    const otherSeat = seatInfo.color === 'w' ? room.black : room.white;
    const wasActive = Boolean(mySeat.voiceActive);
    mySeat.voiceActive = Boolean(data && data.active);
    emitRoomState(io, room);
    if (!wasActive && mySeat.voiceActive && otherSeat && otherSeat.voiceActive) {
      // Both sides active now. The side that just enabled becomes the offerer.
      socket.emit('voice:start', { role: 'offerer' });
      if (otherSeat.socketId) io.to(otherSeat.socketId).emit('voice:start', { role: 'answerer' });
    } else if (wasActive && !mySeat.voiceActive && otherSeat && otherSeat.socketId) {
      io.to(otherSeat.socketId).emit('voice:peer-left');
    }
  });

  /* Abort: either side can cancel within the first 2 plies (i.e. before
   * each color has made their second move) with no rating consequence and
   * without persisting a row to the games table. */
  socket.on('game:abort', (_d, ack) => {
    const room = getCurrentRoom(socket);
    if (!room || room.status !== 'active') return ack && ack({ error: 'Spiel nicht aktiv.' });
    const seatInfo = seatBySocket(room, socket.id);
    if (!seatInfo) return ack && ack({ error: 'Nicht Teilnehmer.' });
    if ((room.moveList || []).length >= 4) return ack && ack({ error: 'Abbruch nur in den ersten 2 Zügen möglich.' });
    endGame(io, room, '*', 'aborted');
    if (typeof ack === 'function') ack({ ok: true });
  });

  /* Claim a forfeit win when the opponent has been disconnected for 60s+.
   * Bots are always 'connected' so they can never be claim-forfeited. */
  socket.on('game:claim_disconnect', (_d, ack) => {
    const room = getCurrentRoom(socket);
    if (!room || room.status !== 'active') return ack && ack({ error: 'Spiel nicht aktiv.' });
    const seatInfo = seatBySocket(room, socket.id);
    if (!seatInfo) return ack && ack({ error: 'Nicht Teilnehmer.' });
    const opp = seatInfo.color === 'w' ? room.black : room.white;
    if (!opp || opp.bot || opp.connected) return ack && ack({ error: 'Gegner ist nicht offline.' });
    if (!opp.disconnectedAt || (Date.now() - opp.disconnectedAt) < 60_000) {
      return ack && ack({ error: 'Bitte 60 Sekunden warten.' });
    }
    const result = seatInfo.color === 'w' ? '1-0' : '0-1';
    endGame(io, room, result, 'disconnect_forfeit');
    if (typeof ack === 'function') ack({ ok: true });
  });

  // Explicit pause: only meaningful for bot games the user is logged into.
  // Snapshots room state to bot_sessions and tears down the in-memory room.
  socket.on('bot:pause', async (_data, ack) => {
    const room = getCurrentRoom(socket);
    if (!room) return ack && ack({ error: 'Kein Raum.' });
    if (room.status !== 'active') return ack && ack({ error: 'Spiel nicht aktiv.' });
    const seatInfo = seatBySocket(room, socket.id);
    if (!seatInfo) return ack && ack({ error: 'Nicht Teilnehmer.' });
    const mySeat = seatInfo.color === 'w' ? room.white : room.black;
    const opp    = seatInfo.color === 'w' ? room.black : room.white;
    if (!opp || !opp.bot) return ack && ack({ error: 'Nur Bot-Partien können pausiert werden.' });
    if (!mySeat.userId) return ack && ack({ error: 'Login erforderlich zum Pausieren.' });
    try {
      cancelPendingPause(room.code);
      await pauseBotRoom(room, seatInfo.color, mySeat.userId);
      userIndex.delete(socket.id);
      socket.leave(roomChannel(room.code));
      if (typeof ack === 'function') ack({ ok: true });
    } catch (err) {
      console.error('bot:pause failed', err);
      if (typeof ack === 'function') ack({ error: 'Speichern fehlgeschlagen.' });
    }
  });

  /* Friend challenge: sender creates a private room and emits an invite to
   * the target via their user:room. The recipient either accepts (server
   * pre-fills the second seat with their identity + a seatToken; both clients
   * navigate to the new game) or declines (room is destroyed, sender
   * notified). Token expires after 60s. */
  socket.on('friend:challenge', async (data, ack) => {
    if (!socket.data.user) return ack && ack({ error: 'Login erforderlich.' });
    if (!dbAvailable()) return ack && ack({ error: 'Datenbank nicht konfiguriert.' });
    const targetId = (data && data.friendId) | 0;
    if (!targetId) return ack && ack({ error: 'Ziel fehlt.' });
    try {
      // Verify the target is actually a confirmed friend.
      const friendCheck = await query(
        `SELECT 1 FROM friendships
          WHERE status = 'accepted'
            AND ((requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?))
          LIMIT 1`,
        [socket.data.user.id, targetId, targetId, socket.data.user.id]
      );
      if (!friendCheck.length) return ack && ack({ error: 'Nicht in deiner Freundesliste.' });
      if (!isUserOnline(targetId)) return ack && ack({ error: 'Freund ist gerade offline.' });
      const targetRows = await query('SELECT id, username, rating FROM users WHERE id = ?', [targetId]);
      if (!targetRows.length) return ack && ack({ error: 'Freund nicht gefunden.' });
      const myRows = await query('SELECT rating FROM users WHERE id = ?', [socket.data.user.id]);
      const myRating = myRows[0] ? myRows[0].rating : null;
      // Create the room with the sender's seat already filled.
      const shape = (data && data.shape) || 'standard';
      const tc = (data && data.timeControl) || { initial: 0, increment: 0 };
      const seat = (data && data.seat === 'b') ? 'b' : (data && data.seat === 'w') ? 'w' : 'random';
      const customSize = data && data.customSize;
      const room = createRoom({
        visibility: 'private', rated: false, timeControl: tc, shape, customSize,
        createdBy: socket.data.user.id,
      });
      const myColor = seat === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : seat;
      assignSeat(room, myColor, socket, socket.data.user.username, myRating);
      socket.join(roomChannel(room.code));
      userIndex.set(socket.id, room.code);

      const challengeToken = require('crypto').randomBytes(16).toString('hex');
      pendingChallenges.set(challengeToken, {
        fromUserId: socket.data.user.id,
        toUserId: targetId,
        roomCode: room.code,
        expiresAt: Date.now() + 60_000,
      });
      io.to('user:' + targetId).emit('friend:incoming_challenge', {
        challengeToken,
        from: { id: socket.data.user.id, username: socket.data.user.username, rating: myRating },
        shape: room.shape,
        shapeOpts: room.shapeOpts,
        timeControl: room.timeControl,
        yourColor: myColor === 'w' ? 'b' : 'w',
      });
      if (typeof ack === 'function') {
        ack({ ok: true, code: room.code, color: myColor,
              seatToken: myColor === 'w' ? room.white.seatToken : room.black.seatToken,
              challengeToken });
      }
    } catch (err) {
      console.error('friend:challenge failed', err);
      if (typeof ack === 'function') ack({ error: 'Herausforderung fehlgeschlagen.' });
    }
  });

  socket.on('friend:accept_challenge', async (data, ack) => {
    if (!socket.data.user) return ack && ack({ error: 'Login erforderlich.' });
    const token = data && data.challengeToken;
    const ch = pendingChallenges.get(token);
    if (!ch) return ack && ack({ error: 'Einladung abgelaufen.' });
    if (ch.toUserId !== socket.data.user.id) return ack && ack({ error: 'Nicht für dich.' });
    pendingChallenges.delete(token);
    const room = getRoom(ch.roomCode);
    if (!room) {
      io.to('user:' + ch.fromUserId).emit('friend:challenge_cancelled', { challengeToken: token, reason: 'Raum nicht mehr verfügbar.' });
      return ack && ack({ error: 'Raum nicht mehr verfügbar.' });
    }
    // Pre-fill the open seat for the acceptor with a fresh seatToken so they
    // can claim it via the normal room:join flow.
    const openColor = !room.white ? 'w' : !room.black ? 'b' : null;
    if (!openColor) return ack && ack({ error: 'Raum bereits voll.' });
    let myRating = null;
    try {
      const r = await query('SELECT rating FROM users WHERE id = ?', [socket.data.user.id]);
      myRating = r[0] ? r[0].rating : null;
    } catch {}
    const newSeatToken = require('crypto').randomBytes(16).toString('hex');
    const seat = {
      socketId: null,
      userId: socket.data.user.id,
      name: socket.data.user.username,
      rating: myRating,
      connected: false,
      seatToken: newSeatToken,
      bot: null,
    };
    if (openColor === 'w') room.white = seat; else room.black = seat;
    room.lastActivity = Date.now();
    // Tell the challenger their friend accepted.
    io.to('user:' + ch.fromUserId).emit('friend:challenge_accepted', { challengeToken: token, code: ch.roomCode });
    if (typeof ack === 'function') ack({ ok: true, code: ch.roomCode, color: openColor, seatToken: newSeatToken });
  });

  socket.on('friend:decline_challenge', (data, ack) => {
    const token = data && data.challengeToken;
    const ch = pendingChallenges.get(token);
    if (!ch) return ack && ack({ ok: true });
    if (socket.data.user && ch.toUserId !== socket.data.user.id) return ack && ack({ error: 'Nicht für dich.' });
    pendingChallenges.delete(token);
    // Tear down the empty room.
    const room = getRoom(ch.roomCode);
    if (room && (!room.black || !room.white)) deleteRoom(ch.roomCode);
    io.to('user:' + ch.fromUserId).emit('friend:challenge_declined', { challengeToken: token });
    if (typeof ack === 'function') ack({ ok: true });
  });

  socket.on('disconnect', () => {
    if (socket.data.user) {
      const wentOffline = setUserOffline(socket.data.user.id, socket.id);
      if (wentOffline) broadcastStatusToFriends(socket.data.user.id, false);
    }
    const code = userIndex.get(socket.id);
    userIndex.delete(socket.id);
    if (!code) return;
    const room = getRoom(code);
    if (!room) return;
    let droppedColor = null;
    let humanWasLoggedIn = null;
    const now = Date.now();
    if (room.white && room.white.socketId === socket.id) {
      room.white.connected = false;
      room.white.disconnectedAt = now;
      if (room.white.voiceActive) { room.white.voiceActive = false; droppedColor = 'w'; }
      if (room.white.userId) humanWasLoggedIn = { color: 'w', userId: room.white.userId };
    }
    if (room.black && room.black.socketId === socket.id) {
      room.black.connected = false;
      room.black.disconnectedAt = now;
      if (room.black.voiceActive) { room.black.voiceActive = false; droppedColor = 'b'; }
      if (room.black.userId) humanWasLoggedIn = { color: 'b', userId: room.black.userId };
    }
    room.spectators = room.spectators.filter((s) => s.socketId !== socket.id);
    room.lastActivity = Date.now();
    if (droppedColor) {
      const otherSeat = droppedColor === 'w' ? room.black : room.white;
      if (otherSeat && otherSeat.socketId) io.to(otherSeat.socketId).emit('voice:peer-left');
    }
    // Auto-pause: logged-in player drops out of an active bot game ->
    // schedule a snapshot, but give them a 30s window to reconnect first.
    // A quick reclaim via seatToken or userId cancels the timer.
    if (humanWasLoggedIn && room.status === 'active') {
      const oppSeat = humanWasLoggedIn.color === 'w' ? room.black : room.white;
      if (oppSeat && oppSeat.bot) {
        schedulePauseWithGrace(room, humanWasLoggedIn.color, humanWasLoggedIn.userId);
        emitRoomState(io, room);
        return;
      }
    }
    emitRoomState(io, room);
  });
}

function assignSeat(room, color, socket, name, rating) {
  const seat = {
    socketId: socket.id,
    userId: socket.data.user ? socket.data.user.id : null,
    name,
    rating,
    connected: true,
    disconnectedAt: null,
    seatToken: newSeatToken(),
  };
  if (color === 'w') room.white = seat;
  else room.black = seat;
  room.lastActivity = Date.now();
}

function addSpectator(room, socket, name) {
  room.spectators.push({ socketId: socket.id, name: name || 'Gast' });
  room.lastActivity = Date.now();
}

function tryReclaimSeat(room, seatToken, socket) {
  if (room.white && room.white.seatToken === seatToken) {
    room.white.socketId = socket.id;
    room.white.connected = true;
    room.white.disconnectedAt = null;
    room.lastActivity = Date.now();
    return 'w';
  }
  if (room.black && room.black.seatToken === seatToken) {
    room.black.socketId = socket.id;
    room.black.connected = true;
    room.black.disconnectedAt = null;
    room.lastActivity = Date.now();
    return 'b';
  }
  return null;
}

function sanitizeName(name, socket) {
  if (socket.data.user && socket.data.user.username) return socket.data.user.username;
  const trimmed = String(name || '').trim().slice(0, 32);
  if (!trimmed) return null;
  return trimmed.replace(/[<>"'`]/g, '');
}

function getCurrentRoom(socket) {
  const code = userIndex.get(socket.id);
  return code ? getRoom(code) : null;
}

function leaveCurrentRoom(io, socket) {
  const code = userIndex.get(socket.id);
  if (!code) return;
  const room = getRoom(code);
  userIndex.delete(socket.id);
  socket.leave(roomChannel(code));
  if (!room) return;
  if (room.white && room.white.socketId === socket.id) room.white = null;
  if (room.black && room.black.socketId === socket.id) room.black = null;
  room.spectators = room.spectators.filter((s) => s.socketId !== socket.id);
  if (!room.white && !room.black && room.spectators.length === 0) deleteRoom(room.code);
  else emitRoomState(io, room);
}

function findSpectatorName(room, socketId) {
  const s = room.spectators.find((x) => x.socketId === socketId);
  return s ? s.name : null;
}

function restartRoom(io, room) {
  const oldWhite = room.white;
  const oldBlack = room.black;
  // Reset chess + clocks
  const { Chess } = require('../shared/chess-engine');
  room.chess = new Chess({ shape: room.shapeArg });
  room.moveList = [];
  room.result = null;
  room.termination = null;
  room.drawOffer = null;
  room.rematchOffer = null;
  room.status = 'active';
  room.clock.whiteMs = room.timeControl.initial * 1000;
  room.clock.blackMs = room.timeControl.initial * 1000;
  room.clock.lastMoveAt = null;
  // Swap colors (bot seat carries through unchanged)
  room.white = oldBlack;
  room.black = oldWhite;
  startClock(io, room);
  emitRoomState(io, room);
  io.to(roomChannel(room.code)).emit('game:restart', publicRoom(room));
  scheduleBotMoveIfNeeded(io, room);
}

/* Snapshot the room to bot_sessions and remove it from memory. Used by the
 * explicit bot:pause event and by the disconnect auto-save path. */
/* Pending auto-pauses awaiting a 30s grace period before they fire.
 * Keyed by room code so a quick reconnect can cancel the timer cleanly.
 * Without this, a brief network blip would auto-pause + delete the room
 * before the client's socket reconnect cycle finishes - the user then
 * comes back to a 'Raum nicht gefunden' error. */
const AUTO_PAUSE_GRACE_MS = 30_000;
const pendingPauses = new Map(); // roomCode -> { timer, color, userId }

function schedulePauseWithGrace(room, userColor, userId) {
  if (pendingPauses.has(room.code)) return;
  const timer = setTimeout(() => {
    pendingPauses.delete(room.code);
    const r = rooms.get(room.code);
    if (!r || r.status !== 'active') return;
    const target = userColor === 'w' ? r.white : r.black;
    // User came back during grace - target is reclaimed and online again.
    if (!target || target.connected) return;
    pauseBotRoom(r, userColor, userId).catch((err) => {
      console.error('auto-pause after grace failed:', err.message);
    });
  }, AUTO_PAUSE_GRACE_MS);
  pendingPauses.set(room.code, { timer, color: userColor, userId });
}

function cancelPendingPause(roomCode) {
  const p = pendingPauses.get(roomCode);
  if (!p) return;
  clearTimeout(p.timer);
  pendingPauses.delete(roomCode);
}

async function pauseBotRoom(room, userColor, userId) {
  if (!dbAvailable()) throw new Error('DB not configured');
  if (!room || room.status !== 'active') return;
  // Capture current ticking-clock values BEFORE we stop the timer.
  const snap = clockSnapshot(room) || { whiteMs: 0, blackMs: 0 };
  // Block any in-flight setImmediate bot moves from landing post-pause.
  room.status = 'paused';
  stopClock(room);
  const opp = userColor === 'w' ? room.black : room.white;
  const shapeOptsJson = room.shapeOpts ? JSON.stringify(room.shapeOpts) : null;
  await query(
    `INSERT INTO bot_sessions
       (user_id, user_color, bot_difficulty, shape, shape_opts,
        time_initial, time_increment, clock_white_ms, clock_black_ms,
        fen, moves_json)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [userId, userColor, opp.bot.difficulty,
     room.shape || 'standard', shapeOptsJson,
     room.timeControl.initial | 0, room.timeControl.increment | 0,
     snap.whiteMs | 0, snap.blackMs | 0,
     room.chess.fen(), JSON.stringify(room.moveList || [])]
  );
  deleteRoom(room.code);
}

/* Called from index.js on SIGTERM/SIGINT: best-effort save of every live
 * bot game so a graceful Plesk restart doesn't drop matches. */
async function saveAllBotSessions() {
  if (!dbAvailable()) return;
  const work = [];
  for (const room of rooms.values()) {
    if (!room || room.status !== 'active') continue;
    const w = room.white, b = room.black;
    if (!w || !b) continue;
    const human = w.bot ? b : (b.bot ? w : null);
    const bot   = w.bot ? w : (b.bot ? b : null);
    if (!human || !bot || !human.userId) continue;
    const userColor = human === w ? 'w' : 'b';
    // Cancel any pending grace timer so the shutdown save isn't a no-op.
    cancelPendingPause(room.code);
    work.push(pauseBotRoom(room, userColor, human.userId).catch((err) => {
      console.error('shutdown save failed for ' + room.code, err.message);
    }));
  }
  await Promise.all(work);
}

module.exports = { registerHandlers, saveAllBotSessions, isUserOnline };
