/* 도장 이력 스트림의 스토어 수명 검증 — 삽입-전용 스트림이 pull로 쌓이고,
   깨진 행을 경계에서 거르며, 스냅샷이 멤버별 집합으로 파생되는지를 본다.
   체크인이 낙관 행 + push 큐를 남기는 경로도 여기서 본다: status는 현재값 1행으로
   병합되므로 오프라인 여러 날의 도장은 이 큐만이 서버로 나른다.
   (IDB 없는 메모리 전용 경로 — 다른 스토어 테스트와 같은 전제) */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StudyDay } from '../../shared/types';
import { CrewStore, groupStudyDays } from './store';

afterEach(() => {
  vi.useRealTimers();
});

function pullDays(store: CrewStore, rows: unknown[]): void {
  store.applyPull({
    rows: [],
    cursor: null,
    studyDays: rows as StudyDay[],
    studyDayCursor: null,
  });
}

describe('도장 이력 스토어', () => {
  it('pull로 받은 행이 멤버별 날짜 집합으로 스냅샷에 실린다', () => {
    const store = new CrewStore();
    pullDays(store, [
      { m: 'sh', day: '2026-08-13' },
      { m: 'sh', day: '2026-08-14' },
      { m: 'wg', day: '2026-08-14' },
    ]);
    const snap = store.getSnapshot();
    expect(snap.studyDays.sh).toEqual(new Set(['2026-08-13', '2026-08-14']));
    expect(snap.studyDays.wg).toEqual(new Set(['2026-08-14']));
    expect(snap.studyDays.th).toBeUndefined();
  });

  it('중복 전달(커서 안전 윈도우)은 무시되고, 깨진 행은 경계에서 걸러진다', () => {
    const store = new CrewStore();
    pullDays(store, [{ m: 'sh', day: '2026-08-13' }]);
    const rev0 = store.getSnapshot().rev;
    pullDays(store, [
      { m: 'sh', day: '2026-08-13' }, // 같은 행 다시
      { m: 'zz', day: '2026-08-13' }, // 모르는 멤버
      { m: 'wg', day: '13일' }, // 날짜 형식 밖
      { m: 'wg' }, // 필드 누락
    ]);
    const snap = store.getSnapshot();
    expect(snap.rev).toBe(rev0); // 실질 변경 없음 — bump가 돌지 않는다
    expect(snap.studyDays.sh).toEqual(new Set(['2026-08-13']));
    expect(snap.studyDays.wg).toBeUndefined();
  });

  it('변경 없는 bump에서는 파생 집합 참조가 유지된다 — 월 요약이 헛 렌더를 돌지 않게', () => {
    const store = new CrewStore();
    pullDays(store, [{ m: 'sh', day: '2026-08-13' }]);
    const before = store.getSnapshot().studyDays;
    store.setSyncPhase('error'); // 무관한 bump
    expect(store.getSnapshot().studyDays).toBe(before);
  });

  it('체크인은 KST 오늘 도장을 즉시 행으로 남기고 push 큐에 올린다', () => {
    vi.useFakeTimers();
    vi.setSystemTime('2026-08-14T03:00:00.000Z'); // KST 8/14 12:00
    const store = new CrewStore();
    store.setMyStatus(true, '도서관');
    expect(store.getSnapshot().studyDays.sh).toEqual(new Set(['2026-08-14']));
    expect(store.pendingStudyDays()).toEqual([{ m: 'sh', day: '2026-08-14' }]);
    // 상태 dirty(1) + 도장 큐(1) — 미전송 카운트에 함께 잡힌다
    expect(store.getSnapshot().sync.pending).toBe(2);
  });

  it('KST 자정을 넘긴 종료는 종료일 도장을 추가로 남긴다 — 오프라인이어도 이틀 다 큐에 남는다', () => {
    vi.useFakeTimers();
    vi.setSystemTime('2026-08-14T14:30:00.000Z'); // KST 8/14 23:30
    const store = new CrewStore();
    store.setMyStatus(true, '집');
    vi.setSystemTime('2026-08-14T15:30:00.000Z'); // KST 8/15 00:30
    store.setMyStatus(false, null);
    expect(store.getSnapshot().studyDays.sh).toEqual(new Set(['2026-08-14', '2026-08-15']));
    expect(store.pendingStudyDays().map((s) => s.day)).toEqual(['2026-08-14', '2026-08-15']);

    // 서버가 에코한 날짜만 정산된다 — 나머지는 큐에 남아 재전송된다
    store.ackStudyDays(['2026-08-14']);
    expect(store.pendingStudyDays().map((s) => s.day)).toEqual(['2026-08-15']);
  });

  it('서버 이력이 먼저 온 날의 체크인은 큐에 다시 올리지 않는다', () => {
    vi.useFakeTimers();
    vi.setSystemTime('2026-08-14T03:00:00.000Z');
    const store = new CrewStore();
    pullDays(store, [{ m: 'sh', day: '2026-08-14' }]);
    store.setMyStatus(true, '카페');
    expect(store.pendingStudyDays()).toEqual([]);
    expect(store.getSnapshot().studyDays.sh).toEqual(new Set(['2026-08-14']));
  });

  it('groupStudyDays는 멤버별로 묶는다', () => {
    expect(groupStudyDays([
      { m: 'sh', day: '2026-08-01' },
      { m: 'sh', day: '2026-08-02' },
      { m: 'jj', day: '2026-08-01' },
    ])).toEqual({
      sh: new Set(['2026-08-01', '2026-08-02']),
      jj: new Set(['2026-08-01']),
    });
  });
});
