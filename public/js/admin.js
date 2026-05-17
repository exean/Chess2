(function () {
  const Api = window.Chess2Api;
  const els = {
    authArea: document.getElementById('auth-area'),
    notAdmin: document.getElementById('not-admin'),
    cardImpressum: document.getElementById('card-impressum'),
    cardUsers: document.getElementById('card-users'),
    cardPieceSets: document.getElementById('card-piece-sets'),
    form: document.getElementById('settings-form'),
    settingsStatus: document.getElementById('settings-status'),
    usersList: document.getElementById('users-list'),
    usersCount: document.getElementById('users-count'),
    usersSearch: document.getElementById('users-search'),
    psList: document.getElementById('piece-sets-list'),
    psForm: document.getElementById('piece-set-form'),
    psFormWrap: document.querySelector('.piece-set-form-wrap'),
    psId: document.getElementById('ps-id'),
    psName: document.getElementById('ps-name'),
    psAuthor: document.getElementById('ps-author'),
    psSource: document.getElementById('ps-source'),
    psLicense: document.getElementById('ps-license'),
    psFiles: document.getElementById('ps-files'),
    psGrid: document.getElementById('ps-grid'),
    psError: document.getElementById('ps-error'),
    psStatus: document.getElementById('ps-status'),
    psReset: document.getElementById('ps-reset'),
  };

  const PIECE_SLOTS = ['wp','wn','wb','wr','wq','wk','bp','bn','bb','br','bq','bk'];
  const SLOT_LABELS = {
    wp:'Weißer Bauer', wn:'Weißer Springer', wb:'Weißer Läufer', wr:'Weißer Turm', wq:'Weiße Dame', wk:'Weißer König',
    bp:'Schwarzer Bauer', bn:'Schwarzer Springer', bb:'Schwarzer Läufer', br:'Schwarzer Turm', bq:'Schwarze Dame', bk:'Schwarzer König',
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

  // Piece-set management ---------------------------------------------
  // Form state. `editingId` is null for a new set, or the existing set id when
  // editing. `slotFiles` holds the SVG text per slot ready to upload; `null`
  // means "no change" in edit mode and "empty slot" in create mode.
  // `existingFiles` mirrors which slots are already saved on the server.
  // `unassigned` is the queue of files whose target slot is ambiguous and the
  // user needs to assign manually.
  const psState = {
    editingId: null,
    slotFiles: Object.fromEntries(PIECE_SLOTS.map((s) => [s, null])),
    existingFiles: Object.fromEntries(PIECE_SLOTS.map((s) => [s, false])),
    unassigned: [],
  };

  function resetPsForm() {
    psState.editingId = null;
    for (const s of PIECE_SLOTS) {
      psState.slotFiles[s] = null;
      psState.existingFiles[s] = false;
    }
    psState.unassigned = [];
    els.psForm.reset();
    els.psId.disabled = false;
    els.psError.classList.add('hidden');
    els.psStatus.classList.add('hidden');
    renderPsGrid();
  }

  function renderPsGrid() {
    els.psGrid.innerHTML = '';
    for (const slot of PIECE_SLOTS) {
      const cell = document.createElement('div');
      cell.className = 'piece-slot';
      cell.dataset.slot = slot;
      const newSvg = psState.slotFiles[slot];
      const hasExisting = psState.existingFiles[slot];
      const status = newSvg ? 'neu'
        : (hasExisting ? 'gespeichert' : 'leer');
      cell.classList.add('piece-slot--' + (newSvg ? 'new' : hasExisting ? 'existing' : 'empty'));
      const preview = document.createElement('div');
      preview.className = 'piece-slot-preview';
      if (newSvg) {
        // Inline render of the staged SVG (data URI keeps script context off).
        preview.innerHTML = '<img alt="" src="data:image/svg+xml;utf8,' + encodeURIComponent(newSvg) + '" />';
      } else if (hasExisting && psState.editingId) {
        preview.innerHTML = '<img alt="" src="/pieces/' + encodeURIComponent(psState.editingId) + '/' + slot + '.svg?v=' + Date.now() + '" />';
      } else {
        preview.innerHTML = '<span class="muted">leer</span>';
      }
      const label = document.createElement('div');
      label.className = 'piece-slot-label';
      label.textContent = SLOT_LABELS[slot] + ' (' + slot + ')';
      const meta = document.createElement('div');
      meta.className = 'piece-slot-meta muted small';
      meta.textContent = status;
      cell.appendChild(preview);
      cell.appendChild(label);
      cell.appendChild(meta);
      if (newSvg || (hasExisting && psState.editingId)) {
        const clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.className = 'btn btn-ghost btn-small';
        clearBtn.textContent = newSvg ? 'Verwerfen' : 'Löschen';
        clearBtn.addEventListener('click', () => clearSlot(slot, newSvg ? 'staged' : 'existing'));
        cell.appendChild(clearBtn);
      }
      els.psGrid.appendChild(cell);
    }

    if (psState.unassigned.length) {
      const wrap = document.createElement('div');
      wrap.className = 'piece-unassigned';
      const title = document.createElement('h4');
      title.textContent = 'Nicht eindeutig zugeordnet';
      wrap.appendChild(title);
      const info = document.createElement('p');
      info.className = 'muted small';
      info.textContent = 'Wähle für jede Datei den passenden Slot oder lasse sie aus.';
      wrap.appendChild(info);
      for (const item of psState.unassigned) {
        const row = document.createElement('div');
        row.className = 'piece-unassigned-row';
        const prev = document.createElement('img');
        prev.alt = '';
        prev.className = 'piece-unassigned-preview';
        prev.src = 'data:image/svg+xml;utf8,' + encodeURIComponent(item.content);
        const fname = document.createElement('span');
        fname.className = 'piece-unassigned-name';
        fname.textContent = item.name;
        const sel = document.createElement('select');
        sel.innerHTML = '<option value="">(weglassen)</option>' +
          PIECE_SLOTS.map((s) => '<option value="' + s + '">' + SLOT_LABELS[s] + ' (' + s + ')</option>').join('');
        sel.addEventListener('change', () => {
          const target = sel.value;
          if (!target) return;
          psState.slotFiles[target] = item.content;
          psState.unassigned = psState.unassigned.filter((x) => x !== item);
          renderPsGrid();
        });
        row.appendChild(prev);
        row.appendChild(fname);
        row.appendChild(sel);
        wrap.appendChild(row);
      }
      els.psGrid.appendChild(wrap);
    }
  }

  function clearSlot(slot, kind) {
    if (kind === 'staged') {
      psState.slotFiles[slot] = null;
    } else if (kind === 'existing' && psState.editingId) {
      if (!confirm('Datei für ' + SLOT_LABELS[slot] + ' im gespeicherten Satz wirklich löschen?')) return;
      Api.request('/api/admin/piece-sets/' + encodeURIComponent(psState.editingId) + '/files/' + slot, { method: 'DELETE' })
        .then((res) => {
          psState.existingFiles = Object.fromEntries(PIECE_SLOTS.map((s) => [s, !!res.set.files[s]]));
          renderPsGrid();
          loadPieceSets();
        })
        .catch((err) => alert('Löschen fehlgeschlagen: ' + err.message));
      return;
    }
    renderPsGrid();
  }

  function showPsError(msg) {
    els.psError.textContent = msg;
    els.psError.classList.remove('hidden');
  }

  // Map flexible filenames -> slot id. Accepts wp, wP, white-pawn, w_pawn, etc.
  function guessSlot(filename) {
    const base = filename.toLowerCase().replace(/\.svg$/, '').replace(/[\s_\-]+/g, '');
    if (/^[wb][pnbrqk]$/.test(base)) return base;
    const pieceMap = { pawn:'p', knight:'n', bishop:'b', rook:'r', queen:'q', king:'k' };
    const colorMatch = base.match(/(white|black|^w|^b)/);
    const pieceMatch = base.match(/(pawn|knight|bishop|rook|queen|king)/);
    if (colorMatch && pieceMatch) {
      const c = colorMatch[1].startsWith('w') ? 'w' : 'b';
      const p = pieceMap[pieceMatch[1]];
      if (p) return c + p;
    }
    return null;
  }

  // Minimal ZIP reader that uses DecompressionStream (Chrome 80+, Firefox 113+,
  // Safari 17+). Parses the central directory backwards from the EOCD record,
  // then inflates each entry. Skips files using unsupported compression.
  async function unzip(buf) {
    const view = new DataView(buf);
    const len = view.byteLength;
    if (len < 22) throw new Error('ZIP-Datei zu klein.');
    let eocd = -1;
    const maxScan = Math.min(len, 65557);
    for (let i = len - 22; i >= len - maxScan; i--) {
      if (i < 0) break;
      if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Kein ZIP-EOCD gefunden.');
    const numEntries = view.getUint16(eocd + 10, true);
    let cd = view.getUint32(eocd + 16, true);
    const out = [];
    const td = new TextDecoder('utf-8');
    for (let i = 0; i < numEntries; i++) {
      if (view.getUint32(cd, true) !== 0x02014b50) throw new Error('CD beschädigt.');
      const method = view.getUint16(cd + 10, true);
      const compSize = view.getUint32(cd + 20, true);
      const fnLen = view.getUint16(cd + 28, true);
      const exLen = view.getUint16(cd + 30, true);
      const cmLen = view.getUint16(cd + 32, true);
      const localOff = view.getUint32(cd + 42, true);
      const fname = td.decode(new Uint8Array(buf, cd + 46, fnLen));
      cd += 46 + fnLen + exLen + cmLen;
      if (fname.endsWith('/')) continue;
      const lhFnLen = view.getUint16(localOff + 26, true);
      const lhExLen = view.getUint16(localOff + 28, true);
      const dataStart = localOff + 30 + lhFnLen + lhExLen;
      const raw = new Uint8Array(buf, dataStart, compSize);
      let bytes;
      if (method === 0) {
        bytes = raw;
      } else if (method === 8) {
        try {
          const stream = new Response(raw).body.pipeThrough(new DecompressionStream('deflate-raw'));
          bytes = new Uint8Array(await new Response(stream).arrayBuffer());
        } catch (err) {
          continue; // skip unsupported entries
        }
      } else {
        continue;
      }
      out.push({ name: fname.replace(/^.*\//, ''), content: td.decode(bytes) });
    }
    return out;
  }

  function looksLikeSvg(s) {
    if (typeof s !== 'string' || !s.length) return false;
    return /<\s*svg[\s>]/i.test(s.slice(0, 2048));
  }

  async function readEntriesFromInput(fileList) {
    const items = [];
    for (const f of fileList) {
      const lower = (f.name || '').toLowerCase();
      if (lower.endsWith('.zip') || f.type === 'application/zip' || f.type === 'application/x-zip-compressed') {
        try {
          const buf = await f.arrayBuffer();
          const entries = await unzip(buf);
          for (const e of entries) {
            if (e.name.toLowerCase().endsWith('.svg') && looksLikeSvg(e.content)) {
              items.push({ name: e.name, content: e.content });
            }
          }
        } catch (err) {
          showPsError('ZIP konnte nicht gelesen werden: ' + err.message);
        }
      } else if (lower.endsWith('.svg') || f.type === 'image/svg+xml') {
        try {
          const txt = await f.text();
          if (looksLikeSvg(txt)) items.push({ name: f.name, content: txt });
        } catch { /* skip */ }
      }
    }
    return items;
  }

  async function onFilesPicked() {
    els.psError.classList.add('hidden');
    const list = els.psFiles.files;
    if (!list || !list.length) return;
    const entries = await readEntriesFromInput(list);
    if (!entries.length) {
      showPsError('Keine SVG-Dateien gefunden.');
      return;
    }
    for (const e of entries) {
      const slot = guessSlot(e.name);
      if (slot) {
        psState.slotFiles[slot] = e.content;
      } else {
        psState.unassigned.push(e);
      }
    }
    // Clear the input so re-picking the same file fires `change` again.
    els.psFiles.value = '';
    renderPsGrid();
  }

  els.psFiles.addEventListener('change', onFilesPicked);

  els.psReset.addEventListener('click', () => {
    resetPsForm();
    if (els.psFormWrap) els.psFormWrap.open = false;
  });

  els.psForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    els.psError.classList.add('hidden');
    els.psStatus.classList.add('hidden');
    const id = (els.psId.value || '').trim();
    if (!/^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/.test(id)) {
      showPsError('ID darf nur a-z, 0-9 und Bindestriche enthalten (2-32 Zeichen).');
      return;
    }
    const meta = {
      name: (els.psName.value || '').trim(),
      author: (els.psAuthor.value || '').trim(),
      sourceUrl: (els.psSource.value || '').trim(),
      license: (els.psLicense.value || '').trim(),
    };
    if (!meta.name) { showPsError('Anzeigename fehlt.'); return; }
    const files = {};
    for (const slot of PIECE_SLOTS) {
      if (psState.slotFiles[slot]) files[slot] = psState.slotFiles[slot];
    }
    if (!psState.editingId && Object.keys(files).length === 0) {
      showPsError('Mindestens eine Datei nötig.');
      return;
    }
    try {
      const res = await Api.request('/api/admin/piece-sets/' + encodeURIComponent(id), {
        method: 'POST',
        body: { meta, files },
      });
      els.psStatus.textContent = res.set.complete
        ? 'Gespeichert. Satz ist vollständig.'
        : 'Gespeichert. Es fehlen noch ' + PIECE_SLOTS.filter((s) => !res.set.files[s]).length + ' Datei(en).';
      els.psStatus.classList.remove('hidden');
      // Stage staged files into "existing" so the grid reflects the saved state.
      psState.editingId = id;
      els.psId.disabled = true;
      for (const s of PIECE_SLOTS) {
        psState.existingFiles[s] = !!res.set.files[s];
        psState.slotFiles[s] = null;
      }
      psState.unassigned = [];
      renderPsGrid();
      loadPieceSets();
    } catch (err) {
      showPsError(err.message);
    }
  });

  function startEditSet(set) {
    resetPsForm();
    psState.editingId = set.id;
    els.psId.value = set.id;
    els.psId.disabled = true;
    els.psName.value = set.meta.name || '';
    els.psAuthor.value = set.meta.author || '';
    els.psSource.value = set.meta.sourceUrl || '';
    els.psLicense.value = set.meta.license || '';
    for (const s of PIECE_SLOTS) psState.existingFiles[s] = !!set.files[s];
    renderPsGrid();
    if (els.psFormWrap) {
      els.psFormWrap.open = true;
      els.psFormWrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  async function deleteSet(set) {
    if (!confirm('Figurensatz "' + (set.meta.name || set.id) + '" wirklich endgültig löschen?')) return;
    try {
      await Api.request('/api/admin/piece-sets/' + encodeURIComponent(set.id), { method: 'DELETE' });
      if (psState.editingId === set.id) resetPsForm();
      await loadPieceSets();
    } catch (err) {
      alert('Löschen fehlgeschlagen: ' + err.message);
    }
  }

  function renderPieceSets(sets) {
    els.psList.innerHTML = '';
    if (!sets.length) {
      els.psList.innerHTML = '<li class="muted">Noch keine eigenen Sätze installiert. Die eingebauten Sätze (Unicode, Modern) stehen immer zur Auswahl.</li>';
      return;
    }
    for (const s of sets) {
      const li = document.createElement('li');
      li.className = 'history-row';
      const left = document.createElement('div');
      left.className = 'history-left';
      const missing = PIECE_SLOTS.filter((slot) => !s.files[slot]).length;
      left.innerHTML =
        '<div class="history-line1">' +
        '<span class="history-opponent">' + esc(s.meta.name || s.id) + '</span>' +
        ' <span class="pill">' + esc(s.id) + '</span>' +
        (s.complete ? '' : ' <span class="pill pill-loss">' + missing + ' fehlt</span>') +
        '</div>' +
        '<div class="history-line2 muted">' +
        (s.meta.author ? 'Urheber: ' + esc(s.meta.author) + ' · ' : '') +
        (s.meta.license ? 'Lizenz: ' + esc(s.meta.license) + ' · ' : '') +
        (s.meta.sourceUrl ? '<a href="' + esc(s.meta.sourceUrl) + '" target="_blank" rel="noopener noreferrer">Quelle</a> · ' : '') +
        (s.meta.updatedAt ? 'aktualisiert ' + esc(formatDate(s.meta.updatedAt)) : '') +
        '</div>';
      const right = document.createElement('div');
      right.className = 'history-actions';
      const editBtn = document.createElement('button');
      editBtn.className = 'btn btn-ghost';
      editBtn.textContent = 'Bearbeiten';
      editBtn.addEventListener('click', () => startEditSet(s));
      const delBtn = document.createElement('button');
      delBtn.className = 'btn btn-ghost';
      delBtn.textContent = 'Löschen';
      delBtn.addEventListener('click', () => deleteSet(s));
      right.appendChild(editBtn);
      right.appendChild(delBtn);
      li.appendChild(left);
      li.appendChild(right);
      els.psList.appendChild(li);
    }
  }

  async function loadPieceSets() {
    try {
      const data = await Api.request('/api/admin/piece-sets');
      renderPieceSets(data.sets || []);
    } catch (err) {
      els.psList.innerHTML = '<li class="error">' + esc(err.message) + '</li>';
    }
  }

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
    els.cardPieceSets.classList.remove('hidden');
    resetPsForm();
    await Promise.all([loadSettings(), loadUsers(), loadPieceSets()]);
  }

  init();
})();
