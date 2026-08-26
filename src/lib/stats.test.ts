/* 월 집계의 "공부한 날" 합성 검증 — 기록·서버 도장 이력·아직 안 온 최근 시작·라이브 세션이
   한 집합으로 모이고, 도장 유래 날짜가 전부 KST 규약 하나로 파생되는지를 본다.
   (KST 파생은 러너 시간대와 무관하다 — 기록 날짜는 문자열 그대로라 역시 무관하다.) */
import { describe, expect, it } from 'vitest';
import type { Entry, MemberStatus } from '../../shared/types';
import { daysOf, monthDaysOf, streakOf, studyDaysOf } from './stats';

const entry = (day: string): Entry => ({
  id: `e-${day}`, m: 'sh', day, time: '10:00',
  tag: '영어', tags: ['영어'], stars: 3, memo: '', body: '', todos: [], photos: [],
  v: 1, updatedAt: `${day}T03:00:00.000Z`, deletedAt: null,
});

const TODAY = new Date(2026, 7, 14); // 2026-08-14 (로컬)
const NOW = Date.parse('2026-08-14T03:00:00.000Z'); // KST 8/14 12:00

describe('studyDaysOf', () => {
  it('상태도 도장 이력도 없으면 기록 날짜와 같다', () => {
    const entries = [entry('2026-08-12'), entry('2026-08-13')];
    expect(studyDaysOf(entries, 'sh', undefined, undefined, NOW))
      .toEqual(daysOf(entries, 'sh'));
  });

  it('서버 도장 이력을 기록 날짜에 합친다 — 기록 없는 체크인 날이 세진다', () => {
    const days = studyDaysOf(
      [entry('2026-08-12')], 'sh', new Set(['2026-08-10', '2026-08-12']), undefined, NOW,
    );
    expect(days).toEqual(new Set(['2026-08-10', '2026-08-12']));
  });

  it('아직 pull로 안 온 최근 시작(lastStartedAt)을 KST 날짜로 더한다 — 서버 이력과 같은 날 하나만', () => {
    const status: MemberStatus = {
      m: 'sh', on: false, place: null, since: null,
      // UTC 8/14 16:00 = KST 8/15 01:00 — 서버 이력도 8/15로 남는 시각. 로컬 규약이 섞이면
      // 이 체크인 하나가 8/14와 8/15 이틀로 불어난다(코덱스 리뷰가 잡은 이중 계산).
      lastStartedAt: '2026-08-14T16:00:00.000Z',
      updatedAt: '2026-08-14T17:00:00.000Z',
    };
    const days = studyDaysOf([], 'sh', new Set(['2026-08-15']), status, NOW);
    expect(days).toEqual(new Set(['2026-08-15']));
  });

  it('자정을 넘겨 아직 켜져 있는 세션은 KST 오늘도 더한다 — 보드의 라이브 도장과 같은 날', () => {
    const status: MemberStatus = {
      m: 'sh', on: true, place: '도서관',
      since: '2026-08-13T15:00:00.000Z', // KST 8/14 00:00 시작 — 켜진 채 자정을 넘긴 세션
      lastStartedAt: '2026-08-13T14:30:00.000Z', // KST 8/13 23:30
      updatedAt: '2026-08-13T15:00:00.000Z',
    };
    const now = Date.parse('2026-08-13T16:00:00.000Z'); // KST 8/14 01:00
    expect(studyDaysOf([], 'sh', undefined, status, now))
      .toEqual(new Set(['2026-08-13', '2026-08-14']));
  });

  it('도장 날이 기록 사이 빈 날을 이어 연속일이 끊기지 않는다', () => {
    const days = studyDaysOf(
      [entry('2026-08-11'), entry('2026-08-13')], 'sh', new Set(['2026-08-12']),
      undefined, NOW,
    );
    expect(monthDaysOf(days, '2026-08-')).toBe(3);
    expect(streakOf(days, TODAY)).toBe(3); // 오늘은 아직 없어도 봐준다 — 11·12·13 연속
  });
});
