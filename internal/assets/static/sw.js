// Versioned app-shell service worker: caches app shell & static assets, falls back to /offline when disconnected.
const CACHE = "legkyi-zvit-v23";
const PRECACHE = [
  "/offline",
  "/static/icon-192.png",
  "/static/icon-512.png",
  "/static/apple-touch-icon.png",
  "/manifest.webmanifest",
  "/static/manifest.webmanifest"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);

  // Ignore cross-origin and non-GET requests
  if (request.method !== "GET" || url.origin !== location.origin) return;

  // Navigation requests: network-first with /offline fallback
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match("/offline"))
    );
    return;
  }

  // Static assets: cache-first or network-first with dynamic caching
  if (url.pathname.startsWith("/static/")) {
    event.respondWith(
      caches.match(request).then(cached => {
        const fetchPromise = fetch(request).then(networkResponse => {
          if (networkResponse && networkResponse.ok) {
            const clone = networkResponse.clone();
            caches.open(CACHE).then(cache => cache.put(request, clone));
          }
          return networkResponse;
        }).catch(() => cached);

        return cached || fetchPromise;
      })
    );
  }
});

// Web Push: the server sends {id, title, body, link}. Chrome requires every push to show a notification. The tag is
// the same one the open page uses ("legkyi-<id>"), so a message never appears twice.
self.addEventListener("push", event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = {}; }
  const title = data.title || "Легкий звіт";
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || "",
    tag: "legkyi-" + (data.id || "msg"),
    icon: "/static/icon-192.png",
    badge: "/static/icon-192.png",
    data: { link: data.link || "/", id: data.id || 0 }
  }));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || "/";
  event.waitUntil((async () => {
    const wins = await clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of wins) {
      if ("focus" in w) {
        await w.focus();
        if ("navigate" in w) { try { await w.navigate(link); } catch (e) { /* cross-scope */ } }
        return;
      }
    }
    if (clients.openWindow) await clients.openWindow(link);
  })());
});
