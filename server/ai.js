'use strict';
/* Simple chess AI: iterative-deepening minimax with alpha-beta pruning,
 * a lightweight material+mobility evaluation, and a small opening book
 * for standard 8x8 games. Works on any shape supported by the engine.
 * Lower difficulties make occasional blunders and pick noisier moves.
 */

const book = require('./opening-book');

const PIECE_VALUE = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

// Difficulty -> { maxDepth, timeBudgetMs, noise, blunderProb }.
//   noise:       max cp delta from best for the random pick among "good enough" moves.
//   blunderProb: chance to ignore search results and play a random legal move instead.
// Lower difficulties have looser noise and a higher blunder rate. The opening
// book is always consulted first regardless of difficulty.
const DIFFICULTY = {
  easy:   { maxDepth: 2, timeBudgetMs: 300,  noise: 120, blunderProb: 0.20 },
  medium: { maxDepth: 3, timeBudgetMs: 1000, noise: 30,  blunderProb: 0.05 },
  hard:   { maxDepth: 4, timeBudgetMs: 2500, noise: 5,   blunderProb: 0 },
};

const MATE_SCORE = 1000000;

function pieceMaterial(chess) {
  let score = 0;
  for (let r = 0; r < chess.shape.height; r++) {
    for (let f = 0; f < chess.shape.width; f++) {
      const p = chess.board[r][f];
      if (!p) continue;
      const v = PIECE_VALUE[p.type];
      score += p.color === 'w' ? v : -v;
    }
  }
  return score;
}

function evaluate(chess) {
  if (chess.inCheckmate()) {
    // Side to move is mated -> losing.
    return chess.turn === 'w' ? -MATE_SCORE : MATE_SCORE;
  }
  if (chess.inStalemate() || chess.insufficientMaterial()
      || chess.threefoldRepetition() || chess.fiftyMoveRule()) {
    return 0;
  }
  let score = pieceMaterial(chess);
  // Mobility tiebreaker - small weight, shape-agnostic.
  const myMoves = chess.generateLegalMoves().length;
  const wasTurn = chess.turn;
  chess.turn = wasTurn === 'w' ? 'b' : 'w';
  const oppMoves = chess.generateLegalMoves().length;
  chess.turn = wasTurn;
  const mobility = wasTurn === 'w' ? (myMoves - oppMoves) : (oppMoves - myMoves);
  score += mobility * 3;
  return score;
}

function orderMoves(moves) {
  // MVV-LVA-ish: captures first, with bigger captures first.
  return moves.slice().sort((a, b) => {
    const av = (a.captured ? PIECE_VALUE[a.captured] : 0) - (a.promotion ? 800 : 0);
    const bv = (b.captured ? PIECE_VALUE[b.captured] : 0) - (b.promotion ? 800 : 0);
    return bv - av;
  });
}

function search(chess, depth, alpha, beta, deadline) {
  if (Date.now() > deadline) return { score: evaluate(chess), move: null, aborted: true };
  if (depth === 0 || chess.isGameOver()) return { score: evaluate(chess), move: null };
  const moves = orderMoves(chess.generateLegalMoves());
  if (moves.length === 0) return { score: evaluate(chess), move: null };
  let best = null;
  if (chess.turn === 'w') {
    let max = -Infinity;
    for (const m of moves) {
      chess._make(m);
      const { score, aborted } = search(chess, depth - 1, alpha, beta, deadline);
      chess._unmake();
      if (aborted) return { score: max === -Infinity ? evaluate(chess) : max, move: best, aborted: true };
      if (score > max) { max = score; best = m; }
      alpha = Math.max(alpha, score);
      if (beta <= alpha) break;
    }
    return { score: max, move: best };
  } else {
    let min = Infinity;
    for (const m of moves) {
      chess._make(m);
      const { score, aborted } = search(chess, depth - 1, alpha, beta, deadline);
      chess._unmake();
      if (aborted) return { score: min === Infinity ? evaluate(chess) : min, move: best, aborted: true };
      if (score < min) { min = score; best = m; }
      beta = Math.min(beta, score);
      if (beta <= alpha) break;
    }
    return { score: min, move: best };
  }
}

// Pick a move using iterative deepening up to the configured depth/time.
function chooseMove(chess, difficulty) {
  const cfg = DIFFICULTY[difficulty] || DIFFICULTY.medium;

  // 1. Opening book: same lines for every difficulty - knowing the openings
  // is a knowledge thing, not a strength thing. Random pick among the
  // book's options at this position gives variety between games.
  const bookMoves = book.lookup(chess);
  if (bookMoves && bookMoves.length) {
    const pick = bookMoves[Math.floor(Math.random() * bookMoves.length)];
    return { from: pick.from, to: pick.to, promotion: pick.promotion || undefined };
  }

  const legal = chess.generateLegalMoves();
  if (legal.length === 0) return null;

  // 2. Random blunder: lower difficulties sometimes throw the search away
  // entirely and play a random legal move. This is the main source of
  // beginner-style mistakes.
  if (cfg.blunderProb > 0 && Math.random() < cfg.blunderProb) {
    const m = legal[Math.floor(Math.random() * legal.length)];
    return toWire(m);
  }

  // 3. Iterative-deepening alpha-beta search.
  const deadline = Date.now() + cfg.timeBudgetMs;
  let bestMove = legal[Math.floor(Math.random() * legal.length)];
  let bestScore = chess.turn === 'w' ? -Infinity : Infinity;

  for (let depth = 1; depth <= cfg.maxDepth; depth++) {
    const result = search(chess, depth, -Infinity, Infinity, deadline);
    if (result.move) {
      bestMove = result.move;
      bestScore = result.score;
    }
    if (result.aborted) break;
    if (Math.abs(result.score) > MATE_SCORE / 2) break; // forced mate found
  }

  // 4. Noise: among moves within `noise` cp of the best, pick one at random.
  // Easy uses a wide window so the bot routinely plays second-best moves.
  if (cfg.noise > 0) {
    const candidates = [];
    for (const m of legal) {
      chess._make(m);
      const score = -negamaxLite(chess, 1, -Infinity, Infinity, chess.turn === 'w' ? 1 : -1);
      chess._unmake();
      candidates.push({ m, score: chess.turn === 'w' ? score : -score });
    }
    const target = chess.turn === 'w' ? Math.max(...candidates.map((c) => c.score))
                                      : Math.min(...candidates.map((c) => c.score));
    const within = candidates.filter((c) => Math.abs(c.score - target) <= cfg.noise);
    if (within.length > 1) bestMove = within[Math.floor(Math.random() * within.length)].m;
  }

  return toWire(bestMove);
}

function toWire(m) {
  return {
    from: window_sqToAlg(m.from[0], m.from[1]),
    to:   window_sqToAlg(m.to[0],   m.to[1]),
    promotion: m.promotion || undefined,
  };
}

// Shallow eval for noise comparison.
function negamaxLite(chess, depth, alpha, beta, sign) {
  if (depth === 0 || chess.isGameOver()) return sign * evaluate(chess);
  let max = -Infinity;
  for (const m of chess.generateLegalMoves()) {
    chess._make(m);
    const v = -negamaxLite(chess, depth - 1, -beta, -alpha, -sign);
    chess._unmake();
    if (v > max) max = v;
    if (v > alpha) alpha = v;
    if (alpha >= beta) break;
  }
  return max === -Infinity ? sign * evaluate(chess) : max;
}

function window_sqToAlg(f, r) { return 'abcdefghijklmnopqrstuvwxyz'[f] + (r + 1); }

module.exports = { chooseMove, evaluate, DIFFICULTY };
