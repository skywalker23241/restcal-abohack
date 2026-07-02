/* 休历 Service Worker
 * 发布新版本时递增 CACHE_VERSION，旧缓存会在 activate 阶段清除。 */
const CACHE_VERSION = "v1.3.3";
const APP_CACHE = `xiuli-app-${CACHE_VERSION}`;
const FONT_CACHE = "xiuli-fonts-v1";

const YEAR_DATA = Array.from({ length: 2026 - 2004 + 1 }, (_, i) => `vendor/chinese-days/years/${2004 + i}.json`);

const PRECACHE = [
    "./",
    "index.html",
    "styles.css",
    "manifest.webmanifest",
    "vendor/chinese-days/index.min.js",
    "icons/icon-192.png",
    "icons/icon-512.png",
    "icons/maskable-512.png",
    "icons/apple-touch-icon.png",
    ...YEAR_DATA
];

self.addEventListener("install", event => {
    event.waitUntil(
        caches.open(APP_CACHE)
            .then(cache => cache.addAll(PRECACHE))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener("activate", event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(
                keys.filter(key => key !== APP_CACHE && key !== FONT_CACHE)
                    .map(key => caches.delete(key))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener("fetch", event => {
    const request = event.request;
    if (request.method !== "GET") return;

    const url = new URL(request.url);

    // 字体等 CDN 资源：URL 带版本号不可变，cache-first
    if (url.hostname === "cdn.jsdelivr.net") {
        event.respondWith(cacheFirst(request, FONT_CACHE));
        return;
    }

    if (url.origin !== self.location.origin) return;

    // 页面与样式 network-first：避免新 index.html 搭配旧 styles.css 造成布局错位，离线时回退缓存
    if (request.mode === "navigate" || url.pathname.endsWith("/styles.css")) {
        const cacheKey = request.mode === "navigate" ? "index.html" : request;
        event.respondWith(
            fetch(request)
                .then(response => {
                    const copy = response.clone();
                    caches.open(APP_CACHE).then(cache => cache.put(cacheKey, copy));
                    return response;
                })
                .catch(() => caches.match(cacheKey))
        );
        return;
    }

    // 其余同源静态资源：cache-first
    event.respondWith(cacheFirst(request, APP_CACHE));
});

function cacheFirst(request, cacheName) {
    return caches.match(request).then(cached => {
        if (cached) return cached;
        return fetch(request).then(response => {
            if (response.ok || response.type === "opaque") {
                const copy = response.clone();
                caches.open(cacheName).then(cache => cache.put(request, copy));
            }
            return response;
        });
    });
}
