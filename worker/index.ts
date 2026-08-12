import { Hono, type MiddlewareHandler } from 'hono';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { makeToken, verifyToken } from './auth';
import {
  pushEntries,
  pullSince,
  setStatus,
  allStatuses,
  getStatusRow,
  claimNotifySlot,
  upsertPushSub,
  deletePushSub,
  deleteGonePushSub,
  pushSubsExcept,
} from './queries';
import { NOTIFY_COOLDOWN_MS, sendPushToAll, shouldNotify } from './push';
import {
  MEMBER_IDS,
  MEMBER_NAMES,
  TAGS,
  PLACES,
  PUSH_LIMITS,
  type Entry,
  type MemberId,
  type PullCursor,
  type PullResponse,
  type PushRequest,
  type PushResponse,
  type PushSubscribeRequest,
  type PushUnsubscribeRequest,
  type StatusSetRequest,
  type StatusSetResponse,
  type VapidKeyResponse,
} from '../shared/types';

type Env = {
  Bindings: {
    DATABASE_URL: string;
    AUTH_SECRET: string;
    VAPID_PUBLIC_KEY: string;
    VAPID_PRIVATE_KEY: string;
    VAPID_SUBJECT?: string;
    ASSETS: Fetcher;
  };
  Variables: {
    memberId: MemberId;
  };
};

const app = new Hono<Env>();

app.get('/api/health', (c) => c.json({ ok: true }));

/* 이름 선택 로그인 — 멤버 id를 받아 서명 토큰을 발급한다.
   신원 검증은 없다: 4인 크루 앱이라 "URL을 아는 사람 = 크루"를 전제로 한다.
   문제가 생기면 AUTH_SECRET 교체로 전원 로그아웃시킬 수 있다. */
app.post('/api/auth/claim', async (c) => {
  let body: { m?: string };
  try {
    body = await c.req.json<{ m?: string }>();
  } catch {
    return c.json({ error: 'invalid json' }, 400);
  }
  if (typeof body.m !== 'string' || !(MEMBER_IDS as readonly string[]).includes(body.m)) {
    return c.json({ error: 'bad member' }, 400);
  }
  return c.json({ token: await makeToken(body.m, c.env.AUTH_SECRET) });
});

