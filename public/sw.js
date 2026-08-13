/* 서비스 워커 — 웹 푸시 표시 + 오프라인 앱 셸.
   앱 데이터는 IndexedDB(로컬 퍼스트)에 있으니, 여기서는 앱을 "여는 데" 필요한
   HTML/JS/CSS만 책임진다: 오프라인에서도 앱을 완전히 다시 열 수 있게. */

const SHELL_CACHE = 'lc-shell-v1';
// 해시가 없는(변할 수 있는) 정적 파일 — 네트워크 우선으로 항상 새 버전을 따른다
const STATIC = ['/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];

/** 셸 HTML을 캐시하고, HTML이 참조하는 해시 자산(/assets/*)을 미리 받아 두며,
    더는 참조되지 않는 옛 자산을 정리한다. HTML만 캐시하고 자산을 빠뜨리면
    오프라인 기동이 흰 화면이 되고, 정리를 안 하면 배포마다 캐시가 무한히 쌓인다. */
async function cacheShell(htmlRes) {
  const cache = await caches.open(SHELL_CACHE);
  await cache.put('/', htmlRes.clone());
  try {
    const html = await htmlRes.clone().text();
    const refs = [...new Set(html.match(/\/assets\/[\w.-]+/g) || [])];
    await Promise.all(
      refs.map(async (path) => {
        if (await cache.match(path)) return;
        const res = await fetch(path);
        if (res.ok) await cache.put(path, res);
      }),
    );
    for (const req of await cache.keys()) {
      const p = new URL(req.url).pathname;
      if (p.startsWith('/assets/') && !refs.includes(p)) await cache.delete(req);
    }
  } catch {
    // 자산 프리페치는 best-effort — 실패해도 다음 온라인 방문이 채운다
  }
}

self.addEventListener('install', (e) => {
  e.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      await cache.addAll(STATIC).catch(() => {});
      try {
        const res = await fetch('/');
        if (res.ok) await cacheShell(res);
      } catch {
        // 오프라인 설치 — 이후 온라인 내비게이션이 셸을 채운다
      }
      await self.skipWaiting();
    })(),
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

  // 내비게이션(HTML): 네트워크 우선(배포 즉시 반영) — 성공하면 셸 갱신, 실패하면 캐시로 기동
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) e.waitUntil(cacheShell(res.clone()));
          return res;
        })
        .catch(() => caches.match('/').then((hit) => hit || Response.error())),
    );
    return;
  }

  // 빌드 자산(/assets/*)은 해시 파일명이라 불변 — 캐시 우선, 없으면 받아서 채운다
  if (url.pathname.startsWith('/assets/')) {
    e.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              e.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.put(req, copy)));
            }
            return res;
          }),
      ),
    );
    return;
  }

  // 해시 없는 정적 파일(manifest, 아이콘): 네트워크 우선 + 캐시 폴백 — 갱신을 놓치지 않는다
  if (STATIC.includes(url.pathname)) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            e.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.put(req, copy)));
          }
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || Response.error())),
    );
  }
  // 그 외(개발 서버 모듈 등)는 손대지 않는다
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
