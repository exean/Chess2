/* Chess2 Service Worker
 * App-shell cache as an offline fallback. Online users always get the
 * latest JS/CSS/HTML from the network so deploys propagate immediately.
 * Real-time traffic (Socket.IO) and API calls bypass the cache.
 */
const CACHE_VERSION = 'chess2-v18';
const SHELL = [
  '/',
  '/index.html',
  '/game.html',
  '/css/style.css',
  '/js/api.js',
  '/js/lobby.js',
  '/js/game.js',
  '/js/board.js',
  '/js/pieces.js',
  '/js/topbar.js',
  '/js/voice.js',
  '/js/chessnut.js',
  '/lib/chess-engine.js',
  '/manifest.webmanifest',
  '/icons/icon.svg',
  '/icons/icon-maskable.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    try { await cache.addAll(SHELL); } catch { /* best effort */ }
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/socket.io/')) return;
  if (url.pathname.startsWith('/api/')) return;

  // Network-first everywhere on same origin: fast feedback for code deploys,
  // cache only as an offline fallback. Background-refresh of cache happens
  // on every successful network response.
  event.respondWith((async () => {
    try {
      const fresh = await fetch(req);
      if (fresh && fresh.ok && fresh.type === 'basic') {
        const cache = await caches.open(CACHE_VERSION);
        cache.put(req, fresh.clone()).catch(() => {});
      }
      return fresh;
    } catch {
      const cached = await caches.match(req);
      if (cached) return cached;
      if (req.mode === 'navigate') return caches.match('/index.html');
      return new Response('', { status: 504, statusText: 'Offline' });
    }
  })());
});
