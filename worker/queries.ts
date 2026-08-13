/* 동기화 쿼리 — Worker(neon-http)와 테스트(PGlite)가 같은 코드를 쓴다. */
import { and, eq, inArray, ne, or, sql } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import { comments, entries, pushSubs, reactions, status } from './schema';
import { normalizeEmojis } from '../shared/types';
import type {
  Comment,
  Entry,
  MemberId,
  MemberStatus,
  Place,
  PullCursor,
  ReactionCursor,
  ReactionSet,
  Tag,
  Todo,
} from '../shared/types';

// 드라이버(neon-http/pglite)에 무관한 최소 공통 타입
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = PgDatabase<any, any, any>;

/** DB가 돌려주는 타임스탬프(Postgres 텍스트 '2026-08-13 05:04:23.1+00')를 ISO로 정규화.
    클라이언트(특히 iOS Safari)는 pg 텍스트 형식을 Date.parse하지 못할 수 있다 —
    프로토콜 경계에서 항상 ISO만 내보내면 클라이언트는 파싱·사전순 비교 모두 안전하다. */
function isoTs(ts: string): string {
  const t = Date.parse(ts);
  return Number.isFinite(t) ? new Date(t).toISOString() : ts;
}

function toEntry(r: typeof entries.$inferSelect): Entry {
  return {
    id: r.id,
    m: r.memberId as MemberId,
    day: r.day,
    time: r.time,
    tag: r.tag as Tag,
    stars: r.stars,
    memo: r.memo,
    body: r.body,
    todos: r.todos as Todo[],
    v: r.version,
    updatedAt: isoTs(r.updatedAt),
    deletedAt: r.deletedAt === null ? null : isoTs(r.deletedAt),
  };
}

/** push 계열이 공유하는 행 매핑 — 필드 추가 시 여기 한 곳만 고친다. */
function toInsertRow(e: Omit<Entry, 'v'>, version: number) {
  return {
    id: e.id,
    memberId: e.m,
    day: e.day,
    time: e.time,
    tag: e.tag,
    stars: e.tag === 'OFF' ? null : e.stars,
    memo: e.memo,
    body: e.body,
    todos: e.todos,
    version,
    deletedAt: e.deletedAt,
  };
}

/** onConflictDoUpdate가 공유하는 내용 필드 갱신 — version/updated_at은 호출부가 정한다. */
const CONTENT_SET = {
  day: sql`excluded.day`,
  time: sql`excluded.time`,
  tag: sql`excluded.tag`,
  stars: sql`excluded.stars`,
  memo: sql`excluded.memo`,
  body: sql`excluded.body`,
  todos: sql`excluded.todos`,
  deletedAt: sql`excluded.deleted_at`,
} as const;

export interface PushOutcome {
  /** 반영된 행 — 서버가 부여한 새 version/updated_at을 담아 돌려준다. */
  applied: Entry[];
  /** CAS 실패(base 불일치·남의 행) — 서버의 현재 행. 클라이언트가 병합 후 재전송한다. */
  conflicts: Entry[];
}

/** 버전 CAS 업서트. updated_at은 항상 서버 시계.
    - 신규 행은 version = base+1로 삽입된다 (base는 보통 0).
    - 기존 행은 "본인 것 + version이 base와 일치"할 때만 갱신 — 동시 수정이 서로를 덮지 못하고,
      전송이 겹쳐도 한쪽만 반영된다. 불일치 행은 현재 서버 행을 conflicts로 돌려준다. */
export async function pushEntries(db: Db, rows: Entry[], me: MemberId): Promise<PushOutcome> {
  if (rows.length === 0) return { applied: [], conflicts: [] };
  const returned = await db
    .insert(entries)
    .values(rows.map((e) => toInsertRow(e, e.v + 1)))
    .onConflictDoUpdate({
      target: entries.id,
      set: {
        ...CONTENT_SET,
        version: sql`excluded.version`,
        updatedAt: sql`now()`,
      },
      // excluded.version = base+1 이므로 "현재 version = base"가 CAS 조건이 된다
      setWhere: sql`${entries.memberId} = ${me} and ${entries.version} = excluded.version - 1`,
    })
    .returning();
  const appliedIds = new Set(returned.map((r) => r.id));
  const missed = rows.filter((e) => !appliedIds.has(e.id)).map((e) => e.id);
  const current = missed.length
    ? await db.select().from(entries).where(inArray(entries.id, missed))
    : [];
  return { applied: returned.map(toEntry), conflicts: current.map(toEntry) };
}

