/* ChemCtrl Service Worker — versão gerada no build */

const CACHE_VERSION = 'chemctrl-c307998';
const APP_VERSION = '1.00.20';

// ── Install: cache shell assets ───────────────────────────────────────────────
self.addEventListener('install', (event) => {
  // Skip waiting immediately so the new SW becomes active as soon as possible
  // when the user clicks "Atualizar agora" (which sends SKIP_WAITING).
  // We do NOT auto-skipWaiting here to give the UI time to show the prompt.
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) =>
      cache.addAll([
        '/',
        '/manifest.json',
        '/favicon.ico',
        '/icons/favicon-32x32.png',
        '/icons/apple-touch-icon.png',
        '/icons/icon-192x192.png',
        '/icons/icon-192x192-maskable.png',
        '/icons/icon-512x512.png',
        '/icons/icon-512x512-maskable.png',
      ])
    ).catch(() => {})
  );
});

// ── Activate: remove old caches ───────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_VERSION)
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Message: handle SKIP_WAITING from the app ─────────────────────────────────
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ── Fetch: network-first strategy ────────────────────────────────────────────
// Always try network first; only fall back to cache for navigation requests.
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only handle GET requests
  if (request.method !== 'GET') return;

  // For navigation (HTML pages) use network-first, fallback to cache
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // For everything else: network-first, no caching of API calls
  // (Supabase / external API requests bypass SW)
  const url = new URL(request.url);
  if (
    url.origin !== self.location.origin ||
    url.pathname.startsWith('/rest/') ||
    url.pathname.startsWith('/auth/')
  ) {
    return; // let browser handle it normally
  }

  // Vite dev server source modules (/src/) must NEVER be cached — they change on every HMR
  if (url.pathname.startsWith('/src/') || url.pathname.startsWith('/@') || url.pathname.startsWith('/node_modules/')) {
    return; // let browser handle it normally (always fresh from Vite dev server)
  }

  // Production static assets: cache-first (they have hashed filenames from Vite)
  if (
    url.pathname.startsWith('/assets/') ||
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.ico') ||
    url.pathname.endsWith('.svg') ||
    url.pathname.endsWith('.webmanifest') ||
    (url.pathname.endsWith('.json') && url.pathname.includes('manifest'))
  ) {
    event.respondWith(
      fetch(request).then((response) => {
        const clone = response.clone();
        caches.open(CACHE_VERSION).then((cache) => cache.put(request, clone));
        return response;
      }).catch(() => caches.match(request))
    );
  }
});
