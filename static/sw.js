// CartChef service worker.
// Static assets: stale-while-revalidate. Pages and the list: network first, falling
// back to the last cached copy so the shopping list stays readable with no signal.
// Bump VERSION when the precache list changes.
const VERSION = "cartchef-v1";
const STATIC_CACHE = `${VERSION}-static`;
const PAGE_CACHE = `${VERSION}-pages`;
const PRECACHE = [
  "/static/css/app.css",
  "/static/js/app.js",
  "/static/icons/icon-192.png",
  "/static/icons/icon-512.png",
  "/manifest.webmanifest",
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const statics = await caches.open(STATIC_CACHE);
    await statics.addAll(PRECACHE);
    try {
      const pages = await caches.open(PAGE_CACHE);
      await pages.add(new Request("/list", { headers: { Accept: "text/html" } }));
    } catch { /* offline during install: the list is cached on the next visit */ }
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => !key.startsWith(VERSION)).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

async function staleWhileRevalidate(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => cached);
  return cached || network;
}

const OFFLINE_HTML = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Offline · CartChef</title><body style="font-family:system-ui;padding:2rem;background:#fbf5ea;color:#2b2118">
<h1>You're offline</h1><p>Open the <a href="/list">shopping list</a> once while online and it will be available offline.</p>`;

async function networkFirst(request, { navigation }) {
  const cache = await caches.open(PAGE_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request.url, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request.url);
    if (cached) return cached;
    if (navigation) {
      const list = await cache.match(new URL("/list", self.location.origin).href);
      if (list) return list;
      return new Response(OFFLINE_HTML, { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } });
    }
    return Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/static/") || url.pathname === "/manifest.webmanifest") {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }
  const navigation = request.mode === "navigate";
  const wantsHtml = (request.headers.get("Accept") || "").includes("text/html");
  if (navigation || wantsHtml || url.pathname === "/api/list") {
    event.respondWith(networkFirst(request, { navigation }));
  }
});
