'use strict';
/* Opening book covering the most common chess openings. Built at module load
 * by replaying SAN sequences on a standard 8x8 engine and keying the resulting
 * positions to the moves that follow. Only applies to standard chess - on
 * custom-sized boards the openings don't transfer and the AI falls back to
 * its regular search.
 */

const { Chess } = require('../shared/chess-engine');

const OPENINGS = [
  // 1.e4 e5 - Open games
  ['e4','e5','Nf3','Nc6','Bb5','a6','Ba4','Nf6','O-O','Be7','Re1','b5','Bb3','d6'], // Ruy Lopez closed
  ['e4','e5','Nf3','Nc6','Bb5','a6','Ba4','Nf6','O-O','Nxe4'], // Berlin/Open
  ['e4','e5','Nf3','Nc6','Bb5','Nf6','O-O','Nxe4'], // Berlin defense
  ['e4','e5','Nf3','Nc6','Bb5','Bc5'], // Classical Berlin
  ['e4','e5','Nf3','Nc6','Bc4','Bc5','c3','Nf6','d4'], // Italian/Giuoco
  ['e4','e5','Nf3','Nc6','Bc4','Bc5','d3','Nf6','c3','d6'], // Giuoco Pianissimo
  ['e4','e5','Nf3','Nc6','Bc4','Nf6'], // Two Knights
  ['e4','e5','Nf3','Nc6','Bc4','Nf6','Ng5','d5','exd5','Na5'], // Two Knights main
  ['e4','e5','Nf3','Nc6','d4','exd4','Nxd4'], // Scotch
  ['e4','e5','Nf3','Nf6','Nxe5','d6','Nf3','Nxe4'], // Petroff
  ['e4','e5','Nc3','Nf6'], // Vienna
  ['e4','e5','f4'], // King's Gambit

  // 1.e4 - Half-open games
  ['e4','c5','Nf3','d6','d4','cxd4','Nxd4','Nf6','Nc3','a6'], // Najdorf
  ['e4','c5','Nf3','d6','d4','cxd4','Nxd4','Nf6','Nc3','g6'], // Dragon
  ['e4','c5','Nf3','Nc6','d4','cxd4','Nxd4','g6'], // Accelerated Dragon
  ['e4','c5','Nf3','Nc6','d4','cxd4','Nxd4','Nf6','Nc3','e5'], // Sveshnikov
  ['e4','c5','Nf3','e6','d4','cxd4','Nxd4','Nc6'], // Taimanov
  ['e4','c5','Nc3','Nc6','g3'], // Closed Sicilian
  ['e4','c5','Nf3','e6','d4','cxd4','Nxd4','a6'], // Kan
  ['e4','c5','c3'], // Alapin
  ['e4','c6','d4','d5','Nc3','dxe4','Nxe4','Bf5'], // Caro-Kann classical
  ['e4','c6','d4','d5','e5','Bf5'], // Caro-Kann advance
  ['e4','c6','d4','d5','exd5','cxd5'], // Caro-Kann exchange
  ['e4','e6','d4','d5','Nc3','Nf6'], // French classical
  ['e4','e6','d4','d5','Nc3','Bb4'], // French Winawer
  ['e4','e6','d4','d5','e5','c5'], // French advance
  ['e4','e6','d4','d5','exd5','exd5'], // French exchange
  ['e4','d5','exd5','Qxd5','Nc3','Qa5'], // Scandinavian
  ['e4','d5','exd5','Nf6'], // Scandinavian Marshall
  ['e4','Nf6','e5','Nd5','d4','d6','Nf3'], // Alekhine
  ['e4','d6','d4','Nf6','Nc3','g6'], // Pirc
  ['e4','g6','d4','Bg7'], // Modern

  // 1.d4 - Queen pawn
  ['d4','d5','c4','e6','Nc3','Nf6','Bg5'], // QGD Classical
  ['d4','d5','c4','e6','Nc3','Nf6','Bg5','Be7','e3','O-O'], // QGD
  ['d4','d5','c4','c6','Nf3','Nf6','Nc3','dxc4'], // Slav
  ['d4','d5','c4','c6','Nc3','Nf6','Nf3','e6'], // Semi-Slav
  ['d4','d5','c4','dxc4','Nf3','Nf6','e3'], // QGA
  ['d4','d5','c4','e6','Nc3','c5'], // Tarrasch
  ['d4','Nf6','c4','e6','Nc3','Bb4'], // Nimzo-Indian
  ['d4','Nf6','c4','e6','Nf3','b6'], // Queen's Indian
  ['d4','Nf6','c4','g6','Nc3','Bg7','e4','d6','Nf3','O-O'], // KID main
  ['d4','Nf6','c4','g6','Nc3','d5'], // Grunfeld
  ['d4','Nf6','c4','c5','d5','b5'], // Benko/Volga
  ['d4','Nf6','c4','c5','d5','e6'], // Benoni
  ['d4','Nf6','c4','e5'], // Budapest
  ['d4','f5'], // Dutch
  ['d4','f5','g3','Nf6','Bg2','g6','Nf3','Bg7'], // Leningrad Dutch

  // English / Reti / Flank
  ['c4','e5','Nc3','Nf6'], // English
  ['c4','c5','Nc3','Nc6'], // Symmetric English
  ['c4','Nf6','Nc3','g6'], // Anglo-Indian
  ['c4','e6','Nc3','Nf6','Nf3','d5'], // English transposing to QGD
  ['Nf3','d5','c4'], // Reti
  ['Nf3','Nf6','c4','g6'], // Reti vs KID setup
  ['Nf3','d5','g3'], // King's Indian Attack
  ['b3'], // Larsen
  ['g3'], // King's Fianchetto
];

const book = new Map();

function key(chess) {
  return chess.positionKey ? chess.positionKey() : chess._positionKey();
}

(function buildBook() {
  for (const sequence of OPENINGS) {
    const chess = new Chess();
    for (const san of sequence) {
      const k = key(chess);
      const move = chess.move(san);
      if (!move) break;
      const entry = book.get(k) || [];
      const exists = entry.some((m) =>
        m.from === move.from && m.to === move.to && m.promotion === (move.promotion || null)
      );
      if (!exists) {
        entry.push({ from: move.from, to: move.to, promotion: move.promotion || null });
        book.set(k, entry);
      }
    }
  }
})();

function lookup(chess) {
  if (chess.shapeName !== 'standard') return null;
  const moves = book.get(key(chess));
  if (!moves || !moves.length) return null;
  // Return a fresh shallow copy so callers don't mutate the book.
  return moves.slice();
}

module.exports = { lookup, size: () => book.size };
