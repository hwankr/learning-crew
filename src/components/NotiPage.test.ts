import { describe, expect, it, vi } from 'vitest';
import type { MemberId, Notification } from '../../shared/types';
import { WHY_BADGE, displayActorOf, feedTargetOf, matchesFilter, readRow, restOf, type NotiRow } from './NotiPage';

const base = (over: Partial<Notification> = {}): Notification => ({
  id: 'n1',
  m: 'sh',
  kind: 'comment',
  why: 'mine',
  actor: 'wg',
  entryId: null,
  quote: '',
  ctx: '',
  actors: [],
  count: 1,
  createdAt: '2026-08-14T12:00:00.000Z',
  updatedAt: '2026-08-14T12:00:00.000Z',
  readAt: null,
  ...over,
});

describe('알림 행 표시', () => {
  it('하루 요약은 actor가 없어도 첫 참여자를 아바타로 쓴다', () => {
    const n = base({ kind: 'react', why: 'react_daily', actor: null, actors: ['th', 'jj'] });
    expect(displayActorOf(n)).toBe('th');
  });

  it('시스템 알림만 사람 아바타 없이 벨로 표시한다', () => {
    expect(displayActorOf(base({ kind: 'system', why: 'quiet', actor: null }))).toBeNull();
  });

  it('모르는 멤버 id도 버리지 않고 memberOf의 중립 표시로 넘긴다', () => {
    const ghost = 'zz' as MemberId;
    expect(displayActorOf(base({ actor: ghost }))).toBe(ghost);
  });

  // 새 글 알림(kind=write) — why가 기록/라운지를 가르고, "새 글" 필터에 함께 잡힌다
  it('새 기록·라운지 글 알림은 문구·배지·필터를 모두 갖는다', () => {
    const e = base({ kind: 'write', why: 'entry' });
    const p = base({ kind: 'write', why: 'post' });
    expect(restOf(e)).toBe('님이 새 기록을 남겼어요');
    expect(restOf(p)).toBe('님이 라운지에 글을 올렸어요');
    expect(WHY_BADGE.entry.label).toBe('새 기록');
    expect(WHY_BADGE.post.label).toBe('라운지 글');
    expect(matchesFilter(e, 'write')).toBe(true);
    expect(matchesFilter(p, 'write')).toBe(true);
    expect(matchesFilter(e, 'comment')).toBe(false);
    expect(displayActorOf(e)).toBe('wg'); // 사람이 쓴 글 — 아바타는 작성자
  });

  // 라운지 글 알림을 눌렀는데 '기록만' 필터가 남으면 대상이 안 보인다 — 대상 판정이 갈림길
  it('라운지 새 글 알림만 라운지를 가리키고, 나머지는 전부 기록이다', () => {
    expect(feedTargetOf(base({ kind: 'write', why: 'post' }))).toBe('post');
    expect(feedTargetOf(base({ kind: 'write', why: 'entry' }))).toBe('entry');
    expect(feedTargetOf(base())).toBe('entry'); // 댓글
    expect(feedTargetOf(base({ kind: 'react', why: 'react_daily' }))).toBe('entry');
  });
});

describe('알림 행 읽음 처리', () => {
  it('접힌 행에서는 안 읽은 원본만 각각 읽음 처리한다', () => {
    const read = base({ id: 'read', readAt: '2026-08-14T13:00:00.000Z' });
    const unread = base({ id: 'unread' });
    const row: NotiRow = { key: 'all:2026-08-14', head: unread, group: [read, unread] };
    const onRead = vi.fn();

    readRow(row, onRead);

    expect(onRead).toHaveBeenCalledTimes(1);
    expect(onRead).toHaveBeenCalledWith('unread');
  });
});
