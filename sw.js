/* Service worker: makes the app usable with no signal, and installable as a phone app.
 *
 * Strategy is network-first with a cache fallback, not cache-first. A timesheet that
 * quietly runs week-old code because a cache never expired is worse than a slightly
 * slower load, so the network always wins when it's reachable.
 *
 * Only same-origin GETs are handled. Firebase and Google Fonts are left alone: the app
 * already falls back to system fonts and to localStorage-cached hours when offline.
 */

const CACHE = 'lcp-hours-v6';
const SHELL = [
  './',
  './index.html',
  './styles.css?v=6',
  './app.js?v=6',
  './sync-config.js?v=6',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    // Individually, so one missing file can't fail the whole install.
    caches.open(CACHE)
      .then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;

  event.respondWith(
    fetch(req)
      .then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req).then(hit => hit || caches.match('./index.html')))
  );
});
