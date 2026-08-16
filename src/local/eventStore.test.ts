import { describe, expect, it } from 'vitest';
import type { CrewEvent } from '../../shared/types';
import { CrewStore, eventContentEqual, mergeCrewEvent } from './store';

const EVENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function event(partial: Partial<CrewEvent> = {}): CrewEvent {
  return {
    id: EVENT_ID,
    m: 'sh',
    participants: ['sh'],
    title: '면접',
    tag: '기타',
    memo: '',
    day: '2026-08-20',
    endDay: null,
    v: 0,
    updatedAt: '2026-08-16T00:00:00.000Z',
    deletedAt: null,
    ...partial,
  };
}

describe('CrewEvent 로컬 스토어', () => {
  it('upsertEvent는 정규화한 행을 즉시 노출하고 CAS 큐에 올린다', () => {
    const store = new CrewStore();
    store.upsertEvent(event({
      id: EVENT_ID.toUpperCase(),
      title: '  최종   면접  ',
      tag: 'OFF',
      endDay: '잘못된 날짜',
    }));

    expect(store.getSnapshot().events).toEqual([
      expect.objectContaining({
        id: EVENT_ID,
        title: '최종   면접',
        tag: '기타',
        endDay: null,
      }),
    ]);
    expect(store.pendingEvents()).toHaveLength(1);
    expect(store.getSnapshot().sync.pending).toBe(1);
  });

  it('제출한 커스텀 태그는 CrewEvent.tag에 그대로 저장한다', () => {
    const store = new CrewStore();
    store.upsertEvent(event({ tag: '면접 준비' }));
    expect(store.getSnapshot().events[0]?.tag).toBe('면접 준비');
    expect(store.pendingEvents()[0]?.tag).toBe('면접 준비');
  });

  it('removeEvent는 내 일정만 soft delete하고 tombstone을 큐에 유지한다', () => {
    const store = new CrewStore();
    store.upsertEvent(event());
    store.removeEvent(EVENT_ID);
    expect(store.getSnapshot().events).toHaveLength(0);
    expect(store.pendingEvents()[0]!.deletedAt).not.toBeNull();

    const foreign = event({
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      m: 'wg',
      v: 1,
    });
    store.applyPull({ rows: [], cursor: null, events: [foreign], eventCursor: null });
    store.removeEvent(foreign.id);
    expect(store.getSnapshot().events.map((row) => row.id)).toContain(foreign.id);
  });

  it('성공 ACK는 서버 v/시각을 채택하고 큐를 비운다', () => {
    const store = new CrewStore();
    store.upsertEvent(event());
    const pending = store.pendingEventSnapshot()[0]!;
    store.ackEventApplied(EVENT_ID, pending.rev, event({
      v: 1,
      updatedAt: '2026-08-16T01:00:00.000Z',
    }));
    expect(store.pendingEvents()).toHaveLength(0);
    expect(store.getSnapshot().events[0]).toMatchObject({ v: 1, updatedAt: '2026-08-16T01:00:00.000Z' });
  });

  it('CAS 충돌은 base에서 로컬이 고친 필드와 서버의 다른 필드를 합쳐 재전송한다', () => {
    const store = new CrewStore();
    store.upsertEvent(event());
    const first = store.pendingEventSnapshot()[0]!;
    const serverV1 = event({ v: 1, updatedAt: '2026-08-16T01:00:00.000Z' });
    store.ackEventApplied(EVENT_ID, first.rev, serverV1);

    store.upsertEvent({
      ...serverV1,
      title: '내가 고친 제목',
      updatedAt: '2026-08-16T01:01:00.000Z',
    });
    store.resolveEventConflict(EVENT_ID, event({
      v: 2,
      memo: '다른 기기 메모',
      updatedAt: '2026-08-16T01:02:00.000Z',
    }));

    expect(store.pendingEvents()[0]).toMatchObject({
      v: 2,
      title: '내가 고친 제목',
      memo: '다른 기기 메모',
    });
  });

  it('서버 tombstone 충돌은 로컬 수정을 버리고 삭제를 채택한다', () => {
    const store = new CrewStore();
    store.upsertEvent(event());
    store.resolveEventConflict(EVENT_ID, event({
      v: 2,
      deletedAt: '2026-08-16T02:00:00.000Z',
    }));
    expect(store.pendingEvents()).toHaveLength(0);
    expect(store.getSnapshot().events).toHaveLength(0);
  });

  it('데모 모드는 일정 변경을 메모리에만 반영한다', async () => {
    const store = new CrewStore();
    await store.init({ demo: true, memberId: 'sh', token: null });
    store.upsertEvent(event());
    expect(store.getSnapshot().events).toHaveLength(1);
    expect(store.pendingEvents()).toHaveLength(0);
  });
});

describe('CrewEvent 충돌 순수 로직', () => {
  it('메타데이터만 다르면 같은 내용이고 필드 변경은 다르다', () => {
    expect(eventContentEqual(event(), event({ v: 9, updatedAt: '2026-08-16T09:00:00.000Z' })))
      .toBe(true);
    expect(eventContentEqual(event(), event({ title: '다른 제목' }))).toBe(false);
  });

  it('3-way 병합은 로컬이 건드리지 않은 필드를 서버에서 받는다', () => {
    expect(mergeCrewEvent(
      event(),
      event({ title: '내 제목' }),
      event({ memo: '서버 메모', v: 2 }),
    )).toMatchObject({ title: '내 제목', memo: '서버 메모', v: 2 });
  });

  it('participants도 내용으로 비교하고 로컬 변경을 CAS 병합에서 보존한다', () => {
    expect(eventContentEqual(event(), event({ participants: ['sh', 'wg'] }))).toBe(false);
    expect(mergeCrewEvent(
      event(),
      event({ participants: ['wg', 'sh'] }),
      event({ memo: '서버 메모', v: 2 }),
    )).toMatchObject({ participants: ['sh', 'wg'], memo: '서버 메모', v: 2 });
  });
});
