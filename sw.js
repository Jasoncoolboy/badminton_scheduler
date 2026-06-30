const SW_VERSION = 'v4';
const APP_VERSION = '2.2.0';
const CORE_CACHE = `shuttle-core-${SW_VERSION}`;
const RUNTIME_CACHE = `shuttle-runtime-${SW_VERSION}`;

const CORE_ASSETS = [
    './',
    './index.html',
    `./style.css?v=${APP_VERSION}`,
    `./app.js?v=${APP_VERSION}`,
    `./manifest.json?v=${APP_VERSION}`,
    `./sw.js?v=${APP_VERSION}`
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CORE_CACHE)
            .then(cache => Promise.allSettled(CORE_ASSETS.map(asset => cache.add(asset))))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(
                keys
                    .filter(key => key !== CORE_CACHE && key !== RUNTIME_CACHE)
                    .map(key => caches.delete(key))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('message', event => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});

function isSameOrigin(request) {
    const requestUrl = new URL(request.url);
    return requestUrl.origin === self.location.origin;
}

async function networkFirst(request) {
    const cache = await caches.open(CORE_CACHE);
    try {
        const networkResponse = await fetch(request);
        cache.put(request, networkResponse.clone());
        return networkResponse;
    } catch (error) {
        const cached = await cache.match(request);
        if (cached) return cached;
        return caches.match('./index.html');
    }
}

function isAppShellAsset(pathname) {
    return /\.(?:js|css)$/i.test(pathname) || pathname.endsWith('/sw.js');
}

self.addEventListener('fetch', event => {
    if (event.request.method !== 'GET') return;
    if (!isSameOrigin(event.request)) return;

    const requestUrl = new URL(event.request.url);
    const isNavigation = event.request.mode === 'navigate';

    if (isNavigation || isAppShellAsset(requestUrl.pathname)) {
        event.respondWith(networkFirst(event.request));
    }
});