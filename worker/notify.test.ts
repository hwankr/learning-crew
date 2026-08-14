/* 알림 파이프라인 검증 — 순수 판정(shared/notify)은 그대로, 팬아웃·cron은
   PGlite(진짜 Postgres) 위에서 발송기 스텁을 꽂아 끝까지 돌린다. */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { sql } from 'drizzle-orm';
import {
  allNotifPrefs,
  deleteOldNotifications,
  getNotifPrefs,
  insertNotificationDedup,
  insertNotifications,
  markNotificationsRead,
  pullNotifications,
  pushComments,
  pushEntries,
  pushReactions,
  putNotifPrefs,
  upsertPushSub,
  upsertReactionDaily,
  type Db,
} from './queries';
import { notifyCommentEvents, notifyStart, runHourly, type Sender } from './notify';
import type { PushBody } from './push';
import {
  DEFAULT_NOTIF_PREFS,
  MEMBER_IDS,
  MEMBER_NAMES,
  type Comment,
  type Entry,
  type MemberId,
  type NotifPrefs,
  type ReactionSet,
} from '../shared/types';
import { primaryTag } from '../shared/types';
import {
  fmtKstTime,
  inQuietHours,
  kstDayStr,
  kstHourStr,
  kstMinutes,
  parseMentions,
  quietSpanMinutes,
  resolveCommentRecipients,
  resolvedStartMode,
} from '../shared/notify';

let db: Db;

beforeAll(async () => {
  const pg = new PGlite();
  for (const migration of readdirSync('migrations').filter((f) => f.endsWith('.sql')).sort()) {
    const ddl = readFileSync(`migrations/${migration}`, 'utf8');
    for (const stmt of ddl.split('--> statement-breakpoint')) await pg.exec(stmt);
  }
  db = drizzle(pg) as unknown as Db;
});

/* ---------- 픽스처 ---------- */

const E1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const E2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const C1 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const C2 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const C3 = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

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

function comment(partial: Partial<Comment> & Pick<Comment, 'id' | 'entryId' | 'm'>): Comment {
  return {
    body: '댓글',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    deletedAt: null,
    ...partial,
  };
}

function prefs(m: MemberId, over: Partial<NotifPrefs> = {}): NotifPrefs {
  return { m, ...DEFAULT_NOTIF_PREFS, updatedAt: new Date().toISOString(), ...over };
}

function allPrefs(over: Partial<Record<MemberId, Partial<NotifPrefs>>> = {}) {
  return Object.fromEntries(MEMBER_IDS.map((m) => [m, prefs(m, over[m])])) as Record<
    MemberId,
    NotifPrefs
  >;
}

const ENV = { VAPID_PUBLIC_KEY: 'pk', VAPID_PRIVATE_KEY: 'sk' };

function makeSender() {
  const calls: { endpoints: string[]; data: PushBody }[] = [];
  const send: Sender = async (_env, targets, data) => {
    calls.push({ endpoints: targets.map((t) => t.endpoint), data });
  };
  return { calls, send };
}

/** 지금 기준으로 "가장 최근의 KST hh:00" 시각(ms) — cron 시각을 과거로 잡아
    실시간으로 만든 행들이 창(since) 안에 들어오게 한다. */
function lastKstHour(hour: number): number {
  const now = Date.now();
  return now - ((kstMinutes(now) - hour * 60 + 1440) % 1440) * 60_000;
}

