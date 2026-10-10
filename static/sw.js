// Service worker: makes the site installable and lets it open without signal.
//  - pages: always from the network (new versions show at once); without signal the
//    last saved app shell is used, so live scoring can be reopened on the field
//  - /_app/immutable/*: hashed files, cached on first use (they never change)
//  - everything else (data from Supabase, other sites): not touched
const CACHE = 'pps-app-v1';
const SHELL = '/200.html';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.add(new Request(SHELL, { cache: 'reload' })))
      // the shell is also saved on every page load, a failure here must not stop the install
      .catch(() => {})
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function trim(cache, max) {
  const keys = await cache.keys();
  for (const k of keys.slice(0, Math.max(0, keys.length - max))) {
    if (!k.url.endsWith(SHELL)) await cache.delete(k);
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(SHELL, copy));
          }
          return res;
        })
        .catch(() => caches.match(SHELL).then((r) => r ?? Response.error()))
    );
    return;
  }

  if (url.pathname.startsWith('/_app/immutable/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ??
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy).then(() => trim(c, 250)));
            }
            return res;
          })
      )
    );
  }
});
