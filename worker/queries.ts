/* 동기화 쿼리 — Worker(neon-http)와 테스트(PGlite)가 같은 코드를 쓴다. */
import { sql } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import { entries } from './schema';
import type { Entry, MemberId, PullCursor, Tag, Todo } from '../shared/types';

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
