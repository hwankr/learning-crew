/* 동기화 SQL의 실제 동작 검증 — PGlite(진짜 Postgres)로 마이그레이션을 적용하고
   Worker와 동일한 쿼리 코드를 실행한다. */
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { sql } from 'drizzle-orm';
import {
  pushEntries,
  pushEntriesLegacy,
  pullSince,
  setStatus,
  allStatuses,
  getStatusRow,
  claimNotifySlot,
  upsertPushSub,
  deletePushSub,
  deleteGonePushSub,
  pushSubsExcept,
  pushComments,
  pullComments,
  pushReactions,
  pullReactions,
  NIL_UUID,
  type Db,
} from './queries';
import { invalidReason } from './validation';
import { NOTIFY_COOLDOWN_MS, shouldNotify } from './push';
import {
  STATUS_TTL_MS,
  canonicalUuid,
  isStatusActive,
  normalizeEmojis,
  primaryTag,
} from '../shared/types';
import type {
  Comment,
  Entry,
  MemberStatus,
  PullCursor,
  ReactionCursor,
  ReactionSet,
} from '../shared/types';

let db: Db;

/** tag는 tags의 파생값이라 픽스처가 직접 정하지 않는다 — 항상 primaryTag(tags)다.
    (구버전 클라이언트를 흉내 내려면 tags를 뺀 행을 직접 만들어야 한다 — 아래 레거시 테스트) */
function entry(partial: Partial<Entry> & Pick<Entry, 'id' | 'm'>): Entry {
  const row: Entry = {
    day: '2026-08-12',
    time: '10:00',
    tag: '영어',
    tags: ['영어'],
    stars: 3,
    memo: '',
    body: '',
    todos: [],
    v: 0,
    updatedAt: new Date().toISOString(),
    deletedAt: null,
    ...partial,
  };
  return { ...row, tag: primaryTag(row.tags) };
}

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

describe('entry push validation', () => {
  it('비-OFF의 null 별점과 OFF의 숫자 별점을 모두 허용해 저장 경계에서 보정한다', () => {
    expect(invalidReason(entry({ id: A, m: 'sh', tags: ['영어'], stars: null }), 'sh')).toBeNull();
    expect(invalidReason(entry({ id: A, m: 'sh', tags: ['OFF'], stars: 4 }), 'sh')).toBeNull();
    expect(invalidReason(entry({ id: A, m: 'sh', tags: ['영어'], stars: 0 }), 'sh')).toBe(
      'bad stars',
    );
  });

  it('tags의 빈 배열·중복·유효하지 않은 원소를 배치 SQL 전에 거부한다', () => {
    expect(invalidReason(entry({ id: A, m: 'sh', tags: [] }), 'sh')).toBe('bad tags');
    expect(invalidReason(entry({ id: A, m: 'sh', tags: ['영어', '영어'] }), 'sh')).toBe(
      'bad tags',
    );
    expect(
      invalidReason(entry({ id: A, m: 'sh', tags: ['영어', '수학'] as Entry['tags'] }), 'sh'),
    ).toBe('bad tags');
  });

  it('tags가 없는 구버전 행은 tag를 검사하고, tags가 있으면 어긋난 tag를 신뢰하지 않는다', () => {
    const { tags: _omit, ...legacy } = entry({ id: A, m: 'sh', tags: ['영어'] });
    expect(invalidReason(legacy as Entry, 'sh')).toBeNull();
    expect(invalidReason({ ...entry({ id: A, m: 'sh', tags: ['영어'] }), tag: 'OFF' }, 'sh')).toBeNull();
  });
});

/** 모든 행을 10분 과거로 — 커서가 안전 지평선에 안 걸리고 키셋으로 전진하게 한다. */
async function ageAll(): Promise<void> {
  await db.execute(sql`update entries set updated_at = updated_at - interval '10 minutes'`);
}
async function ageComments(): Promise<void> {
  await db.execute(sql`update comments set updated_at = updated_at - interval '10 minutes'`);
}
/** 리액션은 ms로 잘라 두고 늙힌다 — 아래 커서 테스트가 행의 ISO updatedAt으로 커서를 만드는데,
    Postgres는 마이크로초까지 저장해서 ISO(ms)로는 그 행을 넘어서지 못한다.
    (실제 클라이언트는 서버가 준 커서를 그대로 되돌려 보내므로 이 문제가 없다.) */
async function ageReactions(): Promise<void> {
  await db.execute(
    sql`update reactions set updated_at = date_trunc('milliseconds', updated_at - interval '10 minutes')`,
  );
}

/** 프로토콜 경계에 나가는 타임스탬프는 항상 ISO여야 한다 — pg 텍스트 형식은 iOS Safari가 못 읽는다. */
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

beforeAll(async () => {
  const pg = new PGlite();
  for (const migration of readdirSync('migrations').filter((f) => f.endsWith('.sql')).sort()) {
    const ddl = readFileSync(`migrations/${migration}`, 'utf8');
    for (const stmt of ddl.split('--> statement-breakpoint')) await pg.exec(stmt);
  }
  db = drizzle(pg) as unknown as Db;
});

