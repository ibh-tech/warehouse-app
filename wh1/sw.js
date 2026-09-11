// Cache name includes a version - bump this string any time the app is
// updated, so old phones automatically drop stale cached files instead
// of getting stuck on an old version forever.
const CACHE_NAME = "parcel-proof-shell-v8";
const SHELL_FILES = [
  "./",
  "./index.html",
  "./app.js",
  "./config.js",
  "./manifest.webmanifest",
  "./logo.png",
  "./icon-192.png",
  "./icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

// NETWORK-FIRST: always try to get the latest file from the internet first.
// Only fall back to the saved local copy if there's no connection. This is
// what makes sure phones pick up updates automatically next time they have
// signal, instead of being stuck on an old cached version.
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