async function resetNotifState(): Promise<void> {
  await db.execute(sql`delete from notifications`);
  await db.execute(sql`delete from notif_prefs`);
  await db.execute(sql`delete from push_subs`);
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/* ---------- 순수 판정 ---------- */

describe('parseMentions', () => {
  it('@이름 사전 매칭 — 있는 이름만, 여러 명도', () => {
    expect(parseMentions('@승환 그 문제집 뭐예요')).toEqual(['sh']);
    expect(parseMentions('@승환 @진주 내일 봬요')).toEqual(['sh', 'jj']);
    expect(parseMentions('멘션 없는 문장 @지나가던사람')).toEqual([]);
  });

  it('멤버 이름끼리 서로 오검출하지 않는다 — 부분 문자열 매칭이라 이름이 겹치면 같이 잡힌다', () => {
    // 멤버를 추가할 때 기존 이름의 부분 문자열(또는 그 반대)이면 여기서 걸린다
    for (const m of MEMBER_IDS) {
      expect(parseMentions(`@${MEMBER_NAMES[m]} 이거 봤어요?`)).toEqual([m]);
    }
    expect(parseMentions(MEMBER_IDS.map((m) => `@${MEMBER_NAMES[m]}`).join(' '))).toEqual([
      ...MEMBER_IDS,
    ]);
  });
});

describe('resolveCommentRecipients', () => {
  const ev = { actor: 'sh' as MemberId, entryOwner: 'wg' as MemberId, priorCommenters: ['th' as MemberId], mentions: [] as MemberId[] };

  it('우선순위: 기록 주인 mine, 이전 댓글러 reply, 나머지는 all(기본 꺼짐)', () => {
    const out = resolveCommentRecipients(ev, allPrefs());
    expect(out).toEqual([
      { m: 'wg', kind: 'comment', why: 'mine' },
      { m: 'th', kind: 'reply', why: 'reply' },
    ]);
    const withAll = resolveCommentRecipients(ev, allPrefs({ jj: { cmAll: true } }));
    expect(withAll).toContainEqual({ m: 'jj', kind: 'comment', why: 'all' });
  });

  it('멘션은 설정을 무시하고 항상 이기며, 행위자 본인은 아무것도 받지 않는다', () => {
    const out = resolveCommentRecipients(
      { ...ev, mentions: ['wg', 'sh'] },
      allPrefs({ wg: { cmMine: false } }),
    );
    // wg는 cmMine을 꺼도 멘션이라 받고, 행위자 sh는 자기 멘션이어도 조용하다 (th의 reply는 그대로)
    expect(out).toEqual([
      { m: 'wg', kind: 'mention', why: 'mention' },
      { m: 'th', kind: 'reply', why: 'reply' },
    ]);
  });

  it('설정이 끄면 mine·reply도 조용하다', () => {
    const out = resolveCommentRecipients(
      ev,
      allPrefs({ wg: { cmMine: false }, th: { cmReply: false } }),
    );
    expect(out).toEqual([]);
  });
});

describe('resolvedStartMode · inQuietHours', () => {
  it('크루별 오버라이드가 기본 모드를 이긴다', () => {
    const p = prefs('sh', { startMode: 'daily', perMember: { wg: 'live', th: 'off' } });
    expect(resolvedStartMode(p, 'wg')).toBe('live');
    expect(resolvedStartMode(p, 'th')).toBe('off');
    expect(resolvedStartMode(p, 'jj')).toBe('daily');
  });

  it('자정을 넘는 창(22:00→07:00)과 안 넘는 창을 모두 판정한다', () => {
    const night = prefs('sh'); // 22:00 → 07:00
    expect(inQuietHours(night, 23 * 60)).toBe(true);
    expect(inQuietHours(night, 3 * 60)).toBe(true);
    expect(inQuietHours(night, 12 * 60)).toBe(false);
    const day = prefs('sh', { quietFrom: '09:00', quietTo: '18:00' });
    expect(inQuietHours(day, 12 * 60)).toBe(true);
    expect(inQuietHours(day, 20 * 60)).toBe(false);
    expect(inQuietHours(prefs('sh', { quietEnabled: false }), 23 * 60)).toBe(false);
    expect(inQuietHours(prefs('sh', { quietFrom: '07:00', quietTo: '07:00' }), 7 * 60)).toBe(false);
    expect(quietSpanMinutes(prefs('sh'))).toBe(9 * 60);
  });
});

describe('KST 시각 도우미', () => {
  it('UTC 자정 직전이 KST에선 다음 날이다', () => {
    const ms = Date.parse('2026-08-13T22:30:00Z'); // KST 8/14 07:30
    expect(kstDayStr(ms)).toBe('2026-08-14');
    expect(kstHourStr(ms)).toBe('07:00');
    expect(kstMinutes(ms)).toBe(7 * 60 + 30);
    expect(fmtKstTime(ms)).toBe('오전 7:30');
    expect(fmtKstTime(Date.parse('2026-08-13T05:14:00Z'))).toBe('오후 2:14');
    expect(fmtKstTime(Date.parse('2026-08-13T03:00:00Z'))).toBe('오후 12:00');
  });
});

/* ---------- 설정 저장 ---------- */

describe('notif prefs queries', () => {
  beforeEach(resetNotifState);

  it('행이 없으면 기본값, 저장하면 저장한 값 — perMember의 이상한 키는 정화된다', async () => {
    const def = await getNotifPrefs(db, 'sh');
    expect(def.startMode).toBe('daily');
    expect(def.cmAll).toBe(false);
    expect(def.quietFrom).toBe('22:00');

    await putNotifPrefs(db, 'sh', {
      ...DEFAULT_NOTIF_PREFS,
      startMode: 'live',
      cmAll: true,
      perMember: { wg: 'off' },
    });
    const saved = await getNotifPrefs(db, 'sh');
    expect(saved.startMode).toBe('live');
    expect(saved.cmAll).toBe(true);
    expect(saved.perMember).toEqual({ wg: 'off' });
    expect(saved.updatedAt).toMatch(ISO_RE);

    // jsonb에 어떤 값이 있었든 읽기 경계에서 정화된다
    await db.execute(
      sql`update notif_prefs set per_member = '{"wg":"loud","외부인":"live","th":"daily"}'::jsonb where member_id = 'sh'`,
    );
    expect((await getNotifPrefs(db, 'sh')).perMember).toEqual({ th: 'daily' });

    const all = await allNotifPrefs(db);
    expect(all.sh.startMode).toBe('live');
    expect(all.jj.startMode).toBe('daily'); // 행 없음 → 기본값
  });
});

/* ---------- 공부 시작 팬아웃 ---------- */

describe('notifyStart', () => {
  beforeEach(resetNotifState);

  it('기본(하루 1회): 첫 시작만 행이 되고, 같은 날 두 번째는 조용하다', async () => {
    // 실행 시각이 언제든 "낮"으로 고정 — 기본 방해 금지 창(22~07)에 걸려 발송이 보류되면 안 된다
    const noon = lastKstHour(12);
    const { calls, send } = makeSender();
    await upsertPushSub(db, 'wg', { endpoint: 'https://e/wg', p256dh: 'k', auth: 'a' });
    await notifyStart(db, ENV, 'sh', '도서관', new Date().toISOString(), noon, send);

    const { rows } = await pullNotifications(db, 'wg', null);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'start', why: 'daily', actor: 'sh', m: 'wg' });
    expect(rows[0]!.ctx).toContain('도서관');
    expect(rows[0]!.createdAt).toMatch(ISO_RE);
    // 구독한 wg에게만 기기 푸시가 나간다 (th·jj는 행만)
    expect(calls).toHaveLength(1);
    expect(calls[0]!.endpoints).toEqual(['https://e/wg']);
    expect((await pullNotifications(db, 'th', null)).rows).toHaveLength(1);

    await notifyStart(db, ENV, 'sh', '집', new Date().toISOString(), noon, send);
    expect((await pullNotifications(db, 'wg', null)).rows).toHaveLength(1); // 중복 없음
    expect(calls).toHaveLength(1);
  });

  it('실시간 모드는 시작마다, 끔 모드는 아무것도 받지 않는다', async () => {
    await putNotifPrefs(db, 'wg', { ...DEFAULT_NOTIF_PREFS, perMember: { sh: 'live' } });
    await putNotifPrefs(db, 'th', { ...DEFAULT_NOTIF_PREFS, startMode: 'off' });
    const { send } = makeSender();
    await notifyStart(db, ENV, 'sh', '도서관', new Date().toISOString(), Date.now(), send);
    await notifyStart(db, ENV, 'sh', '카페', new Date().toISOString(), Date.now(), send);

    const wg = (await pullNotifications(db, 'wg', null)).rows;
    expect(wg).toHaveLength(2);
    expect(wg.every((r) => r.why === 'live')).toBe(true);
    expect((await pullNotifications(db, 'th', null)).rows).toHaveLength(0);
    expect((await pullNotifications(db, 'jj', null)).rows).toHaveLength(1); // 기본 daily
  });

  it('방해 금지 중인 수신자는 행만 쌓이고 푸시는 보류된다(pushed_at null)', async () => {
    const noon = lastKstHour(12); // th의 기본 창(22~07) 밖 + wg의 창은 이 시각을 덮게 설정
    await putNotifPrefs(db, 'wg', {
      ...DEFAULT_NOTIF_PREFS,
      quietFrom: '11:00',
      quietTo: '14:00',
    });
    await upsertPushSub(db, 'wg', { endpoint: 'https://e/wg', p256dh: 'k', auth: 'a' });
    await upsertPushSub(db, 'th', { endpoint: 'https://e/th', p256dh: 'k', auth: 'a' });
    const { calls, send } = makeSender();
    await notifyStart(db, ENV, 'sh', '도서관', new Date().toISOString(), noon, send);

    expect(calls).toHaveLength(1); // th만
    expect(calls[0]!.endpoints).toEqual(['https://e/th']);
    const pushed = await db.execute(
      sql`select member_id, pushed_at from notifications order by member_id`,
    );
    const byMember = new Map(
      (pushed.rows as { member_id: string; pushed_at: string | null }[]).map((r) => [
        r.member_id,
        r.pushed_at,
      ]),
    );
    expect(byMember.get('wg')).toBeNull(); // 보류 — 아침 다이제스트 재료
    expect(byMember.get('th')).not.toBeNull();
  });
});

