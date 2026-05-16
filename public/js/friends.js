(function () {
  const Api = window.Chess2Api;
  const els = {
    authArea: document.getElementById('auth-area'),
    authRequired: document.getElementById('auth-required'),
    cardRequest: document.getElementById('card-request'),
    addForm: document.getElementById('add-form'),
    addUsername: document.getElementById('add-username'),
    addError: document.getElementById('add-error'),
    addSuccess: document.getElementById('add-success'),
    cardIncoming: document.getElementById('card-incoming'),
    incomingList: document.getElementById('incoming-list'),
    cardOutgoing: document.getElementById('card-outgoing'),
    outgoingList: document.getElementById('outgoing-list'),
    friendsList: document.getElementById('friends-list'),
    confirmModal: document.getElementById('confirm-modal'),
    confirmYes: document.getElementById('confirm-yes'),
    confirmNo: document.getElementById('confirm-no'),
    chModal: document.getElementById('challenge-modal'),
    chFriendName: document.getElementById('challenge-friend-name'),
    chForm: document.getElementById('challenge-form'),
    chSeat: document.getElementById('ch-seat'),
    chShape: document.getElementById('ch-shape'),
    chTcInitial: document.getElementById('ch-tc-initial'),
    chTcIncrement: document.getElementById('ch-tc-increment'),
    chError: document.getElementById('ch-error'),
    inModal: document.getElementById('incoming-modal'),
    inFrom: document.getElementById('incoming-from'),
    inDetail: document.getElementById('incoming-detail'),
    inAccept: document.getElementById('incoming-accept'),
    inDecline: document.getElementById('incoming-decline'),
  };

  let user = null;
  let pendingRemoval = null;
  let challengeTarget = null;     // friend being challenged from this page
  let pendingChallenge = null;    // outgoing challenge data
  let incomingChallenge = null;   // incoming challenge data
  const socket = io({ autoConnect: true });

  function escapeHtml(s) {
    return String(s).replace(/[&<>"'`]/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;','`':'&#96;' }[c]));
  }

  function showMessage(el, text, asError) {
    el.textContent = text;
    el.classList.remove('hidden');
    el.classList.toggle('error', !!asError);
    el.classList.toggle('muted', !asError);
  }
  function clearMessages() {
    els.addError.classList.add('hidden');
    els.addError.textContent = '';
    els.addSuccess.classList.add('hidden');
    els.addSuccess.textContent = '';
  }

  function renderRow(meta, actions) {
    const li = document.createElement('li');
    li.className = 'history-row';
    const info = document.createElement('div');
    info.className = 'history-left';
    const onlineDot = (typeof meta.online === 'boolean')
      ? '<span class="online-dot ' + (meta.online ? 'on' : 'off') + '" aria-label="' + (meta.online ? 'online' : 'offline') + '"></span> '
      : '';
    info.innerHTML = onlineDot + '<span class="history-opponent">' + escapeHtml(meta.username) + '</span>' +
      (meta.rating ? ' <span class="pill">' + meta.rating + '</span>' : '') +
      (meta.subtitle ? '<div class="history-line2 muted">' + escapeHtml(meta.subtitle) + '</div>' : '');
    const actionsEl = document.createElement('div');
    actionsEl.className = 'history-actions';
    for (const a of actions) actionsEl.appendChild(a);
    li.appendChild(info);
    li.appendChild(actionsEl);
    return li;
  }

  function btn(label, cls, onClick) {
    const b = document.createElement('button');
    b.className = 'btn ' + cls;
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  }

  function formatDate(s) {
    if (!s) return '';
    const d = new Date(s);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
  }

  async function refresh() {
    if (!user) return;
    try {
      const data = await Api.request('/api/friends');
      // Incoming requests
      if (data.incoming && data.incoming.length) {
        els.cardIncoming.classList.remove('hidden');
        els.incomingList.innerHTML = '';
        for (const r of data.incoming) {
          const row = renderRow(
            { username: r.username, rating: r.rating, subtitle: 'angefragt ' + formatDate(r.created_at) },
            [
              btn('Annehmen', 'btn-primary', () => acceptRequest(r.request_id)),
              btn('Ablehnen', 'btn-ghost', () => declineRequest(r.request_id)),
            ]
          );
          els.incomingList.appendChild(row);
        }
      } else {
        els.cardIncoming.classList.add('hidden');
      }
      // Outgoing requests
      if (data.outgoing && data.outgoing.length) {
        els.cardOutgoing.classList.remove('hidden');
        els.outgoingList.innerHTML = '';
        for (const r of data.outgoing) {
          const row = renderRow(
            { username: r.username, rating: r.rating, subtitle: 'gesendet ' + formatDate(r.created_at) },
            [btn('Zurückziehen', 'btn-ghost', () => cancelRequest(r.request_id))]
          );
          els.outgoingList.appendChild(row);
        }
      } else {
        els.cardOutgoing.classList.add('hidden');
      }
      // Accepted friends
      els.friendsList.innerHTML = '';
      if (data.friends && data.friends.length) {
        for (const f of data.friends) {
          const actions = [];
          if (f.online) {
            actions.push(btn('Spielen', 'btn-primary', () => openChallenge(f)));
          }
          actions.push(btn('Entfernen', 'btn-ghost', () => askRemove(f)));
          const meta = {
            username: f.username,
            rating: f.rating,
            subtitle: 'Freunde seit ' + formatDate(f.since),
            online: f.online,
          };
          const row = renderRow(meta, actions);
          row.dataset.friendId = String(f.friend_id);
          els.friendsList.appendChild(row);
        }
      } else {
        els.friendsList.innerHTML = '<li class="muted">Noch keine Freunde. Schicke unten eine Anfrage.</li>';
      }
    } catch (err) {
      if (err.message && err.message.includes('Login')) {
        showUnauth();
        return;
      }
      els.friendsList.innerHTML = '<li class="error">' + escapeHtml(err.message) + '</li>';
    }
  }

  async function acceptRequest(id) {
    try { await Api.request('/api/friends/requests/' + id + '/accept', { method: 'POST' }); refresh(); }
    catch (err) { alert('Annehmen fehlgeschlagen: ' + err.message); }
  }
  async function declineRequest(id) {
    try { await Api.request('/api/friends/requests/' + id + '/decline', { method: 'POST' }); refresh(); }
    catch (err) { alert('Ablehnen fehlgeschlagen: ' + err.message); }
  }
  async function cancelRequest(id) {
    if (!confirm('Anfrage zurückziehen?')) return;
    try { await Api.request('/api/friends/requests/' + id, { method: 'DELETE' }); refresh(); }
    catch (err) { alert('Zurückziehen fehlgeschlagen: ' + err.message); }
  }

  function askRemove(friend) {
    pendingRemoval = friend;
    Api.openModal(els.confirmModal);
  }
  els.confirmNo.addEventListener('click', () => { pendingRemoval = null; Api.closeModal(els.confirmModal); });
  els.confirmYes.addEventListener('click', async () => {
    if (!pendingRemoval) return;
    const id = pendingRemoval.friend_id || pendingRemoval.id;
    Api.closeModal(els.confirmModal);
    try {
      await Api.request('/api/friends/' + id, { method: 'DELETE' });
      refresh();
    } catch (err) {
      alert('Entfernen fehlgeschlagen: ' + err.message);
    }
    pendingRemoval = null;
  });

  els.addForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearMessages();
    const username = els.addUsername.value.trim();
    if (!username) return;
    if (user && username === user.username) {
      showMessage(els.addError, 'Du kannst dich nicht selbst hinzufügen.', true);
      return;
    }
    try {
      const res = await Api.request('/api/friends/requests', { method: 'POST', body: { username } });
      if (res.status === 'accepted') {
        showMessage(els.addSuccess, 'Direkt befreundet - ' + (res.friendUsername || username) + ' hatte dir schon eine Anfrage geschickt.');
      } else {
        showMessage(els.addSuccess, 'Anfrage an ' + (res.addresseeUsername || username) + ' gesendet.');
      }
      els.addUsername.value = '';
      refresh();
    } catch (err) {
      showMessage(els.addError, err.message, true);
    }
  });

  function showUnauth() {
    els.authRequired.classList.remove('hidden');
    els.cardRequest.classList.add('hidden');
    els.cardIncoming.classList.add('hidden');
    els.cardOutgoing.classList.add('hidden');
    els.friendsList.innerHTML = '';
  }

  function renderAuth() {
    els.authArea.innerHTML = '';
    if (user) {
      const home = document.createElement('a');
      home.href = '/';
      home.className = 'btn btn-ghost';
      home.textContent = '← Lobby';
      els.authArea.appendChild(home);
      const history = document.createElement('a');
      history.href = '/history.html';
      history.className = 'btn btn-ghost';
      history.textContent = 'Meine Partien';
      els.authArea.appendChild(history);
      const logout = document.createElement('button');
      logout.className = 'btn btn-ghost';
      logout.textContent = 'Logout (' + user.username + ')';
      logout.addEventListener('click', () => { Api.setToken(null); user = null; location.href = '/'; });
      els.authArea.appendChild(logout);
    } else {
      const home = document.createElement('a');
      home.href = '/';
      home.className = 'btn btn-primary';
      home.textContent = 'Zur Lobby';
      els.authArea.appendChild(home);
    }
  }

  // ---- Challenge UI -----------------------------------------------------
  function openChallenge(friend) {
    challengeTarget = friend;
    els.chFriendName.textContent = friend.username;
    els.chError.classList.add('hidden');
    Api.openModal(els.chModal);
  }
  els.chModal.addEventListener('click', (e) => {
    if (e.target === els.chModal || e.target.dataset.close !== undefined) {
      Api.closeModal(els.chModal);
    }
  });
  els.chForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!challengeTarget) return;
    const payload = {
      friendId: challengeTarget.friend_id,
      timeControl: {
        initial: Number(els.chTcInitial.value) * 60,
        increment: Number(els.chTcIncrement.value),
      },
      seat: els.chSeat.value,
      shape: els.chShape.value,
    };
    els.chError.classList.add('hidden');
    socket.emit('friend:challenge', payload, (res) => {
      if (res && res.error) {
        els.chError.textContent = res.error;
        els.chError.classList.remove('hidden');
        return;
      }
      pendingChallenge = res;
      Api.closeModal(els.chModal);
      // Wait for friend:challenge_accepted/declined. Save seat info in case
      // accept races with us navigating.
      Api.saveSeat(res.code, res.color, res.seatToken);
    });
  });

  function showIncoming(data) {
    incomingChallenge = data;
    els.inFrom.textContent = data.from.username + (data.from.rating ? ' (' + data.from.rating + ')' : '');
    const tc = data.timeControl && data.timeControl.initial
      ? Math.round(data.timeControl.initial / 60) + '+' + data.timeControl.increment
      : 'ohne Uhr';
    const shape = ({ standard: 'Standard', octagon: 'Achteck', hexagon: 'Sechseck', cross: 'Kreuz', hole: 'Loch', custom: 'Custom' })[data.shape] || data.shape;
    els.inDetail.textContent = shape + ' • ' + tc + ' • du als ' + (data.yourColor === 'w' ? 'Weiß' : 'Schwarz');
    Api.openModal(els.inModal);
  }
  els.inAccept.addEventListener('click', () => {
    if (!incomingChallenge) return;
    const token = incomingChallenge.challengeToken;
    socket.emit('friend:accept_challenge', { challengeToken: token }, (res) => {
      if (res && res.error) { alert(res.error); incomingChallenge = null; Api.closeModal(els.inModal); return; }
      Api.saveSeat(res.code, res.color, res.seatToken);
      location.href = '/game.html?code=' + encodeURIComponent(res.code);
    });
  });
  els.inDecline.addEventListener('click', () => {
    if (!incomingChallenge) return;
    socket.emit('friend:decline_challenge', { challengeToken: incomingChallenge.challengeToken });
    incomingChallenge = null;
    Api.closeModal(els.inModal);
  });

  // ---- Socket presence + challenge events -------------------------------
  socket.on('friend:status', ({ userId, online }) => {
    const row = document.querySelector('li[data-friend-id="' + userId + '"]');
    if (!row) return;
    // Cheap rerender: just refresh the whole list.
    refresh();
  });
  socket.on('friend:incoming_challenge', showIncoming);
  socket.on('friend:challenge_accepted', (data) => {
    if (!pendingChallenge || pendingChallenge.challengeToken !== data.challengeToken) return;
    location.href = '/game.html?code=' + encodeURIComponent(data.code);
  });
  socket.on('friend:challenge_declined', () => {
    pendingChallenge = null;
    alert('Dein Freund hat abgelehnt.');
  });
  socket.on('friend:challenge_cancelled', (data) => {
    pendingChallenge = null;
    alert('Einladung abgebrochen: ' + (data && data.reason ? data.reason : 'unbekannt'));
  });

  async function init() {
    if (Api.getToken()) {
      try { const me = await Api.request('/api/auth/me'); user = me.user; } catch {}
    }
    renderAuth();
    if (!user) { showUnauth(); return; }
    socket.emit('auth', { token: Api.getToken() }, () => {});
    refresh();
  }
  socket.on('connect', () => {
    if (user) socket.emit('auth', { token: Api.getToken() }, () => {});
  });
  init();
})();
