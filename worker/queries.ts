/* 동기화 쿼리 — Worker(neon-http)와 테스트(PGlite)가 같은 코드를 쓴다. */
import { and, eq, inArray, isNull, lt, ne, notInArray, or, sql } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import {
  comments,
  entries,
  notifPrefs,
  notifications,
  photoTombstones,
  pushSubs,
  reactions,
  status,
  tagPrefs,
} from './schema';
import {
  DEFAULT_NOTIF_PREFS,
  MEMBER_IDS,
  NOTIF_MODES,
  entryTags,
  isOffTags,
  normalizeCustomTagList,
  normalizeEmojis,
  normalizePhotos,
  primaryTag,
} from '../shared/types';
import type {
  Comment,
  Entry,
  MemberId,
  MemberStatus,
  NotifKind,
  NotifMode,
  NotifPrefs,
  NotifWhy,
  Notification,
  NotificationRead,
  Place,
  PullCursor,
  ReactionCursor,
  ReactionEmoji,
  ReactionSet,
  Tag,
  TagPrefs,
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
  // jsonb는 무엇이든 들어올 수 있는 자리 + 백필 전의 구버전 행에는 tags가 비어 있다 —
  // 읽을 때도 파생을 다시 계산해 클라이언트가 받는 tag/tags가 절대 어긋나지 않게 한다
  const tags = entryTags({ tag: r.tag, tags: r.tags });
  return {
    id: r.id,
    m: r.memberId as MemberId,
    day: r.day,
    time: r.time,
    tag: primaryTag(tags),
    tags,
    stars: r.stars,
    memo: r.memo,
    body: r.body,
    todos: r.todos as Todo[],
    // jsonb는 손상된 값도 담을 수 있으므로 pull 경계에서 공용 규칙으로 다시 맞춘다.
    photos: normalizePhotos(r.photos),
    v: r.version,
    updatedAt: isoTs(r.updatedAt),
    deletedAt: r.deletedAt === null ? null : isoTs(r.deletedAt),
  };
}

/** push 계열이 공유하는 행 매핑 — 필드 추가 시 여기 한 곳만 고친다.
    tag는 클라이언트가 보낸 값을 믿지 않는다: 항상 tags에서 다시 계산해 저장한다
    (구버전 클라이언트는 tags 없이 tag만 보내므로 entryTags가 양쪽을 하나로 만든다). */
function toInsertRow(e: Omit<Entry, 'v'>, version: number) {
  const tags = entryTags(e);
  return {
    id: e.id,
    memberId: e.m,
    day: e.day,
    time: e.time,
    tag: primaryTag(tags),
    tags,
    // 비-OFF+null은 레거시 "평가 없음"으로 보존하고, OFF만 DB 경계에서 null로 강제한다.
    stars: isOffTags(tags) ? null : e.stars,
    memo: e.memo,
    body: e.body,
    todos: e.todos,
    // 신규 구버전 행(photos 누락)은 []로 시작하고, 기존 행 보존은
    // onConflict SET에서 처리한다. DB에는 항상 정규화된 배열만 들어간다.
    photos: normalizePhotos(e.photos),
    version,
    deletedAt: e.deletedAt,
  };
}

/** onConflictDoUpdate가 공유하는 내용 필드 갱신 — version/updated_at은 호출부가 정한다.
    photos는 별도로 더한다. 구버전 push의 필드 누락을 [] 삭제로 오인하지 않으려면
    "포함된 행"과 "누락된 행"을 다른 upsert SET으로 보내야 한다. */
const CONTENT_SET = {
  day: sql`excluded.day`,
  time: sql`excluded.time`,
  tag: sql`excluded.tag`,
  tags: sql`excluded.tags`,
  stars: sql`excluded.stars`,
  memo: sql`excluded.memo`,
  body: sql`excluded.body`,
  todos: sql`excluded.todos`,
  deletedAt: sql`excluded.deleted_at`,
} as const;

const PHOTO_SET = { photos: sql`excluded.photos` } as const;

/** 구버전 행의 photos 누락을 기존 DB 값 보존으로 처리하는 CAS upsert.
    신규 행은 toInsertRow의 []가 저장되고, 기존 행은 includePhotos=false일 때
    SET에 photos를 넣지 않아 갱신 시점의 값을 원자적으로 그대로 둔다. */
