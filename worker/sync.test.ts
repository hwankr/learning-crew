/* 동기화 SQL의 실제 동작 검증 — PGlite(진짜 Postgres)로 마이그레이션을 적용하고
   Worker와 동일한 쿼리 코드를 실행한다. */
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { pushEntries, pullSince, type Db } from './queries';
import type { Entry, PullCursor } from '../shared/types';

let db: Db;

function entry(partial: Partial<Entry> & Pick<Entry, 'id' | 'm'>): Entry {
  return {
    day: '2026-08-12',
    time: '10:00',
    tag: '영어',
    stars: 3,
    memo: '',
    body: '',
    todos: [],
    updatedAt: new Date().toISOString(),
    deletedAt: null,
    ...partial,
  };
}

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

beforeAll(async () => {
  const pg = new PGlite();
  const migration = readdirSync('migrations').find((f) => f.endsWith('.sql'));
  const ddl = readFileSync(`migrations/${migration}`, 'utf8');
  for (const stmt of ddl.split('--> statement-breakpoint')) await pg.exec(stmt);
  db = drizzle(pg) as unknown as Db;
});

describe('sync queries', () => {
  let cursor: PullCursor | null = null;

  it('push는 새 행을 넣고 pull은 전부 돌려준다', async () => {
    await pushEntries(db, [entry({ id: A, m: 'sh', memo: '첫 기록' }), entry({ id: B, m: 'sh' })], 'sh');
    const r = await pullSince(db, null);
    expect(r.rows).toHaveLength(2);
    expect(r.cursor).not.toBeNull();
    cursor = r.cursor;
  });

  it('같은 id 재전송은 멱등 업데이트이고, 커서 이후 pull에 그 행만 나온다', async () => {
    await pushEntries(db, [entry({ id: A, m: 'sh', memo: '수정된 기록', stars: 5 })], 'sh');
    const r = await pullSince(db, cursor);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]!.id).toBe(A);
    expect(r.rows[0]!.memo).toBe('수정된 기록');
    cursor = r.cursor;
  });

  it('남의 행은 같은 id로 덮어쓸 수 없다 (setWhere 가드)', async () => {
    await pushEntries(db, [entry({ id: A, m: 'wg', memo: '탈취 시도' })], 'wg');
    const r = await pullSince(db, null);
    const rowA = r.rows.find((x) => x.id === A)!;
    expect(rowA.m).toBe('sh');
    expect(rowA.memo).toBe('수정된 기록');
    // 갱신이 일어나지 않았으니 커서 이후 pull에도 나타나지 않는다
    const r2 = await pullSince(db, cursor);
    expect(r2.rows).toHaveLength(0);
  });

  it('soft delete가 변경으로 전파된다', async () => {
    await pushEntries(db, [entry({ id: B, m: 'sh', deletedAt: new Date().toISOString() })], 'sh');
    const r = await pullSince(db, cursor);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]!.id).toBe(B);
    expect(r.rows[0]!.deletedAt).not.toBeNull();
  });

  it('OFF 태그는 별점이 null로 강제된다', async () => {
    const C = '33333333-3333-4333-8333-333333333333';
    await pushEntries(db, [entry({ id: C, m: 'th', tag: 'OFF', stars: 4 })], 'th');
    const r = await pullSince(db, null);
    expect(r.rows.find((x) => x.id === C)!.stars).toBeNull();
  });
});
