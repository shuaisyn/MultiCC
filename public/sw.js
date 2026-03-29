'use strict';

const CACHE_NAME = 'webcc-v1';

// Push notification received
self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch (_) {
    payload = { title: 'WebCC', body: event.data.text() };
  }

  const title = payload.title || 'WebCC';
  const options = {
    body: payload.body || payload.message || '',
    icon: '/icon.svg',
    badge: '/icon.svg',
    tag: payload.tag || `webcc-${payload.sessionId || 'general'}`,
    renotify: true,
    vibrate: [200, 100, 200],
    data: {
      sessionId: payload.sessionId,
      type: payload.type,
      url: payload.url || '/manage',
    },
    actions: [],
  };

  // Add actions based on notification type
  if (payload.type === 'waiting') {
    options.actions = [
      { action: 'open', title: 'Open Session' },
    ];
  } else if (payload.type === 'completed') {
    options.actions = [
      { action: 'open', title: 'View' },
      { action: 'dismiss', title: 'OK' },
    ];
  }

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// Notification clicked
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'dismiss') return;

  const data = event.notification.data || {};
  const targetUrl = data.url || '/manage';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Try to focus an existing window on the manage page
      for (const client of clientList) {
        if (client.url.includes('/manage') && 'focus' in client) {
          client.focus();
          // Post message to focus the session
          if (data.sessionId) {
            client.postMessage({
              type: 'focus-session',
              sessionId: data.sessionId,
            });
          }
          return;
        }
      }
      // No existing window — open new one
      return clients.openWindow(targetUrl);
    })
  );
});

// Service worker install — cache essential assets
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

// Service worker activate — clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n)))
    ).then(() => self.clients.claim())
  );
});