/* ---------- 댓글 · 응원 팬아웃 ---------- */

describe('notifyCommentEvents', () => {
  beforeEach(async () => {
    await resetNotifState();
    await db.execute(sql`delete from comments`);
    await db.execute(sql`delete from reactions`);
    await db.execute(sql`delete from entries`);
    await pushEntries(db, [entry({ id: E1, m: 'wg', tags: ['코딩테스트'] })], 'wg');
  });

  it('댓글 하나가 주인 mine·이전 댓글러 reply·멘션 mention으로 갈라진다', async () => {
    await pushComments(db, [comment({ id: C1, entryId: E1, m: 'th', body: '먼저 단 댓글' })], 'th');
    const { calls, send } = makeSender();
    await upsertPushSub(db, 'wg', { endpoint: 'https://e/wg', p256dh: 'k', auth: 'a' });
    const c = comment({ id: C2, entryId: E1, m: 'sh', body: '@진주 이거 봤어요? 대박' });
    await pushComments(db, [c], 'sh');
    await notifyCommentEvents(db, ENV, 'sh', [c], [], lastKstHour(12), send);

    const wg = (await pullNotifications(db, 'wg', null)).rows;
    expect(wg).toHaveLength(1);
    expect(wg[0]).toMatchObject({ kind: 'comment', why: 'mine', actor: 'sh', entryId: E1 });
    expect(wg[0]!.quote).toBe('@진주 이거 봤어요? 대박');
    expect(wg[0]!.ctx).toBe('내 기록 · 코딩테스트');

    const th = (await pullNotifications(db, 'th', null)).rows;
    expect(th[0]).toMatchObject({ kind: 'reply', why: 'reply' });
    expect(th[0]!.ctx).toBe('웅의 기록 · 코딩테스트');

    const jj = (await pullNotifications(db, 'jj', null)).rows;
    expect(jj[0]).toMatchObject({ kind: 'mention', why: 'mention' });

    // 푸시는 구독자(wg)에게만 — 문구는 why에 따라 갈린다
    expect(calls).toHaveLength(1);
    expect(calls[0]!.data.title).toContain('내 기록에 댓글');
  });

  it('cmAll이 꺼진 구경꾼은 조용하고, 켜면 all로 받는다', async () => {
    const { send } = makeSender();
    const c = comment({ id: C3, entryId: E1, m: 'sh', body: '지나가다 한마디' });
    await pushComments(db, [c], 'sh');
    await notifyCommentEvents(db, ENV, 'sh', [c], [], Date.now(), send);
    expect((await pullNotifications(db, 'jj', null)).rows).toHaveLength(0);

    await resetNotifState();
    await putNotifPrefs(db, 'jj', { ...DEFAULT_NOTIF_PREFS, cmAll: true });
    await notifyCommentEvents(db, ENV, 'sh', [c], [], Date.now(), send);
    const jj = (await pullNotifications(db, 'jj', null)).rows;
    expect(jj).toHaveLength(1);
    expect(jj[0]).toMatchObject({ kind: 'comment', why: 'all' });
  });

  it('응원 실시간 모드: 추가된 이모지만 인용해 행이 된다', async () => {
    await putNotifPrefs(db, 'wg', { ...DEFAULT_NOTIF_PREFS, reactMode: 'live' });
    const { send } = makeSender();
    await notifyCommentEvents(
      db,
      ENV,
      'sh',
      [],
      [{ entryId: E1, added: ['🔥', '💪'] }],
      Date.now(),
      send,
    );
    const wg = (await pullNotifications(db, 'wg', null)).rows;
    expect(wg).toHaveLength(1);
    expect(wg[0]).toMatchObject({ kind: 'react', why: 'react', quote: '🔥 💪', actor: 'sh' });
  });

  it('응원 하루 요약(기본): 집계 행 하나에 count가 쌓이고 읽음이 되돌아간다', async () => {
    const { send } = makeSender();
    await notifyCommentEvents(db, ENV, 'sh', [], [{ entryId: E1, added: ['🔥'] }], Date.now(), send);
    let rows = (await pullNotifications(db, 'wg', null)).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'react', why: 'react_daily', count: 1, actors: ['sh'] });

    await markNotificationsRead(db, 'wg', [{ id: rows[0]!.id, at: rows[0]!.updatedAt }]);
    await notifyCommentEvents(db, ENV, 'th', [], [{ entryId: E1, added: ['👏', '👀'] }], Date.now(), send);
    rows = (await pullNotifications(db, 'wg', null)).rows;
    expect(rows).toHaveLength(1); // 여전히 한 행
    expect(rows[0]!.count).toBe(3);
    expect([...rows[0]!.actors].sort()).toEqual(['sh', 'th']);
    expect(rows[0]!.readAt).toBeNull(); // 새 응원이 왔으니 다시 안 읽음
  });

  it('자기 기록 응원·주인을 모르는 기록은 조용하다', async () => {
    const { send } = makeSender();
    await notifyCommentEvents(
      db,
      ENV,
      'wg', // 자기 기록에 자기가
      [],
      [{ entryId: E1, added: ['🔥'] }],
      Date.now(),
      send,
    );
    await notifyCommentEvents(
      db,
      ENV,
      'sh',
      [],
      [{ entryId: E2, added: ['🔥'] }], // 서버가 모르는 기록
      Date.now(),
      send,
    );
    const count = await db.execute(sql`select count(*)::int as n from notifications`);
    expect((count.rows as { n: number }[])[0]!.n).toBe(0);
  });
});