describe('다중 태그 DB 마이그레이션', () => {
  it('0005가 마이그레이션 전 기존 행을 대표 태그 한 개짜리 배열로 백필한다', async () => {
    const pg = new PGlite();
    try {
      const migrations = readdirSync('migrations').filter((f) => f.endsWith('.sql')).sort();
      const multiTagMigration = migrations.find((f) => f.startsWith('0005_'));
      expect(multiTagMigration).toBeDefined();

      for (const migration of migrations.filter((f) => f < multiTagMigration!)) {
        const ddl = readFileSync(`migrations/${migration}`, 'utf8');
        for (const stmt of ddl.split('--> statement-breakpoint')) await pg.exec(stmt);
      }
      await pg.exec(`
        insert into entries (id, member_id, day, time, tag, stars)
        values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'sh', '2026-08-12', '10:00', '영어', 3)
      `);

      const ddl = readFileSync(`migrations/${multiTagMigration!}`, 'utf8');
      for (const stmt of ddl.split('--> statement-breakpoint')) await pg.exec(stmt);
      const result = await pg.query<{ tag: string; tags: unknown }>(
        `select tag, tags from entries where id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'`,
      );
      expect(result.rows).toEqual([{ tag: '영어', tags: ['영어'] }]);
    } finally {
      await pg.close();
    }
  });
});

describe('sync queries', () => {
  let cursor: PullCursor | null = null;

  it('push는 새 행을 넣고(v0 → version 1) pull은 전부 돌려준다', async () => {
    const out = await pushEntries(
      db,
      [entry({ id: A, m: 'sh', memo: '첫 기록' }), entry({ id: B, m: 'sh' })],
      'sh',
    );
    expect(out.applied.map((e) => e.id).sort()).toEqual([A, B].sort());
    expect(out.conflicts).toHaveLength(0);
    expect(out.applied.find((e) => e.id === A)!.v).toBe(1);
    // 프로토콜 경계의 타임스탬프는 항상 ISO — pg 텍스트 형식은 Safari가 파싱하지 못한다
    expect(out.applied[0]!.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    await ageAll();
    const r = await pullSince(db, null);
    expect(r.rows).toHaveLength(2);
    expect(r.rows.every((x) => x.v === 1)).toBe(true);
    expect(r.cursor).not.toBeNull();
    cursor = r.cursor;
  });

  it('base 버전이 맞는 수정은 반영되고 version이 올라간다', async () => {
    const out = await pushEntries(db, [entry({ id: A, m: 'sh', memo: '수정된 기록', stars: 5, v: 1 })], 'sh');
    expect(out.applied).toHaveLength(1);
    expect(out.applied[0]!.v).toBe(2);
    await ageAll();
    const r = await pullSince(db, cursor);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]!.id).toBe(A);
    expect(r.rows[0]!.memo).toBe('수정된 기록');
    cursor = r.cursor;
  });

  it('오래된 base로 push하면 CAS 충돌 — 서버의 현재 행을 돌려준다', async () => {
    // 다른 기기가 v1을 base로 뒤늦게 수정 시도 (서버는 이미 v2)
    const out = await pushEntries(db, [entry({ id: A, m: 'sh', memo: '뒤늦은 수정', v: 1 })], 'sh');
    expect(out.applied).toHaveLength(0);
    expect(out.conflicts).toHaveLength(1);
    expect(out.conflicts[0]!.memo).toBe('수정된 기록'); // 서버 내용 그대로
    expect(out.conflicts[0]!.v).toBe(2);
  });

  it('반영 없는 재전송(잃어버린 응답 재시도)도 충돌로 현재 행을 에코한다', async () => {
    // v1 → v2 push가 성공했는데 응답을 잃은 경우: 같은 내용을 v1 base로 재전송
    const out = await pushEntries(db, [entry({ id: A, m: 'sh', memo: '수정된 기록', stars: 5, v: 1 })], 'sh');
    expect(out.applied).toHaveLength(0);
    expect(out.conflicts[0]!.memo).toBe('수정된 기록'); // 내용이 같아 클라이언트가 ACK 처리 가능
  });

  it('남의 행은 같은 id로 덮어쓸 수 없다 (setWhere 가드)', async () => {
    const out = await pushEntries(db, [entry({ id: A, m: 'wg', memo: '탈취 시도', v: 2 })], 'wg');
    expect(out.applied).toHaveLength(0);
    expect(out.conflicts[0]!.m).toBe('sh');
    const r = await pullSince(db, null);
    const rowA = r.rows.find((x) => x.id === A)!;
    expect(rowA.m).toBe('sh');
    expect(rowA.memo).toBe('수정된 기록');
    // 갱신이 일어나지 않았으니 커서 이후 pull에도 나타나지 않는다
    const r2 = await pullSince(db, cursor);
    expect(r2.rows).toHaveLength(0);
  });

  it('soft delete가 변경으로 전파된다', async () => {
    const out = await pushEntries(
      db,
      [entry({ id: B, m: 'sh', deletedAt: new Date().toISOString(), v: 1 })],
      'sh',
    );
    expect(out.applied).toHaveLength(1);
    const r = await pullSince(db, cursor);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]!.id).toBe(B);
    expect(r.rows[0]!.deletedAt).not.toBeNull();
  });

  it('삭제된 행을 오래된 base로 수정하면 충돌 — tombstone이 돌아와 부활하지 않는다', async () => {
    // 오프라인 기기가 삭제 전 버전(v1)을 base로 수정을 밀어 올리는 시나리오
    const out = await pushEntries(db, [entry({ id: B, m: 'sh', memo: '부활 시도', v: 1 })], 'sh');
    expect(out.applied).toHaveLength(0);
    expect(out.conflicts).toHaveLength(1);
    expect(out.conflicts[0]!.deletedAt).not.toBeNull(); // 클라이언트는 삭제 승리로 처리한다
  });

  it('비-OFF+null 행이 섞인 배치도 검증과 저장을 정상 통과한다', async () => {
    const noRatingId = '33333333-3333-4333-8333-333333333334';
    const ratedId = '33333333-3333-4333-8333-333333333335';
    const batch = [
      entry({ id: noRatingId, m: 'th', tags: ['기타'], stars: null }),
      entry({ id: ratedId, m: 'th', tags: ['영어'], stars: 4 }),
    ];
    expect(batch.map((row) => invalidReason(row, 'th'))).toEqual([null, null]);

    const out = await pushEntries(db, batch, 'th');
    expect(out.conflicts).toHaveLength(0);
    expect(out.applied.map((row) => row.id).sort()).toEqual([noRatingId, ratedId].sort());
    expect(out.applied.find((row) => row.id === noRatingId)!.stars).toBeNull();
  });

  it('기존 비-OFF+null 행을 pull해 할 일을 수정한 뒤 재push해도 막히지 않는다', async () => {
    const noRatingId = '33333333-3333-4333-8333-333333333334';
    const pulled = (await pullSince(db, null)).rows.find((row) => row.id === noRatingId)!;
    expect(pulled.tags).toEqual(['기타']);
    expect(pulled.stars).toBeNull();

    const edited: Entry = {
      ...pulled,
      todos: [{ t: '레거시 기록도 체크', done: true }],
    };
    expect(invalidReason(edited, 'th')).toBeNull();
    const out = await pushEntries(db, [edited], 'th');
    expect(out.conflicts).toHaveLength(0);
    expect(out.applied[0]!.v).toBe(pulled.v + 1);
    expect(out.applied[0]!.stars).toBeNull();
    expect(out.applied[0]!.todos).toEqual([{ t: '레거시 기록도 체크', done: true }]);

    const roundTrip = (await pullSince(db, null)).rows.find((row) => row.id === noRatingId)!;
    expect(roundTrip.stars).toBeNull();
    expect(roundTrip.todos[0]!.done).toBe(true);
  });

  it('OFF 태그는 별점이 null로 강제된다', async () => {
    const C = '33333333-3333-4333-8333-333333333333';
    await pushEntries(db, [entry({ id: C, m: 'th', tags: ['OFF'], stars: 4 })], 'th');
    const r = await pullSince(db, null);
    expect(r.rows.find((x) => x.id === C)!.stars).toBeNull();
  });
});