/** v(base) 없는 구 프로토콜 push — 행 단위 LWW(예전 의미론 그대로).
    아직 구버전 번들을 돌리는 탭이 새 서버에서 400으로 막히지 않게 하는 이행 경로다.
    version은 +1로 올려서 새 클라이언트의 중복 무시(v 비교)가 이 변경을 놓치지 않게 한다. */
export async function pushEntriesLegacy(
  db: Db,
  rows: Omit<Entry, 'v'>[],
  me: MemberId,
): Promise<Entry[]> {
  if (rows.length === 0) return [];
  const returned = await db
    .insert(entries)
    .values(rows.map((e) => toInsertRow(e, 1)))
    .onConflictDoUpdate({
      target: entries.id,
      set: {
        ...CONTENT_SET,
        version: sql`${entries.version} + 1`,
        updatedAt: sql`now()`,
      },
      setWhere: sql`${entries.memberId} = ${me}`,
    })
    .returning();
  return returned.map(toEntry);
}

export interface PullResult {
  rows: Entry[];
  cursor: PullCursor | null;
}

/** 안전 지평선의 커서 id — ts 이후의 모든 id가 다시 잡히도록 최솟값 UUID를 쓴다. */
export const NIL_UUID = '00000000-0000-0000-0000-000000000000';

/** 커서 안전 지평선 폭 — "최대 쓰기 트랜잭션 지속시간 + Worker-DB 시계 오차"보다 커야 한다.
    (neon-http 쓰기는 자동 커밋 단문이라 수 초, 클라우드 시계 오차는 초 미만 — 90초면 넉넉) */
const HORIZON_MS = 90_000;

/** 한 페이지 상한 — 세 스트림이 공유한다(클라이언트는 가득 찬 페이지를 보고 더 돈다). */
const PAGE = 500;

/** 커서를 어디로 둘지: 지평선으로 / 그대로 / 마지막 행 키셋으로. */
type CursorMove = 'horizon' | 'keep' | 'advance';

/** 세 스트림(기록·댓글·리액션)이 공유하는 커서 전진 판정.
    커서의 모양과 SQL은 스트림마다 다르지만 이 규칙은 하나여야 한다 —
    한 스트림만 규칙이 어긋나면 그 스트림의 늦은 커밋이 영구 누락된다. */
function holdOrAdvance(
  horizonMs: number,
  cursorTs: string | null,
  rowCount: number,
  lastTs: string | undefined,
): CursorMove {
  if (lastTs === undefined) {
    // 빈 페이지: 커서가 지평선을 넘어 있으면(정확히 PAGE행 페이지 직후 등) 끌어내린다
    const curMs = cursorTs === null ? NaN : Date.parse(cursorTs);
    return Number.isFinite(curMs) && curMs > horizonMs ? 'horizon' : 'keep';
  }
  // 마지막 행이 지평선보다 오래됐으면 키셋으로 정상 전진, 아니면 지평선에서 멈춘다.
  // (파싱이 안 되는 타임스탬프는 안전한 쪽 — 지평선 유지 — 로 처리한다)
  const lastMs = Date.parse(lastTs);
  const old = Number.isFinite(lastMs) && lastMs <= horizonMs;
  return rowCount < PAGE && !old ? 'horizon' : 'advance';
}

/** (updated_at, id) 키셋 커서 이후 변경분. 최대 500행 — 클라이언트가 반복 호출한다.

    커서는 안전 지평선(지금 - 90초)까지만 전진한다. updated_at의 now()는 커밋 시각이
    아니라 트랜잭션 시작 시각이라, 먼저 시작해 늦게 커밋된 쓰기가 이미 지나간 커서
    뒤편에 나타나 영구 누락될 수 있다. 지평선 안쪽(최근 90초)의 행은 다음 pull에
    다시 실려 보내고, 클라이언트가 버전(v) 비교로 중복을 무시한다.

    한도(500)에 걸린 페이지는 키셋으로 전진해 페이지네이션이 항상 앞으로 가게 한다 —
    마지막 페이지가 지평선에서 다시 멈추고, 빈 페이지도 지평선 너머의 커서를 끌어내리므로
    페이지네이션이 어떻게 끝나든 커서는 지평선을 넘긴 채 방치되지 않는다. */
