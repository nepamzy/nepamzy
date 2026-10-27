// Minimal offline fallback. Caches only /offline; all other requests go to the network.
// Account, order and admin pages are never cached by this worker.
const CACHE = 'afit-offline-v1'
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.add('/offline'))
      .then(() => self.skipWaiting()),
  )
})
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})
self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return
  event.respondWith(fetch(event.request).catch(() => caches.match('/offline')))
})

// Pop-up notifications (Web Push). The payload is {title, body, url}; the url is always an in-app path.
self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = {}
  }
  const title = String(data.title || 'AFIT Market').slice(0, 100)
  const url =
    typeof data.url === 'string' && /^\/[A-Za-z0-9_/-]{0,120}$/.test(data.url)
      ? data.url
      : '/notifications'
  event.waitUntil(
    self.registration.showNotification(title, {
      body: String(data.body || '').slice(0, 200),
      icon: '/icons/icon.svg',
      badge: '/icons/icon.svg',
      tag: url,
      data: { url },
    }),
  )
})
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/notifications'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ('focus' in c) {
          c.navigate(url).catch(() => undefined)
          return c.focus()
        }
      }
      return self.clients.openWindow(url)
    }),
  )
})
