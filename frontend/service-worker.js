const CACHE = 'ticketsasa-offline-v5';
const IMG_CACHE = 'ticketsasa-img-v5';
const MAX_IMG_ENTRIES = 180;
const OFFLINE = '/offline.html';
const OFFLINE_ASSETS = [OFFLINE, '/assets/app/icon-192.png'];

self.addEventListener('install', event => {
    self.skipWaiting();
    event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(OFFLINE_ASSETS)));
});

self.addEventListener('activate', event => {
    event.waitUntil(caches.keys().then(keys => Promise.all(
        keys.filter(key =>
            (key.startsWith('ticketsasa-offline-') && key !== CACHE) ||
            (key.startsWith('ticketsasa-img-') && key !== IMG_CACHE)
        ).map(key => caches.delete(key))
    )).then(() => self.clients.claim()));
});

async function cacheFirstImage(request) {
    const cache = await caches.open(IMG_CACHE);
    const cached = await cache.match(request);
    if (cached) return cached;

    const response = await fetch(request);
    if (response && response.ok && (response.type === 'basic' || response.type === 'cors')) {
        cache.put(request, response.clone()).then(async () => {
            const keys = await cache.keys();
            if (keys.length > MAX_IMG_ENTRIES) {
                await Promise.all(keys.slice(0, keys.length - MAX_IMG_ENTRIES).map(k => cache.delete(k)));
            }
        }).catch(() => {});
    }
    return response;
}

self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);
    if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;

    if (event.request.mode === 'navigate' && url.pathname === '/') {
        event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE)));
        return;
    }

    const isImageAsset =
        (url.pathname.startsWith('/assets/') && /\.(png|jpe?g|webp|svg|gif)$/i.test(url.pathname)) ||
        url.pathname === '/img';

    if (isImageAsset) {
        event.respondWith(cacheFirstImage(event.request));
    }
});
