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

/** 크루 고정 순서 — 보드 정렬·리액션 이름 나열이 이 순서를 그대로 쓴다.
    새 멤버는 뒤에 붙인다(기존 멤버의 상대 순서가 바뀌면 화면 순서가 통째로 흔들린다). */
export const MEMBER_IDS = ['sh', 'wg', 'th', 'jj', 'kj'] as const;
export type MemberId = (typeof MEMBER_IDS)[number];

/** Worker가 푸시 문구에도 쓰는 표시 이름 — 클라이언트 MEMBERS도 이걸 참조한다.
    (scripts/make-invites.mjs에 같은 표가 복제돼 있다 — 함께 고칠 것) */
export const MEMBER_NAMES: Record<MemberId, string> = {
  sh: '승환',
  wg: '웅',
  th: '태현',
  jj: '진주',
  kj: '경진',
};

export const TAGS = ['자격증', '영어', '코딩테스트', '기타', 'OFF'] as const;
export type Tag = (typeof TAGS)[number];

/** 다중 태그 정규화 — 유효한 값만, 중복 없이, TAGS 순서로.
    순서를 고정하는 이유는 normalizeEmojis와 같다: 순서가 흔들리면 내용이 같은데도
    서로를 "변경"으로 보고 무의미한 동기화가 돈다.
    'OFF'(쉬는 날)는 배타적이라 함께 오면 ['OFF']만 남는다. 유효한 값이 없으면 빈 배열. */
export function normalizeTags(list: unknown): Tag[] {
  if (!Array.isArray(list)) return [];
  const picked = TAGS.filter((t) => list.includes(t));
  return picked.includes('OFF') ? ['OFF'] : picked;
}

/** 대표 태그 — tags[0]. 빈 배열이면 '기타'. DB/구버전 클라이언트가 읽는 tag 컬럼의 값. */
export function primaryTag(tags: readonly Tag[]): Tag {
  return tags[0] ?? '기타';
}

/** 구/신 표현을 하나로 — tags가 비었으면 대표 태그 tag로 되살린다.
    IDB의 구버전 행, 구버전 클라이언트가 push한 행, 초안 복원이 모두 이 함수를 지난다.
    tag까지 유효하지 않으면 '기타'로 되살린다 — 빈 배열은 절대 돌려주지 않는다. */
export function entryTags(e: { tag?: unknown; tags?: unknown }): Tag[] {
  const tags = normalizeTags(e.tags);
  if (tags.length > 0) return tags;
  const fallback = normalizeTags([e.tag]);
  return fallback.length > 0 ? fallback : ['기타'];
}

/** 쉬는 날인가 — tags가 정확히 ['OFF']일 때. stars === null 조건과 같은 정의여야 한다. */
export function isOffTags(tags: readonly Tag[]): boolean {
  return tags.length === 1 && tags[0] === 'OFF';
}

export interface Todo {
  t: string;
  done: boolean;
}

export interface EntryPhoto {
  id: string; // 클라이언트 생성 UUID — R2 표시용/썸네일 키가 이 id를 공유한다
  w: number; // 표시용(1600px) 이미지의 실제 폭
  h: number; // 표시용(1600px) 이미지의 실제 높이
}

const ENTRY_PHOTO_LIMIT = 4;
const ENTRY_PHOTO_DIMENSION_MAX = 10_000;

/** 사진 메타 정규화 — 유효한 UUID만, 첫 등장 순서로 중복 없이, 최대 4장.
    서버와 클라이언트가 같은 경계를 써야 잘못된 메타가 push/pull마다
    서로 다른 내용으로 바뀌어 헛 동기화가 돌지 않는다. 부정확한 크기도 0으로
    남기지 않아 모자이크 종횡비를 깨뜨리지 않게, 가장 가까운 정수 후 1~10000으로 클램프한다. */
