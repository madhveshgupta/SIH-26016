/** Service worker for the field app. */
// Bumped whenever the caching rules change: activation deletes every other
// cache, which clears copies stored under the old rules.
const CACHE = "bhoomi-field-v2";
const SHELL = ["/field", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Never serve case data from a cache: it would look current and not be.
  if (url.pathname.startsWith("/api/")) return;

  const cacheable = request.mode === "navigate" || url.pathname.startsWith("/_next/");
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok && cacheable) {
          const copy = response.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
        }
        return response;
      })
      // Offline: the last good copy, or for a page nobody cached, the shell.
      .catch(() =>
        caches.match(request).then((cached) => cached || (request.mode === "navigate" ? caches.match("/field") : undefined)),
      )
      .then((response) => response || Response.error()),
  );
});

// The page asks for a sync when it comes back online.
self.addEventListener("message", (event) => {
  if (event.data === "sync-now") {
    self.clients.matchAll().then((clients) => clients.forEach((c) => c.postMessage("sync-now")));
  }
});