async function pushEntriesCasGroup(
  db: Db,
  rows: Entry[],
  me: MemberId,
  includePhotos: boolean,
): Promise<(typeof entries.$inferSelect)[]> {
  if (rows.length === 0) return [];
  return db
    .insert(entries)
    .values(rows.map((e) => toInsertRow(e, e.v + 1)))
    .onConflictDoUpdate({
      target: entries.id,
      set: {
        ...CONTENT_SET,
        ...(includePhotos ? PHOTO_SET : {}),
        version: sql`excluded.version`,
        updatedAt: sql`now()`,
      },
      // excluded.version = base+1 이므로 "현재 version = base"가 CAS 조건이 된다
      setWhere: sql`${entries.memberId} = ${me} and ${entries.version} = excluded.version - 1`,
    })
    .returning();
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
  // undefined인 행은 구버전 프로토콜: 빈 배열을 보낸 것이 아니므로 기존 값을 보존한다.
  const withPhotos = rows.filter((e) => e.photos !== undefined);
  const withoutPhotos = rows.filter((e) => e.photos === undefined);
  const [withReturned, withoutReturned] = await Promise.all([
    pushEntriesCasGroup(db, withPhotos, me, true),
    pushEntriesCasGroup(db, withoutPhotos, me, false),
  ]);
  const returned = [...withReturned, ...withoutReturned];
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
  const run = async (
    group: Omit<Entry, 'v'>[],
    includePhotos: boolean,
  ): Promise<(typeof entries.$inferSelect)[]> => {
    if (group.length === 0) return [];
    return db
      .insert(entries)
      .values(group.map((e) => toInsertRow(e, 1)))
      .onConflictDoUpdate({
        target: entries.id,
        set: {
          ...CONTENT_SET,
          ...(includePhotos ? PHOTO_SET : {}),
          version: sql`${entries.version} + 1`,
          updatedAt: sql`now()`,
        },
        setWhere: sql`${entries.memberId} = ${me}`,
      })
      .returning();
  };
  const [withReturned, withoutReturned] = await Promise.all([
    run(rows.filter((e) => e.photos !== undefined), true),
    run(rows.filter((e) => e.photos === undefined), false),
  ]);
  const returned = [...withReturned, ...withoutReturned];
  return returned.map(toEntry);
}

/* ---------- 사진 R2 삭제 톰스톤 ---------- */

/** PUT 경계에서 늦은 업로드를 막는 소유자별 존재 확인. */
export async function hasPhotoTombstone(
  db: Db,
  photoId: string,
  owner: MemberId,
): Promise<boolean> {
  const rows = await db
    .select({ photoId: photoTombstones.photoId })
    .from(photoTombstones)
    .where(and(
      eq(photoTombstones.photoId, photoId),
      eq(photoTombstones.owner, owner),
    ))
    .limit(1);
  return rows.length > 0;
}

export interface PhotoTombstoneJob {
  photoId: string;
  owner: string;
  cleanupGeneration: number;
}

/** 매시 cron이 한 번에 처리할 유한한 묶음. 완료 원장은 건너뛰고 오래된 작업부터 내본다. */
export async function pendingPhotoTombstones(
  db: Db,
  limit = 500,
): Promise<PhotoTombstoneJob[]> {
  return db
    .select({
      photoId: photoTombstones.photoId,
      owner: photoTombstones.owner,
      cleanupGeneration: photoTombstones.cleanupGeneration,
    })
    .from(photoTombstones)
    .where(isNull(photoTombstones.cleanedAt))
    .orderBy(photoTombstones.createdAt, photoTombstones.photoId, photoTombstones.owner)
    .limit(limit);
}

/** 테스트·관측용 id 목록. 실제 cleanup은 반드시 위의 세대까지 함께 읽는다. */
export async function pendingPhotoTombstoneIds(db: Db, limit = 500): Promise<string[]> {
  return (await pendingPhotoTombstones(db, limit)).map((row) => row.photoId);
}

interface PhotoTombstoneJobGroup {
  owner: string;
  cleanupGeneration: number;
  photoIds: string[];
}