/* ---------- 리액션 델타 ---------- */

describe('pushReactions deltas', () => {
  beforeEach(async () => {
    await db.execute(sql`delete from reactions`);
  });

  function rx(partial: Partial<ReactionSet> & Pick<ReactionSet, 'entryId' | 'm'>): ReactionSet {
    return {
      emojis: [],
      actedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...partial,
    };
  }

  it('처음은 전부 added, 추가는 그 차이만, 제거만 하면 빈 배열', async () => {
    const first = await pushReactions(db, [rx({ entryId: E1, m: 'sh', emojis: ['🔥'] })]);
    expect(first.deltas).toEqual([{ entryId: E1, m: 'sh', added: ['🔥'] }]);

    const more = await pushReactions(db, [
      rx({ entryId: E1, m: 'sh', emojis: ['🔥', '💪'], actedAt: new Date(Date.now() + 1000).toISOString() }),
    ]);
    expect(more.deltas).toEqual([{ entryId: E1, m: 'sh', added: ['💪'] }]);

    const removed = await pushReactions(db, [
      rx({ entryId: E1, m: 'sh', emojis: ['💪'], actedAt: new Date(Date.now() + 2000).toISOString() }),
    ]);
    expect(removed.deltas).toEqual([{ entryId: E1, m: 'sh', added: [] }]);
  });

  it('LWW에 밀린 행은 deltas에도 없다', async () => {
    await pushReactions(db, [rx({ entryId: E1, m: 'sh', emojis: ['🔥'] })]);
    const stale = await pushReactions(db, [
      rx({ entryId: E1, m: 'sh', emojis: ['👀'], actedAt: new Date(Date.now() - 60_000).toISOString() }),
    ]);
    expect(stale.applied).toHaveLength(0);
    expect(stale.deltas).toHaveLength(0);
  });
});

