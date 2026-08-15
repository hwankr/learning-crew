import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  date,
  index,
  uniqueIndex,
  boolean,
  primaryKey,
} from 'drizzle-orm/pg-core';

export const entries = pgTable(
  'entries',
  {
    id: uuid('id').primaryKey(),
    memberId: text('member_id').notNull(),
    day: date('day').notNull(),
    time: text('time').notNull(),
    // 구버전 호환 대표 태그 — 서버가 tags에서 다시 계산해 넣는다(클라이언트 값은 신뢰하지 않는다)
    tag: text('tag').notNull(),
    // 다중 선택된 공부 종류. 기존 행은 마이그레이션이 [tag]로 백필한다
    tags: jsonb('tags').notNull().default([]),
    stars: integer('stars'),
    memo: text('memo').notNull().default(''),
    body: text('body').notNull().default(''),
    todos: jsonb('todos').notNull().default([]),
    // R2 바이너와 분리된 표시용 메타 — 기존 행/구버전 클라이언트는 빈 배열
    photos: jsonb('photos').notNull().default([]),
    // 서버 리비전 — push CAS의 기준. 갱신마다 +1, 클라이언트는 pull로 받은 값을 base로 되돌려 보낸다.
    version: integer('version').notNull().default(1),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'string' }),
  },
  (t) => [index('entries_updated_at_id_idx').on(t.updatedAt, t.id)],
);

/** 삭제된 photo id를 영구 기억하는 원장 겸 R2 정리 큐.
    entry 변경과 같은 DB 문장 안에서 트리거가 넣어 메타가 먼저 사라져도 photo id를 잃지 않고,
    정리가 끝난 뒤에도 행을 남겨 구버전 클라이언트가 같은 id를 되살리지 못하게 한다. */
export const photoTombstones = pgTable(
  'photo_tombstones',
  {
    photoId: uuid('photo_id').notNull(),
    // 같은 UUID를 다른 멤버가 자기 기록에 주입해도 소유자의 삭제 원장을 대신 만들 수 없다.
    owner: text('owner').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
    cleanedAt: timestamp('cleaned_at', { withTimezone: true, mode: 'string' }),
    attemptCount: integer('attempt_count').notNull().default(0),
    lastError: text('last_error'),
    firstFailedAt: timestamp('first_failed_at', { withTimezone: true, mode: 'string' }),
    // cleanup이 R2 삭제를 마친 뒤 늦은 PUT이 재무장한 세대를 옛 ACK가 닫지 못하게 하는 CAS 값.
    cleanupGeneration: integer('cleanup_generation').notNull().default(0),
  },
  (t) => [
    primaryKey({ name: 'photo_tombstones_photo_id_owner_pk', columns: [t.photoId, t.owner] }),
  ],
);

/** 지금 상태 — 멤버당 1행을 덮어쓴다. 컬럼명 is_on은 SQL 예약어(on) 회피. */
export const status = pgTable('status', {
  memberId: text('member_id').primaryKey(),
  on: boolean('is_on').notNull().default(false),
  place: text('place'),
  since: timestamp('since', { withTimezone: true, mode: 'string' }),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  // 마지막으로 크루에게 푸시를 보낸 시각 — 껐켰다 반복 스팸 방지 쿨다운의 기준
  lastNotifiedAt: timestamp('last_notified_at', { withTimezone: true, mode: 'string' }),
});

/* 댓글·리액션은 entries에 외래키를 걸지 않는다: 내 기기에서 방금 쓴(아직 push 안 된)
   기록에도 바로 댓글을 달 수 있어야 하는데, 그 기록의 push가 충돌로 밀리면 FK 위반이
   배치 전체를 죽인다. 고아 행은 클라이언트가 그냥 표시하지 않으면 그만이라 인덱스만 둔다. */

/** 댓글 — 내용 불변 + soft delete. pull 커서는 (updated_at, id) 키셋. */
export const comments = pgTable(
  'comments',
  {
    id: uuid('id').primaryKey(),
    entryId: uuid('entry_id').notNull(),
    memberId: text('member_id').notNull(),
    body: text('body').notNull(),
    // 작성 기기 시각 — 표시·정렬 기준. updated_at은 서버 시계라 커서 전용이다.
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'string' }),
  },
  (t) => [
    index('comments_updated_at_id_idx').on(t.updatedAt, t.id),
    index('comments_entry_id_idx').on(t.entryId),
  ],
);

