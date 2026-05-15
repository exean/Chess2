/* Chessnut Air / Go Bluetooth integration via Web Bluetooth API.
 *
 * Service / characteristic UUIDs and the piece-code table are from the
 * community-reverse-engineered Chessnut Air protocol (the Go shares the
 * same Bluetooth stack). The board sends a 38-byte notification every
 * time a square's occupancy changes; bytes 2..33 encode 64 squares as
 * 4-bit piece codes (two squares per byte, low nibble first).
 *
 * Only useful on standard 8x8 games. Web Bluetooth is unsupported by
 * iOS Safari - callers should check ChessnutBoard.isSupported() first.
 */
(function (root) {
  const SERVICE_UUID = '1b7e8251-2877-41c3-b46e-cf057c562023';
  const NOTIFY_UUID  = '1b7e8262-2877-41c3-b46e-cf057c562023';
  const WRITE_UUID   = '1b7e8272-2877-41c3-b46e-cf057c562023';

  // 'Subscribe to board updates' command - sent on connect.
  const INIT_BOARD = new Uint8Array([0x21, 0x01, 0x00]);

  // Chessnut piece codes -> FEN-style letters. Empty squares = '.'.
  const PIECE_CODE_TO_FEN = {
    0x0: '.',
    0x1: 'Q', 0x2: 'K', 0x3: 'R', 0x4: 'N', 0x5: 'B', 0x6: 'P',
    0x7: 'q', 0x8: 'k', 0x9: 'r', 0xA: 'n', 0xB: 'b', 0xC: 'p',
  };

  class ChessnutBoard {
    constructor() {
      this.device = null;
      this.notifyChar = null;
      this.writeChar = null;
      this.boardState = new Array(64).fill('.');
      this.connected = false;
      // 'white-near': player sits at rank 1 side (a1 = bottom-left of physical board)
      // 'black-near': flipped
      this.orientation = 'white-near';
      this.onConnect = () => {};
      this.onDisconnect = () => {};
      this.onBoardChange = () => {};
      this.onError = () => {};
    }

    static isSupported() {
      return typeof navigator !== 'undefined' && !!navigator.bluetooth;
    }

    async connect() {
      if (!ChessnutBoard.isSupported()) throw new Error('Web Bluetooth ist in diesem Browser nicht verfügbar (iOS Safari unterstützt es nicht).');
      this.device = await navigator.bluetooth.requestDevice({
        filters: [{ namePrefix: 'Chessnut' }],
        optionalServices: [SERVICE_UUID],
      });
      this.device.addEventListener('gattserverdisconnected', () => this._handleDisconnect());
      const server = await this.device.gatt.connect();
      const service = await server.getPrimaryService(SERVICE_UUID);
      this.notifyChar = await service.getCharacteristic(NOTIFY_UUID);
      this.writeChar = await service.getCharacteristic(WRITE_UUID);
      this.notifyChar.addEventListener('characteristicvaluechanged', (e) => this._handleNotification(e));
      await this.notifyChar.startNotifications();
      try { await this.writeChar.writeValueWithoutResponse(INIT_BOARD); }
      catch { await this.writeChar.writeValue(INIT_BOARD); }
      this.connected = true;
      this.onConnect(this.device.name || 'Chessnut');
    }

    async disconnect() {
      if (this.device && this.device.gatt && this.device.gatt.connected) {
        try { await this.device.gatt.disconnect(); } catch {}
      }
      this._handleDisconnect();
    }

    _handleDisconnect() {
      this.connected = false;
      this.notifyChar = null;
      this.writeChar = null;
      this.boardState = new Array(64).fill('.');
      this.onDisconnect();
    }

    _handleNotification(event) {
      const data = new Uint8Array(event.target.value.buffer);
      if (data.length < 34 || data[0] !== 0x01) return;
      const newState = new Array(64).fill('.');
      for (let byteIdx = 0; byteIdx < 32; byteIdx++) {
        const b = data[2 + byteIdx];
        const lo = b & 0x0F;
        const hi = (b >> 4) & 0x0F;
        newState[byteIdx * 2]     = PIECE_CODE_TO_FEN[lo] || '?';
        newState[byteIdx * 2 + 1] = PIECE_CODE_TO_FEN[hi] || '?';
      }
      let changed = false;
      for (let i = 0; i < 64; i++) {
        if (newState[i] !== this.boardState[i]) { changed = true; break; }
      }
      this.boardState = newState;
      if (changed) this.onBoardChange(this.physicalToAlgebraic());
    }

    /* Map internal square index (0..63) to algebraic notation given the
     * current orientation. Default ordering reverse-engineered from the
     * Chessnut Air firmware: byte 0 = a8 (rank 8, file a). Flip swaps
     * file/rank so the side-near-you is rank 1.
     */
    physicalToAlgebraic() {
      const out = {};
      for (let i = 0; i < 64; i++) {
        const physFile = i % 8;
        const physRank = Math.floor(i / 8);
        let file, rank;
        if (this.orientation === 'white-near') {
          file = physFile;
          rank = 7 - physRank;
        } else {
          file = 7 - physFile;
          rank = physRank;
        }
        out['abcdefgh'[file] + (rank + 1)] = this.boardState[i];
      }
      return out;
    }

    flipOrientation() {
      this.orientation = this.orientation === 'white-near' ? 'black-near' : 'white-near';
      this.onBoardChange(this.physicalToAlgebraic());
    }

    /* Highlight a set of algebraic squares via the on-board LEDs.
     * Packet: 0x0A 0x08 [rank8..rank1 bytes]. Each rank byte's bit 0 = file a.
     * On the Chessnut Go, LED granularity may be limited - the write is
     * best-effort and falls through silently on unsupported firmware.
     */
    async setLeds(squares) {
      if (!this.writeChar) return;
      const rows = new Uint8Array(8); // index 0 = rank 8 in board frame
      for (const sq of (squares || [])) {
        const f = sq.charCodeAt(0) - 97;
        const r = parseInt(sq.slice(1), 10) - 1;
        if (f < 0 || f > 7 || r < 0 || r > 7) continue;
        let row, bit;
        if (this.orientation === 'white-near') {
          row = 7 - r;       // rank 1 (white near) -> board row 7
          bit = f;
        } else {
          row = r;
          bit = 7 - f;
        }
        rows[row] |= (1 << bit);
      }
      const packet = new Uint8Array(10);
      packet[0] = 0x0A;
      packet[1] = 0x08;
      for (let i = 0; i < 8; i++) packet[2 + i] = rows[i];
      try { await this.writeChar.writeValueWithoutResponse(packet); }
      catch { try { await this.writeChar.writeValue(packet); } catch {} }
    }

    async clearLeds() { return this.setLeds([]); }
  }

  /* Compare a physical board snapshot to an engine state. Tries every
   * legal move and returns the one whose resulting position matches the
   * snapshot. Reports:
   *   { status: 'move',         from, to, promotion? }   - a legal move was played
   *   { status: 'in-progress' }                          - piece(s) lifted, not yet placed
   *   { status: 'invalid' }                              - board doesn't match anything legal
   *   { status: 'in-sync' }                              - identical to current engine state
   */
  function detectMove(physical, engine) {
    const eLetter = (p) => p ? (p.color === 'w' ? p.type.toUpperCase() : p.type) : '.';
    const matches = (engineRef) => {
      for (let r = 0; r < 8; r++) {
        for (let f = 0; f < 8; f++) {
          const sq = 'abcdefgh'[f] + (r + 1);
          if (eLetter(engineRef.board[r][f]) !== physical[sq]) return false;
        }
      }
      return true;
    };
    if (matches(engine)) return { status: 'in-sync' };

    const legal = engine.generateLegalMoves();
    const matchingMoves = [];
    for (const move of legal) {
      engine._make(move);
      const ok = matches(engine);
      engine._unmake();
      if (ok) matchingMoves.push(move);
    }
    if (matchingMoves.length === 1) {
      const m = matchingMoves[0];
      return {
        status: 'move',
        from: 'abcdefgh'[m.from[0]] + (m.from[1] + 1),
        to:   'abcdefgh'[m.to[0]]   + (m.to[1]   + 1),
        promotion: m.promotion || undefined,
      };
    }
    if (matchingMoves.length > 1) {
      // Should only happen if board can't distinguish (e.g., same destination
      // with different promotion piece). Pick the queen-promotion if available.
      const queen = matchingMoves.find((m) => m.promotion === 'q') || matchingMoves[0];
      return {
        status: 'move',
        from: 'abcdefgh'[queen.from[0]] + (queen.from[1] + 1),
        to:   'abcdefgh'[queen.to[0]]   + (queen.to[1]   + 1),
        promotion: queen.promotion || undefined,
      };
    }

    // No legal move produces this state. Check whether the player is just
    // mid-move (pieces lifted, none placed yet): count engine-pieces that are
    // missing from the physical board vs physical-pieces that aren't in the
    // engine.
    let lifted = 0, placed = 0;
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const sq = 'abcdefgh'[f] + (r + 1);
        const e = eLetter(engine.board[r][f]);
        const p = physical[sq] || '.';
        if (e !== '.' && p === '.') lifted++;
        if (e === '.' && p !== '.') placed++;
        if (e !== '.' && p !== '.' && e !== p) placed++;
      }
    }
    if (lifted > 0 && placed === 0) return { status: 'in-progress' };
    return { status: 'invalid' };
  }

  root.Chess2Chessnut = { ChessnutBoard, detectMove };
})(window);
