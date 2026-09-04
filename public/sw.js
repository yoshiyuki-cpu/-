// 良心アプリの service worker。
// 1) プッシュ通知の受け取り（従来どおり）
// 2) 一度開いた画面を圏外でも開けるようにする
//
// 画面（HTML）は「まず回線、だめなら控え」。つながっている時は常に最新で、
// 圏外の時だけ最後に開いた控えを出す。
// 部品（/_next/static/ の JS・CSS）は名前にハッシュが付いていて中身が変わらないので
// 「控えがあればそれ」。Supabase や API への通信は控えない（古い記録を出さないため）。
const CACHE = 'ryoshin-v1'

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', event => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return          // Supabase 等は触らない
  if (url.pathname.startsWith('/api/')) return             // API も触らない

  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(res => {
        const copy = res.clone()
        caches.open(CACHE).then(c => c.put(req, copy))
        return res
      }))
    )
    return
  }

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then(res => {
        const copy = res.clone()
        caches.open(CACHE).then(c => c.put(req, copy))
        return res
      }).catch(() => caches.match(req).then(hit => hit || caches.match('/')))
    )
  }
})

self.addEventListener('push', event => {
  const data = event.data ? event.data.json() : {}
  const title = data.title || '良心アプリ'
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      icon: '/favicon.ico',
      data: { url: data.url || '/' },
    })
  )
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  const url = event.notification.data?.url || '/'
  event.waitUntil(self.clients.openWindow(url))
})
