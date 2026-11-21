/* Service worker do Escuta Só!
 * Guarda todos os arquivos do jogo no aparelho para funcionar 100% offline.
 * Ao publicar uma versão nova, aumente o número em CACHE: o aparelho baixa
 * tudo de novo na próxima vez que abrir o jogo com internet e apaga o cache antigo.
 * (Os dados da fono ficam no IndexedDB e NÃO são afetados por isso.) */
const CACHE = 'escuta-so-v6';

const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './sintonia.js',
  './manifest.json',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(ASSETS.map(url => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('escuta-so-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  // Abrir o app: sempre a página guardada (funciona sem internet).
  if (req.mode === 'navigate') {
    event.respondWith(caches.match('./index.html').then(res => res || fetch(req)));
    return;
  }

  // Demais arquivos: primeiro o cache; se não tiver, busca e guarda.
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then(cached => cached || fetch(req).then(res => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then(cache => cache.put(req, copy));
      }
      return res;
    }))
  );
});
