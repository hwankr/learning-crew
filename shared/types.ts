/* 클라이언트와 Worker가 공유하는 도메인 타입 + 동기화 프로토콜. */

/** Entry id 형식 — 클라이언트 저장 가드와 서버 검증이 같은 정의를 쓴다. */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  /** 서버 리비전. pull로 받은 값이 곧 base — push 시 이 값으로 CAS한다. 로컬 신규 행은 0. */
  v: number;
  updatedAt: string; // 서버 시계 기준 (클라이언트 값은 잠정치)
  deletedAt: string | null; // soft delete — 삭제도 동기화로 전파된다
}

/** v(base 리비전) CAS 업서트 — 충돌하면 서버가 현재 행을 돌려주고 클라이언트가 병합한다. */
export interface PushRequest {
  entries: Entry[];
}
/** 행별 결과. applied=false면 row는 서버의 현재 행(충돌) — 클라이언트가 병합 후 재전송한다. */
export interface PushRowResult {
  id: string;
  applied: boolean;
  row: Entry;
}
export interface PushResponse {
  ok: true;
  serverTime: string;
  results: PushRowResult[];
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
  updatedAt: string; // 액션 시각(토글한 순간) — 도착 순서가 아니라 이 시각으로 LWW 판정한다
}

export interface StatusSetRequest {
  on: boolean;
  place?: Place;
  since?: string; // 오프라인에서 켠 경우를 위해 클라이언트 시각을 보낸다 (서버가 범위 검증)
  /** 토글한 액션 시각 — 오프라인이었다가 뒤늦게 도착해도 더 새 액션을 덮지 못하게 한다. */
  at?: string;
}
export interface StatusSetResponse {
  ok: true;
  /** 처리 후 서버의 현재 상태 — 거부됐으면(다른 기기의 더 새 액션 존재) 그쪽 상태다. */
  status: MemberStatus;
  applied: boolean;
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

/** TTL 신선도 규칙의 단일 정의 — 표시(isStatusActive), 알림 판단(shouldNotify),
    서버의 늦은 ON 액션 무효화가 전부 이 함수를 쓴다. 셋이 어긋나면 안 된다. */
export function isFreshSince(ts: string | null, now: number): boolean {
  if (ts === null) return false;
  const t = Date.parse(ts);
  return Number.isFinite(t) && now - t < STATUS_TTL_MS;
}

export function isStatusActive(s: MemberStatus | undefined, now: number): s is MemberStatus {
  return !!s && s.on && isFreshSince(s.since, now);
}

export const PUSH_LIMITS = {
  batch: 200,
  memo: 60,
  body: 4000,
  todos: 50,
  todoText: 500,
} as const;
