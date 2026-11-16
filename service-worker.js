const CACHE = 'ticketsasa-offline-v4';
const OFFLINE = '/offline.html';
const OFFLINE_ASSETS = [OFFLINE, '/assets/app/icon-192.png'];

self.addEventListener('install', event => {
    event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(OFFLINE_ASSETS)));
});

self.addEventListener('activate', event => {
    event.waitUntil(caches.keys().then(keys => Promise.all(
        keys.filter(key => key.startsWith('ticketsasa-offline-') && key !== CACHE)
            .map(key => caches.delete(key))
    )).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);
    if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
    if (event.request.mode === 'navigate' && url.pathname === '/') {
        event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE)));
    } else if (url.pathname === '/assets/app/icon-192.png' && !url.search) {
        event.respondWith(caches.open(CACHE).then(cache => cache.match(url.pathname))
            .then(cached => cached || fetch(event.request)));
    }
});
