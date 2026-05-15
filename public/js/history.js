(function () {
  const Api = window.Chess2Api;
  const els = {
    authArea: document.getElementById('auth-area'),
    authRequired: document.getElementById('auth-required'),
    form: document.getElementById('filter-form'),
    from: document.getElementById('filter-from'),
    to: document.getElementById('filter-to'),
    opponent: document.getElementById('filter-opponent'),
    result: document.getElementById('filter-result'),
    reset: document.getElementById('filter-reset'),
    list: document.getElementById('games-list'),
    loadMore: document.getElementById('load-more'),
    confirmModal: document.getElementById('confirm-modal'),
    confirmDelete: document.getElementById('confirm-delete'),
    confirmCancel: document.getElementById('confirm-cancel'),
  };
  const PAGE_SIZE = 30;
  let user = null;
  let offset = 0;
  let pendingDelete = null;

  function escapeHtml(s) {
    return String(s).replace(/[&<>"'`]/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;','`':'&#96;' }[c]));
  }

  function shapeLabel(s, opts) {
    if (s === 'octagon') return 'Achteck';
    if (s === 'hexagon') return 'Sechseck';
    if (s === 'cross') return 'Kreuz';
    if (s === 'hole') return 'Loch';
    if (s === 'custom') return opts ? opts.width + 'x' + opts.height : 'Custom';
    return 'Standard';
  }

  function resultLabel(r) {
    if (r === 'win') return 'Sieg';
    if (r === 'loss') return 'Niederlage';
    if (r === 'draw') return 'Remis';
    return r || '?';
  }

  function resultClass(r) {
    if (r === 'win') return 'pill-win';
    if (r === 'loss') return 'pill-loss';
    if (r === 'draw') return 'pill-draw';
    return '';
  }

  function formatDate(s) {
    if (!s) return '';
    const d = new Date(s);
    if (isNaN(d.getTime())) return s;
    // Use the user's locale so dates feel native.
    return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }

  function formatTC(tc) {
    if (!tc || !tc.initial) return 'ohne Uhr';
    return Math.round(tc.initial / 60) + '+' + tc.increment;
  }

  function renderRow(g) {
    const li = document.createElement('li');
    li.className = 'history-row';
    li.dataset.id = g.id;
    const left = document.createElement('div');
    left.className = 'history-left';
    left.innerHTML =
      '<div class="history-line1">' +
      '<span class="history-opponent">' + escapeHtml(g.opponentName || '?') + '</span>' +
      ' <span class="pill ' + resultClass(g.myResult) + '">' + resultLabel(g.myResult) + '</span>' +
      (g.shape && g.shape !== 'standard' ? ' <span class="pill">' + shapeLabel(g.shape, g.shapeOpts) + '</span>' : '') +
      (g.rated ? ' <span class="pill">bewertet</span>' : '') +
      '</div>' +
      '<div class="history-line2 muted">' +
      escapeHtml(formatDate(g.finishedAt)) +
      ' • ' + escapeHtml(formatTC(g.timeControl)) +
      (g.side === 'w' ? ' • du als Weiß' : ' • du als Schwarz') +
      '</div>';
    const right = document.createElement('div');
    right.className = 'history-actions';
    const reviewBtn = document.createElement('a');
    reviewBtn.href = '/game.html?archive=' + g.id;
    reviewBtn.className = 'btn btn-primary';
    reviewBtn.textContent = 'Ansehen';
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn btn-ghost';
    deleteBtn.textContent = 'Löschen';
    deleteBtn.setAttribute('aria-label', 'Partie gegen ' + (g.opponentName || '?') + ' löschen');
    deleteBtn.addEventListener('click', () => askDelete(g));
    right.appendChild(reviewBtn);
    right.appendChild(deleteBtn);
    li.appendChild(left);
    li.appendChild(right);
    return li;
  }

  function askDelete(game) {
    pendingDelete = game;
    Api.openModal(els.confirmModal);
  }

  els.confirmCancel.addEventListener('click', () => {
    pendingDelete = null;
    Api.closeModal(els.confirmModal);
  });

  els.confirmDelete.addEventListener('click', async () => {
    if (!pendingDelete) return;
    const id = pendingDelete.id;
    Api.closeModal(els.confirmModal);
    try {
      await Api.request('/api/games/' + id, { method: 'DELETE' });
      // Remove the row from the DOM.
      const li = els.list.querySelector('li[data-id="' + id + '"]');
      if (li) li.remove();
      if (!els.list.querySelector('.history-row')) {
        els.list.innerHTML = '<li class="muted">Keine Partien zu diesen Filtern.</li>';
      }
    } catch (err) {
      alert('Löschen fehlgeschlagen: ' + err.message);
    }
    pendingDelete = null;
  });

  function buildQuery() {
    const qs = new URLSearchParams();
    if (els.from.value) qs.set('from', els.from.value);
    if (els.to.value) qs.set('to', els.to.value);
    if (els.opponent.value.trim()) qs.set('opponent', els.opponent.value.trim());
    if (els.result.value) qs.set('result', els.result.value);
    qs.set('limit', String(PAGE_SIZE));
    qs.set('offset', String(offset));
    return qs.toString();
  }

  async function loadGames(reset) {
    if (reset) {
      offset = 0;
      els.list.innerHTML = '<li class="muted">Lade...</li>';
    }
    try {
      const res = await Api.request('/api/games?' + buildQuery());
      const entries = res.entries || [];
      if (reset) els.list.innerHTML = '';
      if (entries.length === 0 && offset === 0) {
        els.list.innerHTML = '<li class="muted">Noch keine Partien mit diesen Filtern. Spiel ein paar Partien als eingeloggter Nutzer - sie landen hier automatisch.</li>';
      }
      for (const g of entries) els.list.appendChild(renderRow(g));
      offset += entries.length;
      els.loadMore.classList.toggle('hidden', entries.length < PAGE_SIZE);
    } catch (err) {
      if (err.message && err.message.includes('Login')) {
        els.authRequired.classList.remove('hidden');
        els.list.innerHTML = '';
        els.loadMore.classList.add('hidden');
        return;
      }
      els.list.innerHTML = '<li class="error">' + escapeHtml(err.message) + '</li>';
    }
  }

  els.form.addEventListener('submit', (e) => {
    e.preventDefault();
    loadGames(true);
  });
  els.reset.addEventListener('click', () => {
    els.form.reset();
    loadGames(true);
  });
  els.loadMore.addEventListener('click', () => loadGames(false));

  // Topbar auth area (mirrors the lobby pattern).
  function renderAuth() {
    els.authArea.innerHTML = '';
    if (user) {
      const home = document.createElement('a');
      home.href = '/';
      home.className = 'btn btn-ghost';
      home.textContent = '← Lobby';
      els.authArea.appendChild(home);
      const logout = document.createElement('button');
      logout.className = 'btn btn-ghost';
      logout.textContent = 'Logout (' + user.username + ')';
      logout.addEventListener('click', () => {
        Api.setToken(null);
        user = null;
        location.href = '/';
      });
      els.authArea.appendChild(logout);
    } else {
      const home = document.createElement('a');
      home.href = '/';
      home.className = 'btn btn-primary';
      home.textContent = 'Zur Lobby';
      els.authArea.appendChild(home);
    }
  }

  async function init() {
    if (Api.getToken()) {
      try {
        const me = await Api.request('/api/auth/me');
        user = me.user;
      } catch { user = null; }
    }
    renderAuth();
    if (!user) {
      els.authRequired.classList.remove('hidden');
      els.list.innerHTML = '';
      els.loadMore.classList.add('hidden');
      return;
    }
    loadGames(true);
  }

  init();
})();
