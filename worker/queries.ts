/* 동기화 쿼리 — Worker(neon-http)와 테스트(PGlite)가 같은 코드를 쓴다. */
import { and, eq, ne, sql } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import { entries, pushSubs, status } from './schema';
import type { Entry, MemberId, MemberStatus, Place, PullCursor, Tag, Todo } from '../shared/types';

// 드라이버(neon-http/pglite)에 무관한 최소 공통 타입
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = PgDatabase<any, any, any>;

/** 멱등 다중 업서트. updated_at은 항상 서버 시계.
    setWhere: 기존 행이 본인 것일 때만 갱신 — id 충돌로 남의 행을 덮을 수 없다. */
export async function pushEntries(db: Db, rows: Entry[], me: MemberId): Promise<void> {
  if (rows.length === 0) return;
  await db
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
        deletedAt: sql`excluded.deleted_at`,
        updatedAt: sql`now()`,
      },
      setWhere: sql`${entries.memberId} = ${me}`,
    });
}

export interface PullResult {
  rows: Entry[];
  cursor: PullCursor | null;
}

/** (updated_at, id) 키셋 커서 이후 변경분. 최대 500행 — 클라이언트가 반복 호출한다. */
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
  return {
    rows: rows.map((r) => ({
      id: r.id,
      m: r.memberId as MemberId,
      day: r.day,
      time: r.time,
      tag: r.tag as Tag,
      stars: r.stars,
      memo: r.memo,
      body: r.body,
      todos: r.todos as Todo[],
      updatedAt: r.updatedAt,
      deletedAt: r.deletedAt,
    })),
    cursor: last ? { ts: last.updatedAt, id: last.id } : cursor,
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

/** 내 상태 행을 덮어쓴다. updated_at은 항상 서버 시계. 저장된 행을 돌려준다. */
export async function setStatus(
  db: Db,
  me: MemberId,
  s: { on: boolean; place: Place | null; since: string | null },
): Promise<MemberStatus> {
  const [row] = await db
    .insert(status)
    .values({ memberId: me, on: s.on, place: s.place, since: s.since })
    .onConflictDoUpdate({
      target: status.memberId,
      set: {
        on: sql`excluded.is_on`,
        place: sql`excluded.place`,
        since: sql`excluded.since`,
        updatedAt: sql`now()`,
      },
    })
    .returning();
  return toMemberStatus(row!);
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

/** 푸시를 보냈다는 도장 — 쿨다운 계산의 기준. */
export async function stampNotified(db: Db, me: MemberId): Promise<void> {
  await db.update(status).set({ lastNotifiedAt: sql`now()` }).where(eq(status.memberId, me));
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
