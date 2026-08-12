/* 웹 푸시 발송 — VAPID 서명 + RFC 8291 암호화는 @block65/webcrypto-web-push가 처리한다.
   발송은 응답을 막지 않게 waitUntil로 백그라운드에서 돈다. */
import { buildPushPayload, type PushMessage, type VapidKeys } from '@block65/webcrypto-web-push';
import { STATUS_TTL_MS } from '../shared/types';

/** 같은 사람이 껐켰다 반복해도 이 시간 안에는 다시 알리지 않는다. */
export const NOTIFY_COOLDOWN_MS = 30 * 60 * 1000;

/** off→on 전환이면서 쿨다운이 지났을 때만 알린다. */
export function shouldNotify(
  prev: { on: boolean; since: string | null; lastNotifiedAt: string | null } | null,
  turnOn: boolean,
  now: number,
): boolean {
  if (!turnOn) return false;
  // 켜진 채 장소만 바꾼 경우는 조용히 — 단, TTL이 지난 행은 "끄는 걸 잊은" 상태라
  // 클라이언트 표시 규칙(isStatusActive)과 똑같이 꺼진 것으로 보고 다시 알린다.
  const prevActive =
    !!prev?.on && prev.since !== null && now - Date.parse(prev.since) < STATUS_TTL_MS;
  if (prevActive) return false;
  if (prev?.lastNotifiedAt && now - Date.parse(prev.lastNotifiedAt) < NOTIFY_COOLDOWN_MS) {
    return false;
  }
  return true;
}

export interface PushEnvVars {
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  VAPID_SUBJECT?: string;
}

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** SW가 받는 페이로드 — sw.js의 push 핸들러와 필드를 맞춘다. */
export interface PushBody {
  title: string;
  body: string;
  url: string;
  [key: string]: string; // Jsonifiable 호환
}

/** 대상 전원에게 발송. 404/410(구독 만료)은 onGone으로 정리를 위임하고, 개별 실패는 무시한다. */
export async function sendPushToAll(
  env: PushEnvVars,
  targets: PushTarget[],
  data: PushBody,
  onGone: (endpoint: string) => Promise<void>,
): Promise<void> {
  if (targets.length === 0 || !env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return;
  const vapid: VapidKeys = {
    subject: env.VAPID_SUBJECT ?? 'mailto:fabronjeon@gmail.com',
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
  };
  const message: PushMessage = { data, options: { ttl: 3600, urgency: 'high' } };
  await Promise.all(
    targets.map(async (t) => {
      try {
        const payload = await buildPushPayload(
          message,
          { endpoint: t.endpoint, expirationTime: null, keys: { p256dh: t.p256dh, auth: t.auth } },
          vapid,
        );
        const res = await fetch(t.endpoint, payload);
        if (res.status === 404 || res.status === 410) await onGone(t.endpoint);
      } catch {
        // 일시적 네트워크 오류 — 알림은 best-effort라 재시도하지 않는다
      }
    }),
  );
}
