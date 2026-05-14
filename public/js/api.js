/* Lightweight REST + local storage helpers shared by lobby and game pages. */
(function (root) {
  const TOKEN_KEY = 'chess2.token';
  const NAME_KEY = 'chess2.name';

  function getToken() { return localStorage.getItem(TOKEN_KEY) || null; }
  function setToken(t) {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  }
  function getName() { return localStorage.getItem(NAME_KEY) || ''; }
  function setName(n) { localStorage.setItem(NAME_KEY, n || ''); }

  async function request(path, options) {
    const opts = Object.assign({ method: 'GET', headers: {} }, options || {});
    const t = getToken();
    if (t) opts.headers['Authorization'] = 'Bearer ' + t;
    if (opts.body && typeof opts.body !== 'string') {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(opts.body);
    }
    const res = await fetch(path, opts);
    let data = null;
    try { data = await res.json(); } catch { /* ignore */ }
    if (!res.ok) throw new Error((data && data.error) || ('HTTP ' + res.status));
    return data;
  }

  function seatStorageKey(code) { return 'chess2.seat.' + code; }
  function saveSeat(code, color, seatToken) {
    if (!seatToken) return;
    localStorage.setItem(seatStorageKey(code), JSON.stringify({ color, seatToken }));
  }
  function loadSeat(code) {
    try {
      const raw = localStorage.getItem(seatStorageKey(code));
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }
  function clearSeat(code) { localStorage.removeItem(seatStorageKey(code)); }

  root.Chess2Api = {
    getToken, setToken, getName, setName,
    request, saveSeat, loadSeat, clearSeat,
  };
})(window);
