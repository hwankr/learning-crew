/* 동기화 쿼리 — Worker(neon-http)와 테스트(PGlite)가 같은 코드를 쓴다. */
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import { entries, pushSubs, status } from './schema';
import type { Entry, MemberId, MemberStatus, Place, PullCursor, Tag, Todo } from '../shared/types';

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
  const horizon: PullCursor = { ts: new Date(horizonMs).toISOString(), id: NIL_UUID };
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
  if (!last) {
    // 빈 페이지: 커서가 지평선을 넘어 있으면(정확히 500행 페이지 직후 등) 끌어내린다
    const curMs = cursor ? Date.parse(cursor.ts) : NaN;
    return { rows: [], cursor: Number.isFinite(curMs) && curMs > horizonMs ? horizon : cursor };
  }
  // 마지막 행이 지평선보다 오래됐으면 키셋으로 정상 전진, 아니면 지평선에서 멈춘다.
  // (파싱이 안 되는 타임스탬프는 안전한 쪽 — 지평선 유지 — 로 처리한다)
  const lastMs = Date.parse(last.updatedAt);
  const hold = rows.length < 500 && !(Number.isFinite(lastMs) && lastMs <= horizonMs);
  return {
    rows: rows.map(toEntry),
    cursor: hold ? horizon : { ts: last.updatedAt, id: last.id },
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