const requireMember: MiddlewareHandler<Env> = async (c, next) => {
  const token = (c.req.header('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const memberId = token && c.env.AUTH_SECRET ? await verifyToken(token, c.env.AUTH_SECRET) : null;
  if (!memberId || !(MEMBER_IDS as readonly string[]).includes(memberId)) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  c.set('memberId', memberId as MemberId);
  await next();
};
app.use('/api/sync/*', requireMember);
app.use('/api/push/*', requireMember);

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 본인 행 + 형식이 유효할 때만 통과. 실패 사유 문자열, 성공이면 null. */
function invalidReason(e: Entry, me: MemberId): string | null {
  if (!e || typeof e !== 'object') return 'not an object';
  if (typeof e.id !== 'string' || !UUID_RE.test(e.id)) return 'bad id';
  if (e.m !== me) return 'not your entry';
  if (typeof e.day !== 'string' || !DAY_RE.test(e.day)) return 'bad day';
  if (typeof e.time !== 'string' || !TIME_RE.test(e.time)) return 'bad time';
  if (!(TAGS as readonly string[]).includes(e.tag)) return 'bad tag';
  if (e.stars !== null && (!Number.isInteger(e.stars) || e.stars < 1 || e.stars > 5)) return 'bad stars';
  if (typeof e.memo !== 'string' || e.memo.length > PUSH_LIMITS.memo) return 'bad memo';
  if (typeof e.body !== 'string' || e.body.length > PUSH_LIMITS.body) return 'bad body';
  if (!Array.isArray(e.todos) || e.todos.length > PUSH_LIMITS.todos) return 'bad todos';
  for (const t of e.todos) {
    if (!t || typeof t.t !== 'string' || t.t.length > PUSH_LIMITS.todoText || typeof t.done !== 'boolean') {
      return 'bad todo item';
    }
  }
  if (!Number.isInteger(e.v) || e.v < 0 || e.v > 2_000_000_000) return 'bad v';
  if (e.deletedAt !== null && typeof e.deletedAt !== 'string') return 'bad deletedAt';
  return null;
}

app.post('/api/sync/push', async (c) => {
  const me = c.get('memberId');
  let req: PushRequest;
  try {
    req = await c.req.json<PushRequest>();
  } catch {
    return c.json({ error: 'invalid json' }, 400);
  }
  if (!Array.isArray(req.entries) || req.entries.length > PUSH_LIMITS.batch) {
    return c.json({ error: 'bad batch' }, 400);
  }
  const seen = new Set<string>();
  for (const e of req.entries) {
    const reason = invalidReason(e, me);
    if (reason) return c.json({ error: reason, id: (e as { id?: string })?.id }, 400);
    if (seen.has(e.id)) return c.json({ error: 'duplicate id', id: e.id }, 400);
    seen.add(e.id);
  }
  const outcome = await pushEntries(drizzle(neon(c.env.DATABASE_URL)), req.entries, me);
  const res: PushResponse = {
    ok: true,
    serverTime: new Date().toISOString(),
    results: [
      ...outcome.applied.map((row) => ({ id: row.id, applied: true, row })),
      ...outcome.conflicts.map((row) => ({ id: row.id, applied: false, row })),
    ],
  };
  return c.json(res);
});

app.get('/api/sync/pull', async (c) => {
  const since = c.req.query('since');
  const sinceId = c.req.query('sinceId');
  const cursor: PullCursor | null = since && sinceId ? { ts: since, id: sinceId } : null;
  const db = drizzle(neon(c.env.DATABASE_URL));
  const [result, statuses] = await Promise.all([pullSince(db, cursor), allStatuses(db)]);
  return c.json({ ...result, statuses } satisfies PullResponse);
});

/** 오프라인에서 켠 상태가 뒤늦게 도착해도 쓸 수 있게 클라이언트 since를 받되, 범위 밖이면 지금으로. */
function normalizeSince(raw: unknown, now: number): string {
  if (typeof raw === 'string') {
    const t = Date.parse(raw);
    if (Number.isFinite(t) && t <= now + 5 * 60_000 && t >= now - 24 * 3_600_000) {
      return new Date(t).toISOString();
    }
  }
  return new Date(now).toISOString();
}

/** 액션 시각(LWW 기준) 정규화 — 미래는 지금으로, 24시간보다 오래된 것은 바닥으로 클램프.
    (범위 밖을 "지금"으로 바꾸면 아주 오래된 오프라인 토글이 오히려 이겨 버린다) */
function normalizeAt(raw: unknown, now: number): string {
  const floor = now - 24 * 3_600_000;
  if (typeof raw === 'string') {
    const t = Date.parse(raw);
    if (Number.isFinite(t)) return new Date(Math.min(Math.max(t, floor), now + 5 * 60_000)).toISOString();
  }
  return new Date(now).toISOString();
}

app.post('/api/sync/status', async (c) => {
  const me = c.get('memberId');
  let body: StatusSetRequest;
  try {
    body = await c.req.json<StatusSetRequest>();
  } catch {
    return c.json({ error: 'invalid json' }, 400);
  }
  if (typeof body.on !== 'boolean') return c.json({ error: 'bad on' }, 400);
  if (body.on && !(PLACES as readonly string[]).includes(body.place ?? '')) {
    return c.json({ error: 'bad place' }, 400);
  }
  const now = Date.now();
  const at = normalizeAt(body.at, now);
  const s = body.on
    ? { on: true, place: body.place!, since: normalizeSince(body.since, now), at }
    : { on: false, place: null, since: null, at };
  const db = drizzle(neon(c.env.DATABASE_URL));
  const prev = await getStatusRow(db, me);
  const { status: saved, applied } = await setStatus(db, me, s);

  // off→on 전환이면 크루에게 푸시 — 응답을 막지 않게 백그라운드로.
  // 발송 슬롯은 조건부 UPDATE로 선점한다: 두 기기가 동시에 켜도 한쪽만 보낸다.
  if (applied && shouldNotify(prev, s.on, now)) {
    c.executionCtx.waitUntil(
      (async () => {
        if (!(await claimNotifySlot(db, me, NOTIFY_COOLDOWN_MS))) return;
        const targets = await pushSubsExcept(db, me);
        if (targets.length === 0) return;
        await sendPushToAll(
          c.env,
          targets,
          {
            title: `🟢 ${MEMBER_NAMES[me]} — ${s.place}에서 공부 시작!`,
            body: '오늘도 같이 달려요 👟',
            url: '/',
          },
          (endpoint) => deleteGonePushSub(db, endpoint),
        );
      })(),
    );
  }
  return c.json({ ok: true, status: saved, applied } satisfies StatusSetResponse);
});

/* ---------- 웹 푸시 구독 관리 ---------- */

app.get('/api/push/vapid', (c) => {
  return c.json({ key: c.env.VAPID_PUBLIC_KEY ?? '' } satisfies VapidKeyResponse);
});

const B64URL_RE = /^[A-Za-z0-9_-]+$/;

app.post('/api/push/subscribe', async (c) => {
  const me = c.get('memberId');
  let body: PushSubscribeRequest;
  try {
    body = await c.req.json<PushSubscribeRequest>();
  } catch {
    return c.json({ error: 'invalid json' }, 400);
  }
  if (
    typeof body.endpoint !== 'string' ||
    !body.endpoint.startsWith('https://') ||
    body.endpoint.length > 1024
  ) {
    return c.json({ error: 'bad endpoint' }, 400);
  }
  const k = body.keys;
  if (
    !k ||
    typeof k.p256dh !== 'string' || !B64URL_RE.test(k.p256dh) || k.p256dh.length > 256 ||
    typeof k.auth !== 'string' || !B64URL_RE.test(k.auth) || k.auth.length > 64
  ) {
    return c.json({ error: 'bad keys' }, 400);
  }
  await upsertPushSub(drizzle(neon(c.env.DATABASE_URL)), me, {
    endpoint: body.endpoint,
    p256dh: k.p256dh,
    auth: k.auth,
  });
  return c.json({ ok: true });
});

app.post('/api/push/unsubscribe', async (c) => {
  const me = c.get('memberId');
  let body: PushUnsubscribeRequest;
  try {
    body = await c.req.json<PushUnsubscribeRequest>();
  } catch {
    return c.json({ error: 'invalid json' }, 400);
  }
  if (typeof body.endpoint !== 'string') return c.json({ error: 'bad endpoint' }, 400);
  await deletePushSub(drizzle(neon(c.env.DATABASE_URL)), me, body.endpoint);
  return c.json({ ok: true });
});

// run_worker_first가 /api/*만 Worker로 보내므로 그 외는 정적 자산이 처리하지만,
// 혹시 Worker까지 온 비-API 요청은 SPA 자산으로 넘긴다.
app.notFound((c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
