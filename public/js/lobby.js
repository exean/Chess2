(function () {
  const Api = window.Chess2Api;
  const socket = io({ autoConnect: true });

  const els = {
    nick: document.getElementById('nickname'),
    loggedIn: document.getElementById('logged-in-as'),
    authArea: document.getElementById('auth-area'),
    create: document.getElementById('btn-create'),
    join: document.getElementById('btn-join'),
    joinCode: document.getElementById('join-code'),
    publicList: document.getElementById('public-list'),
    refresh: document.getElementById('btn-refresh'),
    leaderboard: document.getElementById('leaderboard'),
    tcInitial: document.getElementById('tc-initial'),
    tcInc: document.getElementById('tc-increment'),
    seat: document.getElementById('seat'),
    visibility: document.getElementById('visibility'),
    rated: document.getElementById('rated'),
    shape: document.getElementById('shape'),
    shapeHint: document.getElementById('shape-hint'),
    opponent: document.getElementById('opponent'),
    customSize: document.getElementById('custom-size'),
    customW: document.getElementById('custom-w'),
    customH: document.getElementById('custom-h'),
    pausedSection: document.getElementById('paused-section'),
    pausedList: document.getElementById('paused-list'),
    authModal: document.getElementById('auth-modal'),
    authForm: document.getElementById('auth-form'),
    authTitle: document.getElementById('auth-title'),
    authError: document.getElementById('auth-error'),
    showLogin: document.getElementById('btn-show-login'),
    showRegister: document.getElementById('btn-show-register'),
  };

  function shapeHintText(s) {
    if (s === 'octagon') return 'Achteck 14x14: Reihenbreiten 8/10/12/14×8/12/10/8. Standard-Aufstellung in den 8er-Rändern oben und unten, Bauern wandeln am tatsächlichen Brettrand. Unbewertet.';
    if (s === 'hexagon') return 'Sechseck 16x9: Reihen 8/10/12/14/16/14/12/10/8. Aufstellung in den schmalen Außenreihen. Mittlere Reihe ist 16 Felder breit. Unbewertet.';
    if (s === 'cross') return 'Kreuz 12x12: Standard-Aufstellung in der Mitte, Bauern wandeln am tatsächlichen Brettrand (= längere Partien in den Armen). Unbewertet.';
    if (s === 'hole') return 'Loch 10x10: zentrales 2×2-Loch (e5/f5/e6/f6). Figuren können nicht über das Loch hinweg ziehen, Bauern müssen es per Diagonalschlag oder über die Flanken umlaufen. Unbewertet.';
    if (s === 'custom') return 'Benutzerdefiniertes Rechteck: 8 Standard-Figuren werden zentriert in der Heimreihe platziert. Bauern wandeln am Brettrand. Unbewertet.';
    return '';
  }
  function updateShapeHint() {
    const v = els.shape.value;
    const isBot = (els.opponent.value || '').startsWith('bot-');
    let hint = shapeHintText(v);
    if (isBot) hint = (hint ? hint + ' ' : '') + 'Computer-Partien sind immer privat und unbewertet.';
    els.shapeHint.textContent = hint;
    if (v !== 'standard' || isBot) els.rated.checked = false;
    els.rated.disabled = (v !== 'standard') || isBot || !user;
    if (isBot) els.visibility.value = 'private';
    els.visibility.disabled = isBot;
    if (els.customSize) els.customSize.classList.toggle('hidden', v !== 'custom');
  }
  els.shape.addEventListener('change', updateShapeHint);
  els.opponent.addEventListener('change', updateShapeHint);

  function clampCustomDim(input, min, max) {
    if (!input) return;
    const n = parseInt(input.value, 10);
    if (!Number.isFinite(n)) input.value = String(min);
    else if (n < min) input.value = String(min);
    else if (n > max) input.value = String(max);
  }
  if (els.customW) els.customW.addEventListener('change', () => clampCustomDim(els.customW, 8, 26));
  if (els.customH) els.customH.addEventListener('change', () => clampCustomDim(els.customH, 4, 20));

  els.nick.value = Api.getName();
  els.nick.addEventListener('input', () => Api.setName(els.nick.value));

  let user = null;
  let mode = 'login';

  function renderAuth() {
    if (user) {
      els.authArea.innerHTML = '';
      const friends = document.createElement('a');
      friends.href = '/friends.html';
      friends.className = 'btn btn-ghost';
      friends.textContent = 'Freunde';
      els.authArea.appendChild(friends);
      const history = document.createElement('a');
      history.href = '/history.html';
      history.className = 'btn btn-ghost';
      history.textContent = 'Meine Partien';
      els.authArea.appendChild(history);
      const btn = document.createElement('button');
      btn.className = 'btn btn-ghost';
      btn.textContent = 'Logout (' + user.username + ')';
      btn.addEventListener('click', () => {
        Api.setToken(null);
        user = null;
        location.reload();
      });
      els.authArea.appendChild(btn);
      els.loggedIn.classList.remove('hidden');
      els.loggedIn.textContent = 'Eingeloggt als ' + user.username + ' (Rating ' + user.rating + ')';
      els.nick.value = user.username;
      els.nick.disabled = true;
    } else {
      els.loggedIn.classList.add('hidden');
      els.nick.disabled = false;
      els.rated.checked = false;
    }
    updateShapeHint();
  }

  async function loadMe() {
    if (!Api.getToken()) { renderAuth(); return; }
    try {
      const res = await Api.request('/api/auth/me');
      user = res.user;
    } catch {
      user = null;
      Api.setToken(null);
    }
    renderAuth();
    auth();
  }

  function auth() {
    socket.emit('auth', { token: Api.getToken() }, () => {});
  }

  function openAuth(which) {
    mode = which;
    els.authTitle.textContent = which === 'login' ? 'Login' : 'Account erstellen';
    els.authError.classList.add('hidden');
    els.authForm.reset();
    Api.openModal(els.authModal);
    els.authForm.querySelector('input[name=username]').focus();
  }

  els.showLogin.addEventListener('click', () => openAuth('login'));
  els.showRegister.addEventListener('click', () => openAuth('register'));
  els.authModal.addEventListener('click', (e) => {
    if (e.target === els.authModal || e.target.dataset.close !== undefined) {
      Api.closeModal(els.authModal);
    }
  });

  els.authForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(els.authForm));
    try {
      const path = mode === 'login' ? '/api/auth/login' : '/api/auth/register';
      const res = await Api.request(path, { method: 'POST', body: data });
      Api.setToken(res.token);
      user = res.user;
      Api.closeModal(els.authModal);
      renderAuth();
      auth();
      loadLeaderboard();
    } catch (err) {
      els.authError.textContent = err.message;
      els.authError.classList.remove('hidden');
    }
  });

  function timeControl() {
    return {
      initial: Number(els.tcInitial.value) * 60,
      increment: Number(els.tcInc.value),
    };
  }

  els.create.addEventListener('click', () => {
    try {
      const name = (els.nick.value || '').trim();
      if (!name && !user) {
        alert('Bitte zuerst einen Nicknamen eingeben.');
        els.nick.focus();
        return;
      }
      Api.setName(name);
      const payload = {
        name: name,
        visibility: els.visibility.value,
        timeControl: timeControl(),
        rated: els.rated.checked,
        seat: els.seat.value,
        shape: els.shape.value,
        opponent: els.opponent.value,
      };
      if (els.shape.value === 'custom') {
        if (!els.customW || !els.customH) {
          alert('Custom-Brett: Eingabefelder fehlen. Bitte Seite mit Strg+Umschalt+R neu laden.');
          return;
        }
        clampCustomDim(els.customW, 8, 26);
        clampCustomDim(els.customH, 4, 20);
        const w = parseInt(els.customW.value, 10);
        const h = parseInt(els.customH.value, 10);
        if (!Number.isFinite(w) || !Number.isFinite(h)) {
          alert('Bitte gültige Zahlen für Spalten/Reihen eingeben.');
          return;
        }
        payload.customSize = { width: w, height: h };
      }
      socket.emit('room:create', payload, (res) => {
        if (!res) { alert('Keine Antwort vom Server.'); return; }
        if (res.error) { alert(res.error); return; }
        if (!res.code) { alert('Server hat keinen Raum-Code zurückgegeben.'); return; }
        Api.saveSeat(res.code, res.color, res.seatToken);
        location.href = '/game.html?code=' + encodeURIComponent(res.code);
      });
    } catch (err) {
      console.error('Create-Klick fehlgeschlagen:', err);
      alert('Fehler beim Erstellen: ' + (err && err.message ? err.message : err));
    }
  });

  els.join.addEventListener('click', () => {
    const code = (els.joinCode.value || '').trim().toUpperCase();
    if (!code) { els.joinCode.focus(); return; }
    location.href = '/game.html?code=' + encodeURIComponent(code);
  });

  els.joinCode.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') els.join.click();
  });

  function renderPublic(rooms) {
    if (!rooms.length) {
      els.publicList.innerHTML = '<li class="muted">Niemand wartet gerade. Erstelle einen Raum - der nächste, der die Lobby öffnet, sieht ihn hier.</li>';
      return;
    }
    els.publicList.innerHTML = '';
    for (const r of rooms) {
      const li = document.createElement('li');
      const left = document.createElement('div');
      left.innerHTML = '<strong>' + escapeHtml(r.host) + '</strong>' +
        (r.hostRating ? ' <span class="pill">' + r.hostRating + '</span>' : '') +
        ' <span class="pill">' + formatTC(r.timeControl) + '</span>' +
        (r.shape && r.shape !== 'standard' ? ' <span class="pill">' + shapeLabel(r.shape, r.shapeOpts) + '</span>' : '') +
        (r.rated ? ' <span class="pill">bewertet</span>' : '');
      const btn = document.createElement('button');
      btn.className = 'btn btn-primary';
      btn.textContent = 'Beitreten';
      btn.addEventListener('click', () => {
        const name = (els.nick.value || '').trim();
        if (!name && !user) { alert('Bitte Nicknamen eingeben.'); return; }
        Api.setName(name);
        location.href = '/game.html?code=' + encodeURIComponent(r.code);
      });
      li.appendChild(left);
      li.appendChild(btn);
      els.publicList.appendChild(li);
    }
  }

  function formatTC(tc) {
    if (!tc || !tc.initial) return 'ohne Uhr';
    return Math.round(tc.initial / 60) + '+' + tc.increment;
  }

  function shapeLabel(s, opts) {
    if (s === 'octagon') return 'Achteck';
    if (s === 'hexagon') return 'Sechseck';
    if (s === 'cross') return 'Kreuz';
    if (s === 'hole') return 'Loch';
    if (s === 'custom') return opts ? opts.width + 'x' + opts.height : 'Custom';
    return s;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"'`]/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;','`':'&#96;' }[c]));
  }

  function refreshPublic() {
    socket.emit('lobby:list', null, (res) => renderPublic(res.rooms || []));
  }
  els.refresh.addEventListener('click', refreshPublic);

  async function loadLeaderboard() {
    try {
      const res = await Api.request('/api/auth/leaderboard');
      if (!res.entries.length) {
        els.leaderboard.innerHTML = '<li class="muted">Die Bestenliste beginnt mit der ersten bewerteten Standard-Partie. Log dich ein und leg los.</li>';
        return;
      }
      els.leaderboard.innerHTML = '';
      res.entries.forEach((e, i) => {
        const li = document.createElement('li');
        li.innerHTML = '<span><strong>' + (i + 1) + '. ' + escapeHtml(e.username) + '</strong></span>' +
          '<span class="pill">' + e.rating + ' (' + e.games_played + ')</span>';
        els.leaderboard.appendChild(li);
      });
    } catch {
      els.leaderboard.innerHTML = '<li class="muted">Bestenliste nicht verfügbar.</li>';
    }
  }

  socket.on('connect', () => { auth(); refreshPublic(); });
  socket.on('lobby:list', (data) => renderPublic(data.rooms || []));

  // Incoming friend challenge popup. Wired only when a #incoming-modal
  // element exists on the page (the lobby has one).
  const inModal = document.getElementById('incoming-modal');
  if (inModal) {
    let activeChallenge = null;
    const inFrom = document.getElementById('lobby-incoming-from');
    const inDetail = document.getElementById('lobby-incoming-detail');
    const inAccept = document.getElementById('lobby-incoming-accept');
    const inDecline = document.getElementById('lobby-incoming-decline');
    const shapeNames = { standard: 'Standard', octagon: 'Achteck', hexagon: 'Sechseck', cross: 'Kreuz', hole: 'Loch', custom: 'Custom' };
    socket.on('friend:incoming_challenge', (data) => {
      if (window.Chess2Sound) window.Chess2Sound.notification();
      activeChallenge = data;
      inFrom.textContent = data.from.username + (data.from.rating ? ' (' + data.from.rating + ')' : '');
      const tc = data.timeControl && data.timeControl.initial
        ? Math.round(data.timeControl.initial / 60) + '+' + data.timeControl.increment
        : 'ohne Uhr';
      inDetail.textContent = (shapeNames[data.shape] || data.shape) + ' • ' + tc +
        ' • du als ' + (data.yourColor === 'w' ? 'Weiß' : 'Schwarz');
      Api.openModal(inModal);
    });
    inAccept.addEventListener('click', () => {
      if (!activeChallenge) return;
      socket.emit('friend:accept_challenge', { challengeToken: activeChallenge.challengeToken }, (res) => {
        if (res && res.error) { alert(res.error); Api.closeModal(inModal); return; }
        Api.saveSeat(res.code, res.color, res.seatToken);
        location.href = '/game.html?code=' + encodeURIComponent(res.code);
      });
    });
    inDecline.addEventListener('click', () => {
      if (!activeChallenge) return;
      socket.emit('friend:decline_challenge', { challengeToken: activeChallenge.challengeToken });
      activeChallenge = null;
      Api.closeModal(inModal);
    });
  }

  // PWA shortcut: /?action=create -> trigger room creation as soon as a
  // nickname is available.
  if (new URLSearchParams(location.search).get('action') === 'create') {
    const trigger = () => {
      const name = (els.nick.value || '').trim();
      if (name || user) els.create.click();
      else els.nick.focus();
    };
    if (document.readyState === 'complete') trigger();
    else window.addEventListener('load', trigger);
  }

  // Resumable bot games belonging to the logged-in user.
  async function loadPausedSessions() {
    if (!user) { els.pausedSection.classList.add('hidden'); return; }
    try {
      const res = await Api.request('/api/bot-sessions');
      const sessions = res.entries || [];
      if (!sessions.length) { els.pausedSection.classList.add('hidden'); return; }
      els.pausedSection.classList.remove('hidden');
      els.pausedList.innerHTML = '';
      for (const s of sessions) {
        const li = document.createElement('li');
        const info = document.createElement('div');
        const diffLabel = ({ easy: 'leicht', medium: 'mittel', hard: 'schwer' })[s.botDifficulty] || s.botDifficulty;
        const shape = shapeLabel(s.shape, s.shapeOpts);
        const tc = formatTC(s.timeControl);
        const when = new Date(s.pausedAt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
        info.innerHTML = '<strong>Computer (' + escapeHtml(diffLabel) + ')</strong>' +
          ' <span class="pill">' + escapeHtml(shape) + '</span>' +
          ' <span class="pill">' + escapeHtml(tc) + '</span>' +
          ' <span class="pill">' + (s.userColor === 'w' ? 'als Weiß' : 'als Schwarz') + '</span>' +
          '<div class="muted history-line2">pausiert ' + escapeHtml(when) + '</div>';
        const actions = document.createElement('div');
        actions.className = 'history-actions';
        const resume = document.createElement('button');
        resume.className = 'btn btn-primary';
        resume.textContent = 'Fortsetzen';
        resume.addEventListener('click', () => resumeSession(s.id, resume));
        const discard = document.createElement('button');
        discard.className = 'btn btn-ghost';
        discard.textContent = 'Verwerfen';
        discard.addEventListener('click', () => discardSession(s.id));
        actions.appendChild(resume);
        actions.appendChild(discard);
        li.className = 'history-row';
        li.appendChild(info);
        li.appendChild(actions);
        els.pausedList.appendChild(li);
      }
    } catch (err) {
      // 401 just means not logged in - hide section silently.
      els.pausedSection.classList.add('hidden');
    }
  }

  async function resumeSession(id, btn) {
    btn.disabled = true;
    try {
      const res = await Api.request('/api/bot-sessions/' + id + '/resume', { method: 'POST' });
      Api.saveSeat(res.code, res.color, res.seatToken);
      location.href = '/game.html?code=' + encodeURIComponent(res.code);
    } catch (err) {
      alert('Fortsetzen fehlgeschlagen: ' + err.message);
      btn.disabled = false;
    }
  }
  async function discardSession(id) {
    if (!confirm('Pausierte Partie verwerfen?')) return;
    try {
      await Api.request('/api/bot-sessions/' + id, { method: 'DELETE' });
      loadPausedSessions();
    } catch (err) {
      alert('Verwerfen fehlgeschlagen: ' + err.message);
    }
  }

  // Refresh after login completes (renderAuth -> auth -> ...).
  const _origRenderAuth = renderAuth;
  renderAuth = function () { _origRenderAuth(); loadPausedSessions(); };

  loadMe();
  loadLeaderboard();
})();
