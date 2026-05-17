(function () {
  const Api = window.Chess2Api;
  const els = {
    authArea: document.getElementById('auth-area'),
    notAdmin: document.getElementById('not-admin'),
    cardImpressum: document.getElementById('card-impressum'),
    cardUsers: document.getElementById('card-users'),
    form: document.getElementById('settings-form'),
    settingsStatus: document.getElementById('settings-status'),
    usersList: document.getElementById('users-list'),
    usersCount: document.getElementById('users-count'),
    usersSearch: document.getElementById('users-search'),
  };

  let me = null;
  let allUsers = [];

  function esc(s) {
    return String(s || '').replace(/[&<>"'`]/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;','`':'&#96;' }[c]));
  }

  function renderAuth() {
    els.authArea.innerHTML = '';
    if (me) {
      const home = document.createElement('a');
      home.href = '/';
      home.className = 'btn btn-ghost';
      home.textContent = '← Lobby';
      els.authArea.appendChild(home);
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
      const logout = document.createElement('button');
      logout.className = 'btn btn-ghost';
      logout.textContent = 'Logout (' + me.username + ')';
      logout.addEventListener('click', () => { Api.setToken(null); me = null; location.href = '/'; });
      els.authArea.appendChild(logout);
    } else {
      const home = document.createElement('a');
      home.href = '/';
      home.className = 'btn btn-primary';
      home.textContent = 'Zur Lobby';
      els.authArea.appendChild(home);
    }
  }

  function formatDate(s) {
    if (!s) return '';
    const d = new Date(s);
    if (isNaN(d.getTime())) return s;
    return d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
  }

  function applySearch() {
    const q = (els.usersSearch.value || '').toLowerCase().trim();
    const filtered = q
      ? allUsers.filter((u) => u.username.toLowerCase().includes(q))
      : allUsers;
    renderUsers(filtered);
  }
  els.usersSearch.addEventListener('input', applySearch);

  function renderUsers(users) {
    els.usersList.innerHTML = '';
    els.usersCount.textContent = '(' + users.length + ' von ' + allUsers.length + ')';
    if (!users.length) {
      els.usersList.innerHTML = '<li class="muted">Keine User gefunden.</li>';
      return;
    }
    for (const u of users) {
      const li = document.createElement('li');
      li.className = 'history-row';
      const info = document.createElement('div');
      info.className = 'history-left';
      info.innerHTML =
        '<span class="history-opponent">' + esc(u.username) + '</span>' +
        ' <span class="pill">Rating ' + u.rating + '</span>' +
        (u.isAdmin ? ' <span class="pill accent">Admin</span>' : '') +
        '<div class="history-line2 muted">' +
        u.gamesPlayed + ' Partien · ' +
        u.wins + 'S/' + u.losses + 'N/' + u.draws + 'R · ' +
        (u.email ? esc(u.email) + ' · ' : '') +
        'registriert ' + esc(formatDate(u.createdAt)) +
        '</div>';
      const actions = document.createElement('div');
      actions.className = 'history-actions';
      const adminBtn = document.createElement('button');
      adminBtn.className = 'btn ' + (u.isAdmin ? 'btn-ghost' : 'btn-hot');
      adminBtn.textContent = u.isAdmin ? 'Admin entziehen' : 'Zum Admin machen';
      if (u.id === me.id && u.isAdmin) adminBtn.disabled = true;
      adminBtn.addEventListener('click', () => toggleAdmin(u));
      const delBtn = document.createElement('button');
      delBtn.className = 'btn btn-ghost';
      delBtn.textContent = 'Löschen';
      if (u.id === me.id) delBtn.disabled = true;
      delBtn.addEventListener('click', () => deleteUser(u));
      actions.appendChild(adminBtn);
      actions.appendChild(delBtn);
      li.appendChild(info);
      li.appendChild(actions);
      els.usersList.appendChild(li);
    }
  }

  async function toggleAdmin(u) {
    const verb = u.isAdmin ? 'die Admin-Rechte entziehen' : 'zum Admin machen';
    if (!confirm('Willst du ' + u.username + ' ' + verb + '?')) return;
    try {
      await Api.request('/api/admin/users/' + u.id + '/admin', {
        method: 'POST',
        body: { admin: !u.isAdmin },
      });
      await loadUsers();
    } catch (err) {
      alert('Fehler: ' + err.message);
    }
  }

  async function deleteUser(u) {
    if (!confirm('User "' + u.username + '" und alle zugehörigen Daten (Spiele, Freundschaften, etc.) endgültig löschen?')) return;
    try {
      await Api.request('/api/admin/users/' + u.id, { method: 'DELETE' });
      await loadUsers();
    } catch (err) {
      alert('Löschen fehlgeschlagen: ' + err.message);
    }
  }

  async function loadUsers() {
    try {
      const data = await Api.request('/api/admin/users');
      allUsers = data.users || [];
      applySearch();
    } catch (err) {
      els.usersList.innerHTML = '<li class="error">' + esc(err.message) + '</li>';
    }
  }

  async function loadSettings() {
    try {
      const data = await Api.request('/api/admin/settings');
      const settings = data.settings || {};
      for (const input of els.form.querySelectorAll('input')) {
        input.value = settings[input.name] || '';
      }
    } catch (err) {
      console.warn('settings load failed:', err.message);
    }
  }

  els.form.addEventListener('submit', async (e) => {
    e.preventDefault();
    els.settingsStatus.classList.add('hidden');
    const body = {};
    for (const input of els.form.querySelectorAll('input')) {
      body[input.name] = input.value.trim();
    }
    try {
      await Api.request('/api/admin/settings', { method: 'PUT', body });
      els.settingsStatus.textContent = 'Gespeichert.';
      els.settingsStatus.classList.remove('hidden');
      setTimeout(() => els.settingsStatus.classList.add('hidden'), 2500);
    } catch (err) {
      els.settingsStatus.textContent = 'Fehler: ' + err.message;
      els.settingsStatus.classList.remove('hidden');
    }
  });

  async function init() {
    if (!Api.getToken()) { location.href = '/'; return; }
    try {
      const r = await Api.request('/api/auth/me');
      me = r.user;
    } catch {}
    renderAuth();
    if (!me) { location.href = '/'; return; }
    if (!me.is_admin) {
      els.notAdmin.classList.remove('hidden');
      return;
    }
    els.cardImpressum.classList.remove('hidden');
    els.cardUsers.classList.remove('hidden');
    await loadSettings();
    await loadUsers();
  }

  init();
})();
