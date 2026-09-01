/* 월 집계의 "공부한 날" 합성 검증 — 기록·서버 도장 이력·아직 안 온 최근 시작·라이브 세션이
   한 집합으로 모이고, 도장 유래 날짜가 전부 KST 규약 하나로 파생되는지를 본다.
   (KST 파생은 러너 시간대와 무관하다 — 기록 날짜는 문자열 그대로라 역시 무관하다.) */
import { describe, expect, it } from 'vitest';
import type { Entry, MemberStatus, Tag } from '../../shared/types';
import { STUDY_MINUTES_MAX } from '../../shared/types';
import {
  dayTagsOf, daysOf, maxStreakOf, monthDaysOf, monthKeysOf, streakOf, studyDaysOf,
  studyTimeByDayOf, studyTimeSummaryOf,
} from './stats';

const entry = (day: string, tags: Tag[] = ['영어'], studyMinutes: number | null = null): Entry => ({
  id: `e-${day}-${tags.join('+')}`, m: 'sh', day, time: '10:00',
  tag: tags[0] ?? '기타', tags, stars: 3, memo: '', body: '', todos: [], photos: [],
  studyMinutes,
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

describe('dayTagsOf', () => {
  it('같은 날의 여러 기록을 태그 합집합으로 모은다 — 중복 없이 등장 순서', () => {
    const map = dayTagsOf([
      entry('2026-08-12', ['자격증', '영어']),
      entry('2026-08-12', ['영어', '코딩테스트']),
      entry('2026-08-13', ['OFF']),
      { ...entry('2026-08-14'), m: 'wg' }, // 남의 기록은 안 섞인다
    ], 'sh');
    expect(map.get('2026-08-12')).toEqual(['자격증', '영어', '코딩테스트']);
    expect(map.get('2026-08-13')).toEqual(['OFF']); // OFF도 그대로 — 뺄지는 보는 쪽 몫
    expect(map.has('2026-08-14')).toBe(false);
  });
});

describe('studyTimeByDayOf', () => {
  it('같은 날 여러 기록의 분은 합치고 입력일 평균의 분모는 날짜 하나다', () => {
    const days = studyTimeByDayOf([
      { ...entry('2026-08-12', ['영어'], 40), id: 'a' },
      { ...entry('2026-08-12', ['자격증'], 80), id: 'b' },
      { ...entry('2026-08-13', ['영어'], 30), id: 'c' },
    ], 'sh');

    expect(days.get('2026-08-12')).toEqual({
      minutes: 120, recordedEntries: 2, missingEntries: 0,
    });
    expect(studyTimeSummaryOf(days)).toEqual({ minutes: 150, recordedDays: 2 });
  });

  it('null·손상된 0분은 미입력이고, 숫자 시간이 없는 날은 평균 분모에서 빠진다', () => {
    const days = studyTimeByDayOf([
      { ...entry('2026-08-12', ['영어'], null), id: 'a' },
      { ...entry('2026-08-13', ['영어'], 0), id: 'b' },
      { ...entry('2026-08-13', ['영어'], null), id: 'c' },
      { ...entry('2026-08-14', ['영어'], 20), id: 'd' },
      { ...entry('2026-08-15', ['영어'], STUDY_MINUTES_MAX + 1), id: 'e' },
    ], 'sh');

    expect(days.get('2026-08-12')).toEqual({
      minutes: 0, recordedEntries: 0, missingEntries: 1,
    });
    expect(days.get('2026-08-13')).toEqual({
      minutes: 0, recordedEntries: 0, missingEntries: 2,
    });
    expect(days.get('2026-08-15')).toEqual({
      minutes: 0, recordedEntries: 0, missingEntries: 1,
    });
    expect(studyTimeSummaryOf(days)).toEqual({ minutes: 20, recordedDays: 1 });
  });

  it('태그 선택은 해당 태그 포함 기록의 시간을 통째로 더하고 OFF·다른 멤버는 제외한다', () => {
    const rows: Entry[] = [
      { ...entry('2026-08-12', ['자격증', '영어'], 60), id: 'a' },
      { ...entry('2026-08-12', ['영어'], null), id: 'b' },
      { ...entry('2026-08-13', ['자격증'], 30), id: 'c' },
      { ...entry('2026-08-14', ['OFF'], 999), id: 'd', stars: null },
      { ...entry('2026-08-15', ['영어'], 90), id: 'e', m: 'wg' },
    ];

    const english = studyTimeByDayOf(rows, 'sh', '영어');
    expect(studyTimeSummaryOf(english)).toEqual({ minutes: 60, recordedDays: 1 });
    expect(english.get('2026-08-12')).toEqual({
      minutes: 60, recordedEntries: 1, missingEntries: 1,
    });

    // 다중 태그 60분은 자격증에서도 다시 포함된다 — 서로 배타적인 비중 값이 아니다.
    expect(studyTimeSummaryOf(studyTimeByDayOf(rows, 'sh', '자격증')))
      .toEqual({ minutes: 90, recordedDays: 2 });
  });

  it('기간 조건은 합계와 입력일 수에 함께 적용된다', () => {
    const days = studyTimeByDayOf([
      entry('2026-07-31', ['영어'], 20),
      entry('2026-08-01', ['영어'], 40),
      entry('2026-08-02', ['영어'], null),
    ], 'sh');

    expect(studyTimeSummaryOf(days, (day) => day.startsWith('2026-08-')))
      .toEqual({ minutes: 40, recordedDays: 1 });
  });
});

describe('maxStreakOf', () => {
  it('월 경계를 넘는 연속 구간도 하나로 센다', () => {
    expect(maxStreakOf(new Set([
      '2026-07-30', '2026-07-31', '2026-08-01', // 3연속 — 최장
      '2026-08-05', '2026-08-06', // 2연속
    ]))).toBe(3);
  });

  it('빈 집합은 0, 하루면 1', () => {
    expect(maxStreakOf(new Set())).toBe(0);
    expect(maxStreakOf(new Set(['2026-08-05']))).toBe(1);
  });
});

describe('monthKeysOf', () => {
  it('가장 이른 기록 달부터 이번 달까지 — 빈 달도 자리에 남는다', () => {
    expect(monthKeysOf(new Set(['2026-05-10', '2026-08-01']), TODAY))
      .toEqual(['2026-05', '2026-06', '2026-07', '2026-08']);
  });

  it('해를 넘긴 범위도 이어진다', () => {
    expect(monthKeysOf(new Set(['2025-11-30']), TODAY))
      .toEqual(['2025-11', '2025-12', ...Array.from({ length: 8 }, (_, i) => `2026-0${i + 1}`)]);
  });

  it('기록이 없으면 이번 달 하나', () => {
    expect(monthKeysOf(new Set(), TODAY)).toEqual(['2026-08']);
  });

  it('아주 먼 과거·미래도 이번 달을 품는 120개월 창으로 접는다', () => {
    const past = monthKeysOf(new Set(['1996-01-15']), TODAY);
    expect(past).toHaveLength(120);
    expect(past[0]).toBe('2016-09');
    expect(past[119]).toBe('2026-08'); // 창을 접어도 이번 달은 남는다
    const future = monthKeysOf(new Set(['2041-01-01']), TODAY);
    expect(future).toHaveLength(120);
    expect(future[0]).toBe('2026-08');
    expect(future[119]).toBe('2036-07'); // 창 밖의 먼 미래 달은 접는다
  });

  it('미래 달의 기록이 있으면 그 달까지 편다 — 누적에 세는 달이 목록에 없으면 어긋난다', () => {
    expect(monthKeysOf(new Set(['2026-12-01']), TODAY))
      .toEqual(['2026-08', '2026-09', '2026-10', '2026-11', '2026-12']);
  });
});
