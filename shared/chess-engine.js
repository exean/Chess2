'use strict';
/* Chess engine: rules, move generation, FEN, SAN, PGN.
   Works in Node (CommonJS) and the browser (window.Chess). */
(function (root, factory) {
  const mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else root.ChessEngine = mod;
}(typeof self !== 'undefined' ? self : this, function () {

  const W = 'w', B = 'b';
  const PIECE_ORDER = ['p', 'n', 'b', 'r', 'q', 'k'];
  const PIECE_VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

  const DIRS = {
    n: [[1,2],[2,1],[2,-1],[1,-2],[-1,-2],[-2,-1],[-2,1],[-1,2]],
    k: [[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1],[0,-1],[1,-1]],
    b: [[1,1],[1,-1],[-1,1],[-1,-1]],
    r: [[1,0],[-1,0],[0,1],[0,-1]],
    q: [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]],
  };

  function inBounds(f, r) { return f >= 0 && f < 8 && r >= 0 && r < 8; }
  function sqToAlg(f, r) { return 'abcdefgh'[f] + (r + 1); }
  function algToSq(a) {
    const f = a.charCodeAt(0) - 97;
    const r = parseInt(a[1], 10) - 1;
    return [f, r];
  }
  function otherColor(c) { return c === W ? B : W; }

  class Chess {
    constructor(fen) {
      this.reset();
      this.load(fen || 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    }

    reset() {
      this.board = Array.from({ length: 8 }, () => Array(8).fill(null));
      this.turn = W;
      this.castling = { w: { k: false, q: false }, b: { k: false, q: false } };
      this.ep = null;
      this.halfmove = 0;
      this.fullmove = 1;
      this.history = [];
      this.posCount = Object.create(null);
    }

    clone() {
      const c = new Chess(this.fen());
      c.history = this.history.slice();
      c.posCount = Object.assign(Object.create(null), this.posCount);
      return c;
    }

    load(fen) {
      this.reset();
      const parts = fen.trim().split(/\s+/);
      if (parts.length < 4) throw new Error('Invalid FEN');
      const [pos, turn, castle, ep, half, full] = parts;
      const rows = pos.split('/');
      if (rows.length !== 8) throw new Error('Invalid FEN board');
      for (let i = 0; i < 8; i++) {
        const rank = 7 - i;
        let file = 0;
        for (const ch of rows[i]) {
          if (/\d/.test(ch)) { file += parseInt(ch, 10); continue; }
          const color = ch === ch.toUpperCase() ? W : B;
          const type = ch.toLowerCase();
          this.board[rank][file] = { type, color };
          file++;
        }
      }
      this.turn = turn === 'b' ? B : W;
      this.castling.w.k = castle.includes('K');
      this.castling.w.q = castle.includes('Q');
      this.castling.b.k = castle.includes('k');
      this.castling.b.q = castle.includes('q');
      this.ep = ep && ep !== '-' ? algToSq(ep) : null;
      this.halfmove = parseInt(half || '0', 10);
      this.fullmove = parseInt(full || '1', 10);
      this._recordPosition();
    }

    fen() {
      const rows = [];
      for (let r = 7; r >= 0; r--) {
        let row = '', empty = 0;
        for (let f = 0; f < 8; f++) {
          const p = this.board[r][f];
          if (!p) { empty++; continue; }
          if (empty) { row += empty; empty = 0; }
          row += p.color === W ? p.type.toUpperCase() : p.type;
        }
        if (empty) row += empty;
        rows.push(row);
      }
      let c = '';
      if (this.castling.w.k) c += 'K';
      if (this.castling.w.q) c += 'Q';
      if (this.castling.b.k) c += 'k';
      if (this.castling.b.q) c += 'q';
      if (!c) c = '-';
      const ep = this.ep ? sqToAlg(this.ep[0], this.ep[1]) : '-';
      return `${rows.join('/')} ${this.turn} ${c} ${ep} ${this.halfmove} ${this.fullmove}`;
    }

    _positionKey() {
      const f = this.fen().split(' ');
      return `${f[0]} ${f[1]} ${f[2]} ${f[3]}`;
    }

    _recordPosition() {
      const k = this._positionKey();
      this.posCount[k] = (this.posCount[k] || 0) + 1;
    }

    _unrecordPosition() {
      const k = this._positionKey();
      this.posCount[k]--;
      if (this.posCount[k] <= 0) delete this.posCount[k];
    }

    pieceAt(squareOrFile, rank) {
      if (typeof squareOrFile === 'string') {
        const [f, r] = algToSq(squareOrFile);
        return this.board[r][f];
      }
      return this.board[rank][squareOrFile];
    }

    findKing(color) {
      for (let r = 0; r < 8; r++)
        for (let f = 0; f < 8; f++) {
          const p = this.board[r][f];
          if (p && p.type === 'k' && p.color === color) return [f, r];
        }
      return null;
    }

    isSquareAttacked(file, rank, byColor) {
      // Pawn attacks
      const dir = byColor === W ? 1 : -1;
      for (const df of [-1, 1]) {
        const f = file - df, r = rank - dir;
        if (inBounds(f, r)) {
          const p = this.board[r][f];
          if (p && p.color === byColor && p.type === 'p') return true;
        }
      }
      // Knight
      for (const [df, dr] of DIRS.n) {
        const f = file + df, r = rank + dr;
        if (inBounds(f, r)) {
          const p = this.board[r][f];
          if (p && p.color === byColor && p.type === 'n') return true;
        }
      }
      // King
      for (const [df, dr] of DIRS.k) {
        const f = file + df, r = rank + dr;
        if (inBounds(f, r)) {
          const p = this.board[r][f];
          if (p && p.color === byColor && p.type === 'k') return true;
        }
      }
      // Sliders
      const sliders = [
        { dirs: DIRS.r, types: ['r', 'q'] },
        { dirs: DIRS.b, types: ['b', 'q'] },
      ];
      for (const s of sliders) {
        for (const [df, dr] of s.dirs) {
          let f = file + df, r = rank + dr;
          while (inBounds(f, r)) {
            const p = this.board[r][f];
            if (p) {
              if (p.color === byColor && s.types.includes(p.type)) return true;
              break;
            }
            f += df; r += dr;
          }
        }
      }
      return false;
    }

    inCheck(color) {
      const c = color || this.turn;
      const k = this.findKing(c);
      if (!k) return false;
      return this.isSquareAttacked(k[0], k[1], otherColor(c));
    }

    _addMove(moves, m) { moves.push(m); }

    generatePseudoMoves(color) {
      const moves = [];
      const me = color || this.turn;
      for (let r = 0; r < 8; r++) {
        for (let f = 0; f < 8; f++) {
          const p = this.board[r][f];
          if (!p || p.color !== me) continue;
          if (p.type === 'p') this._pawnMoves(f, r, p.color, moves);
          else if (p.type === 'n') this._stepMoves(f, r, p.color, DIRS.n, moves);
          else if (p.type === 'k') this._kingMoves(f, r, p.color, moves);
          else if (p.type === 'b') this._slideMoves(f, r, p.color, DIRS.b, moves);
          else if (p.type === 'r') this._slideMoves(f, r, p.color, DIRS.r, moves);
          else if (p.type === 'q') this._slideMoves(f, r, p.color, DIRS.q, moves);
        }
      }
      return moves;
    }

    _pawnMoves(f, r, color, moves) {
      const dir = color === W ? 1 : -1;
      const startRank = color === W ? 1 : 6;
      const promoteRank = color === W ? 7 : 0;
      const one = r + dir;
      if (inBounds(f, one) && !this.board[one][f]) {
        if (one === promoteRank) {
          for (const promo of ['q', 'r', 'b', 'n']) {
            moves.push({ from: [f, r], to: [f, one], piece: 'p', color, promotion: promo, flags: 'p' });
          }
        } else {
          moves.push({ from: [f, r], to: [f, one], piece: 'p', color, flags: 'n' });
          const two = r + dir * 2;
          if (r === startRank && !this.board[two][f]) {
            moves.push({ from: [f, r], to: [f, two], piece: 'p', color, flags: 'b' });
          }
        }
      }
      for (const df of [-1, 1]) {
        const nf = f + df, nr = r + dir;
        if (!inBounds(nf, nr)) continue;
        const target = this.board[nr][nf];
        if (target && target.color !== color) {
          if (nr === promoteRank) {
            for (const promo of ['q', 'r', 'b', 'n']) {
              moves.push({ from: [f, r], to: [nf, nr], piece: 'p', color, captured: target.type, promotion: promo, flags: 'pc' });
            }
          } else {
            moves.push({ from: [f, r], to: [nf, nr], piece: 'p', color, captured: target.type, flags: 'c' });
          }
        } else if (this.ep && this.ep[0] === nf && this.ep[1] === nr) {
          moves.push({ from: [f, r], to: [nf, nr], piece: 'p', color, captured: 'p', flags: 'e' });
        }
      }
    }

    _stepMoves(f, r, color, dirs, moves) {
      for (const [df, dr] of dirs) {
        const nf = f + df, nr = r + dr;
        if (!inBounds(nf, nr)) continue;
        const t = this.board[nr][nf];
        if (!t) moves.push({ from: [f, r], to: [nf, nr], piece: 'n', color, flags: 'n' });
        else if (t.color !== color) moves.push({ from: [f, r], to: [nf, nr], piece: 'n', color, captured: t.type, flags: 'c' });
      }
    }

    _slideMoves(f, r, color, dirs, moves) {
      const piece = this.board[r][f].type;
      for (const [df, dr] of dirs) {
        let nf = f + df, nr = r + dr;
        while (inBounds(nf, nr)) {
          const t = this.board[nr][nf];
          if (!t) moves.push({ from: [f, r], to: [nf, nr], piece, color, flags: 'n' });
          else {
            if (t.color !== color) moves.push({ from: [f, r], to: [nf, nr], piece, color, captured: t.type, flags: 'c' });
            break;
          }
          nf += df; nr += dr;
        }
      }
    }

    _kingMoves(f, r, color, moves) {
      for (const [df, dr] of DIRS.k) {
        const nf = f + df, nr = r + dr;
        if (!inBounds(nf, nr)) continue;
        const t = this.board[nr][nf];
        if (!t) moves.push({ from: [f, r], to: [nf, nr], piece: 'k', color, flags: 'n' });
        else if (t.color !== color) moves.push({ from: [f, r], to: [nf, nr], piece: 'k', color, captured: t.type, flags: 'c' });
      }
      // Castling
      const back = color === W ? 0 : 7;
      if (f !== 4 || r !== back) return;
      const opp = otherColor(color);
      if (this.isSquareAttacked(4, back, opp)) return;
      if (this.castling[color].k) {
        if (!this.board[back][5] && !this.board[back][6]
            && this.board[back][7] && this.board[back][7].type === 'r'
            && !this.isSquareAttacked(5, back, opp) && !this.isSquareAttacked(6, back, opp)) {
          moves.push({ from: [4, back], to: [6, back], piece: 'k', color, flags: 'k' });
        }
      }
      if (this.castling[color].q) {
        if (!this.board[back][1] && !this.board[back][2] && !this.board[back][3]
            && this.board[back][0] && this.board[back][0].type === 'r'
            && !this.isSquareAttacked(3, back, opp) && !this.isSquareAttacked(2, back, opp)) {
          moves.push({ from: [4, back], to: [2, back], piece: 'k', color, flags: 'q' });
        }
      }
    }

    generateLegalMoves(color) {
      const me = color || this.turn;
      const pseudo = this.generatePseudoMoves(me);
      const legal = [];
      for (const m of pseudo) {
        this._make(m);
        if (!this.inCheck(me)) legal.push(m);
        this._unmake();
      }
      return legal;
    }

    _make(m) {
      const undo = {
        move: m,
        prevTurn: this.turn,
        prevCastling: JSON.parse(JSON.stringify(this.castling)),
        prevEp: this.ep ? [...this.ep] : null,
        prevHalfmove: this.halfmove,
        prevFullmove: this.fullmove,
        captured: null,
        capturedSquare: null,
      };
      const [ff, fr] = m.from;
      const [tf, tr] = m.to;
      const piece = this.board[fr][ff];

      if (m.flags === 'e') {
        // En passant capture
        const capR = fr;
        undo.captured = this.board[capR][tf];
        undo.capturedSquare = [tf, capR];
        this.board[capR][tf] = null;
      } else if (this.board[tr][tf]) {
        undo.captured = this.board[tr][tf];
        undo.capturedSquare = [tf, tr];
      }

      this.board[tr][tf] = piece;
      this.board[fr][ff] = null;

      if (m.flags === 'k') {
        this.board[tr][5] = this.board[tr][7];
        this.board[tr][7] = null;
      } else if (m.flags === 'q') {
        this.board[tr][3] = this.board[tr][0];
        this.board[tr][0] = null;
      }

      if (m.promotion) {
        this.board[tr][tf] = { type: m.promotion, color: piece.color };
      }

      // Castling rights
      if (piece.type === 'k') {
        this.castling[piece.color].k = false;
        this.castling[piece.color].q = false;
      }
      if (piece.type === 'r') {
        const back = piece.color === W ? 0 : 7;
        if (fr === back && ff === 0) this.castling[piece.color].q = false;
        if (fr === back && ff === 7) this.castling[piece.color].k = false;
      }
      if (undo.captured && undo.captured.type === 'r') {
        const opp = undo.captured.color;
        const back = opp === W ? 0 : 7;
        const [csf, csr] = undo.capturedSquare;
        if (csr === back && csf === 0) this.castling[opp].q = false;
        if (csr === back && csf === 7) this.castling[opp].k = false;
      }

      // En passant target square
      if (piece.type === 'p' && Math.abs(tr - fr) === 2) {
        this.ep = [ff, (fr + tr) / 2];
      } else {
        this.ep = null;
      }

      // Halfmove clock
      if (piece.type === 'p' || undo.captured) this.halfmove = 0;
      else this.halfmove++;

      if (this.turn === B) this.fullmove++;
      this.turn = otherColor(this.turn);

      this.history.push(undo);
    }

    _unmake() {
      const undo = this.history.pop();
      if (!undo) return;
      const m = undo.move;
      const [ff, fr] = m.from;
      const [tf, tr] = m.to;
      const piece = this.board[tr][tf];

      // Reverse promotion
      const movedBack = m.promotion ? { type: 'p', color: piece.color } : piece;
      this.board[fr][ff] = movedBack;
      this.board[tr][tf] = null;

      if (m.flags === 'k') {
        this.board[tr][7] = this.board[tr][5];
        this.board[tr][5] = null;
      } else if (m.flags === 'q') {
        this.board[tr][0] = this.board[tr][3];
        this.board[tr][3] = null;
      }

      if (undo.captured) {
        const [csf, csr] = undo.capturedSquare;
        this.board[csr][csf] = undo.captured;
      }

      this.turn = undo.prevTurn;
      this.castling = undo.prevCastling;
      this.ep = undo.prevEp;
      this.halfmove = undo.prevHalfmove;
      this.fullmove = undo.prevFullmove;
    }

    move(input) {
      const legal = this.generateLegalMoves();
      let chosen = null;
      if (typeof input === 'string') {
        // SAN parsing not strictly required; try basic forms
        chosen = this._matchSan(input, legal);
      } else if (input && input.from && input.to) {
        const [ff, fr] = typeof input.from === 'string' ? algToSq(input.from) : input.from;
        const [tf, tr] = typeof input.to === 'string' ? algToSq(input.to) : input.to;
        const promo = input.promotion ? input.promotion.toLowerCase() : null;
        chosen = legal.find((m) =>
          m.from[0] === ff && m.from[1] === fr &&
          m.to[0] === tf && m.to[1] === tr &&
          (!promo || m.promotion === promo)
        );
      }
      if (!chosen) return null;
      const san = this._moveToSan(chosen, legal);
      this._make(chosen);
      // Suffix check/mate marker
      const oppMoves = this.generateLegalMoves();
      let suffix = '';
      if (this.inCheck()) suffix = oppMoves.length === 0 ? '#' : '+';
      const finalSan = san + suffix;
      this.history[this.history.length - 1].san = finalSan;
      this._recordPosition();
      return {
        from: sqToAlg(chosen.from[0], chosen.from[1]),
        to: sqToAlg(chosen.to[0], chosen.to[1]),
        piece: chosen.piece,
        color: chosen.color,
        captured: chosen.captured || null,
        promotion: chosen.promotion || null,
        flags: chosen.flags,
        san: finalSan,
        fen: this.fen(),
      };
    }

    undo() {
      if (!this.history.length) return null;
      this._unrecordPosition();
      const undo = this.history[this.history.length - 1];
      this._unmake();
      return undo.move;
    }

    _matchSan(san, legal) {
      const cleaned = san.replace(/[+#?!]/g, '');
      if (cleaned === 'O-O' || cleaned === '0-0') return legal.find((m) => m.flags === 'k') || null;
      if (cleaned === 'O-O-O' || cleaned === '0-0-0') return legal.find((m) => m.flags === 'q') || null;
      const re = /^([NBRQK])?([a-h])?([1-8])?x?([a-h][1-8])(?:=([NBRQ]))?$/;
      const match = cleaned.match(re);
      if (!match) return null;
      const [, pieceLetter, fromFile, fromRank, dest, promo] = match;
      const type = pieceLetter ? pieceLetter.toLowerCase() : 'p';
      const [tf, tr] = algToSq(dest);
      const candidates = legal.filter((m) =>
        m.piece === type && m.to[0] === tf && m.to[1] === tr &&
        (!fromFile || m.from[0] === fromFile.charCodeAt(0) - 97) &&
        (!fromRank || m.from[1] === parseInt(fromRank, 10) - 1) &&
        (!promo || m.promotion === promo.toLowerCase())
      );
      return candidates.length === 1 ? candidates[0] : null;
    }

    _moveToSan(m, legal) {
      if (m.flags === 'k') return 'O-O';
      if (m.flags === 'q') return 'O-O-O';
      const dest = sqToAlg(m.to[0], m.to[1]);
      const capture = m.captured || m.flags === 'e';
      if (m.piece === 'p') {
        let s = '';
        if (capture) s += 'abcdefgh'[m.from[0]] + 'x';
        s += dest;
        if (m.promotion) s += '=' + m.promotion.toUpperCase();
        return s;
      }
      // Disambiguation
      const same = legal.filter((x) =>
        x !== m && x.piece === m.piece && x.to[0] === m.to[0] && x.to[1] === m.to[1]
      );
      let disambig = '';
      if (same.length) {
        const sameFile = same.some((x) => x.from[0] === m.from[0]);
        const sameRank = same.some((x) => x.from[1] === m.from[1]);
        if (!sameFile) disambig = 'abcdefgh'[m.from[0]];
        else if (!sameRank) disambig = String(m.from[1] + 1);
        else disambig = sqToAlg(m.from[0], m.from[1]);
      }
      return m.piece.toUpperCase() + disambig + (capture ? 'x' : '') + dest;
    }

    inCheckmate() {
      return this.inCheck() && this.generateLegalMoves().length === 0;
    }

    inStalemate() {
      return !this.inCheck() && this.generateLegalMoves().length === 0;
    }

    insufficientMaterial() {
      const pieces = { w: [], b: [] };
      for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
        const p = this.board[r][f];
        if (p && p.type !== 'k') pieces[p.color].push({ ...p, square: [f, r] });
      }
      const total = pieces.w.length + pieces.b.length;
      if (total === 0) return true;
      if (total === 1) {
        const lone = pieces.w.concat(pieces.b)[0];
        if (lone.type === 'n' || lone.type === 'b') return true;
      }
      if (total === 2) {
        const both = pieces.w.concat(pieces.b);
        if (both.every((p) => p.type === 'b')) {
          const colorOf = ([f, r]) => (f + r) % 2;
          if (colorOf(both[0].square) === colorOf(both[1].square)) return true;
        }
      }
      return false;
    }

    threefoldRepetition() {
      for (const k in this.posCount) if (this.posCount[k] >= 3) return true;
      return false;
    }

    fiftyMoveRule() { return this.halfmove >= 100; }

    isGameOver() {
      return this.inCheckmate() || this.inStalemate()
          || this.insufficientMaterial() || this.threefoldRepetition()
          || this.fiftyMoveRule();
    }

    result() {
      if (this.inCheckmate()) return this.turn === W ? '0-1' : '1-0';
      if (this.inStalemate() || this.insufficientMaterial()
          || this.threefoldRepetition() || this.fiftyMoveRule()) return '1/2-1/2';
      return '*';
    }

    terminationReason() {
      if (this.inCheckmate()) return 'checkmate';
      if (this.inStalemate()) return 'stalemate';
      if (this.insufficientMaterial()) return 'insufficient_material';
      if (this.threefoldRepetition()) return 'threefold_repetition';
      if (this.fiftyMoveRule()) return 'fifty_move_rule';
      return null;
    }

    pgn(meta) {
      const headers = Object.assign({
        Event: 'Chess2 online',
        Site: 'Chess2',
        Date: new Date().toISOString().slice(0, 10).replace(/-/g, '.'),
        White: '?',
        Black: '?',
        Result: this.result(),
      }, meta || {});
      let out = '';
      for (const k of Object.keys(headers)) out += `[${k} "${headers[k]}"]\n`;
      out += '\n';
      const sans = this.history.map((h) => h.san);
      for (let i = 0; i < sans.length; i += 2) {
        out += `${i / 2 + 1}. ${sans[i]}${sans[i + 1] ? ' ' + sans[i + 1] : ''} `;
      }
      out += headers.Result;
      return out;
    }

    movesAlgebraic(square) {
      const [f, r] = algToSq(square);
      return this.generateLegalMoves()
        .filter((m) => m.from[0] === f && m.from[1] === r)
        .map((m) => ({
          to: sqToAlg(m.to[0], m.to[1]),
          promotion: m.promotion || null,
          flags: m.flags,
        }));
    }
  }

  return { Chess, sqToAlg, algToSq, PIECE_VALUE, PIECE_ORDER };
}));
