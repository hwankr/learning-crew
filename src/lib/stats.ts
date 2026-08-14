/* 멤버별 기록 집계 — 캘린더가 갖고 있던 계산을 크루 패널의 월 요약이 이어받는다.
   두 화면이 같은 숫자를 서로 다르게 세는 일이 없도록 한 곳에 둔다. */
import type { Entry, MemberId } from '../../shared/types';
import { dayKey } from './constants';

/** 이 멤버가 기록을 남긴 날짜 집합 — 월 일수도 연속일도 여기서 나온다. */
export function daysOf(entries: readonly Entry[], m: MemberId): Set<string> {
  const days = new Set<string>();
  for (const e of entries) if (e.m === m) days.add(e.day);
  return days;
}

/** 오늘부터 거꾸로 센 연속 기록일. 오늘 아직 안 남긴 건 봐준다(어제까지 이어짐) —
    하루가 시작되자마자 연속이 0으로 보이면 이어 갈 마음이 먼저 꺾인다.
    Date를 하나만 두고 되감는다: 366일치 날짜 문자열을 매 렌더 새로 만드는 자리다. */
export function streakOf(days: ReadonlySet<string>, today: Date): number {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  let streak = 0;
  for (let i = 0; i <= 366; i++) {
    if (days.has(dayKey(d))) streak++;
    else if (i > 0) break;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

/** 'YYYY-MM-' 접두사에 해당하는 달의 기록일 수. */
export function monthDaysOf(days: ReadonlySet<string>, prefix: string): number {
  let n = 0;
  for (const d of days) if (d.startsWith(prefix)) n++;
  return n;
}