/* ---------- 읽음 · pull ---------- */

describe('notification read + pull', () => {
  beforeEach(resetNotifState);

  it('읽음 도장은 내 안읽음 행만 찍고, updated_at이 올라 다른 기기 커서에 잡힌다', async () => {
    const [mine] = await insertNotifications(db, [
      { memberId: 'sh', kind: 'comment', why: 'mine', actor: 'wg', entryId: E1, quote: 'ㅎㅇ', ctx: '', day: kstDayStr(Date.now()), aggKey: null },
    ]);
    const [others] = await insertNotifications(db, [
      { memberId: 'wg', kind: 'comment', why: 'mine', actor: 'sh', entryId: E1, quote: '', ctx: '', day: kstDayStr(Date.now()), aggKey: null },
    ]);
    // 늙혀서 커서를 만든다 (안전 지평선 너머로)
    await db.execute(sql`update notifications set updated_at = updated_at - interval '10 minutes'`);
    const first = await pullNotifications(db, 'sh', null);
    expect(first.rows).toHaveLength(1); // 남(wg)의 행은 안 보인다
    const cursor = first.cursor;

    const settled = await markNotificationsRead(db, 'sh', [
      { id: mine!.id, at: mine!.updatedAt },
      { id: others!.id, at: others!.updatedAt },
    ]);
    expect(settled).toEqual([mine!.id, others!.id]); // 남의 행도 "정산"으로는 돌려준다
    const after = await pullNotifications(db, 'sh', cursor);
    expect(after.rows).toHaveLength(1);
    expect(after.rows[0]!.readAt).not.toBeNull();
    // 남(wg)의 행은 그대로 안 읽음
    const wg = await pullNotifications(db, 'wg', null);
    expect(wg.rows[0]!.readAt).toBeNull();
  });

  it('보관 기간(30일) 밖의 행은 pull에 실리지 않고 정리 쿼리가 지운다', async () => {
    const old = new Date(Date.now() - 31 * 86_400_000).toISOString();
    await insertNotifications(db, [
      { memberId: 'sh', kind: 'start', why: 'daily', actor: 'wg', entryId: null, quote: '', ctx: '', day: old.slice(0, 10), aggKey: null, createdAt: old },
    ]);
    expect((await pullNotifications(db, 'sh', null)).rows).toHaveLength(0);
    await deleteOldNotifications(db);
    const count = await db.execute(sql`select count(*)::int as n from notifications`);
    expect((count.rows as { n: number }[])[0]!.n).toBe(0);
  });
});

