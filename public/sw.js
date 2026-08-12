/* 서비스 워커 — 웹 푸시 표시 전용. 캐싱은 하지 않는다(앱 데이터는 이미 로컬 퍼스트). */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

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
