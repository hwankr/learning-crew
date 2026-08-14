/* 화면 상태 영속화 — 새로고침해도 보던 탭·패널·날짜가 그대로여야 한다.
   기록·알림은 스토어(IndexedDB·서버)가 갖고 있으니 여기엔 "어디를 보고 있었나"만 남긴다.
   초안(lc-draft:*)과 달리 잃어도 손해가 없는 값이라, 읽기는 전부 방어적으로 하고
   깨진 항목은 조용히 버린다(하나가 이상하다고 나머지 복원까지 포기할 이유가 없다). */

const KEY = 'lc-ui-v1';
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 모양만 YYYY-MM-DD인 값도 실제 달력에 없는 날이면 버린다 — 그대로 복원하면
    캘린더 격자와 아래 선택일 제목이 서로 다른 달을 가리킨다. */
function dayParts(value: unknown): { y: number; mo: number; d: number } | null {
  if (typeof value !== 'string' || !DAY_RE.test(value)) return null;
  const y = Number(value.slice(0, 4));
  const mo = Number(value.slice(5, 7));
  const d = Number(value.slice(8, 10));
  if (y < 1 || mo < 1 || mo > 12 || d < 1) return null;
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  const monthDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return d <= monthDays[mo - 1]! ? { y, mo, d } : null;
}

/** localStorage에 들어가는 모든 날짜 슬롯의 공통 경계 — UI 선택일뿐 아니라 작성 초안도
    이 검사를 써야, 모양만 날짜인 값이 저장 큐까지 들어가 동기화 전체를 막지 않는다. */
export function isDayKey(value: unknown): value is string {
  return dayParts(value) !== null;
}

/** 좁은 화면 하단 탭 — 데스크톱 view(피드·캘린더)와 따로 산다. 하나로 합치면
    폭이 바뀔 때마다 홈이 캘린더로, 알림이 피드로 번역되며 보던 자리가 뒤바뀐다. */
export type MobileTab = 'home' | 'feed' | 'cal' | 'alerts';
const MTABS: readonly string[] = ['home', 'feed', 'cal', 'alerts'];

export interface UiState {
  view: 'feed' | 'cal';
  mtab: MobileTab;
  panelOpen: boolean;
  /** 캘린더에서 고른 날 (null = 오늘) */
  selDay: string | null;
}

export function loadUi(): Partial<UiState> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const d = JSON.parse(raw) as Record<string, unknown>;
    if (!d || typeof d !== 'object') return {};
    const out: Partial<UiState> = {};
    if (d.view === 'feed' || d.view === 'cal') out.view = d.view;
    if (typeof d.mtab === 'string' && MTABS.includes(d.mtab)) out.mtab = d.mtab as MobileTab;
    if (typeof d.panelOpen === 'boolean') out.panelOpen = d.panelOpen;
    const selDay = d.selDay;
    if (isDayKey(selDay)) out.selDay = selDay;
    return out;
  } catch {
    return {};
  }
}

export function saveUi(s: UiState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // 저장 공간 초과·접근 불가 — 화면 상태는 best-effort
  }
}

/** 저장된 선택일이 속한 달로 캘린더를 되돌린다 — 역산하지 않으면 8월 격자 아래
    9월 목록이 붙는다(월은 오프셋으로, 선택일은 날짜 문자열로 들고 있어서 생기는 틈). */
export function calOffOf(selDay: string | null, today: Date): number {
  const parts = dayParts(selDay);
  if (!parts) return 0;
  return (parts.y - today.getFullYear()) * 12 + (parts.mo - 1 - today.getMonth());
}

/** 위와 같은 틈을 반대 방향으로 메운다 — 이전/다음 달로 넘길 때 선택일도 같은 일(日)로
    옮긴 키. 그 달에 없는 날짜(31일 → 2월)는 말일로 당긴다. */
export function sameDayInMonth(base: Date, selDay: string): string {
  const last = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
  const want = dayParts(selDay)?.d ?? 1; // 깨진 값이면 1일 — 없는 날짜로 넘어가느니 달의 시작
  const d = Math.min(want, last);
  const mo = String(base.getMonth() + 1).padStart(2, '0');
  return `${base.getFullYear()}-${mo}-${String(d).padStart(2, '0')}`;
}
