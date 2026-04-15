const SW_VERSION = 'v2';
const CORE_CACHE = `shuttle-core-${SW_VERSION}`;
const RUNTIME_CACHE = `shuttle-runtime-${SW_VERSION}`;

const CORE_ASSETS = [
    './',
    './index.html',
    './style.css?v=2.0.0',
    './app.js?v=2.0.0',
    './manifest.json?v=2.0.0'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CORE_CACHE).then(cache =>
            Promise.allSettled(CORE_ASSETS.map(asset => cache.add(asset)))
        )
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

async function staleWhileRevalidate(request) {
    const cache = await caches.open(RUNTIME_CACHE);
    const cached = await cache.match(request);
    const networkPromise = fetch(request)
        .then(response => {
            cache.put(request, response.clone());
            return response;
        })
        .catch(() => null);

    if (cached) {
        networkPromise.catch(() => null);
        return cached;
    }
    const networkResponse = await networkPromise;
    if (networkResponse) return networkResponse;
    return caches.match(request);
}

self.addEventListener('fetch', event => {
    if (event.request.method !== 'GET') return;
    if (!isSameOrigin(event.request)) return;

    const requestUrl = new URL(event.request.url);
    const isNavigation = event.request.mode === 'navigate';
    const isStaticAsset = /\.(?:js|css|png|jpg|jpeg|gif|svg|webp|json)$/i.test(requestUrl.pathname);

    if (isNavigation) {
        event.respondWith(networkFirst(event.request));
        return;
    }

    if (isStaticAsset) {
        event.respondWith(staleWhileRevalidate(event.request));
    }
});