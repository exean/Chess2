/* Responsive tap-and-drag chessboard renderer for arbitrary board shapes.
   Piece appearance is controlled by window.Chess2Pieces (see pieces.js). */
(function (root) {
  const FILE_LETTERS = 'abcdefghijklmnopqrstuvwxyz';

  function renderPiece(type, color) {
    const renderer = (window.Chess2Pieces && window.Chess2Pieces.getRenderer(window.Chess2Pieces.getPreferred()))
      || ((t, c) => {
        const s = document.createElement('span');
        s.className = 'piece ' + c;
        s.textContent = t;
        return s;
      });
    return renderer(type, color);
  }

  class Board {
    constructor(el, opts) {
      this.el = el;
      this.el.__chess2Board = this;
      this.orientation = (opts && opts.orientation) || 'w';
      this.onMoveAttempt = (opts && opts.onMoveAttempt) || (() => {});
      this.onPromotion = (opts && opts.onPromotion) || ((from, to, finalize) => finalize('q'));
      this.shapeArg = (opts && opts.shape) || 'standard';
      this.shapeName = typeof this.shapeArg === 'object' ? this.shapeArg.kind : this.shapeArg;
      this.engine = new (window.ChessEngine.Chess)({ shape: this.shapeArg });
      this.selected = null;
      this.legalTargets = [];
      this.lastMove = null;
      this.interactive = true;
      this.viewColor = 'w';
      this._build();
    }

    setShape(shapeArg) {
      // Compare structurally so {kind:'custom',width:10,height:6} differs from
      // the same with width:12 - both have shapeName='custom' but distinct dims.
      const sameAsCurrent = JSON.stringify(shapeArg) === JSON.stringify(this.shapeArg);
      if (sameAsCurrent) return;
      this.shapeArg = shapeArg;
      this.shapeName = typeof shapeArg === 'object' ? shapeArg.kind : shapeArg;
      this.engine = new (window.ChessEngine.Chess)({ shape: this.shapeArg });
      this.selected = null;
      this.legalTargets = [];
      this.lastMove = null;
      this._build();
    }

    _build() {
      const w = this.engine.shape.width;
      const h = this.engine.shape.height;
      this.el.style.setProperty('--cols', w);
      this.el.style.setProperty('--rows', h);
      this.el.style.gridTemplateColumns = `repeat(${w}, minmax(0, 1fr))`;
      this.el.style.gridTemplateRows = `repeat(${h}, minmax(0, 1fr))`;
      this.el.innerHTML = '';
      const total = w * h;
      for (let i = 0; i < total; i++) {
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

    flip() { this.setOrientation(this.orientation === 'w' ? 'b' : 'w'); }

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

    _squareAtIndex(idx) {
      const w = this.engine.shape.width;
      const h = this.engine.shape.height;
      const row = Math.floor(idx / w);
      const col = idx % w;
      let rank, file;
      if (this.orientation === 'w') { rank = h - 1 - row; file = col; }
      else { rank = row; file = w - 1 - col; }
      return [file, rank];
    }

    _indexFor(file, rank) {
      const w = this.engine.shape.width;
      const h = this.engine.shape.height;
      if (this.orientation === 'w') return (h - 1 - rank) * w + file;
      return rank * w + (w - 1 - file);
    }

    render() {
      const w = this.engine.shape.width;
      const h = this.engine.shape.height;
      const children = this.el.children;
      const total = w * h;
      for (let i = 0; i < total; i++) {
        const [file, rank] = this._squareAtIndex(i);
        const sq = children[i];
        sq.innerHTML = '';
        if (!this.engine.shape.mask(file, rank)) {
          sq.className = 'sq void';
          continue;
        }
        const isLight = (file + rank) % 2 === 1;
        sq.className = 'sq ' + (isLight ? 'light' : 'dark');
        const alg = FILE_LETTERS[file] + (rank + 1);
        sq.dataset.sq = alg;
        const piece = this.engine.board[rank][file];
        if (piece) sq.appendChild(renderPiece(piece.type, piece.color));
        // Coordinate labels: on the edge of the playable area (where there is
        // no playable neighbour on that side, taking orientation into account).
        const downNeighbourRank = this.orientation === 'w' ? rank - 1 : rank + 1;
        const leftNeighbourFile = this.orientation === 'w' ? file - 1 : file + 1;
        const showFile = !this.engine.isPlayable(file, downNeighbourRank);
        const showRank = !this.engine.isPlayable(leftNeighbourFile, rank);
        if (showFile) {
          const c = document.createElement('span');
          c.className = 'coord file';
          c.textContent = FILE_LETTERS[file];
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
          const idx = this._indexFor(king[0], king[1]);
          children[idx].classList.add('check');
        }
      }
    }

    _handleSquare(div, _ev) {
      if (!this.interactive) return;
      const alg = div.dataset.sq;
      if (!alg) return; // void square
      const piece = this.engine.pieceAt(alg);
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
        if (piece && piece.color === this.engine.turn && piece.color === this.viewColor) {
          this._select(alg);
          return;
        }
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
      if (move.fen) this.engine.load(move.fen);
      else this.engine.move({ from: move.from, to: move.to, promotion: move.promotion || undefined });
      this.selected = null;
      this.legalTargets = [];
      this.setLastMove({ from: move.from, to: move.to });
    }
  }

  root.Chess2Board = Board;

  // When the user picks a different piece set, re-render every board.
  window.addEventListener('chess2:pieceset-changed', () => {
    document.querySelectorAll('.board').forEach((el) => {
      if (el.__chess2Board) el.__chess2Board.render();
    });
  });
})(window);
