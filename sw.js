const CACHE = 'gmi-movil-shell-v0.1.16';
const CORE_FILES = [
  './',
  './index.html',
  './styles.css',
  './mobile.bundle.js',
  './manifest.webmanifest',
  './encabezado-institucional.png',
  './icons/gmi-192.png',
  './icons/gmi-512.png',
  './icons/gmi-maskable-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(CORE_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys
        .filter(key => key.startsWith('gmi-movil-shell-') && key !== CACHE)
        .map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // HTML y JavaScript: intenta obtener la versión vigente; si no hay red, usa caché.
  const isDocumentOrScript = request.mode === 'navigate' || /\.(?:html|js)$/.test(url.pathname);
  if (isDocumentOrScript) {
    event.respondWith(fetch(request, { cache: 'no-store' }).then(response => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE).then(cache => cache.put(request, copy));
      }
      return response;
    }).catch(() => caches.match(request).then(cached => cached || caches.match('./index.html'))));
    return;
  }

  // Estilos, manifiesto e imagen: caché primero para permitir uso sin conexión.
  event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
    if (response.ok) {
      const copy = response.clone();
      caches.open(CACHE).then(cache => cache.put(request, copy));
    }
    return response;
  })));
});
