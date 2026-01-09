/* ShutterPrompt Service Worker - basic offline cache */
const CACHE_NAME = 'shutterprompt-cache-v3';

// Keep this list local-only. Some hosts may not serve every file (404) or may redirect.
// We use a tolerant pre-cache so install never fails.
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.svg',
  './icons/icon-512.svg',
  './icons/maskable-512.svg'
];

// We intentionally do NOT pre-cache remote CDN assets (Tailwind/FontAwesome/jQuery/Select2)
// to avoid CORS/cache bloat issues. The app still works offline for already-loaded assets,
// and online for AI calls.

async function precacheTolerant(cache) {
  const results = await Promise.allSettled(
    ASSETS.map(async (asset) => {
      // Use reload to avoid HTTP cache returning opaque/redirected oddities
      const req = new Request(asset, { cache: 'reload' });
      const res = await fetch(req);
      if (!res || !res.ok) return;
      await cache.put(asset, res);
    })
  );
  // Optional: keep a tiny debug signal (won't break install)
  // const failed = results.filter(r => r.status === 'rejected').length;
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await precacheTolerant(cache);
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => (k !== CACHE_NAME ? caches.delete(k) : Promise.resolve())));
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Only handle same-origin
  if (url.origin !== self.location.origin) return;

  // Network-first for navigation (freshest index.html)
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => {
            // Cache index under stable keys to cover querystring start_url
            c.put('./index.html', copy);
            c.put('./', copy.clone());
          });
          return res;
        })
        .catch(() => caches.match('./index.html') || caches.match('./'))
    );
    return;
  }

  // Cache-first for known assets
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((c) => c.put(req, copy));
        return res;
      }).catch(() => cached);
    })
  );
});