function jobsByOwnerAndGeneration(
  jobs: readonly PhotoTombstoneJob[],
): PhotoTombstoneJobGroup[] {
  const groups = new Map<string, PhotoTombstoneJobGroup>();
  const seen = new Set<string>();
  for (const job of jobs) {
    const jobKey = JSON.stringify([job.photoId, job.owner, job.cleanupGeneration]);
    if (seen.has(jobKey)) continue;
    seen.add(jobKey);
    const groupKey = JSON.stringify([job.owner, job.cleanupGeneration]);
    const group = groups.get(groupKey) ?? {
      owner: job.owner,
      cleanupGeneration: job.cleanupGeneration,
      photoIds: [],
    };
    group.photoIds.push(job.photoId);
    groups.set(groupKey, group);
  }
  return [...groups.values()];
}

/** R2 삭제 성공을 관측한 세대에만 완료 도장을 찍는다.
    늦은 PUT이 generation을 올렸다면 옛 cleanup의 ACK는 아무 행도 갱신하지 못한다. */
export async function markPhotoTombstonesCleaned(
  db: Db,
  jobs: readonly PhotoTombstoneJob[],
  lastError: string | null = null,
): Promise<string[]> {
  const settled: string[] = [];
  for (const { owner, cleanupGeneration, photoIds } of jobsByOwnerAndGeneration(jobs)) {
    const rows = await db
      .update(photoTombstones)
      .set({ cleanedAt: sql`now()`, lastError })
      .where(and(
        inArray(photoTombstones.photoId, photoIds),
        eq(photoTombstones.owner, owner),
        eq(photoTombstones.cleanupGeneration, cleanupGeneration),
        isNull(photoTombstones.cleanedAt),
      ))
      .returning({ photoId: photoTombstones.photoId });
    settled.push(...rows.map((row) => row.photoId));
  }
  return settled;
}

/** R2 실패는 같은 pending 세대에만 누적한다. 겹친 cleanup의 늦은 실패가
    이미 완료됐거나 PUT으로 재무장된 세대의 상태를 오염시키지 않는다. */
export async function recordPhotoTombstoneFailures(
  db: Db,
  jobs: readonly PhotoTombstoneJob[],
  error: string,
): Promise<void> {
  for (const { owner, cleanupGeneration, photoIds } of jobsByOwnerAndGeneration(jobs)) {
    await db
      .update(photoTombstones)
      .set({
        attemptCount: sql`${photoTombstones.attemptCount} + 1`,
        lastError: error,
        firstFailedAt: sql`coalesce(${photoTombstones.firstFailedAt}, now())`,
      })
      .where(and(
        inArray(photoTombstones.photoId, photoIds),
        eq(photoTombstones.owner, owner),
        eq(photoTombstones.cleanupGeneration, cleanupGeneration),
        isNull(photoTombstones.cleanedAt),
      ));
  }
}

/** PUT 사후 장벽. 원장이 생겨 있으면 새 cleanup 세대로 원자적으로 재무장한다. */
export async function rearmPhotoTombstone(
  db: Db,
  photoId: string,
  owner: MemberId,
): Promise<PhotoTombstoneJob | null> {
  const [row] = await db
    .update(photoTombstones)
    .set({
      cleanedAt: null,
      cleanupGeneration: sql`${photoTombstones.cleanupGeneration} + 1`,
    })
    .where(and(
      eq(photoTombstones.photoId, photoId),
      eq(photoTombstones.owner, owner),
    ))
    .returning({
      photoId: photoTombstones.photoId,
      owner: photoTombstones.owner,
      cleanupGeneration: photoTombstones.cleanupGeneration,
    });
  return row ?? null;
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
  /** 반영된 행마다 이번에 "새로 추가된" 이모지 — 알림 팬아웃용. 제거만 있었으면 빈 배열이다. */
  deltas: { entryId: string; m: MemberId; added: ReactionEmoji[] }[];
}

/** 리액션 집합 업서트 — status와 같은 의미론으로 액션 시각(acted_at) LWW.
    도착 순서로 판정하면 오프라인이었다 재접속한 기기의 옛 토글이 최신 집합을 덮는다.
    PK에 member_id가 있어 남의 행과는 충돌 자체가 없다(= 남의 리액션은 건드릴 수 없다). */
