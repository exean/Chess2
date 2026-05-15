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

  /* Accessible modal helper: opens with role=dialog semantics, traps Tab focus
   * inside the modal, returns focus to the opener on close, and closes on
   * Escape. Modals stay hidden via the existing .hidden class so other code
   * paths keep working untouched. */
  const FOCUSABLE_SEL = 'a[href], area[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), iframe, object, embed, [tabindex]:not([tabindex="-1"]):not([disabled])';
  let previousFocus = null;
  let activeModal = null;

  function focusableInside(el) {
    return Array.from(el.querySelectorAll(FOCUSABLE_SEL))
      .filter((node) => node.offsetParent !== null);
  }

  function openModal(el) {
    if (!el || activeModal === el) return;
    previousFocus = document.activeElement;
    activeModal = el;
    el.classList.remove('hidden');
    el.setAttribute('aria-hidden', 'false');
    const first = focusableInside(el)[0];
    if (first) setTimeout(() => first.focus(), 0);
  }

  function closeModal(el) {
    el = el || activeModal;
    if (!el) return;
    el.classList.add('hidden');
    el.setAttribute('aria-hidden', 'true');
    if (activeModal === el) activeModal = null;
    if (previousFocus && typeof previousFocus.focus === 'function') {
      const target = previousFocus;
      previousFocus = null;
      setTimeout(() => target.focus(), 0);
    }
  }

  document.addEventListener('keydown', (e) => {
    if (!activeModal) return;
    if (e.key === 'Escape') {
      closeModal(activeModal);
      e.preventDefault();
      return;
    }
    if (e.key !== 'Tab') return;
    const items = focusableInside(activeModal);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      last.focus();
      e.preventDefault();
    } else if (!e.shiftKey && document.activeElement === last) {
      first.focus();
      e.preventDefault();
    }
  });

  root.Chess2Api = {
    getToken, setToken, getName, setName,
    request, saveSeat, loadSeat, clearSeat,
    openModal, closeModal,
  };
})(window);