export async function pullSince(db: Db, cursor: PullCursor | null): Promise<PullResult> {
  const horizonMs = Date.now() - HORIZON_MS;
  const rows = await db
    .select()
    .from(entries)
    .where(
      cursor
        ? sql`(${entries.updatedAt}, ${entries.id}) > (${cursor.ts}::timestamptz, ${cursor.id}::uuid)`
        : undefined,
    )
    .orderBy(entries.updatedAt, entries.id)
    .limit(PAGE);
  const last = rows[rows.length - 1];
  const move = holdOrAdvance(horizonMs, cursor?.ts ?? null, rows.length, last?.updatedAt);
  // 커서의 ts만은 DB가 준 원본 문자열 그대로 쓴다 — ISO로 정규화하면 마이크로초가
  // 잘려 커서가 그 행보다 앞서지 못하고 같은 행을 영원히 다시 싣는다.
  return {
    rows: rows.map(toEntry),
    cursor:
      move === 'horizon'
        ? { ts: new Date(horizonMs).toISOString(), id: NIL_UUID }
        : move === 'keep'
          ? cursor
          : { ts: last!.updatedAt, id: last!.id },
  };
}

/* ---------- 댓글 ---------- */

function toComment(r: typeof comments.$inferSelect): Comment {
  return {
    id: r.id,
    entryId: r.entryId,
    m: r.memberId as MemberId,
    body: r.body,
    createdAt: isoTs(r.createdAt),
    updatedAt: isoTs(r.updatedAt),
    deletedAt: r.deletedAt === null ? null : isoTs(r.deletedAt),
  };
}

export interface CommentPushOutcome {
  /** 반영된 행 — 서버가 확정한 updated_at을 담아 돌려준다. */
  applied: Comment[];
  /** 반영되지 않은 행의 서버 현재 값 — 클라이언트는 이걸 그대로 채택하고 큐를 비운다. */
  current: Comment[];
}

/** 댓글 업서트 — 본문·작성시각은 절대 갱신하지 않는다.
    · 내용이 불변이라 재전송이 그냥 멱등해진다(응답을 잃어도 안전).
    · 남이 같은 id로 내 댓글 본문을 바꿔치기할 수 없다.
    갱신되는 건 삭제(tombstone)뿐이고, 그것도 "내 댓글이면서 아직 살아 있는 행을 지울 때"만 —
    삭제가 단조라 지워진 댓글은 어떤 재전송으로도 되살아나지 않는다. */
export async function pushComments(
  db: Db,
  rows: Comment[],
  me: MemberId,
): Promise<CommentPushOutcome> {
  if (rows.length === 0) return { applied: [], current: [] };
  const returned = await db
    .insert(comments)
    .values(
      rows.map((c) => ({
        id: c.id,
        entryId: c.entryId,
        memberId: c.m,
        body: c.body,
        createdAt: c.createdAt,
        deletedAt: c.deletedAt,
      })),
    )
    .onConflictDoUpdate({
      target: comments.id,
      set: { deletedAt: sql`excluded.deleted_at`, updatedAt: sql`now()` },
      setWhere: sql`${comments.memberId} = ${me} and ${comments.deletedAt} is null and excluded.deleted_at is not null`,
    })
    .returning();
  const appliedIds = new Set(returned.map((r) => r.id));
  const missed = rows.filter((c) => !appliedIds.has(c.id)).map((c) => c.id);
  // 반영되지 않은 id는 이미 있는 행(같은 내용 재전송·이미 삭제됨·남의 댓글) — 현재 행을 읽어 돌려준다
  const current = missed.length
    ? await db.select().from(comments).where(inArray(comments.id, missed))
    : [];
  return { applied: returned.map(toComment), current: current.map(toComment) };
}

export interface CommentPullResult {
  rows: Comment[];
  cursor: PullCursor | null;
}

/** 댓글 변경분 — 기록 스트림과 같은 (updated_at, id) 키셋 + 90초 안전 지평선 규칙. */
export async function pullComments(
  db: Db,
  cursor: PullCursor | null,
): Promise<CommentPullResult> {
  const horizonMs = Date.now() - HORIZON_MS;
  const rows = await db
    .select()
    .from(comments)
    .where(
      cursor
        ? sql`(${comments.updatedAt}, ${comments.id}) > (${cursor.ts}::timestamptz, ${cursor.id}::uuid)`
        : undefined,
    )
    .orderBy(comments.updatedAt, comments.id)
    .limit(PAGE);
  const last = rows[rows.length - 1];
  const move = holdOrAdvance(horizonMs, cursor?.ts ?? null, rows.length, last?.updatedAt);
  return {
    rows: rows.map(toComment),
    cursor:
      move === 'horizon'
        ? { ts: new Date(horizonMs).toISOString(), id: NIL_UUID }
        : move === 'keep'
          ? cursor
          : { ts: last!.updatedAt, id: last!.id },
  };
}

/* ---------- 리액션 ---------- */

/** 리액션 로컬/서버 공용 행 키 — (기록, 멤버) 쌍이 곧 한 행이다. */
const rkey = (entryId: string, m: string): string => `${entryId}|${m}`;