export async function pushReactions(db: Db, rows: ReactionSet[]): Promise<ReactionPushOutcome> {
  if (rows.length === 0) return { applied: [], current: [], deltas: [] };
  // 업서트 전의 집합을 먼저 읽는다 — 반영 후에는 "무엇이 새로 왔는지"를 알 길이 없다.
  // 트랜잭션이 아니라 이론상 그 사이 다른 요청이 끼어들 수 있지만, 밀린 쪽은 applied에서
  // 빠지므로 알림이 중복되지는 않는다(놓칠 수는 있다 — 알림은 best-effort).
  const prevRows = await db
    .select()
    .from(reactions)
    .where(
      or(...rows.map((r) => and(eq(reactions.entryId, r.entryId), eq(reactions.memberId, r.m)))),
    );
  const prev = new Map(prevRows.map((r) => [rkey(r.entryId, r.memberId), normalizeEmojis(r.emojis)]));
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
      // 같은 시각의 재전송은 거부한다(엄격 >) — 결과는 그래도 멱등하다: 거부된 행은
      // current로 돌아가고 내용이 같아 클라이언트가 그대로 정산한다. >=로 허용하면
      // 동일 요청 둘이 동시에 오는 경합에서 둘 다 applied가 되어 위의 prev 스냅샷과
      // 비교한 델타(added)가 두 번 잡히고, 알림이 중복 발송된다.
      setWhere: sql`excluded.acted_at > ${reactions.actedAt}`,
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
  const applied = returned.map(toReactionSet);
  return {
    applied,
    current: current.map(toReactionSet),
    deltas: applied.map((r) => {
      const before = prev.get(rkey(r.entryId, r.m)) ?? [];
      return { entryId: r.entryId, m: r.m, added: r.emojis.filter((e) => !before.includes(e)) };
    }),
  };
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

/** 전원 구독을 멤버별로 묶어서 — 수신자별 설정(모드·방해 금지)이 갈리는 알림 발송용. */
export async function pushSubsByMember(
  db: Db,
): Promise<Map<MemberId, { endpoint: string; p256dh: string; auth: string }[]>> {
  const rows = await db.select().from(pushSubs);
  const map = new Map<MemberId, { endpoint: string; p256dh: string; auth: string }[]>();
  for (const r of rows) {
    const m = r.memberId as MemberId;
    const list = map.get(m) ?? [];
    list.push({ endpoint: r.endpoint, p256dh: r.p256dh, auth: r.auth });
    map.set(m, list);
  }
  return map;
}

/* ---------- 알림 ---------- */

/** 내역 보관 기간 — 이 너머는 pull에서 빠지고 cron이 지운다(디자인 각주의 "30일"). */
export const NOTIF_RETENTION_DAYS = 30;

function toNotification(r: typeof notifications.$inferSelect): Notification {
  return {
    id: r.id,
    m: r.memberId as MemberId,
    kind: r.kind as NotifKind,
    why: r.why as NotifWhy,
    actor: (r.actor as MemberId | null) ?? null,
    entryId: r.entryId,
    quote: r.quote,
    ctx: r.ctx,
    actors: Array.isArray(r.actors)
      ? (r.actors as unknown[]).filter((a): a is MemberId =>
          (MEMBER_IDS as readonly unknown[]).includes(a),
        )
      : [],
    count: r.count,
    createdAt: isoTs(r.createdAt),
    updatedAt: isoTs(r.updatedAt),
    readAt: r.readAt === null ? null : isoTs(r.readAt),
  };
}

/** 새 알림 한 건의 입력 — id·시각은 서버(DB)가 정한다. */
export interface NewNotification {
  memberId: MemberId;
  kind: NotifKind;
  why: NotifWhy;
  actor: MemberId | null;
  entryId: string | null;
  quote: string;
  ctx: string;
  day: string; // KST YYYY-MM-DD
  aggKey: string | null;
  count?: number;
  actors?: MemberId[];
  /** 테스트가 과거 행을 심을 때만 넘긴다 — 실서비스 경로는 DB now()를 쓴다. */
  createdAt?: string;
}

function toNotifInsert(n: NewNotification) {
  return {
    memberId: n.memberId,
    kind: n.kind,
    why: n.why,
    actor: n.actor,
    entryId: n.entryId,
    quote: n.quote,
    ctx: n.ctx,
    day: n.day,
    aggKey: n.aggKey,
    count: n.count ?? 1,
    actors: n.actors ?? [],
    ...(n.createdAt !== undefined ? { createdAt: n.createdAt, updatedAt: n.createdAt } : {}),
  };
}

/** 일반 알림 삽입 — agg_key 없는 행 전용(중복 개념이 없다). */
export async function insertNotifications(
  db: Db,
  rows: NewNotification[],
): Promise<Notification[]> {
  if (rows.length === 0) return [];
  const returned = await db.insert(notifications).values(rows.map(toNotifInsert)).returning();
  return returned.map(toNotification);
}

/** agg_key 중복 방지 삽입 — 이미 같은 (수신자, 날짜, agg_key) 행이 있으면 조용히 무시.
    "하루 1회" 시작 알림과 방해 금지 다이제스트가 이걸로 하루 1건을 보장한다. */
export async function insertNotificationDedup(
  db: Db,
  row: NewNotification,
): Promise<Notification | null> {
  const returned = await db
    .insert(notifications)
    .values(toNotifInsert(row))
    .onConflictDoNothing({
      target: [notifications.memberId, notifications.day, notifications.aggKey],
    })
    .returning();
  const r = returned[0];
  return r ? toNotification(r) : null;
}

/** 응원 하루 요약 집계 — (수신자, 날짜)당 1행에 count를 누적하고 참여자를 합친다.
    갱신 시 읽음을 되돌린다(새 응원이 왔으니 다시 안 읽음) — updated_at이 앞으로 와서
    모든 기기가 pull로 갱신분을 받는다. */
export async function upsertReactionDaily(
  db: Db,
  me: MemberId,
  day: string,
  actor: MemberId,
  add: number,
): Promise<Notification> {
  const [row] = await db
    .insert(notifications)
    .values({
      memberId: me,
      kind: 'react',
      why: 'react_daily',
      actor: null,
      entryId: null,
      quote: '',
      ctx: '',
      day,
      aggKey: 'react',
      count: add,
      actors: [actor],
    })
    .onConflictDoUpdate({
      target: [notifications.memberId, notifications.day, notifications.aggKey],
      set: {
        count: sql`${notifications.count} + excluded.count`,
        actors: sql`(select coalesce(jsonb_agg(distinct v), '[]'::jsonb)
                     from jsonb_array_elements_text(${notifications.actors} || excluded.actors) as t(v))`,
        readAt: sql`null`, // 새 응원이 왔으니 다시 안 읽음
        pushedAt: sql`null`, // 이미 요약을 보냈어도 다시 발송 대기로 — 다음 20시에 새 합계로 나간다
        updatedAt: sql`now()`,
      },
    })
    .returning();
  return toNotification(row!);
}

/** 읽음 처리 — 내 행이면서 아직 안 읽었고, 읽은 시점 이후로 갱신되지 않은 행만 도장.
    at(읽을 때 관측한 updatedAt)보다 행이 새로우면 그 사이 내용이 바뀐 것이다 — 특히
    집계 행(react_daily)은 새 응원이 오면 "다시 안 읽음"이 되는데, 뒤늦게 도착한 옛 읽음이
    그 새 세대까지 읽음 처리하면 안 된다. updated_at을 올려 다른 기기로 전파한다.
    요청한 id 전부를 정산된 것으로 돌려준다(이미 읽음·세대 불일치·남의 행 재전송도
    큐에서 빠져야 한다 — 클라이언트는 자기 쪽 세대 판정으로 새 읽음을 다시 보낸다). */
export async function markNotificationsRead(
  db: Db,
  me: MemberId,
  reads: NotificationRead[],
): Promise<string[]> {
  if (reads.length === 0) return [];
  await db.execute(sql`
    update notifications set read_at = now(), updated_at = now()
    from (
      select (e->>'id')::uuid as id, (e->>'at')::timestamptz as at
      from jsonb_array_elements(${JSON.stringify(reads)}::jsonb) as e
    ) as v
    where notifications.id = v.id
      and notifications.member_id = ${me}
      and notifications.read_at is null
      -- at은 프로토콜 경계(isoTs)에서 밀리초로 잘린 에코라, 원본(마이크로초)과 그대로
      -- 비교하면 같은 세대조차 "더 새롭다"로 판정돼 읽음이 영원히 안 찍힌다
      and date_trunc('milliseconds', notifications.updated_at) <= v.at
  `);
  return reads.map((r) => r.id);
}

/** 발송 도장 — 다이제스트가 같은 행을 다시 쓸어 담지 않게 한다. */
export async function markNotificationsPushed(db: Db, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await db
    .update(notifications)
    .set({ pushedAt: sql`now()` })
    .where(inArray(notifications.id, ids));
}

/** 발송 소유권 선점 — pushed_at이 null인 행만 조건부로 도장 찍고, 실제로 찍힌 id를 돌려준다.
    cron 두 인스턴스가 겹쳐 돌아도 같은 행을 두 번 푸시하지 않는다(찍은 쪽만 보낸다).
    선점 후 발송 전에 죽으면 그 푸시는 유실된다 — 이 앱의 푸시는 어디서나 best-effort고
    인앱 내역 행이 진실이라, 재시도 outbox 대신 이 한 줄 원자성으로 충분하다고 본다. */
export async function claimNotificationsPushed(db: Db, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await db
    .update(notifications)
    .set({ pushedAt: sql`now()` })
    .where(and(inArray(notifications.id, ids), isNull(notifications.pushedAt)))
    .returning({ id: notifications.id });
  return new Set(rows.map((r) => r.id));
}

/** 방해 금지 창 동안 쌓인 미발송·미확인 알림 — 다이제스트 재료.
    이미 앱에서 읽었으면 뺀다(모아서 알려 줄 이유가 없다). */
export async function unpushedQuietRows(
  db: Db,
  me: MemberId,
  sinceIso: string,
): Promise<Notification[]> {
  const rows = await db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.memberId, me),
        isNull(notifications.pushedAt),
        isNull(notifications.readAt),
        ne(notifications.kind, 'system'),
        sql`${notifications.createdAt} >= ${sinceIso}::timestamptz`,
      ),
    )
    .orderBy(notifications.createdAt);
  return rows.map(toNotification);
}

