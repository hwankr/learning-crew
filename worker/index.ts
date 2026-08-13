import { Hono, type MiddlewareHandler } from 'hono';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { makeToken, verifyToken } from './auth';
import {
  pushEntries,
  pushEntriesLegacy,
  pullSince,
  pushComments,
  pullComments,
  pushReactions,
  pullReactions,
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
  UUID_RE,
  canonicalUuid,
  isFreshSince,
  normalizeEmojis,
  type Comment,
  type Entry,
  type MemberId,
  type PullCursor,
  type PullResponse,
  type PushRequest,
  type PushResponse,
  type ReactionCursor,
  type ReactionSet,
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

/** 형식만이 아니라 실존하는 달력 날짜인지 — '2026-02-31'은 Postgres date 삽입에서
    500을 내며 배치 전체를 죽이므로 여기서 행 단위 400으로 걸러야 한다. */
function isRealDay(day: string): boolean {
  if (!DAY_RE.test(day)) return false;
  const [y, m, d] = day.split('-').map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m! - 1 && dt.getUTCDate() === d;
}

/** 본인 행 + 형식이 유효할 때만 통과. 실패 사유 문자열, 성공이면 null. */
function invalidReason(e: Entry, me: MemberId): string | null {
  if (!e || typeof e !== 'object') return 'not an object';
  if (typeof e.id !== 'string' || !UUID_RE.test(e.id)) return 'bad id';
  if (e.m !== me) return 'not your entry';
  if (typeof e.day !== 'string' || !isRealDay(e.day)) return 'bad day';
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
  // v가 아예 없으면 구버전 클라이언트(레거시 LWW 프로토콜) — 거부하지 않고 레거시 경로로 처리
  if (e.v !== undefined && (!Number.isInteger(e.v) || e.v < 0 || e.v > 2_000_000_000)) return 'bad v';
  if (e.deletedAt !== null && typeof e.deletedAt !== 'string') return 'bad deletedAt';
  return null;
}

/** 댓글 행 검증 — 본문은 trim 후 길이를 본다(공백만 남는 댓글은 실수다). */
function invalidCommentReason(x: Comment, me: MemberId): string | null {
  if (!x || typeof x !== 'object') return 'not an object';
  if (typeof x.id !== 'string' || !UUID_RE.test(x.id)) return 'bad comment id';
  if (typeof x.entryId !== 'string' || !UUID_RE.test(x.entryId)) return 'bad comment entryId';
  if (x.m !== me) return 'not your comment';
  if (typeof x.body !== 'string') return 'bad comment body';
  const len = x.body.trim().length;
  if (len === 0 || len > PUSH_LIMITS.commentBody) return 'bad comment body';
  if (x.deletedAt !== null && typeof x.deletedAt !== 'string') return 'bad comment deletedAt';
  return null;
}

function invalidReactionReason(x: ReactionSet, me: MemberId): string | null {
  if (!x || typeof x !== 'object') return 'not an object';
  if (typeof x.entryId !== 'string' || !UUID_RE.test(x.entryId)) return 'bad reaction entryId';
  if (x.m !== me) return 'not your reaction';
  if (!Array.isArray(x.emojis)) return 'bad emojis';
  return null;
}

/** 작성 시각 정규화 — 거부하지 않고 범위 밖이면 지금으로 끌어온다.
    오프라인에서 쓴 댓글의 진짜 작성 시각은 살리되(표시·정렬이 이 값을 쓴다),
    시계가 어긋난 기기가 목록 맨 위/맨 아래에 영원히 박히는 것은 막는다. */
function normalizeCreatedAt(raw: unknown, now: number): string {
  if (typeof raw === 'string') {
    const t = Date.parse(raw);
    if (Number.isFinite(t) && t <= now + 5 * 60_000 && t >= now - 30 * 86_400_000) {
      return new Date(t).toISOString();
    }
  }
  return new Date(now).toISOString();
}

app.post('/api/sync/push', async (c) => {
  const me = c.get('memberId');
  let req: PushRequest;
  try {
    req = await c.req.json<PushRequest>();
  } catch {
    return c.json({ error: 'invalid json' }, 400);
  }
  // 세 스트림이 한 요청에 함께 온다. 구버전 클라이언트는 entries만 보내므로 나머지는 없으면 빈 배열.
  const reqComments = req.comments ?? [];
  const reqReactions = req.reactions ?? [];
  if (
    !Array.isArray(req.entries) ||
    req.entries.length > PUSH_LIMITS.batch ||
    !Array.isArray(reqComments) ||
    reqComments.length > PUSH_LIMITS.batch ||
    !Array.isArray(reqReactions) ||
    reqReactions.length > PUSH_LIMITS.batch
  ) {
    return c.json({ error: 'bad batch' }, 400);
  }
  const seen = new Set<string>();
  for (const e of req.entries) {
    const reason = invalidReason(e, me);
    if (reason) return c.json({ error: reason, id: (e as { id?: string })?.id }, 400);
    if (seen.has(e.id)) return c.json({ error: 'duplicate id', id: e.id }, 400);
    seen.add(e.id);
  }
  const now = Date.now();
  const seenComments = new Set<string>();
  const cRows: Comment[] = [];
  for (const x of reqComments) {
    const reason = invalidCommentReason(x, me);
    if (reason) return c.json({ error: reason, id: (x as { id?: string })?.id }, 400);
    // 중복 검사보다 먼저 소문자로 내린다 — pg가 uuid를 소문자로 돌려주므로 검사 키·저장 키·
    // 응답 키가 전부 같은 형태여야 한다. 원문으로 비교하면 대소문자만 다른 두 id가 여기를
    // 통과한 뒤 DB에서 같은 행이 되어 배치 전체를 죽인다.
    const id = canonicalUuid(x.id);
    if (seenComments.has(id)) return c.json({ error: 'duplicate id', id }, 400);
    seenComments.add(id);
    cRows.push({
      ...x,
      id,
      entryId: canonicalUuid(x.entryId),
      body: x.body.trim(),
      createdAt: normalizeCreatedAt(x.createdAt, now),
      // 파싱 안 되는 삭제 시각이 timestamptz 삽입에서 배치 전체를 죽이지 않게 — 값보다 "지워졌다"가 본질
      deletedAt: x.deletedAt === null ? null : normalizeAt(x.deletedAt, now),
    });
  }
  const seenReactions = new Set<string>();
  const rRows: ReactionSet[] = [];
  for (const x of reqReactions) {
    const reason = invalidReactionReason(x, me);
    if (reason) return c.json({ error: reason, id: (x as { entryId?: string })?.entryId }, 400);
    // 댓글과 같은 이유 — 리액션의 상관 키는 (entryId, m)이라 entryId의 대소문자가 어긋나면
    // 반영된 행이 applied:false로 돌아가고 클라이언트 큐가 정산되지 않는다
    const entryId = canonicalUuid(x.entryId);
    const key = `${entryId}|${x.m}`;
    if (seenReactions.has(key)) return c.json({ error: 'duplicate id', id: entryId }, 400);
    seenReactions.add(key);
    rRows.push({
      ...x,
      entryId,
      emojis: normalizeEmojis(x.emojis),
      actedAt: normalizeAt(x.actedAt, now),
    });
  }
  // v가 있는 행은 CAS, 없는 행은 구버전 프로토콜(LWW) — 배포 이행기의 옛 번들도 계속 동기화된다
  const withV: Entry[] = [];
  const legacy: Omit<Entry, 'v'>[] = [];
  for (const e of req.entries) {
    if (e.v === undefined) legacy.push(e);
    else withV.push(e);
  }
  const db = drizzle(neon(c.env.DATABASE_URL));
  const [outcome, legacyApplied, cOut, rOut] = await Promise.all([
    pushEntries(db, withV, me),
    pushEntriesLegacy(db, legacy, me),
    pushComments(db, cRows, me),
    pushReactions(db, rRows),
  ]);
  const res: PushResponse = {
    ok: true,
    serverTime: new Date().toISOString(),
    results: [
      ...outcome.applied.map((row) => ({ id: row.id, applied: true, row })),
      ...outcome.conflicts.map((row) => ({ id: row.id, applied: false, row })),
      ...legacyApplied.map((row) => ({ id: row.id, applied: true, row })),
    ],
    // 보낸 게 없어도 항상 실어 보낸다 — 클라이언트는 "보냈는데 결과 필드가 없음"을
    // 구버전 Worker의 무시로 읽고 큐를 지킨다(조용한 유실 방지)
    commentResults: [
      ...cOut.applied.map((row) => ({ id: row.id, applied: true, row })),
      ...cOut.current.map((row) => ({ id: row.id, applied: false, row })),
    ],
    reactionResults: [
      ...rOut.applied.map((row) => ({ entryId: row.entryId, m: row.m, applied: true, row })),
      ...rOut.current.map((row) => ({ entryId: row.entryId, m: row.m, applied: false, row })),
    ],
  };
  return c.json(res);
});

app.get('/api/sync/pull', async (c) => {
  // 세 커서는 서로 독립이다 — 하나만 와도, 아예 없어도(그 스트림만 처음부터) 동작한다.
  // 깨진 값은 SQL 캐스팅에서 500이 되므로 형식이 맞을 때만 커서로 삼는다.
  const since = c.req.query('since');
  const sinceId = c.req.query('sinceId');
  const cursor: PullCursor | null = since && sinceId ? { ts: since, id: sinceId } : null;
  const csince = c.req.query('csince');
  const csinceId = c.req.query('csinceId');
  const cCursor: PullCursor | null =
    csince && csinceId && UUID_RE.test(csinceId) ? { ts: csince, id: csinceId } : null;
  const rsince = c.req.query('rsince');
  const rsinceEntry = c.req.query('rsinceEntry');
  const rsinceM = c.req.query('rsinceM');
  const rCursor: ReactionCursor | null =
    rsince && rsinceEntry && rsinceM !== undefined && UUID_RE.test(rsinceEntry)
      // 지평선 커서의 멤버 자리는 빈 문자열이라 rsinceM은 값이 ''이어도 커서로 인정한다
      ? { ts: rsince, entryId: rsinceEntry, m: rsinceM as MemberId | '' }
      : null;
  const db = drizzle(neon(c.env.DATABASE_URL));
  const [result, statuses, cRes, rRes] = await Promise.all([
    pullSince(db, cursor),
    allStatuses(db),
    pullComments(db, cCursor),
    pullReactions(db, rCursor),
  ]);
  return c.json({
    ...result,
    statuses,
    comments: cRes.rows,
    commentCursor: cRes.cursor,
    reactions: rRes.rows,
    reactionCursor: rRes.cursor,
  } satisfies PullResponse);
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

/** 액션 시각(LWW 기준) 정규화 — 미래는 지금으로 캡하고 과거는 그대로 둔다.
    · 과거를 끌어올리면 아주 오래된 오프라인 토글이 더 새 액션을 이겨 버린다 —
      오래된 액션은 LWW에서 자연히 지는 것이 정답이다.
    · 미래를 허용하면 시계가 빠른 기기가 그 시간만큼 다른 기기의 토글에 거부권을 갖는다 —
      지금으로 캡하면 미래-스큐 기기는 도착 순서로 동작해 아무도 잠기지 않는다. */
function normalizeAt(raw: unknown, now: number): string {
  if (typeof raw === 'string') {
    const t = Date.parse(raw);
    if (Number.isFinite(t)) return new Date(Math.min(t, now)).toISOString();
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
  // at이 없는 구버전 클라이언트의 ON은 도착 시각이 아니라 본인이 주장하는 시작 시각(since)을
  // 액션 시각으로 삼는다 — 도착 시각을 쓰면 뒤늦게 재접속한 옛 ON이 최신 OFF를 이겨 버린다
  const at = normalizeAt(body.at ?? (body.on ? body.since : undefined), now);
  let s = body.on
    ? { on: true, place: body.place!, since: normalizeSince(body.since, now), at }
    : { on: false, place: null, since: null, at };
  // TTL(14시간)보다 오래된 ON 액션은 이미 끝난 세션 — 뒤늦게 도착해도 "지금 공부 중"으로
  // 되살리거나 시작 알림을 쏘지 않고, 꺼짐으로 기록한다 (LWW 순서는 at이 그대로 지킨다)
  if (s.on && !isFreshSince(at, now)) {
    s = { on: false, place: null, since: null, at };
  }
  const db = drizzle(neon(c.env.DATABASE_URL));
  const prev = await getStatusRow(db, me);
  const { status: saved, applied } = await setStatus(db, me, s);

  // off→on 전환이면 크루에게 푸시 — 응답을 막지 않게 백그라운드로.
  // 발송 슬롯은 조건부 UPDATE로 선점한다: 두 기기가 동시에 켜도 한쪽만 보낸다.
  if (applied && shouldNotify(prev, s.on, now)) {
    c.executionCtx.waitUntil(
      (async () => {
        // 발송 가능성 확인이 먼저 — 키가 없거나 구독자가 없는데 슬롯을 선점하면 쿨다운만 태운다
        if (!c.env.VAPID_PUBLIC_KEY || !c.env.VAPID_PRIVATE_KEY) return;
        const targets = await pushSubsExcept(db, me);
        if (targets.length === 0) return;
        if (!(await claimNotifySlot(db, me, NOTIFY_COOLDOWN_MS))) return;
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
