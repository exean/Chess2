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
    authModal: document.getElementById('auth-modal'),
    authForm: document.getElementById('auth-form'),
    authTitle: document.getElementById('auth-title'),
    authError: document.getElementById('auth-error'),
    showLogin: document.getElementById('btn-show-login'),
    showRegister: document.getElementById('btn-show-register'),
  };

  function shapeHintText(s) {
    if (s === 'octagon') return 'Achteck 10x10: 4 Eckfelder fehlen, Figuren können in die Randspuren ausweichen. Unbewertet.';
    if (s === 'cross') return 'Kreuz 12x12: Standard-Aufstellung in der Mitte, Bauern wandeln am tatsächlichen Brettrand (= längere Partien in den Armen). Unbewertet.';
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
  }
  els.shape.addEventListener('change', updateShapeHint);
  els.opponent.addEventListener('change', updateShapeHint);

  els.nick.value = Api.getName();
  els.nick.addEventListener('input', () => Api.setName(els.nick.value));

  let user = null;
  let mode = 'login';

  function renderAuth() {
    if (user) {
      els.authArea.innerHTML = '';
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
    els.authModal.classList.remove('hidden');
    els.authForm.querySelector('input[name=username]').focus();
  }

  els.showLogin.addEventListener('click', () => openAuth('login'));
  els.showRegister.addEventListener('click', () => openAuth('register'));
  els.authModal.addEventListener('click', (e) => {
    if (e.target === els.authModal || e.target.dataset.close !== undefined) {
      els.authModal.classList.add('hidden');
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
      els.authModal.classList.add('hidden');
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
    const name = (els.nick.value || '').trim();
    if (!name && !user) {
      alert('Bitte zuerst einen Nicknamen eingeben.');
      els.nick.focus();
      return;
    }
    Api.setName(name);
    socket.emit('room:create', {
      name: name,
      visibility: els.visibility.value,
      timeControl: timeControl(),
      rated: els.rated.checked,
      seat: els.seat.value,
      shape: els.shape.value,
      opponent: els.opponent.value,
    }, (res) => {
      if (res.error) { alert(res.error); return; }
      Api.saveSeat(res.code, res.color, res.seatToken);
      location.href = '/game.html?code=' + encodeURIComponent(res.code);
    });
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
      els.publicList.innerHTML = '<li class="muted">Keine offenen Partien.</li>';
      return;
    }
    els.publicList.innerHTML = '';
    for (const r of rooms) {
      const li = document.createElement('li');
      const left = document.createElement('div');
      left.innerHTML = '<strong>' + escapeHtml(r.host) + '</strong>' +
        (r.hostRating ? ' <span class="pill">' + r.hostRating + '</span>' : '') +
        ' <span class="pill">' + formatTC(r.timeControl) + '</span>' +
        (r.shape && r.shape !== 'standard' ? ' <span class="pill">' + shapeLabel(r.shape) + '</span>' : '') +
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

  function shapeLabel(s) {
    if (s === 'octagon') return 'Achteck';
    if (s === 'cross') return 'Kreuz';
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
        els.leaderboard.innerHTML = '<li class="muted">Noch keine bewerteten Partien.</li>';
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

  loadMe();
  loadLeaderboard();
})();