/** 발송 대기 중인 응원 하루 요약 행 전부 — 저녁 요약 푸시 대상.
    날짜로 거르지 않는다: 20시 이후에 생기거나 방해 금지에 걸려 보류된 행은 "오늘" 필터로는
    영영 잡히지 않는다 — 다음 20시에 밀린 요약까지 내보내는 것이 유실보다 낫다.
    앱에서 이미 읽었으면 뺀다(요약해 줄 이유가 없다). */
export async function unpushedReactDailyAll(
  db: Db,
): Promise<Notification[]> {
  const rows = await db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.aggKey, 'react'),
        isNull(notifications.pushedAt),
        isNull(notifications.readAt),
      ),
    )
    .orderBy(notifications.memberId, notifications.day);
  return rows.map(toNotification);
}

/** 보관 기간 지난 내역 정리 — cron 전용. */
export async function deleteOldNotifications(db: Db): Promise<void> {
  await db
    .delete(notifications)
    .where(
      lt(notifications.createdAt, sql`now() - make_interval(days => ${NOTIF_RETENTION_DAYS})`),
    );
}

/** 내 알림 변경분 — 다른 스트림과 같은 (updated_at, id) 키셋 + 90초 안전 지평선.
    보관 기간(30일) 밖의 행은 처음부터 싣지 않는다. */
