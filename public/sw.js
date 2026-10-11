const CACHE = 'screen-room-v9-1';
const SHELL = ['/', '/index.html', '/app.css', '/app.js', '/call.js', '/salas.html', '/manifest.webmanifest', '/icons/icon.svg', '/icons/icon-192.png', '/icons/icon-512.png'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('screen-room-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  // Nunca guardar respostas de contas, mensagens ou backup no cache da PWA.
  if (url.origin !== location.origin || url.pathname.startsWith('/api/') || ['/signal', '/realtime', '/health'].includes(url.pathname)) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.match(url.pathname === '/salas.html' ? '/salas.html' : '/index.html'))); return;
  }
  if (SHELL.includes(url.pathname)) event.respondWith(fetch(event.request).then(response => {if (response.ok) {const copy = response.clone(); caches.open(CACHE).then(cache => cache.put(event.request, copy));} return response;}).catch(() => caches.match(event.request)));
});
