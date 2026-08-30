// ── ZDA App service worker (PWA offline support) ──
//
// This used to be built as a Blob URL from a string embedded inside the
// main HTML file and registered from that (`URL.createObjectURL(...)`)
// instead of being a real, separately-hosted file. That worked fine for
// normal online use, but it's an unreliable pattern for the exact
// "app was fully closed, phone is offline, user reopens it" scenario:
// a service worker registered from a blob: URL doesn't have a stable
// script location the browser can independently re-fetch/re-verify on a
// cold start, and several mobile browser engines (notably iOS Safari,
// and Chrome/WebView in standalone/installed-PWA launch mode) can fail
// to properly re-invoke a blob-registered worker after the browser
// process itself has been fully killed - which looks exactly like "the
// app doesn't open in flight mode when it was closed." Serving this as
// a real file at a stable URL (sw.js, next to the main HTML file) is the
// standard, reliable fix. This file must be uploaded to the same
// folder/deploy as the main app HTML file (e.g. next to it on Netlify)
// so it's reachable at ".../sw.js".
//
// Caching strategy: the HTML document itself (navigation requests) is
// network-FIRST - always fetch the latest version when there's a
// connection, only falling back to the cached copy when genuinely
// offline. That's what makes an update pushed to Netlify actually reach
// already-installed devices instead of them being stuck on old cached
// code forever. Other same-origin assets stay cache-first (they rarely
// change and cache-first keeps things fast).
const CACHE = 'zda-v3';
const SHELL_URL = self.registration.scope;
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.add(SHELL_URL)).catch(() => {})
  );
  // No self.skipWaiting() here anymore: a freshly-installed worker now
  // parks itself in the "waiting" state instead of taking over
  // immediately. The main page listens for that (see the serviceWorker
  // registration block near the end of the HTML file) and shows an
  // "update available" bar so the user can apply it on their own terms -
  // skipWaiting only runs now in response to that button, via the
  // message listener below. Without this, a deploy could silently
  // reload someone's tab out from under them mid-entry.
});
self.addEventListener('message', e => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(ks => Promise.all(
      ks.filter(k => k !== CACHE).map(k => caches.delete(k))
    ))
  );
  self.clients.claim();
});
self.addEventListener('fetch', e => {
  var req = e.request;
  var isNav = req.mode === 'navigate' ||
    (req.method === 'GET' && (req.headers.get('accept') || '').indexOf('text/html') !== -1);
  if (req.url.startsWith(self.location.origin)) {
    if (isNav) {
      // App shell itself: always try the network first so updates show up
      // the moment there's connectivity. Cache the fresh copy as we go, and
      // fall back to whatever was last cached (or the precached shell) when
      // there's no network at all - this is what makes "closed the app
      // while offline" still open instead of failing to load.
      e.respondWith(
        fetch(req).then(res => {
          if (res && res.status === 200) {
            var rc = res.clone();
            caches.open(CACHE).then(c => c.put(req, rc));
          }
          return res;
        }).catch(() =>
          caches.match(req).then(cached => cached || caches.match(SHELL_URL))
        )
      );
    } else {
      e.respondWith(
        caches.match(req).then(cached => {
          if (cached) return cached;
          return fetch(req).then(res => {
            if (res && res.status === 200 && res.type !== 'opaque') {
              var rc = res.clone();
              caches.open(CACHE).then(c => c.put(req, rc));
            }
            return res;
          });
        })
      );
    }
  } else {
    // External: try network, fall back to cache
    e.respondWith(
      fetch(req).catch(() => caches.match(req))
    );
  }
});
