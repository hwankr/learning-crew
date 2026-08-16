import { describe, expect, it, vi } from 'vitest';
import type { MemberId, Notification } from '../../shared/types';
import {
  WHY_BADGE,
  displayActorOf,
  matchesFilter,
  navTargetOf,
  navTargetOfRow,
  readRow,
  restOf,
  type NotiRow,
} from './NotiPage';

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

});

describe('navTargetOf (알림 → 이동 타깃)', () => {
  it('entryId가 있으면 종류 불문 기록 딥링크다', () => {
    expect(navTargetOf(base({ entryId: 'e1' }))).toEqual({ kind: 'entry', id: 'e1' }); // 댓글
    expect(navTargetOf(base({ kind: 'mention', why: 'mention', entryId: 'e1' })))
      .toEqual({ kind: 'entry', id: 'e1' });
    expect(navTargetOf(base({ kind: 'write', why: 'entry', entryId: 'e1' })))
      .toEqual({ kind: 'entry', id: 'e1' });
    expect(navTargetOf(base({ kind: 'react', why: 'react', entryId: 'e1' })))
      .toEqual({ kind: 'entry', id: 'e1' });
  });

  it('라운지 새 글은 postId가 있으면 글 딥링크, 없으면(구버전 캐시 행) 피드 폴백이다', () => {
    expect(navTargetOf(base({ kind: 'write', why: 'post', postId: 'p1' })))
      .toEqual({ kind: 'post', id: 'p1' });
    expect(navTargetOf(base({ kind: 'write', why: 'post' })))
      .toEqual({ kind: 'feed', reveal: 'post' });
  });

  it('구체 카드가 없는 행(시작·시스템·하루 요약)은 기록 쪽 피드만 연다', () => {
    expect(navTargetOf(base({ kind: 'start', why: 'daily' }))).toEqual({ kind: 'feed', reveal: 'entry' });
    expect(navTargetOf(base({ kind: 'system', why: 'quiet', actor: null })))
      .toEqual({ kind: 'feed', reveal: 'entry' });
    expect(navTargetOf(base({ kind: 'react', why: 'react_daily', actors: ['th'] })))
      .toEqual({ kind: 'feed', reveal: 'entry' });
  });

  // 접힌 줄은 서로 다른 기록의 댓글 묶음 — 대표 한 건으로 딥링크하면 나머지가 묻힌다
  it('접힌 줄은 대표에 entryId가 있어도 피드만 연다', () => {
    const a = base({ id: 'a', why: 'all', entryId: 'e1' });
    const b = base({ id: 'b', why: 'all', entryId: 'e2' });
    const row: NotiRow = { key: 'all:2026-08-14', head: a, group: [a, b] };
    expect(navTargetOfRow(row)).toEqual({ kind: 'feed', reveal: 'entry' });
    // 일반 행(원본 하나)은 그대로 head의 판정을 따른다
    expect(navTargetOfRow({ key: 'a', head: a, group: [a] })).toEqual({ kind: 'entry', id: 'e1' });
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