export async function pullNotifications(
  db: Db,
  me: MemberId,
  cursor: PullCursor | null,
): Promise<{ rows: Notification[]; cursor: PullCursor | null }> {
  const horizonMs = Date.now() - HORIZON_MS;
  const rows = await db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.memberId, me),
        sql`${notifications.createdAt} > now() - make_interval(days => ${NOTIF_RETENTION_DAYS})`,
        cursor
          ? sql`(${notifications.updatedAt}, ${notifications.id}) > (${cursor.ts}::timestamptz, ${cursor.id}::uuid)`
          : undefined,
      ),
    )
    .orderBy(notifications.updatedAt, notifications.id)
    .limit(PAGE);
  const last = rows[rows.length - 1];
  const move = holdOrAdvance(horizonMs, cursor?.ts ?? null, rows.length, last?.updatedAt);
  return {
    rows: rows.map(toNotification),
    cursor:
      move === 'horizon'
        ? { ts: new Date(horizonMs).toISOString(), id: NIL_UUID }
        : move === 'keep'
          ? cursor
          : { ts: last!.updatedAt, id: last!.id },
  };
}

/* ---------- 알림 팬아웃 재료 조회 ---------- */

/** 기록 주인·태그 — 알림의 수신자 판정(mine)과 ctx 문구에 쓴다. */
export async function entryOwners(
  db: Db,
  ids: string[],
): Promise<Map<string, { owner: MemberId; tags: Tag[] }>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: entries.id, memberId: entries.memberId, tag: entries.tag, tags: entries.tags })
    .from(entries)
    .where(inArray(entries.id, ids));
  return new Map(
    rows.map((r) => [
      r.id,
      { owner: r.memberId as MemberId, tags: entryTags({ tag: r.tag, tags: r.tags }) },
    ]),
  );
}