function toReactionSet(r: typeof reactions.$inferSelect): ReactionSet {
  return {
    entryId: r.entryId,
    m: r.memberId as MemberId,
    // jsonb는 무엇이든 들어올 수 있는 자리 — 읽을 때도 정규화해 클라이언트가 받는 집합이
    // 항상 REACTIONS 순서·유효 이모지임을 보장한다(순서가 흔들리면 헛 동기화가 돈다)
    emojis: normalizeEmojis(r.emojis),
    actedAt: isoTs(r.actedAt),
    updatedAt: isoTs(r.updatedAt),
  };
}

export interface ReactionPushOutcome {
  applied: ReactionSet[];
  current: ReactionSet[];
}

/** 리액션 집합 업서트 — status와 같은 의미론으로 액션 시각(acted_at) LWW.
    도착 순서로 판정하면 오프라인이었다 재접속한 기기의 옛 토글이 최신 집합을 덮는다.
    PK에 member_id가 있어 남의 행과는 충돌 자체가 없다(= 남의 리액션은 건드릴 수 없다). */
export async function pushReactions(db: Db, rows: ReactionSet[]): Promise<ReactionPushOutcome> {
  if (rows.length === 0) return { applied: [], current: [] };
  const returned = await db
    .insert(reactions)
    .values(
      rows.map((r) => ({
        entryId: r.entryId,
        memberId: r.m,
        emojis: r.emojis,
        actedAt: r.actedAt,
      })),
    )
    .onConflictDoUpdate({
      target: [reactions.entryId, reactions.memberId],
      set: {
        emojis: sql`excluded.emojis`,
        actedAt: sql`excluded.acted_at`,
        updatedAt: sql`now()`,
      },
      // 같은 시각(재전송)은 멱등하게 허용, 더 오래된 액션만 거부한다
      setWhere: sql`excluded.acted_at >= ${reactions.actedAt}`,
    })
    .returning();
  const appliedKeys = new Set(returned.map((r) => rkey(r.entryId, r.memberId)));
  const missed = rows.filter((r) => !appliedKeys.has(rkey(r.entryId, r.m)));
  const current = missed.length
    ? await db
        .select()
        .from(reactions)
        .where(
          or(...missed.map((r) => and(eq(reactions.entryId, r.entryId), eq(reactions.memberId, r.m)))),
        )
    : [];
  return { applied: returned.map(toReactionSet), current: current.map(toReactionSet) };
}

export interface ReactionPullResult {
  rows: ReactionSet[];
  cursor: ReactionCursor | null;
}

/** 지평선 커서의 멤버 자리 — 그 시각의 모든 행이 다시 잡히도록 최솟값을 쓴다.
    실제 멤버 id가 아니라 키셋 비교용 하한(빈 문자열)이다 — entry_id의 NIL_UUID와 같은 역할이고,
    그래서 ReactionCursor.m의 타입도 `MemberId | ''`로 그 사실을 그대로 말한다. */
const MIN_MEMBER = '';

/** 리액션 변경분 — (updated_at, entry_id, member_id) 키셋. PK가 유일성을 보장하므로
    같은 updated_at 행이 여럿이어도 한 번씩만, 빠짐없이 지나간다. */
export async function pullReactions(
  db: Db,
  cursor: ReactionCursor | null,
): Promise<ReactionPullResult> {
  const horizonMs = Date.now() - HORIZON_MS;
  const rows = await db
    .select()
    .from(reactions)
    .where(
      cursor
        ? sql`(${reactions.updatedAt}, ${reactions.entryId}, ${reactions.memberId}) > (${cursor.ts}::timestamptz, ${cursor.entryId}::uuid, ${cursor.m}::text)`
        : undefined,
    )
    .orderBy(reactions.updatedAt, reactions.entryId, reactions.memberId)
    .limit(PAGE);
  const last = rows[rows.length - 1];
  const move = holdOrAdvance(horizonMs, cursor?.ts ?? null, rows.length, last?.updatedAt);
  return {
    rows: rows.map(toReactionSet),
    cursor:
      move === 'horizon'
        ? { ts: new Date(horizonMs).toISOString(), entryId: NIL_UUID, m: MIN_MEMBER }
        : move === 'keep'
          ? cursor
          : { ts: last!.updatedAt, entryId: last!.entryId, m: last!.memberId as MemberId },
  };
}

/* ---------- 지금 상태 ---------- */

