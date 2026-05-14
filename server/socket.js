'use strict';

const crypto = require('crypto');
const { verifyToken } = require('./auth');
const { query, dbAvailable } = require('./db');
const { computeRatings } = require('./rating');
const {
  rooms, userIndex, createRoom, getRoom, deleteRoom,
  listPublicLobbies, publicRoom, clockSnapshot,
} = require('./rooms');

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
    await query(
      `INSERT INTO games
        (room_code, white_user_id, black_user_id, white_name, black_name,
         time_initial, time_increment, rated, result, termination, pgn, final_fen,
         white_rating_before, black_rating_before, white_rating_after, black_rating_after,
         finished_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW())`,
      [room.code, wUser, bUser, room.white.name, room.black.name,
       room.timeControl.initial, room.timeControl.increment, room.rated ? 1 : 0,
       room.result, room.termination, pgn, room.chess.fen(),
       whiteBefore, blackBefore, whiteAfter, blackAfter]
    );
  } catch (err) {
    console.error('Failed to persist game', err);
  }
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

function registerHandlers(io, socket) {
  // identity is resolved on first auth message
  socket.data.user = null;

  socket.on('auth', (data, ack) => {
    if (data && data.token) {
      const payload = verifyToken(data.token);
      if (payload) {
        socket.data.user = { id: payload.sub, username: payload.username };
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
    let rating = null;
    if (socket.data.user && dbAvailable()) {
      try {
        const rows = await query('SELECT rating FROM users WHERE id = ?', [socket.data.user.id]);
        if (rows[0]) rating = rows[0].rating;
      } catch {}
    }
    const room = createRoom({
      visibility, rated, timeControl: tc, createdBy: socket.data.user ? socket.data.user.id : null,
    });
    const chosen = seat === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : seat;
    assignSeat(room, chosen, socket, name, rating);
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
        emitRoomState(io, room);
        return ack && ack({ ok: true, code, color: reclaim, seatToken: data.seatToken, state: publicRoom(room) });
      }
    }
    // Reconnect via account?
    if (socket.data.user) {
      if (room.white && room.white.userId === socket.data.user.id) {
        room.white.socketId = socket.id;
        room.white.connected = true;
        room.lastActivity = Date.now();
        socket.join(roomChannel(code));
        userIndex.set(socket.id, code);
        emitRoomState(io, room);
        return ack && ack({ ok: true, code, color: 'w', seatToken: room.white.seatToken, state: publicRoom(room) });
      }
      if (room.black && room.black.userId === socket.data.user.id) {
        room.black.socketId = socket.id;
        room.black.connected = true;
        room.lastActivity = Date.now();
        socket.join(roomChannel(code));
        userIndex.set(socket.id, code);
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
    if (room.rematchOffer && room.rematchOffer.by !== seatInfo.color) {
      // Both accepted -> start fresh game with swapped colors
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

  socket.on('disconnect', () => {
    const code = userIndex.get(socket.id);
    userIndex.delete(socket.id);
    if (!code) return;
    const room = getRoom(code);
    if (!room) return;
    if (room.white && room.white.socketId === socket.id) room.white.connected = false;
    if (room.black && room.black.socketId === socket.id) room.black.connected = false;
    room.spectators = room.spectators.filter((s) => s.socketId !== socket.id);
    room.lastActivity = Date.now();
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
    room.lastActivity = Date.now();
    return 'w';
  }
  if (room.black && room.black.seatToken === seatToken) {
    room.black.socketId = socket.id;
    room.black.connected = true;
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
  room.chess = new Chess();
  room.moveList = [];
  room.result = null;
  room.termination = null;
  room.drawOffer = null;
  room.rematchOffer = null;
  room.status = 'active';
  room.clock.whiteMs = room.timeControl.initial * 1000;
  room.clock.blackMs = room.timeControl.initial * 1000;
  room.clock.lastMoveAt = null;
  // Swap colors
  room.white = oldBlack;
  room.black = oldWhite;
  startClock(io, room);
  emitRoomState(io, room);
  io.to(roomChannel(room.code)).emit('game:restart', publicRoom(room));
}

module.exports = { registerHandlers };
