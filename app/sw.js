/* Adis service worker: offline app shell (cache-first for static assets), network-first for API, notification clicks. */
const VERSION = 'adis-v0.5.2';
const SHELL = [
  './', './index.html', './manifest.webmanifest',
  './css/tokens.css', './css/base.css', './css/components.css', './css/screens.css',
  './js/core/utils.js', './js/core/logger.js', './js/core/storage.js', './js/core/settings.js', './js/core/i18n.js',
  './js/api/contract.js', './js/mock/db.js', './js/mock/nlu.js', './js/mock/finance.js', './js/mock/tools.js', './js/mock/ai-engine.js', './js/mock/agent-runner.js', './js/mock/mock-server.js',
  './js/api/http-client.js', './js/api/api-client.js', './js/data/repositories.js',
  './js/ui/icons.js', './js/ui/markdown.js', './js/ui/components.js', './js/ui/cards.js', './js/ui/camera.js', './js/ui/router.js',
  './js/services/notifications.js', './js/services/voice.js', './js/services/push.js', './js/services/alarm-clock.js',
  './js/screens/auth.js', './js/screens/onboarding.js', './js/screens/home.js', './js/screens/chat.js', './js/screens/voice.js', './js/screens/memory.js',
  './js/screens/tasks.js', './js/screens/calendar.js', './js/screens/alarms.js', './js/screens/finance.js', './js/screens/proactive.js', './js/screens/agents.js', './js/screens/workspaces.js', './js/screens/profile.js',
  './js/app.js', './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // API calls go straight to the network
  if (url.pathname.includes('/v1/')) return;          // same-origin AI Backend: never cache personal data
  /* Network-first so updates reach users immediately; cache is the offline fallback */
  e.respondWith(
    fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then(hit => hit || caches.match('./index.html')))
  );
});

/* Push from AI Backend (APNs/FCM via Web Push) */
self.addEventListener('push', e => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch (_) { data = { title: 'Adis', body: e.data && e.data.text() }; }
  const opts = { body: data.body || '', icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: data.tag || undefined, renotify: !!data.tag, data: { route: data.route || '#/tasks' } };
  /* Alarms stay on screen until the user reacts and vibrate (where the OS allows it) */
  if (data.alarm) Object.assign(opts, { requireInteraction: true, vibrate: [600, 300, 600, 300, 600], silent: false });
  e.waitUntil(self.registration.showNotification(data.title || 'Adis', opts));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const route = (e.notification.data && e.notification.data.route) || '#/home';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const c = list[0];
    if (c) { c.postMessage({ route }); return c.focus(); }
    return self.clients.openWindow('./index.html' + route);
  }));
});