/** 리액션 — 기록×멤버당 1행(이모지 집합). acted_at은 LWW 기준, updated_at은 커서 기준. */
export const reactions = pgTable(
  'reactions',
  {
    entryId: uuid('entry_id').notNull(),
    memberId: text('member_id').notNull(),
    emojis: jsonb('emojis').notNull().default([]),
    actedAt: timestamp('acted_at', { withTimezone: true, mode: 'string' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.entryId, t.memberId] }),
    index('reactions_updated_at_idx').on(t.updatedAt, t.entryId, t.memberId),
  ],
);

/** 알림 내역 — 수신자(member_id)별 행. 댓글·리액션과 같은 이유로 entries에 FK를 걸지 않는다.
    agg_key는 "같은 날 같은 이유"의 중복·집계를 원자적으로 처리하는 자연키다:
    · 'start:<actor>' — 하루 1회 시작 알림의 중복 방지 (ON CONFLICT DO NOTHING)
    · 'react'         — 응원 하루 요약 집계 행 (ON CONFLICT DO UPDATE로 count 누적)
    · 'quiet'         — 방해 금지 다이제스트 하루 1행
    null이면 유니크가 걸리지 않는다(Postgres 유니크는 null끼리 서로 다름) — 일반 행은 null. */
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    memberId: text('member_id').notNull(),
    kind: text('kind').notNull(),
    why: text('why').notNull(),
    actor: text('actor'),
    entryId: uuid('entry_id'),
    quote: text('quote').notNull().default(''),
    ctx: text('ctx').notNull().default(''),
    actors: jsonb('actors').notNull().default([]),
    count: integer('count').notNull().default(1),
    // KST 기준 사건 날짜 — 표시용이 아니라 agg_key 유니크의 일부
    day: date('day').notNull(),
    aggKey: text('agg_key'),
    // null = 아직 기기 푸시가 나가지 않음(방해 금지 이월분·하루 요약 대기분) — cron이 쓸어 담는 기준
    pushedAt: timestamp('pushed_at', { withTimezone: true, mode: 'string' }),
    readAt: timestamp('read_at', { withTimezone: true, mode: 'string' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  },
  (t) => [
    index('notifications_updated_at_id_idx').on(t.updatedAt, t.id),
    index('notifications_member_created_idx').on(t.memberId, t.createdAt),
    uniqueIndex('notifications_agg_uq').on(t.memberId, t.day, t.aggKey),
  ],
);

/** 알림 설정 — 멤버당 1행, 없으면 DEFAULT_NOTIF_PREFS로 취급한다.
    Worker가 생성·발송을 게이트해야 해서(푸시는 서버가 쏜다) 서버 저장이 필수다. */
export const notifPrefs = pgTable('notif_prefs', {
  memberId: text('member_id').primaryKey(),
  startMode: text('start_mode').notNull().default('daily'),
  perMember: jsonb('per_member').notNull().default({}),
  cmMine: boolean('cm_mine').notNull().default(true),
  cmReply: boolean('cm_reply').notNull().default(true),
  cmAll: boolean('cm_all').notNull().default(false),
  reactMode: text('react_mode').notNull().default('daily'),
  quietEnabled: boolean('quiet_enabled').notNull().default(true),
  quietFrom: text('quiet_from').notNull().default('22:00'),
  quietTo: text('quiet_to').notNull().default('07:00'),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
});

/** 개인 커스텀 태그 목록 — 멤버당 1행. updated_at은 저장 도착 시각이 아니라
    클라이언트 액션 시각이며, 오프라인 변경의 LWW 기준으로 쓴다. */
export const tagPrefs = pgTable('tag_prefs', {
  memberId: text('member_id').primaryKey(),
  tags: jsonb('tags').notNull().default([]),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull(),
});

/** 웹 푸시 구독 — 기기(브라우저)당 1행. endpoint가 곧 기기 식별자다. */
export const pushSubs = pgTable('push_subs', {
  endpoint: text('endpoint').primaryKey(),
  memberId: text('member_id').notNull(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
});
