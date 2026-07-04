// WZ-PWA-2026-07-05 :: WizePicks service worker.
// Purpose: make the site installable and give it an offline shell. It deliberately
// NEVER caches live data — the API lives on a different origin (Railway) so it's not
// even touched here, and any same-origin /api path is skipped — so scores, odds, and
// edges are always fresh. Bump CACHE (v1 -> v2 ...) to force a clean refresh of the shell.

const CACHE = "wizepicks-shell-v1";
const SHELL = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Only handle same-origin GETs. The API (Railway) is cross-origin, so it's never
  // intercepted; skip any same-origin /api path too, as a belt-and-suspenders guard.
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api")) return;

  // Navigations: network-first (always try for the freshest app), fall back to the
  // cached shell only when offline.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() => caches.match("/index.html").then((r) => r || caches.match("/")))
    );
    return;
  }

  // Static assets (hashed JS/CSS/images): cache-first for speed, then network, and
  // cache the fetched copy for next time.
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === "basic") {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
    })
  );
});
