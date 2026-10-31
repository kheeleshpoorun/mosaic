/* Mosaic service worker: the app shell works offline and opens instantly on a slow network.
 * Built by scripts/sw-plugin.ts, which prepends PRECACHE (every built file but library audio),
 * VERSION (a hash of them) and BASE (Vite's base). Library stems are not handled here: the app
 * keeps them in the `mosaic-stems` cache itself (src/lib/stemCache.ts). */
/* global PRECACHE, VERSION, BASE */

const SHELL = `mosaic-shell-${VERSION}`;
const FONTS = 'mosaic-fonts';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((cache) => cache.addAll(PRECACHE)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith('mosaic-shell-') && key !== SHELL) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

// A new version waits until the page asks for it (see src/lib/serviceWorker.ts), so a deploy never
// swaps the code under a song that is playing.
self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  // Range requests (media seeking) and anything but GET go straight to the network.
  if (req.method !== 'GET' || req.headers.has('range')) return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    if (url.pathname.startsWith(`${BASE}library/`)) return;
    // Navigations (?song=…, ?import=…) all get the cached page; the app reads the query itself.
    const key = req.mode === 'navigate' ? `${BASE}index.html` : req;
    // ignoreVary: module scripts and CSS are requested with an Origin header (crossorigin) that the
    // precache requests didn't send, and a `Vary: Origin` response would never match them.
    event.respondWith(caches.match(key, { cacheName: SHELL, ignoreVary: true }).then((hit) => hit || fetch(req)));
    return;
  }

  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(staleWhileRevalidate(req));
  }
});

async function staleWhileRevalidate(req) {
  const cache = await caches.open(FONTS);
  const hit = await cache.match(req);
  const fresh = fetch(req)
    .then((res) => {
      if (res.ok || res.type === 'opaque') void cache.put(req, res.clone());
      return res;
    })
    .catch(() => hit || Response.error());
  return hit || fresh;
}
