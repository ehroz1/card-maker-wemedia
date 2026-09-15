/*
 * Офлайн-доступ: приложение и так один самодостаточный index.html без
 * внешних запросов (шрифты/логотипы/иконки уже вшиты), так что кешировать
 * нужно только саму страницу — тогда повторное открытие работает без сети.
 *
 * Стратегия: сеть в приоритете (чтобы всегда подтягивать свежую версию,
 * когда есть интернет), кеш — только как офлайн-подстраховка.
 *
 * Поменялась логика самого сервис-воркера — бампни CACHE, иначе старые
 * вкладки останутся на старой версии до следующего фонового обновления.
 */
const CACHE = 'card-maker-v1';
const CORE = ['./', './index.html'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(CORE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request)
      .then(response => {
        const copy = response.clone();
        caches.open(CACHE).then(cache => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request).then(cached => cached || caches.match('./index.html')))
  );
});
