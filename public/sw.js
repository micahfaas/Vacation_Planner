// Service worker for offline support. Same-origin app-shell requests are
// cached as they are fetched, along with the Tabler icon webfont from
// jsDelivr so the UI still renders its glyphs offline. Other cross-origin
// calls (Supabase, weather, rates, map tiles) are left to the network —
// trip data itself survives offline through the localStorage cache in
// storage.js, not this cache.
const CACHE = 'trip-planner-v3';

// Cross-origin hosts whose GET responses are safe to cache for offline use.
const CACHEABLE_CDN = ['cdn.jsdelivr.net'];

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const cdnCacheable = CACHEABLE_CDN.includes(url.hostname);
  if (!sameOrigin && !cdnCacheable) return; // network-only: Supabase, tiles, etc.

  // Navigations: network-first so a new deploy shows immediately; fall back
  // to the cached shell when offline.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then(c => c || caches.match('./index.html')))
    );
    return;
  }

  // Static assets and cacheable CDN files: serve from cache, refresh in the
  // background.
  e.respondWith(
    caches.match(req).then(cached => {
      const network = fetch(req)
        .then(res => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
