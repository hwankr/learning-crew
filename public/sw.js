/* 서비스 워커 — 웹 푸시 표시 + 오프라인 앱 셸.
   앱 데이터는 IndexedDB(로컬 퍼스트)에 있으니, 여기서는 앱을 "여는 데" 필요한
   HTML/JS/CSS만 책임진다: 오프라인에서도 앱을 완전히 다시 열 수 있게. */

const SHELL_CACHE = 'lc-shell-v1';
// 해시가 없는(변할 수 있는) 정적 파일 — 네트워크 우선으로 항상 새 버전을 따른다
const STATIC = ['/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];

function isHtml(res) {
  return (res.headers.get('content-type') || '').includes('text/html');
}

/** 셸 갱신: HTML이 참조하는 해시 자산(/assets/*)을 전부 확보한 뒤에야 '/'를 교체하고,
    그다음에 미참조 옛 자산을 정리한다. 순서가 생명이다 —
    · 자산 확보 전에 HTML부터 바꾸면 그 사이 오프라인 전환 시 참조 깨진 셸(흰 화면)이 되고,
    · 확보 실패에도 정리를 하면 일관됐던 옛 셸까지 부순다 (실패 시 옛 셸 그대로 유지). */
async function cacheShell(htmlRes) {
  const cache = await caches.open(SHELL_CACHE);
  let html;
  try {
    html = await htmlRes.text();
  } catch {
    return;
  }
  // 배포가 없었다면(내용 동일) 매 내비게이션마다 재캐시·스캔을 반복하지 않는다
  const cached = await cache.match('/');
  if (cached && (await cached.clone().text()) === html) return;

  const refs = [...new Set(html.match(/\/assets\/[\w.-]+/g) || [])];
  for (const path of refs) {
    if (await cache.match(path)) continue;
    let res;
    try {
      res = await fetch(path);
    } catch {
      return; // 확보 실패 — 옛 셸을 그대로 둔다
    }
    if (!res.ok) return;
    await cache.put(path, res);
  }
  await cache.put(
    '/',
    new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } }),
  );
  for (const req of await cache.keys()) {
    const p = new URL(req.url).pathname;
    if (p.startsWith('/assets/') && !refs.includes(p)) await cache.delete(req);
  }
}

self.addEventListener('install', (e) => {
  e.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      await cache.addAll(STATIC).catch(() => {});
      try {
        const res = await fetch('/');
        if (res.ok && isHtml(res)) await cacheShell(res);
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

  // 내비게이션: 네트워크 우선(배포 즉시 반영) — HTML일 때만 셸을 갱신한다.
  // (아이콘·manifest 직접 접속도 mode=navigate다 — 그걸 '/'로 캐시하면 셸이 깨진다)
  if (req.mode === 'navigate') {
    const network = fetch(req);
    e.waitUntil(
      network
        .then((res) => (res.ok && isHtml(res) ? cacheShell(res.clone()) : undefined))
        .catch(() => {}),
    );
    e.respondWith(
      network.catch(() => caches.match('/').then((hit) => hit || Response.error())),
    );
    return;
  }

  // 빌드 자산(/assets/*)은 해시 파일명이라 불변 — 캐시 우선, 없으면 받아서 채운다
  if (url.pathname.startsWith('/assets/')) {
    e.respondWith(
      (async () => {
        const hit = await caches.match(req);
        if (hit) return hit;
        try {
          const res = await fetch(req);
          if (res.ok) {
            const cache = await caches.open(SHELL_CACHE);
            await cache.put(req, res.clone());
          }
          return res;
        } catch {
          return Response.error(); // 캐시도 네트워크도 없음 — 명시적 실패
        }
      })(),
    );
    return;
  }

  // 해시 없는 정적 파일(manifest, 아이콘): 네트워크 우선 + 캐시 폴백 — 갱신을 놓치지 않는다
  if (STATIC.includes(url.pathname)) {
    e.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          if (res.ok) {
            const cache = await caches.open(SHELL_CACHE);
            await cache.put(req, res.clone());
          }
          return res;
        } catch {
          return (await caches.match(req)) || Response.error();
        }
      })(),
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