/** 기록별 살아 있는 댓글의 (작성자, 작성 시각) — reply(내 대화가 이어질 때) 판정 재료.
    이번 배치에서 방금 삽입된 댓글은 제외한다(그건 '이전'이 아니다). "이전"의 시각 판정은
    호출부가 새 댓글마다 createdAt으로 거른다 — 팬아웃이 늦는 사이 끼어든 더 나중 댓글의
    작성자를 이전 댓글러로 오인해 reply 배지를 붙이지 않기 위해서다. */
export async function priorCommenters(
  db: Db,
  entryIds: string[],
  excludeCommentIds: string[],
): Promise<Map<string, { m: MemberId; createdAt: string }[]>> {
  if (entryIds.length === 0) return new Map();
  const rows = await db
    .select({
      entryId: comments.entryId,
      memberId: comments.memberId,
      createdAt: comments.createdAt,
    })
    .from(comments)
    .where(
      and(
        inArray(comments.entryId, entryIds),
        isNull(comments.deletedAt),
        excludeCommentIds.length ? notInArray(comments.id, excludeCommentIds) : undefined,
      ),
    );
  const map = new Map<string, { m: MemberId; createdAt: string }[]>();
  for (const r of rows) {
    const list = map.get(r.entryId) ?? [];
    list.push({ m: r.memberId as MemberId, createdAt: isoTs(r.createdAt) });
    map.set(r.entryId, list);
  }
  return map;
}

/* ---------- 개인 커스텀 태그 설정 ---------- */

function toTagPrefs(r: typeof tagPrefs.$inferSelect): TagPrefs {
  return {
    m: r.memberId as MemberId,
    // jsonb는 손상된 값도 담을 수 있으므로 GET 경계에서도 공용 규칙을 다시 적용한다.
    tags: normalizeCustomTagList(r.tags),
    updatedAt: isoTs(r.updatedAt),
  };
}

function defaultTagPrefs(m: MemberId): TagPrefs {
  return { m, tags: [], updatedAt: new Date(0).toISOString() };
}

export async function getTagPrefs(db: Db, me: MemberId): Promise<TagPrefs> {
  const [row] = await db.select().from(tagPrefs).where(eq(tagPrefs.memberId, me)).limit(1);
  return row ? toTagPrefs(row) : defaultTagPrefs(me);
}

/** 커스텀 태그 목록 저장 — 액션 시각이 기존 값보다 엄격히 새울 때만 반영한다.
    목록은 HTTP 경계에서 정화했더라도 DB 경계에서 한 번 더 같은 정의를 적용한다. */
