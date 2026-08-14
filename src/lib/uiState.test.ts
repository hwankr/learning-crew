/* 화면 상태는 신뢰할 수 없는 localStorage에서 온다 — 형식만 날짜처럼 생긴 값이
   캘린더의 달과 선택일 제목을 갈라놓지 않게 복원 경계를 검증한다. */
import { afterEach, describe, expect, it } from 'vitest';
import { calOffOf, loadUi, sameDayInMonth } from './uiState';

const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

function stored(value: string): void {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: () => value },
  });
}

afterEach(() => {
  if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
  else Reflect.deleteProperty(globalThis, 'localStorage');
});

describe('loadUi', () => {
  it('유효한 화면 상태를 복원한다', () => {
    stored(JSON.stringify({ view: 'feed', mtab: 'alerts', panelOpen: true, selDay: '2024-02-29' }));
    expect(loadUi()).toEqual({ view: 'feed', mtab: 'alerts', panelOpen: true, selDay: '2024-02-29' });
  });

  // 넓은 셸과 좁은 셸의 탭은 값 집합이 다르다 — 모르는 값이 통과하면 좁은 화면이
  // 어느 탭도 아닌 상태로 열려 본문이 통째로 빈다
  it.each(['notiset', 'noti', 'cal ', '', 42])(
    '모르는 모바일 탭 %s는 나머지 상태와 분리해 버린다',
    (mtab) => {
      stored(JSON.stringify({ view: 'cal', mtab }));
      expect(loadUi()).toEqual({ view: 'cal' });
    },
  );

  it.each(['2026-00-10', '2026-13-10', '2026-02-29', '2026-04-31', 'not-a-day'])(
    '달력에 없는 선택일 %s는 나머지 상태와 분리해 버린다',
    (selDay) => {
      stored(JSON.stringify({ view: 'cal', panelOpen: false, selDay }));
      expect(loadUi()).toEqual({ view: 'cal', panelOpen: false });
    },
  );
});

describe('calOffOf', () => {
  const august = new Date(2026, 7, 14);

  it('선택일의 연·월을 현재 달 기준 오프셋으로 바꾼다', () => {
    expect(calOffOf('2025-12-31', august)).toBe(-8);
    expect(calOffOf('2027-02-01', august)).toBe(6);
  });

  it('깨진 선택일은 현재 달로 되돌린다', () => {
    expect(calOffOf('2026-02-30', august)).toBe(0);
    expect(calOffOf('2026-99-99', august)).toBe(0);
  });
});

describe('sameDayInMonth', () => {
  it('같은 일(日)을 옮긴 달의 키로 돌려준다', () => {
    expect(sameDayInMonth(new Date(2026, 8, 1), '2026-08-14')).toBe('2026-09-14');
    expect(sameDayInMonth(new Date(2026, 6, 1), '2026-08-01')).toBe('2026-07-01');
  });

  it('그 달에 없는 일자는 말일로 당긴다', () => {
    expect(sameDayInMonth(new Date(2026, 1, 1), '2026-01-31')).toBe('2026-02-28');
    expect(sameDayInMonth(new Date(2024, 1, 1), '2024-01-31')).toBe('2024-02-29'); // 윤년
    expect(sameDayInMonth(new Date(2026, 3, 1), '2026-03-31')).toBe('2026-04-30');
  });

  it('깨진 선택일은 1일로 받는다', () => {
    expect(sameDayInMonth(new Date(2026, 8, 1), '2026-02-30')).toBe('2026-09-01');
  });
});
