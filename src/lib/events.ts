/* 크루 일정의 표시 규칙 — D-day 라벨, 임박·지남 판정, 걸친 날짜, 날짜 문구.
   캘린더 셀·선택일 패널·홈 배너·등록 시트가 같은 일정을 서로 다르게 세지 않도록 한 곳에 둔다
   (기록 집계를 stats.ts에 모아 둔 것과 같은 이유다). */
import type { CrewEvent, MemberId } from '../../shared/types';
import { EVENT_LIMITS } from '../../shared/types';
import { W, membersOfEntries, pad2, type Member } from './constants';

/** 임박 강조 기준 — 시작까지 이 날 수 이내면 노란 옷을 입는다(디자인 urgentDays). */
export const URGENT_DAYS = 7;

/** 날짜 키를 자정 UTC ms로. 로컬 시각으로 파싱하면 서머타임이 있는 지역에서 하루가
    23·25시간이 되어 "며칠 남았나"가 하루씩 어긋난다. */
function dayMs(day: string): number {
  return Date.parse(`${day}T00:00:00.000Z`);
}

/** from에서 to까지의 날 수 (미래가 양수). 둘 다 YYYY-MM-DD여야 한다. */
export function dayDiff(from: string, to: string): number {
  return Math.round((dayMs(to) - dayMs(from)) / 86_400_000);
}

