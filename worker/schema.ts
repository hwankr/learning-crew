import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  date,
  index,
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
    tag: text('tag').notNull(),
    stars: integer('stars'),
    memo: text('memo').notNull().default(''),
    body: text('body').notNull().default(''),
    todos: jsonb('todos').notNull().default([]),
    // 서버 리비전 — push CAS의 기준. 갱신마다 +1, 클라이언트는 pull로 받은 값을 base로 되돌려 보낸다.
    version: integer('version').notNull().default(1),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'string' }),
  },
  (t) => [index('entries_updated_at_id_idx').on(t.updatedAt, t.id)],
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

/** 웹 푸시 구독 — 기기(브라우저)당 1행. endpoint가 곧 기기 식별자다. */
export const pushSubs = pgTable('push_subs', {
  endpoint: text('endpoint').primaryKey(),
  memberId: text('member_id').notNull(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
});
