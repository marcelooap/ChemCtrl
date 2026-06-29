/* ChemCtrl Service Worker — v4
 * Network-first for app assets; API requests (Supabase) always bypass cache.
 */
const CACHE_VERSION = 'chemctrl-v4';
const APP_CACHE = `${CACHE_VERSION}-app`;

const SUPABASE_HOST = 'cpzibnwytukcgxeamfhp.supabase.co';

// Assets to pre-cache on install (app shell)
const PRECACHE_URLS = ['/', '/index.html', '/manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_CACHE).then((cache) => cache.addAll(PRECACHE_URLS).catch(() => {}))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => !key.startsWith(CACHE_VERSION))
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();

  // Notify all clients that a new SW has activated
  self.clients.matchAll({ includeUncontrolled: true }).then((clients) => {
    clients.forEach((client) => client.postMessage({ type: 'SW_ACTIVATED' }));
  });
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only handle GET requests over HTTP(S)
  if (request.method !== 'GET' || !request.url.startsWith('http')) return;

  const url = new URL(request.url);

  // ── Supabase API & any cross-origin API calls: ALWAYS network-only, never cache ──
  if (url.hostname === SUPABASE_HOST || url.hostname !== self.location.hostname) {
    event.respondWith(
      fetch(request, { cache: 'no-store' }).catch(() => new Response('Offline', { status: 503 }))
    );
    return;
  }

  // ── Same-origin app assets: network-first, fall back to cache ──
  event.respondWith(
    fetch(request, { cache: 'no-store' })
      .then((response) => {
        // Only cache successful, same-origin responses
        if (response.ok && response.type === 'basic') {
          const clone = response.clone();
          caches.open(APP_CACHE).then((cache) => cache.put(request, clone)).catch(() => {});
        }
        return response;
      })
      .catch(() => caches.match(request).then((cached) => cached || caches.match('/index.html')))
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