/** 날짜 키를 n일 옮긴 키 — 달·해 경계는 Date 연산이 알아서 넘어간다. */
export function shiftDay(day: string, n: number): string {
  const d = new Date(dayMs(day) + n * 86_400_000);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** D-DAY / D-3 / D+2 — 기준은 늘 시작일이다. */
export function dLabel(day: string, todayKey: string): string {
  const diff = dayDiff(todayKey, day);
  return diff === 0 ? 'D-DAY' : diff > 0 ? `D-${diff}` : `D+${-diff}`;
}

/** 오늘이 기간 안에 든 기간 일정 — 시험 기간 한복판이다.
    하루 일정은 여기 들지 않는다: 오늘 하루짜리는 "진행 중"이 아니라 D-DAY다. */
export function isOngoing(ev: Pick<CrewEvent, 'day' | 'endDay'>, todayKey: string): boolean {
  if (!ev.endDay || ev.endDay <= ev.day) return false;
  return ev.day <= todayKey && todayKey <= ev.endDay;
}

/** 일정이 지금 어디쯤인가 — 색과 접두 라벨이 이 셋으로 갈린다.
    'past'는 마지막 날까지 지난 것만이다: 기간 일정은 시작일이 지났어도 아직 진행 중이면
    지난 일정이 아니다. 'near'는 시작이 URGENT_DAYS 안으로 들어온 상태 — 진행 중인 기간
    일정도 여기 든다(이미 겪고 있는 일이 다음 주 시험보다 덜 급할 수는 없다). */
export type EventPhase = 'past' | 'near' | 'ahead';

export function eventPhase(ev: Pick<CrewEvent, 'day' | 'endDay'>, todayKey: string): EventPhase {
  if ((ev.endDay ?? ev.day) < todayKey) return 'past';
  // 지남을 걸러낸 뒤라 시작이 이미 지난 것은 진행 중인 기간 일정뿐이다 — 그것도 임박으로 본다
  return dayDiff(todayKey, ev.day) <= URGENT_DAYS ? 'near' : 'ahead';
}

/** 셀·행에 붙는 접두 — 지난 일정은 며칠 지났는지보다 "지났다"가 먼저다(디자인).
    진행 중인 기간 일정은 시작일 기준 D+n이 어색하다("D+6"은 지난 일처럼 읽힌다) — 지금
    겪고 있다고 그대로 말한다. */
export function eventDdayLabel(ev: Pick<CrewEvent, 'day' | 'endDay'>, todayKey: string): string {
  if (eventPhase(ev, todayKey) === 'past') return '지남';
  return isOngoing(ev, todayKey) ? '진행 중' : dLabel(ev.day, todayKey);
}

/** 이 일정이 걸치는 날짜 키들 — 하루 일정은 하나, 기간 일정은 시작·종료 포함 전부.
    서버 한도(spanDays)로 끊는다: 정규화를 거치지 않은 값이 들어와도 루프가 폭주하지 않는다. */
export function eventDays(ev: Pick<CrewEvent, 'day' | 'endDay'>): string[] {
  const days = [ev.day];
  if (!ev.endDay || ev.endDay <= ev.day) return days;
  const span = Math.min(dayDiff(ev.day, ev.endDay), EVENT_LIMITS.spanDays);
  for (let i = 1; i <= span; i++) days.push(shiftDay(ev.day, i));
  return days;
}

/** 시작일 이른 순 — 같은 날이면 제목, 그래도 같으면 id로 끊는다.
    정렬 기준이 흔들리면 같은 셀의 알약 순서가 렌더마다 바뀐다. */
function byStart(a: CrewEvent, b: CrewEvent): number {
  return a.day.localeCompare(b.day) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
}

/** 날짜 → 그 날에 걸린 일정. 기간 일정은 걸친 모든 날에 들어간다. */
export function eventsByDay(events: readonly CrewEvent[]): Map<string, CrewEvent[]> {
  const byDay = new Map<string, CrewEvent[]>();
  for (const ev of [...events].sort(byStart)) {
    for (const day of eventDays(ev)) {
      const list = byDay.get(day);
      if (list) list.push(ev);
      else byDay.set(day, [ev]);
    }
  }
  return byDay;
}

/** 다가오는 일정 하나 — 아직 안 끝난 것 중 가장 이른 것. 없으면 null. */
export function upcomingEvent(events: readonly CrewEvent[], todayKey: string): CrewEvent | null {
  let best: CrewEvent | null = null;
  for (const ev of events) {
    if ((ev.endDay ?? ev.day) < todayKey) continue;
    if (!best || byStart(ev, best) < 0) best = ev;
  }
  return best;
}

/* ---------- 참여 인원 ---------- */

/** 이 일정의 당사자 id — 비어 있으면 등록자 하나로 되살린다.
    경계 정규화(normalizeCrewEvent)가 이미 하는 일이지만 화면도 같은 폴백을 갖는다:
    참여자를 모르던 시절에 심은 데모 시드처럼 정규화를 지나지 않은 값이 들어와도
    "사람 없는 일정"이 되면 안 된다 — 등록한 사람은 언제나 있다. */
export function eventParticipants(ev: Pick<CrewEvent, 'm' | 'participants'>): MemberId[] {
  const ids = ev.participants ?? [];
  return ids.length > 0 ? [...ids] : [ev.m];
}

/** 참여자를 표시용 멤버로 — 크루 고정 순서, 모르는 id는 중립 표시로 뒤에 남는다.
    기록의 멤버 목록과 같은 함수를 지난다: 한 화면에서 사람을 찾는 기준이 둘일 수 없다. */
export function eventMembers(ev: Pick<CrewEvent, 'm' | 'participants'>): Member[] {
  return membersOfEntries(eventParticipants(ev).map((m) => ({ m })));
}

/** 그 날 일정들의 참여자를 합친 멤버 목록 — 셀의 네모 점 하나가 사람 한 명이다.
    한 사람이 그 날 일정 둘에 들어 있어도 점은 하나다(기록 동그라미와 같은 규칙). */
export function eventsDayMembers(events: readonly CrewEvent[]): Member[] {
  return membersOfEntries(events.flatMap((ev) => eventParticipants(ev).map((m) => ({ m }))));
}

/** 참여자 이름 요약 — "승환" / "승환·웅" / "승환 외 2".
    셋부터 이름을 접는 이유: 이 문자열이 서는 자리(패널 행 부제·홈 배너)는 뒤에 날짜와
    메모가 붙는 한 줄이라, 이름을 다 이으면 정작 "언제"가 말줄임으로 먼저 잘린다. */
export function participantsLabel(members: readonly { name: string }[]): string {
  const names = members.map((m) => m.name);
  if (names.length <= 2) return names.join('·');
  return `${names[0]} 외 ${names.length - 1}`;
}

function parts(day: string): { y: number; m: number; d: number } {
  return { y: Number(day.slice(0, 4)), m: Number(day.slice(5, 7)), d: Number(day.slice(8, 10)) };
}

/** "8월 18일 (화)" — 하루짜리 날짜 한 줄. */
export function dayLabel(day: string): string {
  const p = parts(day);
  return `${p.m}월 ${p.d}일 (${W[new Date(p.y, p.m - 1, p.d).getDay()]})`;
}

/** 기간 문구 — "8월 18일" / 같은 달이면 "8월 18–20일" / 달을 넘기면 "8월 30일–9월 2일".
    요일을 붙이지 않는 짧은 형태라 제출 버튼과 토스트가 이걸 쓴다. */
export function eventSpanLabel(day: string, endDay: string | null): string {
  const s = parts(day);
  if (!endDay || endDay <= day) return `${s.m}월 ${s.d}일`;
  const e = parts(endDay);
  return s.y === e.y && s.m === e.m
    ? `${s.m}월 ${s.d}–${e.d}일`
    : `${s.m}월 ${s.d}일–${e.m}월 ${e.d}일`;
}

/** 일정이 언제인가 — 하루면 요일까지, 기간이면 기간 문구(디자인 dateLabel). */
export function eventWhenLabel(day: string, endDay: string | null): string {
  return endDay && endDay > day ? eventSpanLabel(day, endDay) : dayLabel(day);
}
