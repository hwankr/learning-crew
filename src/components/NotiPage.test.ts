import { describe, expect, it, vi } from 'vitest';
import type { MemberId, Notification } from '../../shared/types';
import { displayActorOf, readRow, type NotiRow } from './NotiPage';

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