export function normalizePhotos(list: unknown): EntryPhoto[] {
  if (!Array.isArray(list)) return [];
  const photos: EntryPhoto[] = [];
  const seen = new Set<string>();

  const dimension = (value: unknown): number => {
    const rounded = typeof value === 'number' && !Number.isNaN(value) ? Math.round(value) : 1;
    return Math.max(1, Math.min(ENTRY_PHOTO_DIMENSION_MAX, rounded));
  };

  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const photo = item as { id?: unknown; w?: unknown; h?: unknown };
    if (typeof photo.id !== 'string' || !UUID_RE.test(photo.id)) continue;
    const id = canonicalUuid(photo.id);
    if (seen.has(id)) continue;
    seen.add(id);
    photos.push({ id, w: dimension(photo.w), h: dimension(photo.h) });
    if (photos.length === ENTRY_PHOTO_LIMIT) break;
  }
  return photos;
}

export interface Entry {
  id: string; // 클라이언트 생성 UUID — 멱등 업서트의 키
  m: MemberId;
  day: string; // YYYY-MM-DD
  time: string; // HH:MM
  /** @deprecated 구버전 호환 대표 태그 — 항상 primaryTag(tags). 새 코드는 tags를 쓴다.
      (DB의 tag 컬럼은 text NOT NULL이고, 서비스워커 캐시에 남은 구버전 번들·구버전 Worker가
       여전히 이 필드만 읽고 쓴다. 직접 대입하지 말고 경계마다 primaryTag로 다시 계산할 것) */
  tag: Tag;
  /** 다중 선택된 공부 종류 — 최소 1개, TAGS 순서, 'OFF'면 단독. */
  tags: Tag[];
  stars: number | null; // OFF(tags === ['OFF'])는 null
  memo: string;
  body: string;
  todos: Todo[];
  /** 표시용 사진 메타 — 바이너는 R2에 별도 저장하고 이 배열만 CAS 동기화한다. */
  photos: EntryPhoto[];
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
  /** 읽음 처리할 알림. "모두 읽음"도 클라이언트가 아는 안읽음 id를 열거해 보낸다 —
      서버에 별도 상태가 없어 멱등하고, 그 사이 도착한 새 알림을 실수로 읽음 처리하지 않는다.
      at은 읽은 시점에 관측한 그 행의 updatedAt(서버 시계) — 서버는 행이 그 뒤로 갱신되지
      않았을 때만 도장을 찍는다. 집계 행(react_daily)이 그 사이 "다시 안 읽음"이 됐는데
      뒤늦게 도착한 옛 읽음이 새 세대까지 읽음 처리하는 것을 막는다. */
  notificationReads?: NotificationRead[];
}

export interface NotificationRead {
  id: string;
  at: string; // 읽은 시점에 관측한 행의 updatedAt — 세대 판별값
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
  /** 정산된 읽음 처리 id — 이미 읽음이던 행도 포함해 요청한 id를 그대로 돌려준다(멱등).
      comment/reaction 결과와 같은 구버전 규약: 보냈는데 이 필드가 없으면 큐를 지킨다. */
  notificationReadResults?: string[];
}

