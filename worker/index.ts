import { Hono } from 'hono';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { makeToken, verifyToken } from './auth';
import { pushEntries, pullSince } from './queries';
import {
  MEMBER_IDS,
  TAGS,
  PUSH_LIMITS,
  type Entry,
  type MemberId,
  type PullCursor,
  type PullResponse,
  type PushRequest,
  type PushResponse,
} from '../shared/types';

type Env = {
  Bindings: {
    DATABASE_URL: string;
    AUTH_SECRET: string;
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

app.use('/api/sync/*', async (c, next) => {
  const token = (c.req.header('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const memberId = token && c.env.AUTH_SECRET ? await verifyToken(token, c.env.AUTH_SECRET) : null;
  if (!memberId || !(MEMBER_IDS as readonly string[]).includes(memberId)) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  c.set('memberId', memberId as MemberId);
  await next();
});

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
  for (const e of req.entries) {
    const reason = invalidReason(e, me);
    if (reason) return c.json({ error: reason, id: (e as { id?: string })?.id }, 400);
  }
  await pushEntries(drizzle(neon(c.env.DATABASE_URL)), req.entries, me);
  const res: PushResponse = { ok: true, serverTime: new Date().toISOString() };
  return c.json(res);
});

app.get('/api/sync/pull', async (c) => {
  const since = c.req.query('since');
  const sinceId = c.req.query('sinceId');
  const cursor: PullCursor | null = since && sinceId ? { ts: since, id: sinceId } : null;
  const result = await pullSince(drizzle(neon(c.env.DATABASE_URL)), cursor);
  return c.json(result satisfies PullResponse);
});

// run_worker_first가 /api/*만 Worker로 보내므로 그 외는 정적 자산이 처리하지만,
// 혹시 Worker까지 온 비-API 요청은 SPA 자산으로 넘긴다.
app.notFound((c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
