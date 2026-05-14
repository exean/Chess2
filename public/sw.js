/* Chess2 Service Worker
 * App-shell cache so the UI loads instantly and survives flaky networks.
 * Real-time traffic (Socket.IO) and API calls bypass the cache.
 */
const CACHE_VERSION = 'chess2-v2';
const SHELL = [
  '/',
  '/index.html',
  '/game.html',
  '/css/style.css',
  '/js/api.js',
  '/js/lobby.js',
  '/js/game.js',
  '/js/board.js',
  '/lib/chess-engine.js',
  '/manifest.webmanifest',
  '/icons/icon.svg',
  '/icons/icon-maskable.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    await cache.addAll(SHELL);
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
  // Never intercept real-time / API traffic.
  if (url.pathname.startsWith('/socket.io/')) return;
  if (url.pathname.startsWith('/api/')) return;

  // Navigation requests: network first, cache fallback.
  if (req.mode === 'navigate' || req.headers.get('accept') && req.headers.get('accept').includes('text/html')) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE_VERSION);
        cache.put(req, fresh.clone()).catch(() => {});
        return fresh;
      } catch {
        const cached = await caches.match(req);
        return cached || caches.match('/index.html');
      }
    })());
    return;
  }

  // Static assets: cache first, network fallback (and refresh cache in background).
  event.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) {
      fetch(req).then((fresh) => {
        if (fresh && fresh.ok) caches.open(CACHE_VERSION).then((c) => c.put(req, fresh).catch(() => {}));
      }).catch(() => {});
      return cached;
    }
    try {
      const fresh = await fetch(req);
      if (fresh && fresh.ok) {
        const cache = await caches.open(CACHE_VERSION);
        cache.put(req, fresh.clone()).catch(() => {});
      }
      return fresh;
    } catch {
      return new Response('', { status: 504, statusText: 'Offline' });
    }
  })());
});
