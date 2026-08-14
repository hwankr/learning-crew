/* 화면 상태는 신뢰할 수 없는 localStorage에서 온다 — 형식만 날짜처럼 생긴 값이
   캘린더의 달과 선택일 제목을 갈라놓지 않게 복원 경계를 검증한다. */
import { afterEach, describe, expect, it } from 'vitest';
import { calOffOf, loadUi } from './uiState';

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
    stored(JSON.stringify({ view: 'feed', panelOpen: true, selDay: '2024-02-29' }));
    expect(loadUi()).toEqual({ view: 'feed', panelOpen: true, selDay: '2024-02-29' });
  });

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