export async function putTagPrefs(
  db: Db,
  me: MemberId,
  p: { tags: unknown; at: string },
): Promise<{ prefs: TagPrefs; applied: boolean }> {
  const values = {
    memberId: me,
    tags: normalizeCustomTagList(p.tags),
    updatedAt: p.at,
  };
  const [row] = await db
    .insert(tagPrefs)
    .values(values)
    .onConflictDoUpdate({
      target: tagPrefs.memberId,
      set: { tags: sql`excluded.tags`, updatedAt: sql`excluded.updated_at` },
      setWhere: sql`excluded.updated_at > ${tagPrefs.updatedAt}`,
    })
    .returning();
  if (row) return { prefs: toTagPrefs(row), applied: true };
  const [current] = await db.select().from(tagPrefs).where(eq(tagPrefs.memberId, me)).limit(1);
  return { prefs: toTagPrefs(current!), applied: false };
}

/* ---------- 알림 설정 ---------- */

function asMode(v: unknown): NotifMode | null {
  return (NOTIF_MODES as readonly unknown[]).includes(v) ? (v as NotifMode) : null;
}

/** perMember jsonb 정화 — 유효한 멤버 키·모드만 남긴다(jsonb는 무엇이든 들어올 수 있는 자리). */
function sanitizePerMember(v: unknown): Partial<Record<MemberId, NotifMode>> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const out: Partial<Record<MemberId, NotifMode>> = {};
  for (const [k, raw] of Object.entries(v)) {
    const mode = asMode(raw);
    if (mode && (MEMBER_IDS as readonly string[]).includes(k)) out[k as MemberId] = mode;
  }
  return out;
}

function toNotifPrefs(r: typeof notifPrefs.$inferSelect): NotifPrefs {
  return {
    m: r.memberId as MemberId,
    startMode: asMode(r.startMode) ?? DEFAULT_NOTIF_PREFS.startMode,
    perMember: sanitizePerMember(r.perMember),
    cmMine: r.cmMine,
    cmReply: r.cmReply,
    cmAll: r.cmAll,
    reactMode: asMode(r.reactMode) ?? DEFAULT_NOTIF_PREFS.reactMode,
    quietEnabled: r.quietEnabled,
    quietFrom: r.quietFrom,
    quietTo: r.quietTo,
    updatedAt: isoTs(r.updatedAt),
  };
}

function defaultPrefs(m: MemberId): NotifPrefs {
  return { m, ...DEFAULT_NOTIF_PREFS, updatedAt: new Date(0).toISOString() };
}

export async function getNotifPrefs(db: Db, me: MemberId): Promise<NotifPrefs> {
  const [row] = await db.select().from(notifPrefs).where(eq(notifPrefs.memberId, me)).limit(1);
  return row ? toNotifPrefs(row) : defaultPrefs(me);
}

/** 전원 설정 — 행이 없는 멤버는 기본값. 팬아웃이 수신자마다 이걸로 게이트한다. */
export async function allNotifPrefs(db: Db): Promise<Record<MemberId, NotifPrefs>> {
  const rows = await db.select().from(notifPrefs);
  const byId = new Map(rows.map((r) => [r.memberId, toNotifPrefs(r)]));
  return Object.fromEntries(
    MEMBER_IDS.map((m) => [m, byId.get(m) ?? defaultPrefs(m)]),
  ) as Record<MemberId, NotifPrefs>;
}

/** 설정 저장 — 마지막 저장이 이긴다(설정 화면은 항상 서버 값을 먼저 읽고 고친다). */
export async function putNotifPrefs(
  db: Db,
  me: MemberId,
  p: Omit<NotifPrefs, 'm' | 'updatedAt'>,
): Promise<NotifPrefs> {
  const values = {
    memberId: me,
    startMode: p.startMode,
    perMember: p.perMember,
    cmMine: p.cmMine,
    cmReply: p.cmReply,
    cmAll: p.cmAll,
    reactMode: p.reactMode,
    quietEnabled: p.quietEnabled,
    quietFrom: p.quietFrom,
    quietTo: p.quietTo,
  };
  const [row] = await db
    .insert(notifPrefs)
    .values(values)
    .onConflictDoUpdate({
      target: notifPrefs.memberId,
      set: { ...values, updatedAt: sql`now()` },
    })
    .returning();
  return toNotifPrefs(row!);
}
