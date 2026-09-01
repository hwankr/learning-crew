/* 멤버별 기록 집계 — 캘린더가 갖고 있던 계산을 크루 패널의 월 요약이 이어받는다.
   두 화면이 같은 숫자를 서로 다르게 세는 일이 없도록 한 곳에 둔다. */
import type { Entry, MemberId, MemberStatus, Tag } from '../../shared/types';
import { STUDY_MINUTES_MAX, entryTags, isOffTags, isStatusActive } from '../../shared/types';
import { kstDayStr } from '../../shared/notify';
import { dayKey, pad2 } from './constants';

/** 이 멤버가 기록을 남긴 날짜 집합 — 월 일수도 연속일도 여기서 나온다. */
export function daysOf(entries: readonly Entry[], m: MemberId): Set<string> {
  const days = new Set<string>();
  for (const e of entries) if (e.m === m) days.add(e.day);
  return days;
}

/** 기록과 도장을 합친 "공부한 날" 집합 — 기록을 안 남겨도 체크인(오늘 공부함)이면 세진다.
    도장 유래의 날짜는 전부 KST 하나로 파생한다(studyStampDays와 같은 규약) — 서버 이력은
    KST인데 여기만 기기 시간대로 세면 KST 자정 부근의 체크인 하나가 이틀로 불어난다.
    · stamped: 서버 이력(study_days)의 로컬 복제본 — 내 체크인은 쓰는 즉시 여기 들어간다
    · status.lastStartedAt의 KST 날짜: 아직 pull로 안 돌아온 다른 멤버의 최근 시작
    · 지금 켜져 있는 세션(isStatusActive)의 KST 오늘: 자정을 넘겨도 오늘이 이어서 세진다 */
