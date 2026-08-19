const SW_VERSION = 'v5';
const APP_VERSION = '2.3.0';
const CORE_CACHE = `shuttle-core-${SW_VERSION}-${APP_VERSION}`;

const CORE_ASSETS = [
    './',
    './index.html',
    `./style.css?v=${APP_VERSION}`,
    `./app.js?v=${APP_VERSION}`,
    `./manifest.json?v=${APP_VERSION}`
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CORE_CACHE)
            // reload skips the HTTP cache, so a fresh install never seeds
            // itself with the files the previous version was serving
            .then(cache => Promise.allSettled(
                CORE_ASSETS.map(asset => cache.add(new Request(asset, { cache: 'reload' })))
            ))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(
                keys.filter(key => key !== CORE_CACHE).map(key => caches.delete(key))
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
    return new URL(request.url).origin === self.location.origin;
}

function isAppShellAsset(pathname) {
    return /\.(?:js|css)$/i.test(pathname);
}

async function networkFirst(request, bypassHttpCache) {
    const cache = await caches.open(CORE_CACHE);

    try {
        const response = await fetch(request, bypassHttpCache ? { cache: 'reload' } : undefined);
        if (response && response.ok) {
            cache.put(request, response.clone());
            return response;
        }
        // a 404/500 mid-deploy must not replace a working cached copy
        return (await cache.match(request)) || response;
    } catch (error) {
        return (await cache.match(request)) || caches.match('./index.html');
    }
}

self.addEventListener('fetch', event => {
    if (event.request.method !== 'GET') return;
    if (!isSameOrigin(event.request)) return;

    const pathname = new URL(event.request.url).pathname;

    if (event.request.mode === 'navigate') {
        // navigations keep their own request so redirects stay intact
        event.respondWith(networkFirst(event.request, false));
    } else if (isAppShellAsset(pathname)) {
        event.respondWith(networkFirst(event.request, true));
    }
});
