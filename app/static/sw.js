// Network-first service worker: pages are never served from cache (data is private), only a fallback offline page.
const CACHE = "reports-v1";
self.addEventListener("install", e => e.waitUntil(
  caches.open(CACHE).then(c => c.addAll(["/offline", "/static/app.css", "/static/icon-192.png"])).then(() => self.skipWaiting())));
self.addEventListener("activate", e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).catch(() => caches.match("/offline")));
  } else if (url.pathname.startsWith("/static/")) {
    e.respondWith(fetch(req).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(req, copy));
      return res;
    }).catch(() => caches.match(req)));
  }
});
