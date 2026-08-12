/* 클라이언트와 Worker가 공유하는 도메인 타입 + 동기화 프로토콜. */

export const MEMBER_IDS = ['sh', 'wg', 'th', 'jj'] as const;
export type MemberId = (typeof MEMBER_IDS)[number];

/** Worker가 푸시 문구에도 쓰는 표시 이름 — 클라이언트 MEMBERS도 이걸 참조한다. */
export const MEMBER_NAMES: Record<MemberId, string> = {
  sh: '승환',
  wg: '웅',
  th: '태현',
  jj: '진주',
};

export const TAGS = ['자격증', '영어', '코딩테스트', '기타', 'OFF'] as const;
export type Tag = (typeof TAGS)[number];

export interface Todo {
  t: string;
  done: boolean;
}

export interface Entry {
  id: string; // 클라이언트 생성 UUID — 멱등 업서트의 키
  m: MemberId;
  day: string; // YYYY-MM-DD
  time: string; // HH:MM
  tag: Tag;
  stars: number | null; // OFF는 null
  memo: string;
  body: string;
  todos: Todo[];
  updatedAt: string; // 서버 시계 기준 (클라이언트 값은 잠정치)
  deletedAt: string | null; // soft delete — 삭제도 동기화로 전파된다
}

/** 행 전체를 last-write-wins로 업서트한다. 삭제는 deletedAt이 찍힌 행. */
export interface PushRequest {
  entries: Entry[];
}
export interface PushResponse {
  ok: true;
  serverTime: string;
}

/** (updated_at, id) 키셋 커서 — 같은 타임스탬프 행도 놓치지 않는다. */
export interface PullCursor {
  ts: string;
  id: string;
}
export interface PullResponse {
  rows: Entry[];
  cursor: PullCursor | null;
  /** 전 멤버의 지금 상태 — 4행뿐이라 매 pull에 통째로 실어 보낸다. */
  statuses: MemberStatus[];
}

/* ---------- 지금 상태 (라이브 체크인) ---------- */

export const PLACES = ['도서관', '집', '카페', '기타'] as const;
export type Place = (typeof PLACES)[number];

/** 멤버당 1행. "도서관에서 공부 중" 같은 지금 상태 — 기록(Entry)과 달리 덮어쓰는 현재값. */
export interface MemberStatus {
  m: MemberId;
  on: boolean;
  place: Place | null; // off면 null
  since: string | null; // 켠 시각(ISO), off면 null
  updatedAt: string; // 서버 시계 기준
}

export interface StatusSetRequest {
  on: boolean;
  place?: Place;
  since?: string; // 오프라인에서 켠 경우를 위해 클라이언트 시각을 보낸다 (서버가 범위 검증)
}
export interface StatusSetResponse {
  ok: true;
  status: MemberStatus;
}

/* ---------- 웹 푸시 구독 ---------- */

export interface PushSubscribeRequest {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}
export interface PushUnsubscribeRequest {
  endpoint: string;
}
/** GET /api/push/vapid — 구독에 쓰는 VAPID 공개키. */
export interface VapidKeyResponse {
  key: string;
}

/** 끄는 걸 잊은 상태가 다음 날까지 남지 않게 — 이 시간이 지나면 꺼진 것으로 취급. */
export const STATUS_TTL_MS = 14 * 60 * 60 * 1000;

export function isStatusActive(s: MemberStatus | undefined, now: number): s is MemberStatus {
  return !!s && s.on && s.since !== null && now - Date.parse(s.since) < STATUS_TTL_MS;
}

export const PUSH_LIMITS = {
  batch: 200,
  memo: 60,
  body: 4000,
  todos: 50,
  todoText: 500,
} as const;
