/* 동기화 SQL의 실제 동작 검증 — PGlite(진짜 Postgres)로 마이그레이션을 적용하고
   Worker와 동일한 쿼리 코드를 실행한다. */
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { sql } from 'drizzle-orm';
import {
  pushEntries,
  pullSince,
  setStatus,
  allStatuses,
  getStatusRow,
  stampNotified,
  upsertPushSub,
  deletePushSub,
  deleteGonePushSub,
  pushSubsExcept,
  type Db,
} from './queries';
import { NOTIFY_COOLDOWN_MS, shouldNotify } from './push';
import { STATUS_TTL_MS, isStatusActive } from '../shared/types';
import type { Entry, MemberStatus, PullCursor } from '../shared/types';

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
    v: 0,
    updatedAt: new Date().toISOString(),
    deletedAt: null,
    ...partial,
  };
}

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

/** 모든 행을 10분 과거로 — 커서가 안전 지평선(지금-60초)에 안 걸리고 키셋으로 전진하게 한다. */
async function ageAll(): Promise<void> {
  await db.execute(sql`update entries set updated_at = updated_at - interval '10 minutes'`);
}

beforeAll(async () => {
  const pg = new PGlite();
  for (const migration of readdirSync('migrations').filter((f) => f.endsWith('.sql')).sort()) {
    const ddl = readFileSync(`migrations/${migration}`, 'utf8');
    for (const stmt of ddl.split('--> statement-breakpoint')) await pg.exec(stmt);
  }
  db = drizzle(pg) as unknown as Db;
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

  it('OFF 태그는 별점이 null로 강제된다', async () => {
    const C = '33333333-3333-4333-8333-333333333333';
    await pushEntries(db, [entry({ id: C, m: 'th', tag: 'OFF', stars: 4 })], 'th');
    const r = await pullSince(db, null);
    expect(r.rows.find((x) => x.id === C)!.stars).toBeNull();
  });
});

describe('pull 커서 안전 지평선', () => {
  const NIL = '00000000-0000-0000-0000-000000000000';
  const D = '44444444-4444-4444-8444-444444444444';
  const E = '55555555-5555-4555-8555-555555555555';
  let held: PullCursor | null = null;

  it('최근(60초 이내) 행이 있으면 커서가 지평선에서 멈춘다', async () => {
    await pushEntries(db, [entry({ id: D, m: 'sh', memo: '지평선 테스트' })], 'sh');
    const r = await pullSince(db, null);
    expect(r.rows.find((x) => x.id === D)).toBeTruthy();
    expect(r.cursor!.id).toBe(NIL);
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

  it('오래된 행만 있으면 키셋 커서로 전진하고 재-pull은 비어 있다', async () => {
    await ageAll();
    const r = await pullSince(db, null);
    expect(r.cursor!.id).not.toBe(NIL);
    const r2 = await pullSince(db, r.cursor);
    expect(r2.rows).toHaveLength(0);
  });
});

describe('status queries', () => {
  it('켜면 멤버당 1행이 저장되고 저장된 행을 돌려준다', async () => {
    const since = new Date().toISOString();
    const saved = await setStatus(db, 'sh', { on: true, place: '도서관', since });
    expect(saved.m).toBe('sh');
    expect(saved.on).toBe(true);
    expect(saved.place).toBe('도서관');
    const all = await allStatuses(db);
    expect(all.filter((s) => s.m === 'sh')).toHaveLength(1);
  });

  it('재설정은 같은 행을 덮어쓴다 (끄면 place/since가 비워진다)', async () => {
    await setStatus(db, 'sh', { on: false, place: null, since: null });
    const all = await allStatuses(db);
    const sh = all.find((s) => s.m === 'sh')!;
    expect(sh.on).toBe(false);
    expect(sh.place).toBeNull();
    expect(sh.since).toBeNull();
    expect(all.filter((s) => s.m === 'sh')).toHaveLength(1);
  });

  it('멤버별로 행이 따로 쌓인다', async () => {
    await setStatus(db, 'wg', { on: true, place: '카페', since: new Date().toISOString() });
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

  it('stampNotified가 쿨다운 기준 시각을 남긴다', async () => {
    await setStatus(db, 'jj', { on: true, place: '도서관', since: new Date().toISOString() });
    expect((await getStatusRow(db, 'jj'))!.lastNotifiedAt).toBeNull();
    await stampNotified(db, 'jj');
    const row = await getStatusRow(db, 'jj');
    expect(row!.lastNotifiedAt).not.toBeNull();
  });
});