/* ---------- 시간 단위 cron ---------- */

describe('runHourly', () => {
  beforeEach(resetNotifState);

  it('20:00 KST — 응원 하루 요약을 한 번만 푸시하고 도장 찍는다', async () => {
    const at20 = lastKstHour(20);
    const day = kstDayStr(at20);
    await upsertReactionDaily(db, 'sh', day, 'wg', 2);
    await upsertReactionDaily(db, 'sh', day, 'th', 1);
    await upsertPushSub(db, 'sh', { endpoint: 'https://e/sh', p256dh: 'k', auth: 'a' });

    const { calls, send } = makeSender();
    await runHourly(db, ENV, at20, send);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.data.title).toContain('응원 3개');

    await runHourly(db, ENV, at20, send); // 같은 시각 재실행 — 이미 도장
    expect(calls).toHaveLength(1);
  });

  it('quietTo 시각 — 보류분을 다이제스트 한 건으로 접고 원본 행에 도장 찍는다', async () => {
    const at7 = lastKstHour(7);
    await putNotifPrefs(db, 'sh', { ...DEFAULT_NOTIF_PREFS }); // 22:00→07:00
    await insertNotifications(db, [
      { memberId: 'sh', kind: 'start', why: 'daily', actor: 'th', entryId: null, quote: '', ctx: '', day: kstDayStr(at7), aggKey: null },
      { memberId: 'sh', kind: 'comment', why: 'mine', actor: 'jj', entryId: E1, quote: '새벽 댓글', ctx: '', day: kstDayStr(at7), aggKey: null },
    ]);
    await upsertPushSub(db, 'sh', { endpoint: 'https://e/sh', p256dh: 'k', auth: 'a' });

    const { calls, send } = makeSender();
    await runHourly(db, ENV, at7, send);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.data.title).toContain('알림 2개');

    const rows = (await pullNotifications(db, 'sh', null)).rows;
    const sys = rows.find((r) => r.kind === 'system');
    expect(sys).toMatchObject({ why: 'quiet', count: 2 });
    expect(sys!.ctx).toContain('태현');

    await runHourly(db, ENV, at7, send); // 재실행 — 남은 보류분이 없다
    expect(calls).toHaveLength(1);
    expect(
      (await db.execute(sql`select count(*)::int as n from notifications where kind = 'system'`))
        .rows as { n: number }[],
    ).toEqual([{ n: 1 }]);
  });

  it('이미 앱에서 읽은 보류분은 다이제스트에 넣지 않는다', async () => {
    const at7 = lastKstHour(7);
    const [row] = await insertNotifications(db, [
      { memberId: 'sh', kind: 'comment', why: 'mine', actor: 'jj', entryId: E1, quote: '', ctx: '', day: kstDayStr(at7), aggKey: null },
    ]);
    await markNotificationsRead(db, 'sh', [{ id: row!.id, at: row!.updatedAt }]);
    const { calls, send } = makeSender();
    await runHourly(db, ENV, at7, send);
    expect(calls).toHaveLength(0);
    expect(
      (await db.execute(sql`select count(*)::int as n from notifications where kind = 'system'`))
        .rows as { n: number }[],
    ).toEqual([{ n: 0 }]);
  });
});

