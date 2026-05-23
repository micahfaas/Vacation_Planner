// Service worker for offline support. Same-origin app-shell requests are
// cached as they are fetched, along with the Tabler icon webfont from
// jsDelivr so the UI still renders its glyphs offline. Other cross-origin
// calls (Supabase, weather, rates, map tiles) are left to the network —
// trip data itself survives offline through the localStorage cache in
// storage.js, not this cache.
const CACHE = 'trip-planner-v3';

// Cross-origin hosts whose GET responses are safe to cache for offline use.
const CACHEABLE_CDN = ['cdn.jsdelivr.net'];

// Holds photos handed to the app via the PWA share target until the page
// boots and drains them (see main.js).
const SHARE_CACHE = 'trip-planner-shared';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Web push: booking reminders (#12). The watcher-run function sends a JSON
// payload { title, body, url, tag }; show it as a notification.
self.addEventListener('push', e => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch { data = {}; }
  const title = data.title || 'Trip Planner';
  const options = {
    body: data.body || '',
    tag: data.tag || undefined,
    data: { url: data.url || './' },
    icon: './icon.svg',
    badge: './icon.svg',
  };
  e.waitUntil(self.registration.showNotification(title, options));
});

// Tapping a notification focuses an open tab (navigating it to the target) or
// opens a new one.
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || './';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if ('focus' in c) {
          if ('navigate' in c && target) c.navigate(target).catch(() => {});
          return c.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  const reqUrl = new URL(req.url);

  // PWA share target: photos (and any text) shared into the app arrive as a
  // POST to ./share-target. Stash the files in a cache and redirect into the
  // app with a flag; the page drains them on boot.
  if (req.method === 'POST' && reqUrl.pathname.endsWith('/share-target')) {
    e.respondWith(handleShareTarget(req));
    return;
  }

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

// Drain any text into query params (so the existing GET share handler in
// main.js still works) and stash image files in SHARE_CACHE keyed by index.
// Then 303-redirect into the app with a ?shared_photos=<n> flag.
async function handleShareTarget(request) {
  const base = self.registration.scope;
  try {
    const form = await request.formData();
    const files = (form.getAll('photos') || [])
      .filter(f => f && typeof f.type === 'string' && f.type.startsWith('image/'));

    const cache = await caches.open(SHARE_CACHE);
    for (const key of await cache.keys()) await cache.delete(key);

    let n = 0;
    for (const file of files) {
      await cache.put(
        new Request(base + '__shared_photo_' + n),
        new Response(file, {
          headers: {
            'Content-Type': file.type,
            'X-Filename': encodeURIComponent(file.name || ('photo' + n + '.jpg'))
          }
        })
      );
      n++;
    }

    const params = new URLSearchParams();
    if (n) params.set('shared_photos', String(n));
    const title = form.get('title'); if (title) params.set('shared_title', title);
    const text = form.get('text'); if (text) params.set('shared_text', text);
    const u = form.get('url'); if (u) params.set('shared_url', u);
    return Response.redirect(base + '?' + params.toString(), 303);
  } catch {
    return Response.redirect(base, 303);
  }
}