export function studyDaysOf(
  entries: readonly Entry[],
  m: MemberId,
  stamped: ReadonlySet<string> | undefined,
  status: MemberStatus | undefined,
  now: number,
): Set<string> {
  const days = daysOf(entries, m);
  if (stamped) for (const d of stamped) days.add(d);
  const startMs = Date.parse(status?.lastStartedAt ?? '');
  if (Number.isFinite(startMs)) days.add(kstDayStr(startMs));
  if (isStatusActive(status, now)) days.add(kstDayStr(now));
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

/** 이 멤버가 그 날 공부한 태그들 — 날짜 → 태그 목록(중복 없음, 기록 순서).
    도장만 있는 날은 여기 없다(체크인에는 태그가 없다) — 태그 필터에서 "공부는 했지만
    무엇인지는 모르는 날"로 남는 것이 맞다. OFF도 그대로 담는다: 뺄지는 보는 쪽 사정이다. */
export function dayTagsOf(entries: readonly Entry[], m: MemberId): Map<string, Tag[]> {
  const map = new Map<string, Tag[]>();
  for (const e of entries) {
    if (e.m !== m) continue;
    const cur = map.get(e.day);
    if (cur) {
      for (const t of entryTags(e)) if (!cur.includes(t)) cur.push(t);
    } else {
      map.set(e.day, [...entryTags(e)]);
    }
  }
  return map;
}

/** 한 날짜에 직접 입력된 공부시간. 체크인 도장·현재 상태에는 시간 정보가 없으므로
    이 집계는 Entry만 받는다. 같은 날 기록이 여러 개면 분은 합치되, 평균의 분모가 되는
    `recordedEntries > 0` 날짜는 한 번만 센다. null은 0분이 아니라 미입력이다. */
export interface DayStudyTime {
  minutes: number;
  recordedEntries: number;
  missingEntries: number;
}

/** 멤버의 날짜별 수동 공부시간 — 태그를 고르면 "그 태그가 포함된 기록"만 더한다.
    한 기록에 태그가 여러 개여도 시간을 나누지 않는다. 따라서 태그별 결과끼리는 서로
    겹칠 수 있고, 이 값으로 합계 100%인 비중 차트를 만들면 안 된다. */
export function studyTimeByDayOf(
  entries: readonly Entry[],
  m: MemberId,
  selectedTag: Tag | null = null,
): Map<string, DayStudyTime> {
  const map = new Map<string, DayStudyTime>();
  for (const e of entries) {
    if (e.m !== m) continue;
    const tags = entryTags(e);
    if (isOffTags(tags) || (selectedTag !== null && !tags.includes(selectedTag))) continue;

    const cur = map.get(e.day) ?? { minutes: 0, recordedEntries: 0, missingEntries: 0 };
    if (
      typeof e.studyMinutes === 'number'
      && Number.isInteger(e.studyMinutes)
      && e.studyMinutes >= 1
      && e.studyMinutes <= STUDY_MINUTES_MAX
    ) {
      cur.minutes += e.studyMinutes;
      cur.recordedEntries += 1;
    } else {
      // null(및 구버전/손상 행의 누락)은 실제 0분으로 바꾸지 않는다.
      cur.missingEntries += 1;
    }
    map.set(e.day, cur);
  }
  return map;
}

export interface StudyTimeSummary {
  minutes: number;
  /** 공부시간이 숫자로 입력된 날짜 수 — 일 평균의 분모. 기록 수가 아니다. */
  recordedDays: number;
}

/** 날짜별 시간 중 원하는 기간의 합계와 입력일 수. 같은 날 숫자 기록과 null 기록이
    함께 있어도 그 날은 시간 입력일 한 번이며, null만 있는 날은 평균 분모에서 빠진다. */
export function studyTimeSummaryOf(
  days: ReadonlyMap<string, DayStudyTime>,
  pred: (day: string) => boolean = () => true,
): StudyTimeSummary {
  let minutes = 0;
  let recordedDays = 0;
  for (const [day, value] of days) {
    if (!pred(day) || value.recordedEntries === 0) continue;
    minutes += value.minutes;
    recordedDays += 1;
  }
  return { minutes, recordedDays };
}

/** 날짜 키 → 에포크 일수. 달력 상 연속(어제→오늘)이 정확히 +1이 되는 눈금이다 —
    문자열 비교나 로컬 Date 산술은 월 경계·DST 가정에서 흔들린다(KST엔 DST가 없지만
    UTC 눈금이면 애초에 가정이 필요 없다). */
function dayNum(key: string): number {
  return Date.UTC(+key.slice(0, 4), +key.slice(5, 7) - 1, +key.slice(8, 10)) / 86_400_000;
}

/** 전 기간 최장 연속 공부일 — streakOf(오늘 기준 현재 연속)와 짝을 이루는 기록 보드용. */
export function maxStreakOf(days: ReadonlySet<string>): number {
  const nums = [...days].map(dayNum).filter(Number.isFinite).sort((a, b) => a - b);
  let max = 0;
  let run = 0;
  let prev = Number.NaN;
  for (const n of nums) {
    run = n === prev + 1 ? run + 1 : 1;
    prev = n;
    if (run > max) max = run;
  }
  return max;
}

/** 가장 이른 기록 달부터 "이번 달과 가장 늦은 기록 달 중 나중" 까지의 'YYYY-MM' 목록 —
    통계의 "전체" 화면이 월 단위로 편다. 미래 날짜에 남긴 기록도 누적·태그·순위에는
    세므로, 그 달이 목록에 없으면 월별 행의 합과 누적이 어긋난다. 기록이 없으면 이번 달 하나.
    상한은 "이번 달을 반드시 품는 120개월 창" — 깨진 날짜 하나가 수백 행을 만들지 않되,
    창을 접더라도 이번 달이 빠지면 안 된다(이번 달이 빠진 통계는 통계가 아니다).
    과거를 먼저 지키고 창 밖의 먼 미래 달을 접는다: 십 년 전 기록은 실데이터일 수 있지만
    십 년 뒤 기록은 깨진 날짜에 가깝다.
    창이 접은 달의 기록은 월별 행에 안 보여도 누적·태그·연속에는 그대로 세진다 —
    이 불일치는 안다. 창은 120개월 밖 기록이라는 병적 데이터에 대한 표시 방어일 뿐이고,
    집계까지 창으로 자르면 정상 경로의 모든 계산에 이 경계가 끼어든다. */
export function monthKeysOf(days: ReadonlySet<string>, today: Date): string[] {
  const cur = today.getFullYear() * 12 + today.getMonth();
  let lo = cur;
  let hi = cur;
  for (const d of days) {
    const n = +d.slice(0, 4) * 12 + (+d.slice(5, 7) - 1);
    if (!Number.isFinite(n)) continue;
    if (n < lo) lo = n;
    if (n > hi) hi = n;
  }
  lo = Math.max(lo, cur - 119);
  hi = Math.min(hi, lo + 119); // lo ≤ cur ≤ lo + 119 — 이번 달은 늘 창 안이다
  const out: string[] = [];
  for (let n = lo; n <= hi; n++) out.push(`${Math.floor(n / 12)}-${pad2((n % 12) + 1)}`);
  return out;
}
