/* Piece-set registry: each set knows how to render a piece at a given color.
 * Built-in sets are 'unicode' (text glyphs, no extra assets) and 'modern'
 * (hand-crafted inline SVGs). Drop additional SVG sets into
 * /public/pieces/<setname>/{w|b}{p,n,b,r,q,k}.svg and add an entry below to
 * make them selectable.
 */
(function (root) {
  const UNICODE_GLYPHS = {
    w: { k: '♔', q: '♕', r: '♖', b: '♗', n: '♘', p: '♙' },
    b: { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' },
  };

  // Modern set: simple stylized silhouettes. Each piece is defined once as a
  // single SVG body and tinted via classes (.piece.w / .piece.b) so we don't
  // need separate files per color.
  const MODERN_SHAPES = {
    p: `
      <circle cx="22.5" cy="13" r="5.5"/>
      <path d="M16.5 18 h12 l1.5 5 h-15 z"/>
      <path d="M14 24 h17 l2.5 8 h-22 z"/>
      <ellipse cx="22.5" cy="34" rx="13" ry="3"/>`,
    r: `
      <path d="M11 9 h3 v3 h4 v-3 h3 v3 h4 v-3 h3 v3 h4 v-3 h2 v9 h-23 z"/>
      <path d="M14 19 h17 l-1 3 v8 l1 3 h-17 l1 -3 v-8 z"/>
      <path d="M10 33 h25 v3 h-25 z"/>`,
    n: `
      <path d="M22 6 c -7 0 -11 6 -11 13 c 0 4 1 7 3 9 l -3 5 h 21 l -1 -5 c 2 -2 3 -5 3 -9 c 0 -3 -1 -6 -3 -8 l -2 3 l -3 -2 l -2 3 l -2 -8 c -1 -1 -1 -1 -2 -1 z"/>
      <circle cx="18.5" cy="15" r="1.2" class="eye"/>
      <path d="M10 33 h25 v3 h-25 z"/>`,
    b: `
      <circle cx="22.5" cy="8" r="2.5"/>
      <path d="M15 12 c 0 -3 4 -3 7.5 -3 c 3.5 0 7.5 0 7.5 3 c 0 8 -3 14 -7.5 14 c -4.5 0 -7.5 -6 -7.5 -14 z"/>
      <path d="M19 17 h7 v1.5 h-7 z" class="band"/>
      <path d="M14 26 h17 l-1 4 h-15 z"/>
      <path d="M10 33 h25 v3 h-25 z"/>`,
    q: `
      <path d="M9 8 l3 9 l3 -8 l2.5 8 l3 -10 l2 10 l3 -8 l2.5 8 l3 -9 l-2 12 h-15 z"/>
      <circle cx="9" cy="7" r="1.5"/>
      <circle cx="14.5" cy="6" r="1.5"/>
      <circle cx="22.5" cy="5" r="1.7"/>
      <circle cx="30.5" cy="6" r="1.5"/>
      <circle cx="36" cy="7" r="1.5"/>
      <path d="M13 20 h19 l-1 4 v6 l1 3 h-19 l1 -3 v-6 z"/>
      <path d="M10 33 h25 v3 h-25 z"/>`,
    k: `
      <path d="M21 4 h3 v3 h3 v3 h-3 v4 h-3 v-4 h-3 v-3 h3 z"/>
      <path d="M12 16 c 0 -3 3 -3 10.5 -3 c 7.5 0 10.5 0 10.5 3 v 4 a 10.5 10.5 0 0 1 -21 0 z"/>
      <path d="M14 22 h17 l-1 4 v 4 l 1 3 h -17 l 1 -3 v -4 z"/>
      <path d="M10 33 h25 v3 h-25 z"/>`,
  };

  function renderUnicode(type, color) {
    const span = document.createElement('span');
    span.className = 'piece pu ' + color;
    span.textContent = UNICODE_GLYPHS[color][type];
    return span;
  }

  function renderModern(type, color) {
    const el = document.createElement('span');
    el.className = 'piece ps ' + color;
    el.innerHTML =
      '<svg viewBox="0 0 45 45" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">'
      + '<g class="body">' + MODERN_SHAPES[type] + '</g>'
      + '</svg>';
    return el;
  }

  function renderImageSet(setPath) {
    return (type, color) => {
      const img = document.createElement('img');
      img.className = 'piece pi ' + color;
      img.alt = '';
      img.src = setPath + '/' + color + type + '.svg';
      img.draggable = false;
      return img;
    };
  }

  const SETS = {
    unicode: { name: 'Unicode', render: renderUnicode },
    modern:  { name: 'Modern',  render: renderModern  },
  };

  // Discover image-based sets from /public/pieces/<dir>/ (populated server-side
  // by GET /api/piece-sets). Fires the pieceset-changed event so any UI that
  // already rendered the selector picks up the new options.
  fetch('/api/piece-sets').then((r) => r.ok ? r.json() : { sets: [] })
    .then((data) => {
      for (const s of (data.sets || [])) {
        if (SETS[s.id]) continue;
        SETS[s.id] = { name: s.name, render: renderImageSet('/pieces/' + s.id) };
      }
      window.dispatchEvent(new CustomEvent('chess2:pieceset-listchanged'));
    })
    .catch(() => { /* offline or no server - fine */ });

  function listSets() {
    return Object.keys(SETS).map((k) => ({ id: k, name: SETS[k].name }));
  }

  function getRenderer(id) {
    return (SETS[id] || SETS.unicode).render;
  }

  function getPreferred() {
    try { return localStorage.getItem('chess2.pieces') || 'unicode'; }
    catch { return 'unicode'; }
  }

  function setPreferred(id) {
    if (!SETS[id]) id = 'unicode';
    try { localStorage.setItem('chess2.pieces', id); } catch {}
    window.dispatchEvent(new CustomEvent('chess2:pieceset-changed', { detail: { id } }));
  }

  root.Chess2Pieces = { listSets, getRenderer, getPreferred, setPreferred, renderImageSet };
})(window);
