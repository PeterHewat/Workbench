/**
 * Precaching service worker shared by every Workbench app.
 *
 * The `@workbench/ui/vite` plugin prepends two constants when it emits this file into a build:
 * `VERSION`, a hash of the build, and `PRECACHE`, every file the build produced (relative to the
 * worker). A new deploy therefore ships a byte-different worker, the browser installs it, and it
 * drops the previous build's cache — so hashed assets from old deploys do not pile up forever.
 *
 * Each worker only answers for its own files. The index page's worker sits at the site root and
 * so has every app inside its scope; it must not cache or fall back for them.
 */
/* global VERSION, PRECACHE */

const PREFIX = `workbench:${self.registration.scope}:`;
const CACHE = PREFIX + VERSION;
const SHELL = new URL("./", self.registration.scope).href;
const OWNED = new Set([SHELL, ...PRECACHE.map((p) => new URL(p, self.registration.scope).href)]);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll([...OWNED]))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

/** The URL without its query or hash: `./?x=1` and `./index.html` are both the shell. */
function ownKey(req) {
  const url = new URL(req.url);
  url.search = "";
  url.hash = "";
  const href = url.href === `${SHELL}index.html` ? SHELL : url.href;
  return OWNED.has(href) ? href : null;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const key = ownKey(req);
  if (!key) return;

  if (req.mode === "navigate") {
    // Online, the page is always fresh; offline, the precached copy of this build.
    event.respondWith(fetch(req).catch(() => caches.match(key).then((hit) => hit ?? offline())));
    return;
  }
  // Everything else in the build is content-hashed or versioned with the worker: cache first.
  event.respondWith(caches.match(key).then((hit) => hit ?? fetch(req)));
});

function offline() {
  return new Response("Offline", { status: 503, statusText: "Offline" });
}