function toMemberStatus(r: typeof status.$inferSelect): MemberStatus {
  return {
    m: r.memberId as MemberId,
    on: r.on,
    place: r.place as Place | null,
    since: r.since === null ? null : isoTs(r.since),
    updatedAt: isoTs(r.updatedAt),
  };
}

/** 내 상태 행을 액션 시각(at) 기준 LWW로 갱신한다.
    기존 행의 updated_at(=이전 액션 시각)보다 오래된 액션은 거부 — 오프라인이었다가
    뒤늦게 도착한 옛 토글이 다른 기기의 더 새 상태를 덮지 못한다. 거부 시 현재 행을 돌려준다. */
export async function setStatus(
  db: Db,
  me: MemberId,
  s: { on: boolean; place: Place | null; since: string | null; at: string },
): Promise<{ status: MemberStatus; applied: boolean }> {
  const [row] = await db
    .insert(status)
    .values({ memberId: me, on: s.on, place: s.place, since: s.since, updatedAt: s.at })
    .onConflictDoUpdate({
      target: status.memberId,
      set: {
        on: sql`excluded.is_on`,
        place: sql`excluded.place`,
        since: sql`excluded.since`,
        updatedAt: sql`excluded.updated_at`,
      },
      // 같은 시각(재전송)은 멱등하게 허용, 더 오래된 액션만 거부한다
      setWhere: sql`excluded.updated_at >= ${status.updatedAt}`,
    })
    .returning();
  if (row) return { status: toMemberStatus(row), applied: true };
  const [cur] = await db.select().from(status).where(eq(status.memberId, me)).limit(1);
  return { status: toMemberStatus(cur!), applied: false };
}

export async function allStatuses(db: Db): Promise<MemberStatus[]> {
  return (await db.select().from(status)).map(toMemberStatus);
}

/** 알림 판단에 필요한 이전 상태 (없으면 null). */
export async function getStatusRow(
  db: Db,
  me: MemberId,
): Promise<{ on: boolean; since: string | null; lastNotifiedAt: string | null } | null> {
  const [row] = await db.select().from(status).where(eq(status.memberId, me)).limit(1);
  return row ? { on: row.on, since: row.since, lastNotifiedAt: row.lastNotifiedAt } : null;
}

/** 알림 발송 슬롯을 원자적으로 선점한다 — 조건부 UPDATE라 두 기기가 동시에 켜도
    한쪽만 true를 받는다(중복 발송 방지). 도장(last_notified_at)이 곧 쿨다운의 기준. */
export async function claimNotifySlot(db: Db, me: MemberId, cooldownMs: number): Promise<boolean> {
  const secs = Math.floor(cooldownMs / 1000);
  const rows = await db
    .update(status)
    .set({ lastNotifiedAt: sql`now()` })
    .where(
      and(
        eq(status.memberId, me),
        sql`(${status.lastNotifiedAt} is null or ${status.lastNotifiedAt} <= now() - make_interval(secs => ${secs}))`,
      ),
    )
    .returning({ m: status.memberId });
  return rows.length > 0;
}

/* ---------- 웹 푸시 구독 ---------- */

export async function upsertPushSub(
  db: Db,
  me: MemberId,
  sub: { endpoint: string; p256dh: string; auth: string },
): Promise<void> {
  await db
    .insert(pushSubs)
    .values({ endpoint: sub.endpoint, memberId: me, p256dh: sub.p256dh, auth: sub.auth })
    .onConflictDoUpdate({
      target: pushSubs.endpoint,
      // 같은 브라우저에서 멤버를 바꿔 로그인해도 최신 멤버가 받는다
      set: { memberId: me, p256dh: sub.p256dh, auth: sub.auth },
    });
}

/** 본인 구독만 지울 수 있다. 만료 정리는 deleteGonePushSub를 쓴다. */
export async function deletePushSub(db: Db, me: MemberId, endpoint: string): Promise<void> {
  await db.delete(pushSubs).where(and(eq(pushSubs.endpoint, endpoint), eq(pushSubs.memberId, me)));
}

/** 푸시 서비스가 404/410으로 죽었다고 알려준 구독 정리. */
export async function deleteGonePushSub(db: Db, endpoint: string): Promise<void> {
  await db.delete(pushSubs).where(eq(pushSubs.endpoint, endpoint));
}

/** 나를 제외한 크루 전원의 구독 — 알림 수신 대상. */
export async function pushSubsExcept(
  db: Db,
  me: MemberId,
): Promise<{ endpoint: string; p256dh: string; auth: string }[]> {
  return db
    .select({ endpoint: pushSubs.endpoint, p256dh: pushSubs.p256dh, auth: pushSubs.auth })
    .from(pushSubs)
    .where(ne(pushSubs.memberId, me));
}
