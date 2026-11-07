/* Public assets only. Never cache pages, API, room tickets or file downloads. */
const CACHE = 'scale-public-v1';
const OFFLINE = '/offline.html';
const PUBLIC_FILES = [OFFLINE, '/offline.css', '/icon-192.png'];
const MAX_ASSETS = 64;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    for (const path of PUBLIC_FILES) {
      const response = await fetch(new Request(path, { credentials: 'omit', cache: 'reload' }));
      if (!response.ok || response.redirected) throw new Error('Offline assets unavailable');
      await cache.put(path, response);
    }
  })());
  // No skipWaiting: a new worker activates only after ALL old tabs close.
  // This prevents a second window from updating a client during its call.
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith('scale-public-') && name !== CACHE) await caches.delete(name);
    }
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (/^\/(?:api|socket\.io)(?:\/|$)/.test(url.pathname) || url.pathname === '/sw.js') return;
  if (request.headers.has('authorization') || request.headers.has('x-room-ticket')) return;
  if (request.mode === 'navigate') {
    // Network-only HTML, even when logged in; fallback has no account data.
    event.respondWith(fetch(request).then(async (response) => {
      if (response.status >= 500) return (await caches.match(OFFLINE)) || response;
      return response;
    }).catch(async () => (await caches.match(OFFLINE)) || Response.error()));
    return;
  }
  if (url.search || url.hash) return;
  const isHashedAsset = /^\/_next\/static\/(?:[^/]+\/)*(?:[a-f0-9]{8,}|[^/]+[-.][a-f0-9]{8,})(?:\.[a-z0-9]+)+$/i.test(url.pathname);
  if (!isHashedAsset && !PUBLIC_FILES.includes(url.pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(request);
    if (cached) return cached;
    const response = await fetch(new Request(request, { credentials: 'omit' }));
    const contentType = response.headers.get('content-type') || '';
    const privateResponse = /(?:private|no-store)/i.test(response.headers.get('cache-control') || '');
    const safeType = /^(?:text\/css|(?:application|text)\/javascript|font\/|image\/)/i.test(contentType);
    if (response.ok && !response.redirected && response.type !== 'opaque' && safeType && !privateResponse) {
      try {
        await cache.put(request, response.clone());
        const keys = await cache.keys();
        const assets = keys.filter((key) => !PUBLIC_FILES.includes(new URL(key.url).pathname));
        for (const key of assets.slice(0, Math.max(0, assets.length - MAX_ASSETS))) await cache.delete(key);
      } catch { /* Quota/private browsing must not prevent loading the app. */ }
    }
    return response;
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find((client) => new URL(client.url).origin === self.location.origin);
    if (existing) await existing.focus();
    else await self.clients.openWindow('/');
  })());
});
