// Service worker для PWA.
// Стратегии:
//   /assets/ — хешированная сборка (immutable) → cache-first.
//   /icons/  — нехешированные пути (иконки принтеров и пр.) → network-first:
//              свежие при онлайне, из кэша только как офлайн-фолбэк. Именно
//              из-за прежнего cache-first здесь залипали старые SVG.
//   навигация — network-first с офлайн-фолбэком на оболочку.
//   /api/    — не кэшируем.
// Имя кэша меняем при смене стратегии, чтобы старый кэш вычистился на activate.
const CACHE = "ft-static-v2";

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.add("/")).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Кэшируем только успешные ответы (иначе можно закэшировать 404 и отдавать его).
function putIfOk(req, resp) {
  if (resp && resp.ok) {
    const copy = resp.clone();
    caches.open(CACHE).then((c) => c.put(req, copy));
  }
  return resp;
}

function cacheFirst(req) {
  return caches.match(req).then((hit) => hit || fetch(req).then((resp) => putIfOk(req, resp)));
}

function networkFirst(req) {
  return fetch(req).then((resp) => putIfOk(req, resp)).catch(() => caches.match(req));
}

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.startsWith("/api/")) return; // данные всегда по сети

  if (url.pathname.startsWith("/assets/")) { e.respondWith(cacheFirst(e.request)); return; }
  if (url.pathname.startsWith("/icons/")) { e.respondWith(networkFirst(e.request)); return; }

  // навигация — сеть, при офлайне отдаём оболочку приложения
  if (e.request.mode === "navigate") {
    e.respondWith(fetch(e.request).catch(() => caches.match("/")));
  }
});
