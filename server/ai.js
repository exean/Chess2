'use strict';
/* Simple chess AI: iterative-deepening minimax with alpha-beta pruning
 * and a lightweight material+mobility evaluation. Works on any of the
 * shapes supported by ../shared/chess-engine.js (the move generator and
 * legality rules are reused as-is, so no board-size assumptions leak in).
 */

const PIECE_VALUE = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

// Difficulty -> { maxDepth, timeBudgetMs, noise }.
// `noise` adds a tiny random tiebreaker so the lowest difficulty doesn't
// always play identically from the starting position.
const DIFFICULTY = {
  easy:   { maxDepth: 2, timeBudgetMs: 300,  noise: 40 },
  medium: { maxDepth: 3, timeBudgetMs: 1000, noise: 8  },
  hard:   { maxDepth: 4, timeBudgetMs: 2500, noise: 0  },
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
  const deadline = Date.now() + cfg.timeBudgetMs;
  const legal = chess.generateLegalMoves();
  if (legal.length === 0) return null;

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

  // Optional noise: among moves whose score is within `noise` of the best,
  // pick one at random.
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

  return {
    from: window_sqToAlg(bestMove.from[0], bestMove.from[1]),
    to:   window_sqToAlg(bestMove.to[0],   bestMove.to[1]),
    promotion: bestMove.promotion || undefined,
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
