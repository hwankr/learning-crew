/* 웹 푸시 구독 관리 — 서비스 워커 등록, 구독 생성/해지, 현재 상태 판별. */
import type { PushSubscribeRequest, PushUnsubscribeRequest, VapidKeyResponse } from '../../shared/types';

export type PushState =
  | 'unsupported' // 이 브라우저는 웹 푸시 불가
  | 'ios-install' // iOS Safari 탭 — 홈 화면에 추가하면 가능
  | 'denied' // 브라우저 설정에서 알림 차단됨
  | 'off'
  | 'on';

function supported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

function isIOS(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
}

/** 앱 부팅 시 호출 — SW를 최신으로 유지한다(푸시 수신 자체는 구독만 있으면 된다). */
export function registerSW(): void {
  if ('serviceWorker' in navigator) {
    void navigator.serviceWorker.register('/sw.js').catch(() => {
      // 등록 실패(비보안 컨텍스트 등)는 치명적이지 않다 — 알림만 못 켤 뿐
    });
  }
}

export async function getPushState(): Promise<PushState> {
  if (!supported()) return isIOS() ? 'ios-install' : 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    return sub ? 'on' : 'off';
  } catch {
    return 'off';
  }
}

function b64urlToBytes(s: string): Uint8Array {
  const b = atob(s.replaceAll('-', '+').replaceAll('_', '/'));
  return Uint8Array.from(b, (ch) => ch.charCodeAt(0));
}

/** 인증 API 호출 공용 헤더 — SyncClient도 같은 것을 쓴다. */
export function authHeaders(token: string): Record<string, string> {
  return { 'content-type': 'application/json', authorization: `Bearer ${token}` };
}

/** 권한 요청 → SW 준비 → 구독 생성 → 서버 등록. 결과 상태를 돌려준다. */
export async function enablePush(token: string): Promise<PushState> {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return perm === 'denied' ? 'denied' : 'off';

  const reg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;

  const keyRes = await fetch('/api/push/vapid', { headers: authHeaders(token) });
  if (!keyRes.ok) throw new Error(`vapid ${keyRes.status}`);
  const { key } = (await keyRes.json()) as VapidKeyResponse;
  if (!key) throw new Error('vapid key missing');

  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: b64urlToBytes(key).buffer as ArrayBuffer,
  });
  const json = sub.toJSON();
  if (!json.keys?.p256dh || !json.keys.auth) throw new Error('subscription keys missing');

  const res = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({
      endpoint: sub.endpoint,
      keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
    } satisfies PushSubscribeRequest),
  });
  if (!res.ok) {
    await sub.unsubscribe(); // 서버가 모르는 구독을 남기지 않는다
    throw new Error(`subscribe ${res.status}`);
  }
  return 'on';
}

export async function disablePush(token: string): Promise<PushState> {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    // 서버 삭제가 실패해도 로컬 해지는 진행 — 죽은 endpoint는 발송 시 404/410으로 정리된다
    await fetch('/api/push/unsubscribe', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ endpoint: sub.endpoint } satisfies PushUnsubscribeRequest),
    }).catch(() => undefined);
    await sub.unsubscribe();
  }
  return 'off';
}
