/* Lab Virtual Kimia X — service worker
   Menyimpan halaman, font, dan seluruh gambar di penyimpanan internal browser (Cache Storage)
   agar website tetap bisa dipakai tanpa internet setelah kunjungan pertama. */
const VERSION = 'v1';
const SITE_CACHE = 'lvk-site-' + VERSION;
const IMG_CACHE = 'lvk-img-' + VERSION;
const FONT_CACHE = 'lvk-font-' + VERSION;

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SITE_CACHE)
      .then(c => c.addAll(['./', './index.html']).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keep = [SITE_CACHE, IMG_CACHE, FONT_CACHE];
    const names = await caches.keys();
    await Promise.all(names.filter(n => n.startsWith('lvk-') && !keep.includes(n)).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

const isImage = url => url.hostname === 'upload.wikimedia.org' ||
  (url.hostname === 'commons.wikimedia.org' && url.pathname.startsWith('/wiki/Special:FilePath'));
const isFont = url => url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';

async function fetchForCache(url) {
  // Coba CORS dulu (respons dapat dibaca); bila ditolak, simpan respons opaque.
  try {
    const r = await fetch(url, { mode: 'cors', credentials: 'omit', redirect: 'follow' });
    if (r.ok) return r;
  } catch (e) {}
  return fetch(new Request(url, { mode: 'no-cors', credentials: 'omit' }));
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request, { ignoreVary: true });
  if (hit) return hit;
  const res = await fetch(request);
  if (res && (res.ok || res.type === 'opaque')) cache.put(request, res.clone()).catch(() => {});
  return res;
}

async function networkFirst(request) {
  const cache = await caches.open(SITE_CACHE);
  try {
    const res = await fetch(request);
    if (res && res.ok) cache.put(request, res.clone()).catch(() => {});
    return res;
  } catch (e) {
    return (await cache.match(request, { ignoreSearch: true })) ||
           (await cache.match('./index.html')) || Response.error();
  }
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (isImage(url)) { event.respondWith(cacheFirst(req, IMG_CACHE)); return; }
  if (isFont(url)) { event.respondWith(cacheFirst(req, FONT_CACHE)); return; }
  if (url.origin === self.location.origin) { event.respondWith(networkFirst(req)); }
});

// Unduh seluruh gambar sekaligus atas permintaan halaman, sambil melaporkan kemajuan.
self.addEventListener('message', event => {
  const data = event.data || {};
  const reply = msg => event.source && event.source.postMessage(msg);
  if (data.type === 'precache' && Array.isArray(data.urls)) {
    event.waitUntil((async () => {
      const cache = await caches.open(IMG_CACHE);
      let done = 0, failed = 0;
      const queue = data.urls.slice();
      const worker = async () => {
        while (queue.length) {
          const url = queue.shift();
          try {
            if (!(await cache.match(url, { ignoreVary: true }))) {
              const res = await fetchForCache(url);
              if (res && (res.ok || res.type === 'opaque')) await cache.put(url, res);
              else failed++;
            }
          } catch (e) { failed++; }
          done++;
          reply({ type: 'progress', done, total: data.urls.length, failed });
        }
      };
      await Promise.all([worker(), worker(), worker(), worker()]);
      reply({ type: 'complete', done, total: data.urls.length, failed });
    })());
  }
  if (data.type === 'status') {
    event.waitUntil((async () => {
      const cache = await caches.open(IMG_CACHE);
      const keys = await cache.keys();
      reply({ type: 'status', cached: keys.length });
    })());
  }
  if (data.type === 'clear') {
    event.waitUntil((async () => {
      await caches.delete(IMG_CACHE);
      reply({ type: 'cleared' });
    })());
  }
});
