/*
 * Service worker. Deliberately conservative: a broken one can strand a phone on
 * an old version, so nearly everything goes to the network first.
 *
 *  - Pages (navigations / index.html) and data/** (manifest, per-service catalog files, new.json, titles.json): network first, cache when offline.
 *  - assets/* (hashed file names, never change): cache first.
 *  - Poster images from TMDB: cache first, small bounded cache.
 *  - Firebase / Google API traffic and anything else cross-origin: not touched at all.
 *
 * Bump VERSION to throw away every old cache on the next launch.
 */
const VERSION = 'v2';
const PAGES = `pt-pages-${VERSION}`;
const ASSETS = `pt-assets-${VERSION}`;
const IMAGES = `pt-images-${VERSION}`;
const KEEP = [PAGES, ASSETS, IMAGES];
const MAX_IMAGES = 200;
const NETWORK_TIMEOUT_MS = 4000;
const SCOPE = new URL(self.registration.scope).pathname; // e.g. /pick-tonight/

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n.startsWith('pt-') && !KEEP.includes(n)).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

async function put(cacheName, request, response) {
  // Only keep complete, successful answers (opaque image responses are allowed).
  if (!response || (response.status !== 200 && response.type !== 'opaque')) return;
  try {
    const cache = await caches.open(cacheName);
    await cache.put(request, response);
  } catch (e) {
    /* storage full or similar: carry on without caching */
  }
}

async function networkFirst(request, cacheName, { timeout = 0, fallbackToScope = false } = {}) {
  const cache = await caches.open(cacheName);
  const network = fetch(request).then((response) => {
    put(cacheName, request, response.clone());
    return response;
  });
  network.catch(() => {});
  try {
    if (timeout) {
      return await Promise.race([
        network,
        new Promise((_, reject) => setTimeout(() => reject(new Error('slow network')), timeout)),
      ]);
    }
    return await network;
  } catch (e) {
    const hit =
      (await cache.match(request, { ignoreSearch: true })) ||
      (fallbackToScope ? await cache.match(SCOPE, { ignoreSearch: true }) : undefined);
    if (hit) return hit;
    return network; // nothing cached: wait for the network after all (or fail normally)
  }
}

async function cacheFirst(request, cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  await put(cacheName, request, response.clone());
  if (maxEntries) {
    const keys = await cache.keys();
    for (let i = 0; i < keys.length - maxEntries; i++) await cache.delete(keys[i]);
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // Poster art from TMDB's image CDN.
  if (url.hostname === 'image.tmdb.org') {
    event.respondWith(cacheFirst(request, IMAGES, MAX_IMAGES).catch(() => fetch(request)));
    return;
  }

  // Everything else cross-origin (Firebase, Google APIs, ...) is left alone.
  if (url.origin !== self.location.origin) return;
  // Only our own scope.
  if (!url.pathname.startsWith(SCOPE)) return;
  // Never intercept the service worker file itself.
  if (url.pathname.endsWith('/sw.js')) return;

  const rel = url.pathname.slice(SCOPE.length);

  if (request.mode === 'navigate' || rel === '' || rel === 'index.html') {
    event.respondWith(networkFirst(request, PAGES, { timeout: NETWORK_TIMEOUT_MS, fallbackToScope: true }));
    return;
  }
  if (rel.startsWith('data/')) {
    event.respondWith(networkFirst(request, PAGES, { timeout: NETWORK_TIMEOUT_MS }));
    return;
  }
  if (rel.startsWith('assets/')) {
    event.respondWith(cacheFirst(request, ASSETS).catch(() => fetch(request)));
    return;
  }
  // Icons, manifest and the like.
  event.respondWith(networkFirst(request, PAGES, { timeout: NETWORK_TIMEOUT_MS }));
});
