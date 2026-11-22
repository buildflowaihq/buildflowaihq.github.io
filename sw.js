// BuildFlowAI app alerts. The server sends an empty "wake up" push; we ask it for the message and show it.
// The person's private key comes in on this file's address (sw.js?k=...).
var API = 'https://script.google.com/macros/s/AKfycbzi4KHTN8AChENP4Ar28nSZCsBPkSzxQ2dytwbO-GTAX0x5VGnK60bLJXq3WZm_A7zU9g/exec';
var KEY = new URL(self.location.href).searchParams.get('k') || '';
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });
self.addEventListener('push', function (e) {
  e.waitUntil(
    fetch(API + '?action=latest&k=' + encodeURIComponent(KEY), { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var m = (d && d.msg) || {};
        return self.registration.showNotification(m.title || 'BuildFlowAI', {
          body: m.body || 'BuildFlowAI needs you.', icon: 'icons/pwa-icon-192.png', badge: 'icons/favicon-32.png',
          data: { url: m.url || '' }, tag: 'bfai-' + (m.ts || Date.now())
        });
      })
      .catch(function () {
        return self.registration.showNotification('BuildFlowAI', { body: 'BuildFlowAI needs you.', icon: 'icons/pwa-icon-192.png' });
      })
  );
});
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var url = (e.notification.data && e.notification.data.url) || ('./?k=' + KEY);
  e.waitUntil(self.clients.openWindow(url));
});

// Always load the newest app pages when online (GitHub Pages lets browsers keep an old copy for 10 minutes).
// Only page loads are affected; everything else goes to the network as normal. Offline, the browser's copy is used.
self.addEventListener('fetch', function (e) {
  if (e.request.mode !== 'navigate') return;
  e.respondWith(fetch(e.request, { cache: 'no-store' }).catch(function () { return fetch(e.request); }));
});
