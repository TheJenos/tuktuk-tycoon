/*
 * The service worker: makes the game installable and playable offline (against bots, or hot-seat).
 * scripts/pwa.ts fills in VERSION, PRECACHE and SHELL_FILES at build time and writes this to dist/sw.js.
 *
 *   the page (navigations)   network first, so a deploy shows up at once; the cached page when offline
 *   /assets/*                cache first: Vite puts a content hash in the names, so they never change
 *   everything else here     stale while revalidate (icons, legal pages, the manifest)
 *
 * A new version waits until every tab of the old one is closed (no skipWaiting): a game in progress keeps
 * the files it started with, and Netlify's deploys drop the old hashed ones.
 *
 * Other origins (Firebase, Discord, the Netlify functions) are never touched: multiplayer is online only.
 */
const VERSION = __VERSION__;
const PRECACHE = __PRECACHE__;
const SHELL_FILES = __SHELL_FILES__;

const SHELL = `shell-${VERSION}`;
// Hashed files: shared between versions, pruned to the current build's on activate
const ASSETS = 'assets';

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const shell = await caches.open(SHELL);
      await shell.addAll(['/', ...SHELL_FILES].map((p) => new Request(p, { cache: 'reload' })));
      const assets = await caches.open(ASSETS);
      const have = new Set((await assets.keys()).map((r) => new URL(r.url).pathname));
      await assets.addAll(PRECACHE.filter((p) => !have.has(p)));
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name !== SHELL && name !== ASSETS) await caches.delete(name);
      }
      // Precached files the new build no longer uses. Sounds are fetched when first played, not
      // precached, so they're kept: the next build's sounds have the same hashes unless they changed.
      const keep = new Set(PRECACHE);
      const assets = await caches.open(ASSETS);
      for (const req of await assets.keys()) {
        const path = new URL(req.url).pathname;
        if (!keep.has(path) && !/\.(ogg|mp3)$/.test(path)) await assets.delete(req);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/.netlify/')) return;

  if (req.mode === 'navigate') {
    event.respondWith(page(req));
  } else if (url.pathname.startsWith('/assets/')) {
    event.respondWith(hashed(req));
  } else {
    event.respondWith(revalidate(req));
  }
});

async function page(req) {
  try {
    const res = await fetch(req);
    // Only the game's own page is kept: /privacy.html and the like go through revalidate's cache
    if (res.ok && new URL(req.url).pathname === '/') (await caches.open(SHELL)).put('/', res.clone());
    return res;
  } catch {
    const cached = (await caches.match(req, { ignoreSearch: true, ignoreVary: true })) ?? (await caches.match('/'));
    return cached ?? Response.error();
  }
}

async function hashed(req) {
  const cache = await caches.open(ASSETS);
  // ignoreVary: module scripts are requested with an Origin header, the precache without one.
  // A ranged request (media) can't be answered from a full cached response by every browser; let it through
  const cached = await cache.match(req, { ignoreSearch: true, ignoreVary: true });
  if (cached && !req.headers.has('range')) return cached;
  const res = await fetch(req);
  if (res.ok && res.status === 200) cache.put(req, res.clone());
  return res;
}

async function revalidate(req) {
  const cache = await caches.open(SHELL);
  const cached = await cache.match(req, { ignoreVary: true });
  const fresh = fetch(req).then((res) => {
    if (res.ok && res.status === 200) cache.put(req, res.clone());
    return res;
  });
  if (cached) {
    fresh.catch(() => undefined);
    return cached;
  }
  return fresh;
}
