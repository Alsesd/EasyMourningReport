// Network-first service worker: private pages are never cached; only an offline fallback and static assets are.
const CACHE = "legkyi-zvit-v4";
self.addEventListener("install", event => event.waitUntil(
  caches.open(CACHE)
    .then(cache => cache.addAll(["/offline", "/static/app.css", "/static/icon.svg", "/static/apple-touch-icon.png"]))
    .then(() => self.skipWaiting())
));
self.addEventListener("activate", event => event.waitUntil(
  caches.keys()
    .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
    .then(() => self.clients.claim())
));
self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== location.origin) return;
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match("/offline")));
  } else if (url.pathname.startsWith("/static/")) {
    event.respondWith(fetch(request).then(response => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE).then(cache => cache.put(request, copy));
      }
      return response;
    }).catch(() => caches.match(request)));
  }
});