describe('다중 태그', () => {
  const M1 = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1';
  const M2 = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd2';
  const M3 = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd3';

  it('여러 태그가 그대로 왕복하고 tag는 대표 태그로 저장된다', async () => {
    const out = await pushEntries(
      db,
      [entry({ id: M1, m: 'sh', tags: ['기타', '자격증'] })], // 입력 순서가 뒤섞여 있어도
      'sh',
    );
    // 정규화가 TAGS 순서로 고정한다 — 순서가 흔들리면 헛 동기화가 돈다
    expect(out.applied[0]!.tags).toEqual(['자격증', '기타']);
    expect(out.applied[0]!.tag).toBe('자격증');
    const r = await pullSince(db, null);
    const row = r.rows.find((x) => x.id === M1)!;
    expect(row.tags).toEqual(['자격증', '기타']);
    expect(row.tag).toBe('자격증');
  });

  it('수정으로 태그를 바꾸면 반영된다 (CONTENT_SET에 tags가 빠지면 여기서 걸린다)', async () => {
    const out = await pushEntries(
      db,
      [entry({ id: M1, m: 'sh', tags: ['영어', '코딩테스트'], v: 1 })],
      'sh',
    );
    expect(out.applied[0]!.tags).toEqual(['영어', '코딩테스트']);
    expect(out.applied[0]!.tag).toBe('영어');
    const r = await pullSince(db, null);
    expect(r.rows.find((x) => x.id === M1)!.tags).toEqual(['영어', '코딩테스트']);
  });

  it('tags 없이 tag만 보내는 구버전 클라이언트도 tags가 파생된다', async () => {
    // 구버전 번들은 tags라는 필드를 아예 모른다 — 그 행을 그대로 흉내 낸다
    const { tags: _omit, ...legacyRow } = entry({ id: M2, m: 'sh', tags: ['코딩테스트'] });
    const out = await pushEntries(db, [legacyRow as Entry], 'sh');
    expect(out.applied[0]!.tags).toEqual(['코딩테스트']);
    expect(out.applied[0]!.tag).toBe('코딩테스트');
    // 레거시(v 없는) push 경로도 같은 파생을 지난다
    const { v: _v, tags: _omit2, ...legacyNoV } = entry({ id: M3, m: 'sh', tags: ['OFF'] });
    const applied = await pushEntriesLegacy(db, [legacyNoV as Omit<Entry, 'v'>], 'sh');
    expect(applied[0]!.tags).toEqual(['OFF']);
    expect(applied[0]!.stars).toBeNull(); // OFF 판정도 tags 기준이다
  });

  it('클라이언트가 tag/tags를 어긋나게 보내도 서버가 tags 기준으로 고친다', async () => {
    const bad: Entry = { ...entry({ id: M2, m: 'sh', tags: ['영어', '기타'], v: 1 }), tag: 'OFF' };
    const out = await pushEntries(db, [bad], 'sh');
    expect(out.applied[0]!.tag).toBe('영어'); // 보낸 tag를 믿지 않는다
    expect(out.applied[0]!.tags).toEqual(['영어', '기타']);
    expect(out.applied[0]!.stars).not.toBeNull(); // OFF가 아니므로 별점이 살아 있다
  });

  it('tags가 비어 저장된 구버전 행도 읽을 때 tag에서 되살아난다 (백필 전 행)', async () => {
    await db.execute(sql`update entries set tags = '[]'::jsonb where id = ${M1}::uuid`);
    const r = await pullSince(db, null);
    const row = r.rows.find((x) => x.id === M1)!;
    expect(row.tags).toEqual([row.tag]);
    expect(row.tags.length).toBe(1);
  });
});