/** (updated_at, id) 키셋 커서 — 같은 타임스탬프 행도 놓치지 않는다. */
export interface PullCursor {
  ts: string;
  id: string;
}
export interface PullResponse {
  rows: Entry[];
  cursor: PullCursor | null;
  /** 전 멤버의 지금 상태 — 멤버당 1행뿐이라 매 pull에 통째로 실어 보낸다. */
  statuses: MemberStatus[];
  comments?: Comment[];
  commentCursor?: PullCursor | null;
  reactions?: ReactionSet[];
  reactionCursor?: ReactionCursor | null;
  /** 내(토큰 주인) 알림만 — 다른 스트림과 같은 (updated_at, id) 키셋. */
  notifications?: Notification[];
  notificationCursor?: PullCursor | null;
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

/* ---------- 알림 ---------- */

/** 알림 종류 — 내역 필터의 단위. '댓글' 필터는 comment|reply를 함께 잡는다. */
export const NOTIF_KINDS = ['start', 'comment', 'reply', 'mention', 'react', 'system'] as const;
export type NotifKind = (typeof NOTIF_KINDS)[number];

/** 알림이 온 이유 — 내역 행의 배지 키. 문구·색 매핑은 클라이언트의 몫이다. */
export const NOTIF_WHYS = [
  'mention', // 나를 언급한 댓글 (설정과 무관하게 항상)
  'mine', // 내 기록에 달린 댓글
  'reply', // 내가 댓글 단 기록에 달린 후속 댓글 (스레드가 없는 앱이라 "답글"의 정의가 이것)
  'all', // 크루 기록의 모든 댓글 (기본 꺼짐)
  'react', // 응원 반응 — 바로 받기
  'react_daily', // 응원 반응 — 하루 요약 집계
  'daily', // 공부 시작 — 하루 1회
  'live', // 공부 시작 — 실시간
  'quiet', // 방해 금지 시간 다이제스트
] as const;
export type NotifWhy = (typeof NOTIF_WHYS)[number];

/** 알림 한 건 — 수신자(m)별 행. 서버가 만들고 클라이언트는 읽음 처리만 쓴다. */
export interface Notification {
  id: string; // 서버 생성 UUID
  m: MemberId; // 수신자
  kind: NotifKind;
  why: NotifWhy;
  actor: MemberId | null; // 행위자 — system·집계 행은 null일 수 있다
  entryId: string | null; // 관련 기록 (없으면 null)
  quote: string; // 인용문(댓글 본문, 이모지 등). '' = 없음
  ctx: string; // 부가 설명 한 줄. '' = 없음 (집계 행은 클라이언트가 count로 만든다)
  actors: MemberId[]; // 집계 행(react_daily)의 참여자 목록
  count: number; // 집계 개수 — 일반 행은 1
  createdAt: string; // 사건 시각 — 표시·정렬 기준
  updatedAt: string; // 서버 시계 — pull 커서·중복 판별 기준 (집계 행은 갱신마다 앞으로 온다)
  readAt: string | null;
}

/* ---------- 알림 설정 ---------- */

export const NOTIF_MODES = ['live', 'daily', 'off'] as const;
/** 공부 시작·응원 반응이 공유하는 3단 모드 — 실시간 / 하루 1회(요약) / 끔. */
export type NotifMode = (typeof NOTIF_MODES)[number];

/** 멤버당 1행. 서버가 알림 생성·푸시 발송을 이 값으로 게이트한다(멘션은 예외 — 항상). */
export interface NotifPrefs {
  m: MemberId;
  startMode: NotifMode; // 공부 시작 기본값
  perMember: Partial<Record<MemberId, NotifMode>>; // 크루별 오버라이드 (없는 키는 startMode)
  cmMine: boolean; // 내 기록에 달린 댓글
  cmReply: boolean; // 내 댓글에 달린 답글
  cmAll: boolean; // 크루 기록의 모든 댓글
  reactMode: NotifMode; // 응원 반응
  quietEnabled: boolean; // 방해 금지 시간
  quietFrom: string; // 'HH:00' — 매시 정각만 (다이제스트가 시간 단위 cron이라)
  quietTo: string; // 'HH:00'
  updatedAt: string;
}

/** 설정 행이 없는 멤버의 기본값 — 디자인의 추천 조합과 같다. */
export const DEFAULT_NOTIF_PREFS: Omit<NotifPrefs, 'm' | 'updatedAt'> = {
  startMode: 'daily',
  perMember: {},
  cmMine: true,
  cmReply: true,
  cmAll: false,
  reactMode: 'daily',
  quietEnabled: true,
  quietFrom: '22:00',
  quietTo: '07:00',
};

/** GET/PUT /api/notify/prefs 응답. */
export interface NotifPrefsResponse {
  ok: true;
  prefs: NotifPrefs;
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
  photos: ENTRY_PHOTO_LIMIT,
  /** 댓글 한 개 길이 (batch 200은 세 스트림이 공유한다) */
  commentBody: 500,
} as const;
