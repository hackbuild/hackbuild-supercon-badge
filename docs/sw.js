// Keeps the crowd games pages installable and usable on flaky wifi. Same-origin files are fetched
// network first so a deploy lands on the next load, with the cached copy as the fallback. The CDN
// libraries are version pinned, so they come from cache and refresh behind it. Anything else,
// including the giphy gifs and every non-GET request, goes to the network untouched. Every URL is
// relative so the site works under its /hackbuild-supercon-badge/ path.

const SHELL_CACHE = 'hb-badge-shell-v1';
const CDN_CACHE = 'hb-badge-cdn-v1';
const KEEP = [SHELL_CACHE, CDN_CACHE];
// A cached page is served after this long without a network answer, so a bad link never hangs a load.
const NETWORK_WAIT_MS = 4000;
const CDN_HOSTS = ['cdn.jsdelivr.net', 'unpkg.com', 'cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];
const SHELL = [
  './', 'index.html', 'host.html', 'play.html', 'stage.html', 'coin.html', 'viewer.html',
  'manifest.webmanifest', 'lib/ui.css',
  'icons/icon-32.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', event => {
  // One missing file must not fail the install, and reload skips the browser's http cache.
  event.waitUntil(caches.open(SHELL_CACHE)
    .then(cache => Promise.allSettled(SHELL.map(url => cache.add(new Request(url, { cache: 'reload' })))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(names => Promise.all(names.filter(n => n.startsWith('hb-badge-') && !KEEP.includes(n)).map(n => caches.delete(n))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET' || request.headers.has('range')) return;
  if (request.cache === 'only-if-cached' && request.mode !== 'same-origin') return;
  const url = new URL(request.url);
  if (url.origin === self.location.origin) event.respondWith(networkFirst(event, request));
  else if (CDN_HOSTS.includes(url.hostname)) event.respondWith(staleWhileRevalidate(event, request));
});

const storable = res => res.ok && res.status === 200;

async function networkFirst(event, request) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request, { ignoreVary: true });
  // no-cache revalidates with the server, since github pages lets the http cache hold a file for ten minutes.
  const fresh = fetch(request, { cache: 'no-cache' }).then(res => {
    if (!storable(res)) return res.status >= 500 && cached ? cached : res;
    cache.put(request, res.clone()).catch(() => {});
    return res;
  });
  if (!cached) return fresh;
  event.waitUntil(fresh.catch(() => {}));
  return Promise.race([fresh.catch(() => cached), new Promise(done => setTimeout(done, NETWORK_WAIT_MS, cached))]);
}

async function staleWhileRevalidate(event, request) {
  const cache = await caches.open(CDN_CACHE);
  const cached = await cache.match(request, { ignoreVary: true });
  const fresh = fetch(request).then(res => {
    // The font stylesheet is a no-cors request, so its response is opaque and still worth keeping.
    if (storable(res) || res.type === 'opaque') cache.put(request, res.clone()).catch(() => {});
    return res;
  });
  if (!cached) return fresh;
  event.waitUntil(fresh.catch(() => {}));
  return cached;
}
