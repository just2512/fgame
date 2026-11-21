const CACHE_NAME = "fgame-shell-v1";
const scopeUrl = self.registration.scope;
const SHELL = [
  new URL("./", scopeUrl).toString(),
  new URL("./index.html", scopeUrl).toString(),
  new URL("./manifest.webmanifest", scopeUrl).toString(),
  new URL("./icon.svg", scopeUrl).toString()
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(new URL("./index.html", scopeUrl).toString(), copy));
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(new URL("./index.html", scopeUrl).toString());
          if (cached) return cached;
          return caches.match(new URL("./", scopeUrl).toString());
        })
    );
    return;
  }

  event.respondWith(
    caches.match(request, { ignoreVary: true }).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    })
  );
});
