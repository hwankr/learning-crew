/* 동기화 쿼리 — Worker(neon-http)와 테스트(PGlite)가 같은 코드를 쓴다. */
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import { entries, pushSubs, status } from './schema';
import type { Entry, MemberId, MemberStatus, Place, PullCursor, Tag, Todo } from '../shared/types';

// 드라이버(neon-http/pglite)에 무관한 최소 공통 타입
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = PgDatabase<any, any, any>;

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
    updatedAt: r.updatedAt,
    deletedAt: r.deletedAt,
  };
}

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
    .values(
      rows.map((e) => ({
        id: e.id,
        memberId: e.m,
        day: e.day,
        time: e.time,
        tag: e.tag,
        stars: e.tag === 'OFF' ? null : e.stars,
        memo: e.memo,
        body: e.body,
        todos: e.todos,
        version: e.v + 1,
        deletedAt: e.deletedAt,
      })),
    )
    .onConflictDoUpdate({
      target: entries.id,
      set: {
        day: sql`excluded.day`,
        time: sql`excluded.time`,
        tag: sql`excluded.tag`,
        stars: sql`excluded.stars`,
        memo: sql`excluded.memo`,
        body: sql`excluded.body`,
        todos: sql`excluded.todos`,
        version: sql`excluded.version`,
        deletedAt: sql`excluded.deleted_at`,
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

export interface PullResult {
  rows: Entry[];
  cursor: PullCursor | null;
}

/** 안전 지평선의 커서 id — ts 이후의 모든 id가 다시 잡히도록 최솟값 UUID를 쓴다. */
const NIL_UUID = '00000000-0000-0000-0000-000000000000';

/** (updated_at, id) 키셋 커서 이후 변경분. 최대 500행 — 클라이언트가 반복 호출한다.

    커서는 "지금 - 60초" 안전 지평선까지만 전진한다. updated_at의 now()는 커밋 시각이
    아니라 트랜잭션 시작 시각이라, 먼저 시작해 늦게 커밋된 쓰기가 이미 지나간 커서
    뒤편에 나타나 영구 누락될 수 있다. 지평선 안쪽(최근 60초)의 행은 다음 pull에
    다시 실려 보내고, 클라이언트가 버전(v) 비교로 중복을 무시한다. */
export async function pullSince(db: Db, cursor: PullCursor | null): Promise<PullResult> {
  const rows = await db
    .select()
    .from(entries)
    .where(
      cursor
        ? sql`(${entries.updatedAt}, ${entries.id}) > (${cursor.ts}::timestamptz, ${cursor.id}::uuid)`
        : undefined,
    )
    .orderBy(entries.updatedAt, entries.id)
    .limit(500);
  const last = rows[rows.length - 1];
  if (!last) return { rows: [], cursor };
  // 마지막 행이 지평선보다 오래됐으면 키셋으로 정상 전진, 아니면 지평선에서 멈춘다.
  // (비교는 SQL에서 — 드라이버별 타임스탬프 문자열을 JS로 파싱하지 않는다)
  // 한도(500)에 걸린 페이지는 키셋으로 전진해 페이지네이션이 항상 앞으로 가게 한다 —
  // 마지막 페이지(<500)가 다시 지평선에서 멈추므로 최근 윈도우는 결국 재검사된다.
  const [h] = await db
    .select({
      olderThanHorizon: sql<boolean>`${last.updatedAt}::timestamptz <= now() - interval '60 seconds'`,
      horizon: sql<string>`(now() - interval '60 seconds')::text`,
    })
    .from(entries)
    .limit(1);
  const holdAtHorizon = rows.length < 500 && h && !h.olderThanHorizon;
  return {
    rows: rows.map(toEntry),
    cursor: holdAtHorizon ? { ts: h.horizon, id: NIL_UUID } : { ts: last.updatedAt, id: last.id },
  };
}

/* ---------- 지금 상태 ---------- */

function toMemberStatus(r: typeof status.$inferSelect): MemberStatus {
  return {
    m: r.memberId as MemberId,
    on: r.on,
    place: r.place as Place | null,
    since: r.since,
    updatedAt: r.updatedAt,
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