describe('pull 커서 안전 지평선', () => {
  const D = '44444444-4444-4444-8444-444444444444';
  const E = '55555555-5555-4555-8555-555555555555';
  let held: PullCursor | null = null;

  it('최근 행이 있으면 커서가 지평선에서 멈춘다', async () => {
    await pushEntries(db, [entry({ id: D, m: 'sh', memo: '지평선 테스트' })], 'sh');
    const r = await pullSince(db, null);
    expect(r.rows.find((x) => x.id === D)).toBeTruthy();
    expect(r.cursor!.id).toBe(NIL_UUID);
    held = r.cursor;
  });

  it('지평선 커서 재-pull은 최근 행을 다시 싣는다 (중복은 클라이언트가 v 비교로 무시)', async () => {
    const r = await pullSince(db, held);
    expect(r.rows.some((x) => x.id === D)).toBe(true);
  });

  it('커서 확보 후 과거 시각으로 커밋된 행(느린 트랜잭션)도 다음 pull에 잡힌다', async () => {
    // updated_at의 now()는 트랜잭션 시작 시각 — 먼저 시작해 늦게 커밋되면
    // 이미 확보된 커서보다 과거 시각으로 나타난다. 그 상황의 시뮬레이션:
    await pushEntries(db, [entry({ id: E, m: 'sh', memo: '늦게 커밋' })], 'sh');
    await db.execute(sql`update entries set updated_at = now() - interval '30 seconds' where id = ${E}`);
    const r = await pullSince(db, held);
    expect(r.rows.some((x) => x.id === E)).toBe(true);
  });

  it('지평선 너머로 방치된 커서는 빈 페이지에서 끌어내려진다 (정확히 500행 페이지 직후 상황)', async () => {
    // 지평선 너머(지금)의 커서를 손에 든 클라이언트 시뮬레이션
    const beyond: PullCursor = { ts: new Date().toISOString(), id: NIL_UUID };
    const r = await pullSince(db, beyond);
    expect(r.rows).toHaveLength(0);
    expect(Date.parse(r.cursor!.ts)).toBeLessThan(Date.parse(beyond.ts)); // 지평선으로 후퇴
    // 끌어내린 커서로 다시 pull하면 최근 행들이 재전달된다 — 늦은 커밋을 놓치지 않는다
    const r2 = await pullSince(db, r.cursor);
    expect(r2.rows.length).toBeGreaterThan(0);
  });

  it('오래된 행만 있으면 키셋 커서로 전진하고 재-pull은 비어 있다', async () => {
    await ageAll();
    const r = await pullSince(db, null);
    expect(r.cursor!.id).not.toBe(NIL_UUID);
    const r2 = await pullSince(db, r.cursor);
    expect(r2.rows).toHaveLength(0);
  });
});

describe('구버전 프로토콜 push (v 없음 — 레거시 LWW)', () => {
  const L = '66666666-6666-4666-8666-666666666666';
  const legacyEntry = (partial: Partial<Entry> & Pick<Entry, 'id' | 'm'>): Omit<Entry, 'v'> => {
    const { v: _v, ...rest } = entry(partial);
    return rest;
  };

  it('신규 행을 넣고 version 1을 준다', async () => {
    const applied = await pushEntriesLegacy(db, [legacyEntry({ id: L, m: 'sh', memo: '레거시' })], 'sh');
    expect(applied).toHaveLength(1);
    expect(applied[0]!.v).toBe(1);
  });

  it('버전과 무관하게 덮어쓰고 version을 올린다 — 새 클라이언트의 v 비교가 변경을 놓치지 않는다', async () => {
    const applied = await pushEntriesLegacy(db, [legacyEntry({ id: L, m: 'sh', memo: '레거시 수정' })], 'sh');
    expect(applied[0]!.memo).toBe('레거시 수정');
    expect(applied[0]!.v).toBe(2);
  });

  it('남의 행은 여전히 덮을 수 없다 (setWhere 가드)', async () => {
    const applied = await pushEntriesLegacy(db, [legacyEntry({ id: L, m: 'wg', memo: '탈취' })], 'wg');
    expect(applied).toHaveLength(0);
    const r = await pullSince(db, null);
    expect(r.rows.find((x) => x.id === L)!.memo).toBe('레거시 수정');
  });
});

