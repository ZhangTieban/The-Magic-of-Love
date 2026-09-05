// Only present so notifications can be shown from a worker scope, which keeps
// them alive while the tab is hidden. No caching: the page must always be the
// version on disk while it is being tuned.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = clients.find((client) => 'focus' in client);
    if (existing) return existing.focus();
    return self.clients.openWindow('./');
  })());
});
