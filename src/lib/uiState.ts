/* 화면 상태 영속화 — 새로고침해도 보던 탭·패널·날짜가 그대로여야 한다.
   기록·알림은 스토어(IndexedDB·서버)가 갖고 있으니 여기엔 "어디를 보고 있었나"만 남긴다.
   초안(lc-draft:*)과 달리 잃어도 손해가 없는 값이라, 읽기는 전부 방어적으로 하고
   깨진 항목은 조용히 버린다(하나가 이상하다고 나머지 복원까지 포기할 이유가 없다). */

const KEY = 'lc-ui-v1';
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface UiState {
  view: 'feed' | 'cal';
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
    if (typeof d.panelOpen === 'boolean') out.panelOpen = d.panelOpen;
    if (typeof d.selDay === 'string' && DAY_RE.test(d.selDay)) out.selDay = d.selDay;
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
  if (!selDay || !DAY_RE.test(selDay)) return 0;
  const y = Number(selDay.slice(0, 4));
  const mo = Number(selDay.slice(5, 7));
  if (!Number.isFinite(y) || !Number.isFinite(mo)) return 0;
  return (y - today.getFullYear()) * 12 + (mo - 1 - today.getMonth());
}