describe('status queries', () => {
  const t0 = Date.now();
  const iso = (ms: number) => new Date(ms).toISOString();

  it('켜면 멤버당 1행이 저장되고 저장된 행을 돌려준다', async () => {
    const since = iso(t0);
    const r = await setStatus(db, 'sh', { on: true, place: '도서관', since, at: iso(t0) });
    expect(r.applied).toBe(true);
    expect(r.status.m).toBe('sh');
    expect(r.status.on).toBe(true);
    expect(r.status.place).toBe('도서관');
    // 상태 타임스탬프도 ISO로 정규화되어 나간다 (클라이언트는 사전순 비교에 의존한다)
    expect(r.status.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(r.status.since).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const all = await allStatuses(db);
    expect(all.filter((s) => s.m === 'sh')).toHaveLength(1);
  });

  it('재설정은 같은 행을 덮어쓴다 (끄면 place/since가 비워진다)', async () => {
    const r = await setStatus(db, 'sh', { on: false, place: null, since: null, at: iso(t0 + 1000) });
    expect(r.applied).toBe(true);
    const all = await allStatuses(db);
    const sh = all.find((s) => s.m === 'sh')!;
    expect(sh.on).toBe(false);
    expect(sh.place).toBeNull();
    expect(sh.since).toBeNull();
    expect(all.filter((s) => s.m === 'sh')).toHaveLength(1);
  });

  it('더 오래된 액션 시각은 거부된다 — 뒤늦게 도착한 오프라인 ON이 최신 OFF를 못 덮는다', async () => {
    // 시나리오: 휴대폰이 오프라인에서 t0-10분에 ON → 노트북이 t0+1초에 OFF(위 테스트)
    // → 휴대폰이 재접속해 옛 ON을 밀어 올린다. 도착은 늦지만 액션은 과거 — 거부돼야 한다.
    const stale = await setStatus(db, 'sh', {
      on: true, place: '도서관', since: iso(t0 - 600_000), at: iso(t0 - 600_000),
    });
    expect(stale.applied).toBe(false);
    expect(stale.status.on).toBe(false); // 서버의 현재 상태(OFF)를 돌려준다 — 클라이언트가 채택
    const sh = (await allStatuses(db)).find((s) => s.m === 'sh')!;
    expect(sh.on).toBe(false);
  });

  it('같은 액션 시각의 재전송은 멱등하게 허용된다 (잃어버린 응답 재시도)', async () => {
    const r = await setStatus(db, 'sh', { on: false, place: null, since: null, at: iso(t0 + 1000) });
    expect(r.applied).toBe(true);
  });

  it('멤버별로 행이 따로 쌓인다', async () => {
    await setStatus(db, 'wg', { on: true, place: '카페', since: iso(t0), at: iso(t0) });
    const all = await allStatuses(db);
    expect(all).toHaveLength(2);
    expect(all.find((s) => s.m === 'wg')!.on).toBe(true);
  });
});

describe('isStatusActive (표시 규칙)', () => {
  const now = Date.now();
  const st = (over: Partial<MemberStatus>): MemberStatus => ({
    m: 'sh', on: true, place: '도서관',
    since: new Date(now - 60_000).toISOString(),
    updatedAt: new Date(now).toISOString(),
    ...over,
  });

  it('켜져 있고 TTL 이내면 활성', () => {
    expect(isStatusActive(st({}), now)).toBe(true);
  });
  it('꺼져 있으면 비활성', () => {
    expect(isStatusActive(st({ on: false, since: null }), now)).toBe(false);
  });
  it('끄는 걸 잊어 TTL을 넘기면 비활성으로 표시', () => {
    expect(isStatusActive(st({ since: new Date(now - STATUS_TTL_MS - 1000).toISOString() }), now)).toBe(false);
  });
  it('상태가 아예 없으면 비활성', () => {
    expect(isStatusActive(undefined, now)).toBe(false);
  });
});

describe('shouldNotify (푸시 발송 규칙)', () => {
  const now = Date.now();
  const ago = (ms: number) => new Date(now - ms).toISOString();

  it('첫 켜기(이전 상태 없음)는 알린다', () => {
    expect(shouldNotify(null, true, now)).toBe(true);
  });
  it('off→on 전환은 알린다', () => {
    expect(shouldNotify({ on: false, since: null, lastNotifiedAt: null }, true, now)).toBe(true);
  });
  it('켜진 채 장소만 바꾸면 알리지 않는다', () => {
    expect(shouldNotify({ on: true, since: ago(60_000), lastNotifiedAt: null }, true, now)).toBe(false);
  });
  it('끌 때는 알리지 않는다', () => {
    expect(shouldNotify({ on: false, since: null, lastNotifiedAt: null }, false, now)).toBe(false);
  });
  it('쿨다운 안의 재켜기는 조용히 넘어간다', () => {
    const recent = ago(NOTIFY_COOLDOWN_MS - 60_000);
    expect(shouldNotify({ on: false, since: null, lastNotifiedAt: recent }, true, now)).toBe(false);
  });
  it('쿨다운이 지나면 다시 알린다', () => {
    const old = ago(NOTIFY_COOLDOWN_MS + 60_000);
    expect(shouldNotify({ on: false, since: null, lastNotifiedAt: old }, true, now)).toBe(true);
  });
  it('끄는 걸 잊어 TTL이 지난 on 행은 꺼진 것으로 보고 다음 켜기에 알린다', () => {
    // 어제 아침 켜고 안 끈 사람이 오늘 아침 다시 체크인하는 시나리오
    const stale = ago(STATUS_TTL_MS + 60_000);
    expect(shouldNotify({ on: true, since: stale, lastNotifiedAt: stale }, true, now)).toBe(true);
  });
  it('TTL 이내의 on 행은 여전히 조용하다 (스팸 방지)', () => {
    const fresh = ago(STATUS_TTL_MS - 60_000);
    expect(shouldNotify({ on: true, since: fresh, lastNotifiedAt: fresh }, true, now)).toBe(false);
  });
});

describe('push subscription queries', () => {
  const EP1 = 'https://push.example.com/sub/1';
  const EP2 = 'https://push.example.com/sub/2';

  it('구독 등록 후 본인 제외 목록에 나온다', async () => {
    await upsertPushSub(db, 'sh', { endpoint: EP1, p256dh: 'pk1', auth: 'a1' });
    await upsertPushSub(db, 'wg', { endpoint: EP2, p256dh: 'pk2', auth: 'a2' });
    const forWg = await pushSubsExcept(db, 'wg');
    expect(forWg.map((s) => s.endpoint)).toEqual([EP1]);
  });

  it('같은 endpoint 재등록은 멤버/키를 갱신한다 (기기 주인이 바뀌는 경우)', async () => {
    await upsertPushSub(db, 'th', { endpoint: EP1, p256dh: 'pk1b', auth: 'a1b' });
    const forSh = await pushSubsExcept(db, 'sh');
    const row = forSh.find((s) => s.endpoint === EP1)!;
    expect(row.p256dh).toBe('pk1b');
    // sh 것이 아니게 됐으니 sh 제외 목록에 나타난다
    expect(forSh).toHaveLength(2);
  });

  it('남의 구독은 지울 수 없고 본인 것만 지워진다', async () => {
    await deletePushSub(db, 'sh', EP1); // EP1은 이제 th 소유 — 무시돼야 한다
    expect((await pushSubsExcept(db, 'jj')).map((s) => s.endpoint).sort()).toEqual([EP1, EP2]);
    await deletePushSub(db, 'th', EP1);
    expect((await pushSubsExcept(db, 'jj')).map((s) => s.endpoint)).toEqual([EP2]);
  });

  it('만료 구독(404/410)은 소유와 무관하게 정리된다', async () => {
    await deleteGonePushSub(db, EP2);
    expect(await pushSubsExcept(db, 'jj')).toHaveLength(0);
  });

  it('claimNotifySlot은 첫 선점만 성공한다 — 두 기기 동시 켜기의 중복 발송 방지', async () => {
    const now = new Date().toISOString();
    await setStatus(db, 'jj', { on: true, place: '도서관', since: now, at: now });
    expect((await getStatusRow(db, 'jj'))!.lastNotifiedAt).toBeNull();
    expect(await claimNotifySlot(db, 'jj', NOTIFY_COOLDOWN_MS)).toBe(true);
    expect((await getStatusRow(db, 'jj'))!.lastNotifiedAt).not.toBeNull();
    // 도장이 방금 찍혔으니 쿨다운 안 — 두 번째 선점은 실패한다
    expect(await claimNotifySlot(db, 'jj', NOTIFY_COOLDOWN_MS)).toBe(false);
  });

  it('쿨다운이 지나면 다시 선점할 수 있다', async () => {
    await db.execute(
      sql`update status set last_notified_at = now() - interval '31 minutes' where member_id = 'jj'`,
    );
    expect(await claimNotifySlot(db, 'jj', NOTIFY_COOLDOWN_MS)).toBe(true);
  });
});

/* ---------- 댓글 ---------- */

const C1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const C2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
/** entries에 없는 기록 id — 외래키를 걸지 않았음을 확인하는 데도 쓴다. */
const GHOST = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function comment(p: Partial<Comment> & Pick<Comment, 'id' | 'm' | 'entryId'>): Comment {
  const nowIso = new Date().toISOString();
  return { body: '오늘 고생하셨어요', createdAt: nowIso, updatedAt: nowIso, deletedAt: null, ...p };
}

describe('comment queries', () => {
  it('새 댓글이 저장되고 pull로 받는다 (아직 없는 기록에도 달 수 있다 — 외래키 없음)', async () => {
    const out = await pushComments(
      db,
      [comment({ id: C1, m: 'wg', entryId: A }), comment({ id: C2, m: 'wg', entryId: GHOST })],
      'wg',
    );
    expect(out.applied).toHaveLength(2);
    expect(out.current).toHaveLength(0);
    // 프로토콜 경계의 타임스탬프는 전부 ISO — 서버 시계(updatedAt)도 작성 기기 시각(createdAt)도
    expect(out.applied[0]!.updatedAt).toMatch(ISO_RE);
    expect(out.applied[0]!.createdAt).toMatch(ISO_RE);
    const r = await pullComments(db, null);
    expect(r.rows.map((x) => x.id).sort()).toEqual([C1, C2].sort());
    expect(r.rows.find((x) => x.id === C1)!.body).toBe('오늘 고생하셨어요');
  });

  it('같은 id 재전송은 멱등 — 본문·작성시각을 덮지 않고 현재 행을 돌려준다', async () => {
    const out = await pushComments(
      db,
      [comment({ id: C1, m: 'wg', entryId: A, body: '바꿔치기 시도', createdAt: '2020-01-01T00:00:00.000Z' })],
      'wg',
    );
    expect(out.applied).toHaveLength(0);
    expect(out.current).toHaveLength(1);
    expect(out.current[0]!.body).toBe('오늘 고생하셨어요'); // 클라이언트는 이 행을 채택하고 큐를 비운다
    expect(out.current[0]!.createdAt).not.toContain('2020');
  });

  it('남의 댓글은 지울 수 없다 — 거부되고 살아있는 현재 행이 돌아온다', async () => {
    const out = await pushComments(
      db,
      [comment({ id: C1, m: 'sh', entryId: A, deletedAt: new Date().toISOString() })],
      'sh',
    );
    expect(out.applied).toHaveLength(0);
    expect(out.current[0]!.m).toBe('wg');
    expect(out.current[0]!.deletedAt).toBeNull();
  });

  it('내 댓글 삭제는 tombstone으로 전파되고, 부활 시도는 실패한다 (삭제는 단조)', async () => {
    const del = await pushComments(
      db,
      [comment({ id: C1, m: 'wg', entryId: A, deletedAt: new Date().toISOString() })],
      'wg',
    );
    expect(del.applied).toHaveLength(1);
    expect(del.applied[0]!.deletedAt).not.toBeNull();
    expect(del.applied[0]!.body).toBe('오늘 고생하셨어요'); // 본문은 그대로 — 갱신되는 건 삭제뿐

    // 오프라인 기기가 삭제 전 상태를 밀어 올리는 시나리오 — 되살아나면 안 된다
    const revive = await pushComments(db, [comment({ id: C1, m: 'wg', entryId: A })], 'wg');
    expect(revive.applied).toHaveLength(0);
    expect(revive.current[0]!.deletedAt).not.toBeNull();

    // 삭제 재전송(잃어버린 응답 재시도)도 tombstone을 그대로 에코 — 클라이언트가 큐를 정산할 수 있다
    const again = await pushComments(
      db,
      [comment({ id: C1, m: 'wg', entryId: A, deletedAt: new Date().toISOString() })],
      'wg',
    );
    expect(again.applied).toHaveLength(0);
    expect(again.current[0]!.deletedAt).not.toBeNull();
  });

  it('tombstone도 pull로 전파된다 (다른 기기가 목록에서 지울 수 있게)', async () => {
    const r = await pullComments(db, null);
    expect(r.rows.find((x) => x.id === C1)!.deletedAt).toMatch(ISO_RE);
  });
});

describe('comment pull 커서 안전 지평선', () => {
  let held: PullCursor | null = null;

  it('최근 행이 있으면 커서가 지평선에서 멈춘다', async () => {
    const r = await pullComments(db, null);
    expect(r.rows.length).toBeGreaterThan(0);
    expect(r.cursor!.id).toBe(NIL_UUID);
    held = r.cursor;
  });

  it('지평선 커서 재-pull은 최근 행을 다시 싣는다 (중복은 클라이언트가 updatedAt 비교로 무시)', async () => {
    const r = await pullComments(db, held);
    expect(r.rows.some((x) => x.id === C2)).toBe(true);
  });

  it('지평선 너머로 방치된 커서는 빈 페이지에서 끌어내려진다', async () => {
    const beyond: PullCursor = { ts: new Date().toISOString(), id: NIL_UUID };
    const r = await pullComments(db, beyond);
    expect(r.rows).toHaveLength(0);
    expect(Date.parse(r.cursor!.ts)).toBeLessThan(Date.parse(beyond.ts));
  });

  it('오래된 행만 있으면 키셋 커서로 전진하고 재-pull은 비어 있다', async () => {
    await ageComments();
    const r = await pullComments(db, null);
    expect(r.cursor!.id).not.toBe(NIL_UUID);
    const r2 = await pullComments(db, r.cursor);
    expect(r2.rows).toHaveLength(0);
  });
});

/* ---------- 리액션 ---------- */

const R1 = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';
const R2 = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2';
const R3 = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc3';

function rset(p: Partial<ReactionSet> & Pick<ReactionSet, 'entryId' | 'm'>): ReactionSet {
  const nowIso = new Date().toISOString();
  return { emojis: ['👏'], actedAt: nowIso, updatedAt: nowIso, ...p };
}

describe('normalizeEmojis (서버·클라이언트 공용 정규화)', () => {
  it('허용 이모지만 남기고 중복을 없애 REACTIONS 순서로 정렬한다', () => {
    expect(normalizeEmojis(['🔥', '👏', '👏', '🍕'])).toEqual(['👏', '🔥']);
  });
  it('배열이 아니면 빈 집합', () => {
    expect(normalizeEmojis('👏')).toEqual([]);
    expect(normalizeEmojis(undefined)).toEqual([]);
  });
});

describe('reaction queries', () => {
  const t0 = Date.now();
  const iso = (ms: number) => new Date(ms).toISOString();

  it('리액션 집합이 기록×멤버당 1행으로 저장된다', async () => {
    const out = await pushReactions(db, [
      rset({ entryId: R1, m: 'wg', emojis: ['👏'], actedAt: iso(t0) }),
    ]);
    expect(out.applied).toHaveLength(1);
    expect(out.applied[0]!.emojis).toEqual(['👏']);
    expect(out.applied[0]!.actedAt).toMatch(ISO_RE);
    expect(out.applied[0]!.updatedAt).toMatch(ISO_RE);
  });

  it('더 오래된 액션 시각은 거부된다 — 뒤늦게 도착한 옛 토글이 최신 집합을 못 덮는다', async () => {
    const stale = await pushReactions(db, [
      rset({ entryId: R1, m: 'wg', emojis: [], actedAt: iso(t0 - 600_000) }),
    ]);
    expect(stale.applied).toHaveLength(0);
    expect(stale.current[0]!.emojis).toEqual(['👏']); // 서버 현재 행 — 클라이언트가 채택한다
    expect(stale.current[0]!.actedAt).toBe(iso(t0));
  });

  it('같은 액션 시각의 재전송은 반영 없이 현재 행으로 정산된다 (잃어버린 응답 재시도)', async () => {
    // 엄격 >: 동일 요청 둘이 동시에 와도 applied(→알림 델타)는 한 번만 잡힌다.
    // 재전송은 current로 돌아가고 내용이 같아 클라이언트 큐는 그대로 정산된다.
    const out = await pushReactions(db, [
      rset({ entryId: R1, m: 'wg', emojis: ['👏'], actedAt: iso(t0) }),
    ]);
    expect(out.applied).toHaveLength(0);
    expect(out.deltas).toHaveLength(0);
    expect(out.current).toHaveLength(1);
    expect(out.current[0]!.emojis).toEqual(['👏']);
    expect(out.current[0]!.actedAt).toBe(iso(t0));
  });

  it('더 새로운 액션은 집합 전체를 갈아끼운다', async () => {
    const out = await pushReactions(db, [
      rset({ entryId: R1, m: 'wg', emojis: ['👏', '🔥'], actedAt: iso(t0 + 1000) }),
    ]);
    expect(out.applied[0]!.emojis).toEqual(['👏', '🔥']);
  });

  it('저장된 집합은 읽을 때도 정규화된다 (순서가 흔들리면 헛 동기화가 돈다)', async () => {
    // jsonb에는 무엇이든 들어갈 수 있다 — 구버전/손상된 값이 있어도 경계에서 바로잡는다
    await db.execute(
      sql`update reactions set emojis = '["🔥","👏","👏","🍕"]'::jsonb where entry_id = ${R1}::uuid and member_id = 'wg'`,
    );
    const r = await pullReactions(db, null);
    expect(r.rows.find((x) => x.entryId === R1 && x.m === 'wg')!.emojis).toEqual(['👏', '🔥']);
  });

  it('멤버마다 행이 따로 쌓인다 — 남의 리액션은 덮을 수 없다 (PK에 member_id)', async () => {
    await pushReactions(db, [rset({ entryId: R1, m: 'sh', emojis: ['💪'], actedAt: iso(t0) })]);
    const r = await pullReactions(db, null);
    const onR1 = r.rows.filter((x) => x.entryId === R1);
    expect(onR1).toHaveLength(2);
    expect(onR1.find((x) => x.m === 'wg')!.emojis).toEqual(['👏', '🔥']);
    expect(onR1.find((x) => x.m === 'sh')!.emojis).toEqual(['💪']);
  });
});

describe('reaction pull 커서 안전 지평선', () => {
  const iso = (ms: number) => new Date(ms).toISOString();

  it('최근 행이 있으면 커서가 지평선에서 멈춘다 (키 자리는 최솟값)', async () => {
    const r = await pullReactions(db, null);
    expect(r.rows.length).toBeGreaterThan(0);
    expect(r.cursor!.entryId).toBe(NIL_UUID);
    expect(r.cursor!.m).toBe('');
    // 지평선 커서로 다시 pull하면 최근 행이 재전달된다 — 늦은 커밋을 놓치지 않는다
    expect((await pullReactions(db, r.cursor)).rows.length).toBeGreaterThan(0);
  });

  it('지평선 너머로 방치된 커서는 빈 페이지에서 끌어내려진다', async () => {
    const beyond: ReactionCursor = { ts: iso(Date.now()), entryId: NIL_UUID, m: '' };
    const r = await pullReactions(db, beyond);
    expect(r.rows).toHaveLength(0);
    expect(Date.parse(r.cursor!.ts)).toBeLessThan(Date.parse(beyond.ts));
  });

  it('오래된 행만 있으면 키셋 커서로 전진하고 재-pull은 비어 있다', async () => {
    // 한 statement로 들어간 세 행은 updated_at이 완전히 같다 — (ts, entry_id, member_id)
    // 튜플 비교가 그 동률을 갈라주는지 함께 확인한다
    const now = iso(Date.now());
    await pushReactions(db, [
      rset({ entryId: R2, m: 'th', emojis: ['👀'], actedAt: now }),
      rset({ entryId: R3, m: 'th', emojis: ['😴'], actedAt: now }),
      rset({ entryId: R3, m: 'jj', emojis: ['😴'], actedAt: now }),
    ]);
    await ageReactions();
    const all = await pullReactions(db, null);
    expect(all.cursor!.entryId).not.toBe(NIL_UUID);
    expect(await pullReactions(db, all.cursor)).toMatchObject({ rows: [] });

    // 첫 행의 키를 커서로 삼으면 그 행만 빠지고 나머지가 순서대로 이어진다
    const first = all.rows[0]!;
    const rest = await pullReactions(db, {
      ts: first.updatedAt,
      entryId: first.entryId,
      m: first.m,
    });
    expect(rest.rows.map((x) => `${x.entryId}|${x.m}`)).toEqual(
      all.rows.slice(1).map((x) => `${x.entryId}|${x.m}`),
    );
  });
});

/* ---------- UUID 대소문자 (pg의 소문자 정규화) ---------- */

const C3 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3';
const C4 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4';
const R4 = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc4';

describe('canonicalUuid (핸들러 경계의 소문자 정규화)', () => {
  it('대문자는 내리고 소문자는 그대로 둔다', () => {
    expect(canonicalUuid(C3.toUpperCase())).toBe(C3);
    expect(canonicalUuid(C3)).toBe(C3);
  });

  it('pg는 uuid를 소문자로 돌려준다 — 보낸 키 그대로 상관시키면 ACK가 어긋난다', async () => {
    const sentId = C3.toUpperCase();
    const out = await pushComments(db, [comment({ id: sentId, m: 'wg', entryId: A })], 'wg');
    expect(out.applied).toHaveLength(1);
    // 응답의 id는 보낸 문자열이 아니라 소문자다 — 핸들러가 미리 내려두지 않으면
    // 클라이언트가 자기 큐 항목과 짝지을 수 없어 그 댓글이 큐에 영원히 남는다
    expect(out.applied[0]!.id).not.toBe(sentId);
    expect(out.applied[0]!.id).toBe(canonicalUuid(sentId));
  });

  it('대문자 entryId도 소문자로 저장된다 — 리액션의 상관 키 (entryId, m)도 같은 성질', async () => {
    const out = await pushReactions(db, [
      rset({ entryId: R4.toUpperCase(), m: 'wg', emojis: ['🔥'] }),
    ]);
    expect(out.applied[0]!.entryId).toBe(R4);
  });

  it('대소문자만 다른 두 행을 한 배치에 넣으면 배치 전체가 죽는다 (중복 검사가 먼저 정규화해야 하는 이유)', async () => {
    // pg에게는 같은 한 행이라 ON CONFLICT가 같은 행을 두 번 건드리게 되고,
    // 그 statement 전체가 에러가 된다 — 행 단위 400이 아니라 push 전체가 500이 된다
    const err = await pushComments(
      db,
      [
        comment({ id: C4, m: 'wg', entryId: A }),
        comment({ id: C4.toUpperCase(), m: 'wg', entryId: A }),
      ],
      'wg',
    ).then(
      () => null,
      (e: unknown) => e as { message?: string; cause?: { message?: string } },
    );
    expect(err).not.toBeNull();
    expect(`${err?.cause?.message ?? err?.message}`).toMatch(/second time/);
  });

  it('정규화 후 중복이 걸러지면 남는 한 행만 정상 저장된다', async () => {
    const ids = [C4, C4.toUpperCase()].map(canonicalUuid);
    expect(new Set(ids).size).toBe(1); // 핸들러의 seenComments가 두 번째를 400으로 막는다
    const out = await pushComments(db, [comment({ id: ids[0]!, m: 'wg', entryId: A })], 'wg');
    expect(out.applied).toHaveLength(1);
    expect(out.applied[0]!.id).toBe(C4);
  });
});
