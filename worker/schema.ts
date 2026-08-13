import { pgTable, uuid, text, integer, jsonb, timestamp, date, index, boolean } from 'drizzle-orm/pg-core';

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

/** 웹 푸시 구독 — 기기(브라우저)당 1행. endpoint가 곧 기기 식별자다. */
export const pushSubs = pgTable('push_subs', {
  endpoint: text('endpoint').primaryKey(),
  memberId: text('member_id').notNull(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
});
