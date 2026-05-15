(function () {
  const Api = window.Chess2Api;
  const params = new URLSearchParams(location.search);
  const code = (params.get('code') || '').toUpperCase();
  if (!code) { location.href = '/'; return; }

  const socket = io({ autoConnect: true });
  const els = {
    board: document.getElementById('board'),
    roomInfo: document.getElementById('room-info'),
    playerTop: document.getElementById('player-top'),
    playerBottom: document.getElementById('player-bottom'),
    btnFlip: document.getElementById('btn-flip'),
    btnResign: document.getElementById('btn-resign'),
    btnDraw: document.getElementById('btn-draw'),
    btnLeave: document.getElementById('btn-leave'),
    btnRematch: document.getElementById('btn-rematch'),
    moveList: document.getElementById('move-list'),
    chatLog: document.getElementById('chat-log'),
    chatForm: document.getElementById('chat-form'),
    chatInput: document.getElementById('chat-input'),
    status: document.getElementById('status-line'),
    promoModal: document.getElementById('promo-modal'),
    endModal: document.getElementById('end-modal'),
    endTitle: document.getElementById('end-title'),
    endDetail: document.getElementById('end-detail'),
    endPgn: document.getElementById('end-pgn'),
    endRematch: document.getElementById('end-rematch'),
    endLeave: document.getElementById('end-leave'),
    sharePanel: document.getElementById('share-panel'),
    shareCode: document.getElementById('share-code'),
    shareQr: document.getElementById('share-qr'),
    shareUrl: document.getElementById('share-url'),
    btnCopy: document.getElementById('btn-copy'),
    btnShare: document.getElementById('btn-share'),
    nameModal: document.getElementById('name-modal'),
    nameForm: document.getElementById('name-form'),
    voiceBar: document.getElementById('voice-bar'),
    btnVoice: document.getElementById('btn-voice'),
    btnMute: document.getElementById('btn-mute'),
    voiceStatus: document.getElementById('voice-status'),
    chessnutBar: document.getElementById('chessnut-bar'),
    btnChessnut: document.getElementById('btn-chessnut'),
    btnChessnutFlip: document.getElementById('btn-chessnut-flip'),
    chessnutStatus: document.getElementById('chessnut-status'),
  };

  let myColor = null; // 'w' | 'b' | 'spectator'
  let mySeatToken = null;
  let state = null;
  let promoCallback = null;
  let clockTimer = null;
  let lastClock = null;
  let lastClockReceivedAt = 0;

  const board = new Chess2Board(els.board, {
    onMoveAttempt: ({ from, to, promotion }) => {
      socket.emit('game:move', { from, to, promotion }, (res) => {
        if (res && res.error) setStatus(res.error);
      });
    },
    onPromotion: (from, to, finalize) => {
      promoCallback = finalize;
      els.promoModal.classList.remove('hidden');
    },
  });

  function refreshPromoButtons() {
    const color = myColor === 'b' ? 'b' : 'w';
    els.promoModal.querySelectorAll('.promo-btn').forEach((btn) => {
      btn.innerHTML = '';
      if (window.Chess2Pieces) {
        const render = window.Chess2Pieces.getRenderer(window.Chess2Pieces.getPreferred());
        btn.appendChild(render(btn.dataset.promo, color));
      } else {
        btn.textContent = btn.dataset.promo.toUpperCase();
      }
    });
  }
  refreshPromoButtons();
  window.addEventListener('chess2:pieceset-changed', refreshPromoButtons);

  els.promoModal.querySelectorAll('.promo-btn').forEach((b) => {
    b.addEventListener('click', () => {
      els.promoModal.classList.add('hidden');
      const fn = promoCallback;
      promoCallback = null;
      if (fn) fn(b.dataset.promo);
    });
  });

  function setStatus(msg) { els.status.textContent = msg || ''; }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"'`]/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;','`':'&#96;' }[c]));
  }

  function formatClock(ms) {
    if (ms == null) return '--:--';
    if (ms < 0) ms = 0;
    const total = Math.ceil(ms / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    if (ms < 10000) {
      const tenths = Math.floor((ms % 1000) / 100);
      return m + ':' + String(s).padStart(2, '0') + '.' + tenths;
    }
    return m + ':' + String(s).padStart(2, '0');
  }

  function updatePlayers() {
    if (!state) return;
    const topColor = (myColor === 'b') ? 'w' : 'b';
    const bottomColor = (myColor === 'b') ? 'b' : 'w';
    paintPlayer(els.playerTop, topColor);
    paintPlayer(els.playerBottom, bottomColor);
    const shapeLabel = state.shape && state.shape !== 'standard' ? ' • ' + shapeName(state.shape, state.shapeOpts) : '';
    els.roomInfo.textContent = 'Raum ' + state.code +
      (state.timeControl.initial
        ? ' • ' + Math.round(state.timeControl.initial / 60) + '+' + state.timeControl.increment
        : ' • ohne Uhr') +
      (state.rated ? ' • bewertet' : '') +
      shapeLabel;
  }

  function shapeName(s, opts) {
    if (s === 'octagon') return 'Achteck';
    if (s === 'cross') return 'Kreuz';
    if (s === 'custom') return opts ? opts.width + 'x' + opts.height : 'Custom';
    return 'Standard';
  }

  function paintPlayer(el, color) {
    const seat = color === 'w' ? state.white : state.black;
    const nameEl = el.querySelector('.player-name');
    const ratingEl = el.querySelector('.player-rating');
    if (seat) {
      nameEl.textContent = seat.name + (color === state.turn && state.status === 'active' ? ' •' : '');
      ratingEl.textContent = seat.rating ? '(' + seat.rating + ')' : '';
      el.classList.toggle('disconnected', !seat.connected);
    } else {
      nameEl.textContent = '(wartet auf Spieler...)';
      ratingEl.textContent = '';
      el.classList.remove('disconnected');
    }
  }

  function refreshClocks() {
    if (!state) return;
    let whiteMs = null, blackMs = null;
    if (state.clock) {
      whiteMs = state.clock.whiteMs;
      blackMs = state.clock.blackMs;
      if (state.status === 'active' && lastClock && lastClockReceivedAt) {
        const drift = Date.now() - lastClockReceivedAt;
        if (state.turn === 'w') whiteMs = Math.max(0, lastClock.whiteMs - drift);
        else blackMs = Math.max(0, lastClock.blackMs - drift);
      }
    }
    const topColor = (myColor === 'b') ? 'w' : 'b';
    const bottomColor = (myColor === 'b') ? 'b' : 'w';
    const topMs = topColor === 'w' ? whiteMs : blackMs;
    const bottomMs = bottomColor === 'w' ? whiteMs : blackMs;
    const topEl = els.playerTop.querySelector('.player-clock');
    const bottomEl = els.playerBottom.querySelector('.player-clock');
    topEl.textContent = formatClock(topMs);
    bottomEl.textContent = formatClock(bottomMs);
    if (!state.clock) { topEl.classList.add('hidden'); bottomEl.classList.add('hidden'); }
    else { topEl.classList.remove('hidden'); bottomEl.classList.remove('hidden'); }
    topEl.classList.toggle('active', state.status === 'active' && state.turn === topColor);
    bottomEl.classList.toggle('active', state.status === 'active' && state.turn === bottomColor);
    topEl.classList.toggle('low', topMs != null && topMs < 10000);
    bottomEl.classList.toggle('low', bottomMs != null && bottomMs < 10000);

    // Claim timeout if opponent flag fell (defensive; server checks too).
    if (state.status === 'active') {
      if (whiteMs === 0 || blackMs === 0) socket.emit('game:claim_timeout');
    }
  }

  function renderMoves() {
    if (!state) return;
    els.moveList.innerHTML = '';
    const moves = state.moves || [];
    for (let i = 0; i < moves.length; i += 2) {
      const num = document.createElement('li');
      num.className = 'num';
      num.textContent = (i / 2 + 1) + '.';
      const w = document.createElement('li');
      w.className = 'ply';
      w.textContent = moves[i].san;
      const b = document.createElement('li');
      b.className = 'ply';
      if (moves[i + 1]) b.textContent = moves[i + 1].san;
      if (i + 2 >= moves.length) {
        (moves[i + 1] ? b : w).classList.add('last');
      }
      els.moveList.appendChild(num);
      els.moveList.appendChild(w);
      els.moveList.appendChild(b);
    }
    els.moveList.parentElement.scrollTop = els.moveList.parentElement.scrollHeight;
  }

  function renderStatus() {
    if (!state) return;
    let msg = '';
    if (state.status === 'waiting') msg = 'Warte auf zweiten Spieler. Code: ' + state.code;
    else if (state.status === 'active') {
      msg = state.turn === 'w' ? 'Weiß am Zug' : 'Schwarz am Zug';
      if (state.drawOffer && state.drawOffer.by !== myColor) msg += ' • Gegner bietet Remis (im Chat annehmen mit /draw)';
      else if (state.drawOffer && state.drawOffer.by === myColor) msg += ' • Remis-Angebot gesendet';
    } else if (state.status === 'finished') {
      const labels = {
        checkmate: 'Schachmatt',
        resignation: 'Aufgegeben',
        timeout: 'Zeit abgelaufen',
        draw_agreement: 'Remis vereinbart',
        stalemate: 'Patt',
        insufficient_material: 'Unzureichendes Material',
        threefold_repetition: 'Stellungswiederholung',
        fifty_move_rule: '50-Züge-Regel',
      };
      msg = (labels[state.termination] || 'Beendet') + ' • Ergebnis: ' + state.result;
    }
    setStatus(msg);
  }

  function refreshFromState(newState) {
    state = newState;
    if (state.shape) {
      const arg = state.shape === 'custom' && state.shapeOpts
        ? { kind: 'custom', width: state.shapeOpts.width, height: state.shapeOpts.height }
        : state.shape;
      board.setShape(arg);
    }
    if (state.fen) {
      // Only replace position if engine differs (avoid wiping in-progress selection)
      if (board.engine.fen() !== state.fen) board.setPosition(state.fen);
    }
    if (state.moves && state.moves.length) {
      const last = state.moves[state.moves.length - 1];
      board.setLastMove({ from: last.from, to: last.to });
    } else {
      board.setLastMove(null);
    }
    board.viewColor = myColor === 'b' ? 'b' : 'w';
    board.setInteractive(state.status === 'active' && (myColor === 'w' || myColor === 'b') && myColor === state.turn);
    board.setOrientation(myColor === 'b' ? 'b' : 'w');
    refreshPromoButtons();
    lastClock = state.clock ? { whiteMs: state.clock.whiteMs, blackMs: state.clock.blackMs } : null;
    lastClockReceivedAt = Date.now();
    updatePlayers();
    refreshClocks();
    renderMoves();
    renderStatus();
    updateActionButtons();
    updateSharePanel();
  }

  function updateActionButtons() {
    const isPlayer = myColor === 'w' || myColor === 'b';
    const active = state && state.status === 'active' && isPlayer;
    els.btnResign.disabled = !active;
    els.btnDraw.disabled = !active;
    els.btnRematch.classList.toggle('hidden', !(state && state.status === 'finished' && isPlayer));
  }

  function appendChat(msg) {
    const div = document.createElement('div');
    div.className = 'msg';
    const who = document.createElement('span');
    who.className = 'who ' + (msg.color || 'system');
    who.textContent = msg.name + ':';
    div.appendChild(who);
    div.appendChild(document.createTextNode(' ' + msg.text));
    els.chatLog.appendChild(div);
    els.chatLog.scrollTop = els.chatLog.scrollHeight;
  }

  function joinRoom() {
    const seat = Api.loadSeat(code);
    if (seat) {
      myColor = seat.color;
      mySeatToken = seat.seatToken;
    }
    const name = Api.getName();
    // Ask for a nickname if we have no seat token (i.e., first time on this room),
    // no name saved, and no account.
    if (!mySeatToken && !name && !Api.getToken()) {
      promptForName(() => joinRoom());
      return;
    }
    socket.emit('room:join', {
      code,
      name: name || 'Gast',
      seatToken: mySeatToken,
    }, (res) => {
      if (res && res.error) { alert(res.error); location.href = '/'; return; }
      myColor = res.color;
      if (res.seatToken) {
        mySeatToken = res.seatToken;
        Api.saveSeat(code, myColor, mySeatToken);
      }
      refreshFromState(res.state);
      // Load chat history for late joiners
      socket.emit('room:chat_history', null, (r) => {
        if (r && r.messages) r.messages.forEach(appendChat);
      });
    });
  }

  function promptForName(done) {
    els.nameModal.classList.remove('hidden');
    const handler = (e) => {
      e.preventDefault();
      const data = new FormData(els.nameForm);
      const nick = String(data.get('nickname') || '').trim().slice(0, 32);
      if (!nick) return;
      Api.setName(nick);
      els.nameModal.classList.add('hidden');
      els.nameForm.removeEventListener('submit', handler);
      done();
    };
    els.nameForm.addEventListener('submit', handler);
  }

  function updateSharePanel() {
    if (!state) return;
    const showPanel = state.status === 'waiting';
    els.sharePanel.classList.toggle('hidden', !showPanel);
    if (!showPanel) return;
    const joinUrl = location.origin + '/game.html?code=' + encodeURIComponent(state.code);
    els.shareCode.textContent = state.code;
    els.shareUrl.value = joinUrl;
    const qrUrl = '/api/qr?text=' + encodeURIComponent(joinUrl);
    if (els.shareQr.dataset.for !== state.code) {
      els.shareQr.dataset.for = state.code;
      els.shareQr.src = qrUrl;
    }
    els.btnShare.classList.toggle('hidden', !navigator.share);
  }

  els.btnCopy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(els.shareUrl.value);
      els.btnCopy.textContent = 'Kopiert ✓';
      setTimeout(() => { els.btnCopy.textContent = 'Kopieren'; }, 1500);
    } catch {
      els.shareUrl.select();
      document.execCommand && document.execCommand('copy');
    }
  });

  els.btnShare.addEventListener('click', async () => {
    if (!navigator.share) return;
    try {
      await navigator.share({
        title: 'Chess2 - tritt meiner Partie bei',
        text: 'Spiel mit mir Schach (Code ' + (state && state.code) + ')',
        url: els.shareUrl.value,
      });
    } catch { /* user cancelled */ }
  });

  // Button handlers
  els.btnFlip.addEventListener('click', () => board.flip());
  els.btnLeave.addEventListener('click', () => {
    if (!confirm('Wirklich verlassen?')) return;
    socket.emit('room:leave');
    Api.clearSeat(code);
    location.href = '/';
  });
  els.btnResign.addEventListener('click', () => {
    if (!confirm('Wirklich aufgeben?')) return;
    socket.emit('game:resign');
  });
  els.btnDraw.addEventListener('click', () => {
    if (state.drawOffer && state.drawOffer.by !== myColor) socket.emit('game:draw_accept');
    else socket.emit('game:draw_offer');
  });
  els.btnRematch.addEventListener('click', () => socket.emit('game:rematch_offer'));
  els.endRematch.addEventListener('click', () => {
    socket.emit('game:rematch_offer');
    els.endModal.classList.add('hidden');
  });
  els.endLeave.addEventListener('click', () => {
    socket.emit('room:leave');
    Api.clearSeat(code);
    location.href = '/';
  });

  els.chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = els.chatInput.value.trim();
    if (!text) return;
    if (text === '/draw') {
      socket.emit('game:draw_accept');
    } else if (text === '/resign') {
      socket.emit('game:resign');
    } else {
      socket.emit('chat:send', { text });
    }
    els.chatInput.value = '';
  });

  // Socket events
  socket.on('connect', () => {
    socket.emit('auth', { token: Api.getToken() }, () => joinRoom());
  });
  socket.on('room:state', (s) => { if (s.code === code) refreshFromState(s); });
  socket.on('game:move', (data) => {
    if (state && data.move) {
      state.moves = (state.moves || []).concat(data.move);
      state.fen = data.fen;
      state.turn = data.turn;
      state.clock = data.clock;
      lastClock = data.clock ? { whiteMs: data.clock.whiteMs, blackMs: data.clock.blackMs } : null;
      lastClockReceivedAt = Date.now();
      board.applyMove(data.move);
      board.setInteractive(state.status === 'active' && (myColor === 'w' || myColor === 'b') && myColor === state.turn);
      renderMoves();
      renderStatus();
      refreshClocks();
    }
  });
  socket.on('clock:tick', (snap) => {
    if (!state) return;
    state.clock = snap;
    lastClock = snap ? { whiteMs: snap.whiteMs, blackMs: snap.blackMs } : null;
    lastClockReceivedAt = Date.now();
    refreshClocks();
  });
  socket.on('game:end', (data) => {
    showEndModal(data);
  });
  socket.on('game:restart', (s) => {
    Api.saveSeat(code, myColor === 'w' ? 'b' : 'w', mySeatToken);
    myColor = myColor === 'w' ? 'b' : 'w';
    els.endModal.classList.add('hidden');
    refreshFromState(s);
  });
  socket.on('chat:message', (msg) => appendChat(msg));
  socket.on('app:error', (e) => setStatus(e.message));

  function showEndModal(data) {
    const labels = {
      checkmate: 'Schachmatt',
      resignation: 'Aufgegeben',
      timeout: 'Zeit abgelaufen',
      draw_agreement: 'Remis vereinbart',
      stalemate: 'Patt',
      insufficient_material: 'Unzureichendes Material',
      threefold_repetition: 'Stellungswiederholung',
      fifty_move_rule: '50-Züge-Regel',
    };
    let outcome = 'Remis';
    if (data.result === '1-0') outcome = 'Weiß gewinnt';
    else if (data.result === '0-1') outcome = 'Schwarz gewinnt';
    els.endTitle.textContent = outcome;
    els.endDetail.textContent = labels[data.termination] || data.termination || '';
    els.endPgn.textContent = data.pgn || '';
    els.endModal.classList.remove('hidden');
  }

  // ---- Voice chat ---------------------------------------------------------
  let voice = null;
  function setupVoice() {
    if (voice) return;
    if (!window.Chess2Voice || !navigator.mediaDevices) {
      els.voiceStatus.textContent = 'Sprachchat im Browser nicht verfügbar';
      return;
    }
    voice = new window.Chess2Voice.VoiceChat(socket);
    voice.onStateChange = renderVoice;
    voice.onLevel = (which, level) => {
      const playerEl = whichPlayerEl(which);
      if (playerEl) {
        playerEl.style.setProperty('--speak-level', String(Math.min(1, level * 5)));
        playerEl.classList.toggle('speaking', level > 0.04);
      }
    };
    renderVoice();
  }

  function whichPlayerEl(which) {
    // 'local' -> me, 'remote' -> opponent. Map to bottom/top player cards.
    if (which === 'local') return els.playerBottom;
    if (which === 'remote') return els.playerTop;
    return null;
  }

  function renderVoice() {
    if (!voice) return;
    const isPlayer = myColor === 'w' || myColor === 'b';
    const finished = state && state.status === 'finished';
    els.btnVoice.disabled = !isPlayer || finished || voice.state === 'enabling';
    const labels = {
      idle: '🎙️ Stimme',
      enabling: '… Mikrofon wird angefragt',
      waiting: '⏳ Wartet auf Gegner',
      connecting: '… Verbinde',
      connected: '🔴 Stimme aktiv',
      error: '⚠️ Stimme aus',
    };
    els.btnVoice.textContent = labels[voice.state] || 'Stimme';
    els.btnMute.classList.toggle('hidden', voice.state === 'idle' || !voice.localStream);
    els.btnMute.textContent = voice.muted ? '🔊 Aufheben' : '🔇 Stumm';
    const status = {
      idle: '',
      enabling: 'Mikrofon-Berechtigung wird angefragt…',
      waiting: 'Mikrofon ist an. Sobald dein Gegner Stimme aktiviert, wird verbunden.',
      connecting: 'Baue Peer-Verbindung auf…',
      connected: voice.muted ? 'Du bist stummgeschaltet.' : 'Direkter Audio-Channel zwischen euch beiden.',
      error: voice.error || 'Sprach-Verbindung fehlgeschlagen.',
    };
    els.voiceStatus.textContent = status[voice.state] || '';
  }

  els.btnVoice.addEventListener('click', () => {
    if (!voice) return;
    if (voice.state === 'idle' || voice.state === 'error') voice.enable();
    else voice.disable();
  });
  els.btnMute.addEventListener('click', () => { if (voice) voice.toggleMute(); });

  setupVoice();
  // Re-render on each state refresh so the button enabled-state matches.
  const _origRefreshFromState = refreshFromState;
  refreshFromState = function (newState) {
    _origRefreshFromState(newState);
    renderVoice();
  };

  // ---- Chessnut Bluetooth board -----------------------------------------
  let chessnut = null;
  function setupChessnut() {
    if (chessnut) return;
    if (!window.Chess2Chessnut) return;
    if (!window.Chess2Chessnut.ChessnutBoard.isSupported()) {
      // Hide entire bar if browser doesn't have Web Bluetooth.
      els.chessnutBar.classList.add('hidden');
      return;
    }
    chessnut = new window.Chess2Chessnut.ChessnutBoard();
    chessnut.onConnect = (name) => {
      setChessnutStatus('Verbunden mit ' + name + '. Stelle die Startaufstellung auf.');
      renderChessnut();
      // Show legal source squares as LEDs while it's my turn.
      updateChessnutLeds();
    };
    chessnut.onDisconnect = () => {
      setChessnutStatus('Brett getrennt.');
      renderChessnut();
    };
    chessnut.onBoardChange = (physical) => handleBoardChange(physical);
    renderChessnut();
  }
  function setChessnutStatus(msg) { els.chessnutStatus.textContent = msg || ''; }
  function renderChessnut() {
    // Bar is only useful on standard 8x8 boards.
    const isStandard = state && state.shape === 'standard';
    els.chessnutBar.classList.toggle('hidden', !isStandard || !chessnut);
    if (!chessnut) return;
    els.btnChessnut.textContent = chessnut.connected ? '♟ Trennen' : '♟ Chessnut verbinden';
    els.btnChessnutFlip.classList.toggle('hidden', !chessnut.connected);
  }

  let lastBoardSnapshot = null;
  function handleBoardChange(physical) {
    if (!state || state.status !== 'active') return;
    if (state.shape !== 'standard') return;
    lastBoardSnapshot = physical;
    const result = window.Chess2Chessnut.detectMove(physical, board.engine);
    if (result.status === 'in-sync') {
      setChessnutStatus('Brett synchron.');
      return;
    }
    if (result.status === 'in-progress') {
      setChessnutStatus('Figur in der Hand…');
      return;
    }
    if (result.status === 'invalid') {
      setChessnutStatus('Stellung weicht ab. Bitte den letzten Zug auf dem Brett vollziehen.');
      // Light the squares the engine expects to be empty/occupied differently.
      flashSyncHint();
      return;
    }
    // result.status === 'move' - submit if it's our turn
    const seatColor = myColor === 'w' || myColor === 'b' ? myColor : null;
    if (!seatColor || seatColor !== state.turn) {
      setChessnutStatus('Dein Gegner ist am Zug.');
      return;
    }
    setChessnutStatus('Zug erkannt: ' + result.from + '→' + result.to + (result.promotion ? '=' + result.promotion.toUpperCase() : ''));
    socket.emit('game:move', {
      from: result.from, to: result.to, promotion: result.promotion,
    }, (res) => {
      if (res && res.error) setChessnutStatus('Zug abgelehnt: ' + res.error);
    });
  }

  function updateChessnutLeds() {
    if (!chessnut || !chessnut.connected) return;
    if (!state || state.status !== 'active') { chessnut.clearLeds(); return; }
    if (state.shape !== 'standard') { chessnut.clearLeds(); return; }
    // Highlight the opponent's last move so the human knows what to replay on
    // the board. When it's my turn this means: the squares the opponent's
    // piece came from and landed on.
    const moves = state.moves || [];
    if (moves.length === 0) { chessnut.clearLeds(); return; }
    const last = moves[moves.length - 1];
    chessnut.setLeds([last.from, last.to]);
  }

  function flashSyncHint() {
    if (!chessnut || !chessnut.connected) return;
    // Show the most recent move (opponent's) as a hint of what to put on the board.
    const moves = state && state.moves;
    if (moves && moves.length) {
      const last = moves[moves.length - 1];
      chessnut.setLeds([last.from, last.to]);
    }
  }

  els.btnChessnut.addEventListener('click', async () => {
    setupChessnut();
    if (!chessnut) {
      setChessnutStatus('Web Bluetooth wird in diesem Browser nicht unterstützt (iOS Safari: nein).');
      return;
    }
    if (chessnut.connected) {
      await chessnut.disconnect();
      return;
    }
    setChessnutStatus('Suche Chessnut-Brett… (Bluetooth-Dialog beachten)');
    try { await chessnut.connect(); }
    catch (err) {
      setChessnutStatus(err && err.message ? 'Fehler: ' + err.message : 'Verbindung abgebrochen.');
    }
  });
  els.btnChessnutFlip.addEventListener('click', () => {
    if (chessnut) chessnut.flipOrientation();
  });

  // Pre-create the wrapper (so the bar visibility logic kicks in early), but
  // only construct the actual ChessnutBoard on first connect click.
  setupChessnut();

  // Hook into existing refresh cycle: update bar visibility and LEDs whenever
  // the state changes. We layer over refreshFromState - voice already
  // monkey-patches it, so re-grab the current binding to chain.
  const _origRefreshFromState2 = refreshFromState;
  refreshFromState = function (newState) {
    _origRefreshFromState2(newState);
    renderChessnut();
    updateChessnutLeds();
    // Re-evaluate physical board against new engine state (e.g., after
    // opponent's move sync prompt should clear once you replay it).
    if (chessnut && chessnut.connected && lastBoardSnapshot) handleBoardChange(lastBoardSnapshot);
  };

  // Local tick for smooth clock display between server updates.
  clockTimer = setInterval(refreshClocks, 200);
  window.addEventListener('beforeunload', () => {
    clearInterval(clockTimer);
    if (voice) voice.disable();
    if (chessnut && chessnut.connected) chessnut.disconnect();
  });
})();