/* ---------- 세대 인지 읽음 · 발송 재무장 ---------- */

describe('read generation + push re-arm', () => {
  beforeEach(resetNotifState);

  it('옛 세대의 읽음은 그 사이 갱신된 집계 행에 도장을 못 찍는다', async () => {
    const day = kstDayStr(Date.now());
    const gen1 = await upsertReactionDaily(db, 'sh', day, 'wg', 1);
    await new Promise((r) => setTimeout(r, 5)); // updated_at(now())이 확실히 달라지게
    const gen2 = await upsertReactionDaily(db, 'sh', day, 'th', 2);
    const settled = await markNotificationsRead(db, 'sh', [{ id: gen1.id, at: gen1.updatedAt }]);
    expect(settled).toEqual([gen1.id]); // 정산은 되지만 —
    expect((await pullNotifications(db, 'sh', null)).rows[0]!.readAt).toBeNull(); // 도장은 없다
    await markNotificationsRead(db, 'sh', [{ id: gen2.id, at: gen2.updatedAt }]);
    expect((await pullNotifications(db, 'sh', null)).rows[0]!.readAt).not.toBeNull();
  });

  it('요약 발송 뒤 새 응원은 다시 대기가 되고, 날짜 경계 밖 행도 다음 20시에 나간다', async () => {
    const at20 = lastKstHour(20);
    const day = kstDayStr(at20);
    await upsertReactionDaily(db, 'sh', day, 'wg', 1);
    await upsertPushSub(db, 'sh', { endpoint: 'https://e/sh', p256dh: 'k', auth: 'a' });
    const { calls, send } = makeSender();
    await runHourly(db, ENV, at20, send);
    expect(calls).toHaveLength(1);
    // 발송 후 새 응원 — pushed_at이 되돌아가 다시 대기열에 선다
    await upsertReactionDaily(db, 'sh', day, 'th', 2);
    await runHourly(db, ENV, at20, send);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.data.title).toContain('응원 3개');
    // 옛 날짜의 미발송 행(20시 이후 생성·방해 금지 보류분의 대역)도 잡힌다 — day 필터가 없다
    await upsertReactionDaily(db, 'jj', '2020-01-01', 'wg', 1);
    await upsertPushSub(db, 'jj', { endpoint: 'https://e/jj', p256dh: 'k', auth: 'a' });
    await runHourly(db, ENV, at20, send);
    expect(calls).toHaveLength(3);
    expect(calls[2]!.endpoints).toEqual(['https://e/jj']);
  });
});

/* ---------- 크루 전원 커버리지 ---------- */

/* 위 테스트들은 특정 멤버(sh·wg·th)로 시나리오를 확인한다. 여기서는 MEMBER_IDS를 직접 돌면서
   "설정 행이 없어도 기본값" · "팬아웃은 본인 제외 전원"을 보증한다 — 멤버를 추가했는데
   어딘가에서 조용히 빠지면 인원수를 박아 둔 단언 없이도 여기서 걸린다. */
