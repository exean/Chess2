/* Responsive tap-and-drag chessboard renderer.
   Pieces are rendered as Unicode glyphs (no external image assets). */
(function (root) {
  const GLYPHS = {
    w: { k: '♔', q: '♕', r: '♖', b: '♗', n: '♘', p: '♙' },
    b: { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' },
  };

  class Board {
    constructor(el, opts) {
      this.el = el;
      this.orientation = (opts && opts.orientation) || 'w';
      this.onMoveAttempt = (opts && opts.onMoveAttempt) || (() => {});
      this.onPromotion = (opts && opts.onPromotion) || ((from, to, finalize) => finalize('q'));
      this.engine = new (window.ChessEngine.Chess)();
      this.selected = null;
      this.legalTargets = [];
      this.lastMove = null;
      this.interactive = true;
      this.viewColor = 'w'; // which color the user controls; for highlighting check
      this._build();
    }

    _build() {
      this.el.innerHTML = '';
      this.squares = {};
      for (let i = 0; i < 64; i++) {
        const div = document.createElement('div');
        div.className = 'sq';
        div.addEventListener('click', (e) => this._handleSquare(div, e));
        this.el.appendChild(div);
      }
      this.render();
    }

    setOrientation(color) {
      this.orientation = color === 'b' ? 'b' : 'w';
      this.render();
    }

    flip() {
      this.setOrientation(this.orientation === 'w' ? 'b' : 'w');
    }

    setInteractive(b) { this.interactive = b; }

    setPosition(fen) {
      this.engine.load(fen);
      this.selected = null;
      this.legalTargets = [];
      this.render();
    }

    setLastMove(move) {
      if (!move) this.lastMove = null;
      else this.lastMove = { from: move.from, to: move.to };
      this.render();
    }

    _indexFor(file, rank) {
      // returns DOM index for given algebraic file/rank, taking orientation into account
      if (this.orientation === 'w') return (7 - rank) * 8 + file;
      return rank * 8 + (7 - file);
    }

    _squareAtIndex(idx) {
      let row = Math.floor(idx / 8);
      let col = idx % 8;
      let rank, file;
      if (this.orientation === 'w') { rank = 7 - row; file = col; }
      else { rank = row; file = 7 - col; }
      return [file, rank];
    }

    render() {
      const children = this.el.children;
      for (let i = 0; i < 64; i++) {
        const [file, rank] = this._squareAtIndex(i);
        const isLight = (file + rank) % 2 === 1;
        const piece = this.engine.board[rank][file];
        const sq = children[i];
        sq.className = 'sq ' + (isLight ? 'light' : 'dark');
        sq.innerHTML = '';
        const alg = 'abcdefgh'[file] + (rank + 1);
        sq.dataset.sq = alg;
        if (piece) {
          const span = document.createElement('span');
          span.className = 'piece ' + piece.color;
          span.textContent = GLYPHS[piece.color][piece.type];
          sq.appendChild(span);
        }
        // Coord labels on edge squares
        const showFile = (this.orientation === 'w' && rank === 0) || (this.orientation === 'b' && rank === 7);
        const showRank = (this.orientation === 'w' && file === 0) || (this.orientation === 'b' && file === 7);
        if (showFile) {
          const c = document.createElement('span');
          c.className = 'coord file';
          c.textContent = 'abcdefgh'[file];
          sq.appendChild(c);
        }
        if (showRank) {
          const c = document.createElement('span');
          c.className = 'coord rank';
          c.textContent = String(rank + 1);
          sq.appendChild(c);
        }
        if (this.lastMove && (this.lastMove.from === alg || this.lastMove.to === alg)) {
          sq.classList.add('last-move');
        }
        if (this.selected === alg) sq.classList.add('selected');
        const tgt = this.legalTargets.find((t) => t.to === alg);
        if (tgt) {
          sq.classList.add('target');
          if (tgt.flags && (tgt.flags.includes('c') || tgt.flags.includes('e'))) sq.classList.add('capture');
        }
      }
      // Mark king in check
      if (this.engine.inCheck()) {
        const king = this.engine.findKing(this.engine.turn);
        if (king) {
          const alg = 'abcdefgh'[king[0]] + (king[1] + 1);
          const idx = this._indexFor(king[0], king[1]);
          children[idx].classList.add('check');
        }
      }
    }

    _handleSquare(div, _ev) {
      if (!this.interactive) return;
      const alg = div.dataset.sq;
      const piece = this.engine.pieceAt(alg);
      // If a piece is already selected and clicked target is a legal target, do move.
      if (this.selected) {
        const target = this.legalTargets.find((t) => t.to === alg);
        if (target) {
          const from = this.selected;
          this.selected = null;
          this.legalTargets = [];
          this.render();
          if (target.promotion) {
            this.onPromotion(from, alg, (promo) => {
              this.onMoveAttempt({ from, to: alg, promotion: promo });
            });
          } else {
            this.onMoveAttempt({ from, to: alg });
          }
          return;
        }
        // Click on own piece: switch selection.
        if (piece && piece.color === this.engine.turn && piece.color === this.viewColor) {
          this._select(alg);
          return;
        }
        // Else deselect
        this.selected = null;
        this.legalTargets = [];
        this.render();
        return;
      }
      if (!piece || piece.color !== this.engine.turn || piece.color !== this.viewColor) return;
      this._select(alg);
    }

    _select(alg) {
      this.selected = alg;
      this.legalTargets = this.engine.movesAlgebraic(alg);
      this.render();
    }

    applyMove(move) {
      // Trust the server's FEN to stay in sync even if engines drift.
      if (move.fen) this.engine.load(move.fen);
      else this.engine.move({ from: move.from, to: move.to, promotion: move.promotion || undefined });
      this.selected = null;
      this.legalTargets = [];
      this.setLastMove({ from: move.from, to: move.to });
    }
  }

  root.Chess2Board = Board;
})(window);
