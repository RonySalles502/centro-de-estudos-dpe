const APP_VERSION = "__APP_VERSION__";
const STATIC_CACHE = `centro-dpern-static-${APP_VERSION}`;
const CONTENT_CACHE = `centro-dpern-content-${APP_VERSION}`;
const ROOT = new URL("./", self.registration.scope);
const STATIC = ["./", "./index.html", "./styles.css", "./app.js", "./manifest.webmanifest", "./icon.svg"].map(path => new URL(path, ROOT).href);
self.addEventListener("install", event => { event.waitUntil(caches.open(STATIC_CACHE).then(cache => cache.addAll(STATIC))); self.skipWaiting(); });
self.addEventListener("activate", event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => ![STATIC_CACHE, CONTENT_CACHE].includes(key)).map(key => caches.delete(key))))); self.clients.claim(); });
async function networkFirst(request, cacheName, fallback) { const cache = await caches.open(cacheName); try { const response = await fetch(request); if (response.ok) await cache.put(request, response.clone()); return response; } catch (error) { return (await cache.match(request)) || (fallback ? await cache.match(fallback) : Response.error()); } }
self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== ROOT.origin) return;
  if (event.request.mode === "navigate") { event.respondWith(networkFirst(event.request, STATIC_CACHE, new URL("./index.html", ROOT).href)); return; }
  if (url.pathname.includes("/content/")) { event.respondWith(networkFirst(event.request, CONTENT_CACHE)); return; }
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(response => { if (response.ok) caches.open(STATIC_CACHE).then(cache => cache.put(event.request, response.clone())); return response; })));
});
