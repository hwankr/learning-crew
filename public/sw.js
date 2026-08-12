/* 서비스 워커 — 웹 푸시 표시 + 오프라인 앱 셸.
   앱 데이터는 IndexedDB(로컬 퍼스트)에 있으니, 여기서는 앱을 "여는 데" 필요한
   HTML/JS/CSS만 책임진다: 오프라인에서도 앱을 완전히 다시 열 수 있게. */

const SHELL_CACHE = 'lc-shell-v1';
const PRECACHE = ['/', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    Promise.all([
      caches.keys().then((keys) =>
        Promise.all(keys.filter((k) => k !== SHELL_CACHE).map((k) => caches.delete(k))),
      ),
      self.clients.claim(),
    ]),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // 동기화는 SyncClient의 몫 — 절대 캐시하지 않는다

  // 내비게이션(HTML): 네트워크 우선(배포 즉시 반영) — 실패하면 캐시된 셸로 오프라인 기동
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put('/', copy));
          }
          return res;
        })
        .catch(() => caches.match('/').then((hit) => hit || Response.error())),
    );
    return;
  }

  // 빌드 자산(/assets/*)은 해시 파일명이라 불변 — 캐시 우선, 없으면 받아서 채운다.
  // manifest·아이콘도 같은 전략. 그 외(개발 서버 모듈 등)는 손대지 않는다.
  if (!url.pathname.startsWith('/assets/') && !PRECACHE.includes(url.pathname)) return;
  e.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        }),
    ),
  );
});

// Worker의 sendPushToAll이 보내는 PushBody({title, body, url})를 그대로 표시한다.
self.addEventListener('push', (e) => {
  let d = {};
  try {
    d = e.data ? e.data.json() : {};
  } catch {
    // 형식이 깨진 페이로드는 기본 문구로
  }
  e.waitUntil(
    self.registration.showNotification(d.title || '러닝 크루 👟', {
      body: d.body || '',
      icon: '/icons/icon-192.png',
      tag: 'crew-live', // 같은 태그는 갱신 — 알림이 쌓이지 않는다
      data: { url: d.url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ('focus' in c) return c.focus();
      }
      return self.clients.openWindow(e.notification.data?.url || '/');
    }),
  );
});
