// Service worker do Zelo: o app inteiro funciona offline depois da primeira abertura.
// Ao publicar uma nova versão, aumente VERSION aqui e app.version em js/main.js.
const VERSION = 'zelo-v1.3.0';
const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/badge-96.png',
  'js/core/catalog.js',
  'js/core/data.js',
  'js/core/demo.js',
  'js/core/domain.js',
  'js/core/parse.js',
  'js/core/presence.js',
  'js/core/store.js',
  'js/core/sync.js',
  'js/core/voice.js',
  'js/firebase-config.js',
  'js/lib/clock.js',
  'js/lib/crypto.js',
  'js/lib/hlc.js',
  'js/lib/idb.js',
  'js/lib/util.js',
  'js/main.js',
  'js/state.js',
  'js/ui/chart.js',
  'js/ui/haptics.js',
  'js/ui/numpad.js',
  'js/ui/pickers.js',
  'js/ui/qr.js',
  'js/ui/rail.js',
  'js/ui/ui.js',
  'js/vendor/jsqr.js',
  'js/vendor/qrcode.js',
  'js/views/add.js',
  'js/views/checkout.js',
  'js/views/common.js',
  'js/views/gate.js',
  'js/views/inventory.js',
  'js/views/itemedit.js',
  'js/views/lists.js',
  'js/views/prices.js',
  'js/views/product.js',
  'js/views/settings.js',
  'js/views/shop.js',
];
const RUNTIME = 'zelo-runtime';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== RUNTIME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (e) => {
  if (e.data === 'skip') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Configuração do Firebase: rede primeiro (vale assim que o arquivo mudar), cache se offline.
  if (url.origin === location.origin && url.pathname.endsWith('/js/firebase-config.js')) {
    e.respondWith(
      fetch(req, { cache: 'no-store' })
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put('js/firebase-config.js', copy));
          }
          return res;
        })
        .catch(() => caches.match('js/firebase-config.js')),
    );
    return;
  }
  // App: cache primeiro, rede como reserva.
  if (url.origin === location.origin) {
    e.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).catch(() => caches.match('index.html'))));
    return;
  }
  // SDK do Firebase e fontes: usa o cache e atualiza em segundo plano.
  if (url.hostname === 'www.gstatic.com' || url.hostname.startsWith('fonts.')) {
    e.respondWith(
      caches.open(RUNTIME).then(async (c) => {
        const hit = await c.match(req);
        const net = fetch(req)
          .then((res) => {
            if (res.ok || res.type === 'opaque') c.put(req, res.clone());
            return res;
          })
          .catch(() => hit);
        return hit || net;
      }),
    );
  }
  // Firestore e Auth: sempre rede (o próprio app guarda os dados no IndexedDB).
});
