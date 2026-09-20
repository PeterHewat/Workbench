/**
 * Stale-while-revalidate service worker shared by every Workbench app.
 *
 * Runtime caching rather than a precache manifest: asset names are content-hashed by Vite, so
 * there is nothing to keep in sync at build time. A navigation that fails offline falls back to
 * the cached app shell, which is all these apps need — they have no server to talk to.
 */
const CACHE = "workbench-v1";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(req);
      const net = fetch(req)
        .then((res) => {
          if (res.ok) void cache.put(req, res.clone());
          return res;
        })
        .catch(() => null);
      if (hit) {
        void net;
        return hit;
      }
      const res = await net;
      if (res) return res;
      if (req.mode === "navigate") {
        const shell = await cache.match("./index.html");
        if (shell) return shell;
      }
      return new Response("Offline", { status: 503, statusText: "Offline" });
    })()
  );
});
