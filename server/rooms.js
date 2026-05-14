'use strict';

const { Chess, SHAPES } = require('../shared/chess-engine');

const VALID_SHAPES = [...Object.keys(SHAPES), 'custom'];

function normalizeShape(shape, customSize) {
  if (shape === 'custom') {
    const w = Math.max(8, Math.min(26, (customSize && customSize.width)  | 0 || 8));
    const h = Math.max(4, Math.min(20, (customSize && customSize.height) | 0 || 8));
    return { engineArg: { kind: 'custom', width: w, height: h }, name: 'custom', opts: { width: w, height: h } };
  }
  if (!VALID_SHAPES.includes(shape) || shape === 'custom') {
    return { engineArg: 'standard', name: 'standard', opts: null };
  }
  return { engineArg: shape, name: shape, opts: null };
}

const rooms = new Map();   // code -> room
const userIndex = new Map(); // socketId -> code

const ROOM_TTL_MS = 1000 * 60 * 60 * 6; // 6h idle = garbage collect

function makeCode() {
  const alpha = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = '';
    for (let i = 0; i < 5; i++) code += alpha[Math.floor(Math.random() * alpha.length)];
  } while (rooms.has(code));
  return code;
}

function publicRoom(room) {
  return {
    code: room.code,
    visibility: room.visibility,
    timeControl: room.timeControl,
    rated: room.rated,
    shape: room.shape,
    shapeOpts: room.shapeOpts,
    status: room.status,
    white: room.white ? publicSeat(room.white) : null,
    black: room.black ? publicSeat(room.black) : null,
    spectators: room.spectators.length,
    fen: room.chess.fen(),
    turn: room.chess.turn,
    moves: room.moveList,
    clock: clockSnapshot(room),
    drawOffer: room.drawOffer,
    rematchOffer: room.rematchOffer,
    result: room.result,
    termination: room.termination,
    createdBy: room.createdBy,
  };
}

function publicSeat(seat) {
  return {
    name: seat.name,
    userId: seat.userId || null,
    rating: seat.rating || null,
    connected: seat.connected,
    bot: seat.bot ? { difficulty: seat.bot.difficulty } : null,
  };
}

function clockSnapshot(room) {
  if (!room.timeControl.initial) return null;
  let whiteMs = room.clock.whiteMs;
  let blackMs = room.clock.blackMs;
  if (room.status === 'active' && room.clock.lastMoveAt) {
    const elapsed = Date.now() - room.clock.lastMoveAt;
    if (room.chess.turn === 'w') whiteMs = Math.max(0, whiteMs - elapsed);
    else blackMs = Math.max(0, blackMs - elapsed);
  }
  return { whiteMs, blackMs, running: room.status === 'active', lastMoveAt: room.clock.lastMoveAt };
}

function createBotSeat(difficulty) {
  const labels = { easy: 'Computer (leicht)', medium: 'Computer (mittel)', hard: 'Computer (schwer)' };
  return {
    socketId: null,
    userId: null,
    name: labels[difficulty] || 'Computer',
    rating: null,
    connected: true,
    seatToken: null,
    bot: { difficulty },
  };
}

function createRoom(opts) {
  const code = makeCode();
  const tc = opts.timeControl || { initial: 0, increment: 0 };
  const norm = normalizeShape(opts.shape, opts.customSize);
  // Only standard 8x8 counts toward Elo - alternative shapes and bot games are
  // unrated.
  const rated = Boolean(opts.rated) && norm.name === 'standard' && !opts.botColor;
  const room = {
    code,
    visibility: opts.visibility === 'public' ? 'public' : 'private',
    timeControl: { initial: Math.max(0, tc.initial | 0), increment: Math.max(0, tc.increment | 0) },
    rated,
    shape: norm.name,
    shapeOpts: norm.opts,
    shapeArg: norm.engineArg,
    status: 'waiting',
    white: null,
    black: null,
    spectators: [],
    chess: new Chess({ shape: norm.engineArg }),
    moveList: [],
    chat: [],
    clock: {
      whiteMs: (tc.initial | 0) * 1000,
      blackMs: (tc.initial | 0) * 1000,
      lastMoveAt: null,
      timerHandle: null,
    },
    drawOffer: null,
    rematchOffer: null,
    result: null,
    termination: null,
    createdAt: Date.now(),
    lastActivity: Date.now(),
    createdBy: opts.createdBy || null,
  };
  rooms.set(code, room);
  return room;
}

function getRoom(code) { return rooms.get((code || '').toUpperCase()); }

function deleteRoom(code) {
  const room = rooms.get(code);
  if (!room) return;
  if (room.clock.timerHandle) clearInterval(room.clock.timerHandle);
  rooms.delete(code);
}

function listPublicLobbies() {
  const out = [];
  for (const room of rooms.values()) {
    if (room.visibility !== 'public') continue;
    if (room.status !== 'waiting') continue;
    out.push({
      code: room.code,
      timeControl: room.timeControl,
      rated: room.rated,
      shape: room.shape,
      shapeOpts: room.shapeOpts,
      host: room.white ? room.white.name : (room.black ? room.black.name : '?'),
      hostRating: room.white ? room.white.rating : (room.black ? room.black.rating : null),
      createdAt: room.createdAt,
    });
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

function gcRooms() {
  const now = Date.now();
  for (const room of [...rooms.values()]) {
    const idle = now - room.lastActivity;
    const occupied = (room.white && room.white.connected) || (room.black && room.black.connected) || room.spectators.length;
    if (!occupied && idle > 1000 * 60 * 30) deleteRoom(room.code); // 30 min empty
    else if (idle > ROOM_TTL_MS) deleteRoom(room.code);
  }
}

setInterval(gcRooms, 1000 * 60 * 5);

module.exports = {
  rooms,
  userIndex,
  createRoom,
  createBotSeat,
  getRoom,
  deleteRoom,
  listPublicLobbies,
  publicRoom,
  clockSnapshot,
};
