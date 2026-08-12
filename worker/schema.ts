import { pgTable, uuid, text, integer, jsonb, timestamp, date, index } from 'drizzle-orm/pg-core';

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
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'string' }),
  },
  (t) => [index('entries_updated_at_id_idx').on(t.updatedAt, t.id)],
);
