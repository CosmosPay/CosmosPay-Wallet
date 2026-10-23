/*
 * Offline shell for the installable web app — registered by src/lib/pwa.ts, web build only.
 *
 * What it caches is the app itself and nothing the app talks to:
 *   - pages (navigations): network first, so a deploy is picked up on the next open, with the
 *     last good copy as the offline fallback;
 *   - the bundle's hashed files (/assets/…), fonts, icons and logos: cache first — a hashed
 *     file never changes under its name;
 * and EVERY other request — the gateway, Horizon, the chain nodes, prices — goes straight to
 * the network untouched. A wallet must never answer a balance or a quote from a cache.
 *
 * Plain JavaScript with no imports: a worker file is served as is, outside the bundler.
 */
const VERSION = 'cosmos-web-v1';
const PAGES = `${VERSION}-pages`;
const ASSETS = `${VERSION}-assets`;
/** Hashed bundles accumulate across deploys; past this many the oldest are dropped. */
const MAX_ASSETS = 240;

/** The bundle's own folder (`build.assets` in astro.config.ts is `assets`) and the art. */
const STATIC_PATH = /\/(assets|fonts|icons|tokens|brand)\//;

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => !n.startsWith(VERSION)).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

async function trim(cache) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MAX_ASSETS; i++) await cache.delete(keys[i]);
}

async function pageFirstFromNetwork(request) {
  const cache = await caches.open(PAGES);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = (await cache.match(request)) || (await cache.match(self.registration.scope));
    if (cached) return cached;
    throw err;
  }
}

async function assetFromCache(request) {
  const cache = await caches.open(ASSETS);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok && response.type === 'basic') {
    await cache.put(request, response.clone());
    trim(cache);
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // Anything not served by this origin is the network's business, never the cache's.
  if (url.origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    event.respondWith(pageFirstFromNetwork(request));
    return;
  }
  if (!STATIC_PATH.test(url.pathname)) return;
  // Hashed bundles never change under their name; the art keeps its name across releases,
  // so it is served from the cache and refreshed behind it.
  event.respondWith(url.pathname.includes('/assets/') ? assetFromCache(request) : artRevalidated(request));
});

async function artRevalidated(request) {
  const cache = await caches.open(ASSETS);
  const cached = await cache.match(request);
  const fresh = fetch(request)
    .then((response) => {
      if (response.ok && response.type === 'basic') cache.put(request, response.clone());
      return response;
    })
    .catch(() => cached);
  return cached || fresh;
}
