/* 클라이언트와 Worker가 공유하는 도메인 타입 + 동기화 프로토콜. */

/** Entry id 형식 — 클라이언트 저장 가드와 서버 검증이 같은 정의를 쓴다. */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** UUID를 소문자 표준형으로 — PostgreSQL `uuid` 컬럼은 무엇을 넣든 소문자로 돌려주므로
    경계에서 미리 맞춰 두지 않으면 두 가지가 깨진다.
    · 대문자로 보낸 id는 응답이 소문자로 돌아와 클라이언트의 상관 키와 어긋난다 →
      ACK되지 못한 행이 큐에 영원히 남아 재전송 루프를 돈다.
    · 대소문자만 다른 두 id는 원문 비교인 중복 검사를 통과한 뒤 DB에서 같은 행이 되어
      `ON CONFLICT DO UPDATE ... cannot affect row a second time`으로 배치 전체를 죽인다. */
export function canonicalUuid(id: string): string {
  return id.toLowerCase();
}

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

/* ---------- 댓글 ---------- */

/** 기록에 달리는 댓글. 내용은 불변(수정 없음) — 서버는 본문을 절대 덮어쓰지 않는다.
    삭제는 soft delete로 전파되고, 한 번 지워진 댓글은 되살아나지 않는다. */
export interface Comment {
  id: string; // 클라이언트 생성 UUID — 멱등 업서트의 키
  entryId: string; // 대상 기록 id
  m: MemberId; // 작성자
  body: string;
  createdAt: string; // 작성 기기 시각(서버가 범위 검증) — 표시·정렬 기준
  updatedAt: string; // 서버 시계 — pull 커서·중복 판별 기준
  deletedAt: string | null;
}

/* ---------- 리액션 ---------- */

export const REACTIONS = ['👏', '🔥', '💪', '👀', '😴'] as const;
export type ReactionEmoji = (typeof REACTIONS)[number];

/** 기록×멤버당 1행 — 그 멤버가 그 기록에 남긴 이모지 집합.
    지금 상태(status)와 같은 의미론: 도착 순서가 아니라 액션 시각(actedAt)으로 LWW 판정한다. */
export interface ReactionSet {
  entryId: string;
  m: MemberId;
  emojis: ReactionEmoji[];
  actedAt: string; // 토글한 시각 — LWW 비교 기준 (서버가 미래는 지금으로 캡)
  updatedAt: string; // 서버 시계 — pull 커서·중복 판별 기준
}

/** 리액션 집합 정규화 — 허용 이모지만, 중복 없이, REACTIONS 순서로.
    서버 검증과 클라이언트 토글이 같은 정의를 써야 한다 — 순서가 어긋나면
    내용이 같은데도 서로를 "변경"으로 보고 무의미한 동기화가 돈다. */
export function normalizeEmojis(list: unknown): ReactionEmoji[] {
  if (!Array.isArray(list)) return [];
  return REACTIONS.filter((e) => list.includes(e));
}

/** 리액션 키셋 커서 — PK(entry_id, member_id)가 유일성을 보장한다. */
export interface ReactionCursor {
  ts: string;
  entryId: string;
  /** 실제 멤버 id, 또는 빈 문자열 — 지평선 커서의 멤버 자리는 "모든 member_id보다 작은 하한"이라
      그 시각의 행이 하나도 빠지지 않고 다시 잡힌다(entryId의 NIL_UUID와 같은 역할). */
  m: MemberId | '';
}

/* ---------- 동기화 프로토콜 ---------- */

/** v(base 리비전) CAS 업서트 — 충돌하면 서버가 현재 행을 돌려주고 클라이언트가 병합한다. */
export interface PushRequest {
  entries: Entry[];
  /** 없으면 빈 배열로 취급 — 이행기의 구버전 클라이언트 호환 */
  comments?: Comment[];
  reactions?: ReactionSet[];
}
/** 행별 결과. applied=false면 row는 서버의 현재 행(충돌) — 클라이언트가 병합 후 재전송한다. */
export interface PushRowResult {
  id: string;
  applied: boolean;
  row: Entry;
}

/** applied=false면 row는 서버의 현재 행 — 클라이언트가 그대로 채택한다(이길 수 없다). */
export interface CommentPushResult {
  id: string;
  applied: boolean;
  row: Comment;
}
export interface ReactionPushResult {
  entryId: string;
  m: MemberId;
  applied: boolean;
  row: ReactionSet;
}

export interface PushResponse {
  ok: true;
  serverTime: string;
  results: PushRowResult[];
  /** 새 서버는 (보낸 게 없어도) 항상 실어 보낸다. 클라이언트는 보냈는데 이 필드가
      없으면 "구버전 Worker가 무시했다"로 보고 큐를 비우지 않는다 — 조용한 유실 방지. */
  commentResults?: CommentPushResult[];
  reactionResults?: ReactionPushResult[];
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
  comments?: Comment[];
  commentCursor?: PullCursor | null;
  reactions?: ReactionSet[];
  reactionCursor?: ReactionCursor | null;
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
  /** 댓글 한 개 길이 (batch 200은 세 스트림이 공유한다) */
  commentBody: 500,
} as const;