describe('크루 전원 커버리지', () => {
  const NEWEST = MEMBER_IDS[MEMBER_IDS.length - 1]!; // 가장 최근에 합류한 멤버

  beforeEach(async () => {
    await resetNotifState();
    await db.execute(sql`delete from comments`);
    await db.execute(sql`delete from reactions`);
    await db.execute(sql`delete from entries`);
  });

  it('설정 행이 없는 멤버도 전원 기본값으로 채워진다 — 팬아웃이 참조하는 prefs 맵의 전제', async () => {
    const bare = (p: NotifPrefs) => ({ ...p, updatedAt: '' }); // 기본값의 updatedAt은 비교 대상이 아니다
    const all = await allNotifPrefs(db);
    expect(Object.keys(all).sort()).toEqual([...MEMBER_IDS].sort());
    for (const m of MEMBER_IDS) {
      expect(bare(all[m])).toEqual(bare(prefs(m)));
      expect(bare(await getNotifPrefs(db, m))).toEqual(bare(prefs(m)));
    }

    // 한 명이 저장해도 나머지는 그대로 기본값 — 채우기가 저장된 행에만 붙지 않는다
    await putNotifPrefs(db, NEWEST, { ...DEFAULT_NOTIF_PREFS, startMode: 'off' });
    const after = await allNotifPrefs(db);
    expect(after[NEWEST].startMode).toBe('off');
    for (const m of MEMBER_IDS.filter((x) => x !== NEWEST)) {
      expect(after[m].startMode).toBe(DEFAULT_NOTIF_PREFS.startMode);
    }
  });

  it('댓글 수신자는 누가 쓰든 본인만 빼고 전원이다 — mine·reply·mention 전부', () => {
    for (const actor of MEMBER_IDS) {
      const others = MEMBER_IDS.filter((m) => m !== actor);
      const [owner, ...rest] = others as [MemberId, ...MemberId[]];

      // 기본 설정: 주인은 mine, 나머지 이전 댓글러는 reply — 한 명도 빠지지 않는다
      expect(
        resolveCommentRecipients(
          { actor, entryOwner: owner, priorCommenters: rest, mentions: [] },
          allPrefs(),
        ),
      ).toEqual([
        { m: owner, kind: 'comment', why: 'mine' },
        ...rest.map((m) => ({ m, kind: 'reply', why: 'reply' })),
      ]);

      // 멘션은 설정과 무관하게 전원이 받는다 (행위자 자신만 조용하다)
      expect(
        resolveCommentRecipients(
          { actor, entryOwner: null, priorCommenters: [], mentions: [...others, actor] },
          allPrefs(),
        ),
      ).toEqual(others.map((m) => ({ m, kind: 'mention', why: 'mention' })));
    }
  });

  it('공부 시작 팬아웃은 누가 시작하든 본인 제외 전원에게 간다', async () => {
    const noon = lastKstHour(12); // 기본 방해 금지 창(22~07) 밖 — 보류가 아니라 행이 생긴다
    const { send } = makeSender();
    for (const me of MEMBER_IDS) {
      await resetNotifState();
      await notifyStart(db, ENV, me, '도서관', new Date().toISOString(), noon, send);
      for (const m of MEMBER_IDS) {
        const { rows } = await pullNotifications(db, m, null);
        expect(rows.map((r) => r.actor)).toEqual(m === me ? [] : [me]);
      }
    }
  });

  it('응원 팬아웃은 누가 기록 주인이어도 그 사람에게 간다', async () => {
    const { send } = makeSender();
    for (const [i, owner] of MEMBER_IDS.entries()) {
      await resetNotifState();
      await db.execute(sql`delete from entries`);
      await pushEntries(db, [entry({ id: E1, m: owner })], owner);
      const actor = MEMBER_IDS[(i + 1) % MEMBER_IDS.length]!;
      await notifyCommentEvents(db, ENV, actor, [], [{ entryId: E1, added: ['🔥'] }], Date.now(), send);

      const rows = (await pullNotifications(db, owner, null)).rows;
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ kind: 'react', why: 'react_daily', actors: [actor] });
      // 주인 아닌 사람에게는 가지 않는다
      for (const m of MEMBER_IDS.filter((x) => x !== owner)) {
        expect((await pullNotifications(db, m, null)).rows).toHaveLength(0);
      }
    }
  });
});

/* ---------- 집계 유니크 ---------- */

describe('agg_key 유니크', () => {
  beforeEach(resetNotifState);

  it('같은 (수신자, 날짜, 키)는 한 번만 — 일반 행(null 키)은 무제한', async () => {
    const day = kstDayStr(Date.now());
    const base = { memberId: 'sh', kind: 'start', why: 'daily', actor: 'wg', entryId: null, quote: '', ctx: '', day } as const;
    expect(await insertNotificationDedup(db, { ...base, aggKey: 'start:wg' })).not.toBeNull();
    expect(await insertNotificationDedup(db, { ...base, aggKey: 'start:wg' })).toBeNull();
    await insertNotifications(db, [
      { ...base, why: 'live', aggKey: null },
      { ...base, why: 'live', aggKey: null },
    ]);
    const count = await db.execute(sql`select count(*)::int as n from notifications`);
    expect((count.rows as { n: number }[])[0]!.n).toBe(3);
  });
});
