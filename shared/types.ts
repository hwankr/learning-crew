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
export type KnownTag = (typeof TAGS)[number];
export type Tag = string;

export const TAG_LIMITS = {
  nameLen: 12,
  perEntry: 8,
  perMember: 20,
} as const;

const CONTROL_CHAR_RE = /\p{Cc}/u;
const LONE_SURROGATE_RE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const KNOWN_TAGS = new Set<string>(TAGS);

/** 사용자 태그 한 개 정화 — 화면·저장·서버가 모두 같은 문자열을 비교하도록 NFC와
    공백을 먼저 맞춘다. 길이는 UTF-16 code unit가 아니라 사용자가 보는 코드포인트 수다.
    짝 없는 surrogate는 PostgreSQL jsonb가 거부해 요청·동기화 배치 전체를 죽이므로 버린다. */
export function sanitizeCustomTag(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const isWellFormed = (raw as string & { isWellFormed?: () => boolean }).isWellFormed;
  if (isWellFormed ? !isWellFormed.call(raw) : LONE_SURROGATE_RE.test(raw)) return null;
  const normalized = raw.trim().normalize('NFC');
  // 내부 줄바꿈·탭을 공백으로 숨기기 전에 거부한다. 양끝 공백은 위 trim의 몫이다.
  if (CONTROL_CHAR_RE.test(normalized)) return null;
  const tag = normalized.replace(/\s+/gu, ' ');
  if (!tag || [...tag].length > TAG_LIMITS.nameLen) return null;
  return tag;
}

/** locale에 기대지 않는 고정 문자열 순서 — Worker와 브라우저가 반드시 같아야 한다. */
function compareTagCodePoints(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** 다중 태그 정규화 — 기본 태그는 TAGS 순서, 커스텀 태그는 코드포인트 순서로.
    순서를 고정하는 이유는 normalizeEmojis와 같다: 순서가 흔들리면 내용이 같은데도
    서로를 "변경"으로 보고 무의미한 동기화가 돈다.
    'OFF'(쉬는 날)는 배타적이라 함께 오면 ['OFF']만 남는다. 유효한 값이 없으면 빈 배열. */
export function normalizeTags(list: unknown): Tag[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  for (const raw of list) {
    const tag = sanitizeCustomTag(raw);
    if (tag !== null) seen.add(tag);
  }
  if (seen.has('OFF')) return ['OFF'];
  const known = TAGS.filter((tag) => seen.has(tag));
  const custom = [...seen].filter((tag) => !KNOWN_TAGS.has(tag)).sort(compareTagCodePoints);
  return [...known, ...custom].slice(0, TAG_LIMITS.perEntry);
}

/** 멤버별 피커에 보여 줄 커스텀 태그 목록 — 기본 태그는 별도로 항상 노출하므로 뺀다.
    피커마다 기본 태그가 다르므로 두 번째 인자로 그 목록을 바꿀 수 있다. 일정용 목록은
    아래 전용 래퍼가 OFF 예약 이름까지 더해 서버와 클라이언트에서 같은 규칙으로 거른다. */
export function normalizeCustomTagList(
  list: unknown,
  presetTags: readonly string[] = TAGS,
): string[] {
  if (!Array.isArray(list)) return [];
  const presets = presetTags === TAGS ? KNOWN_TAGS : new Set(presetTags);
  const custom = new Set<string>();
  for (const raw of list) {
    const tag = sanitizeCustomTag(raw);
    if (tag !== null && !presets.has(tag)) custom.add(tag);
  }
  return [...custom].sort(compareTagCodePoints).slice(0, TAG_LIMITS.perMember);
}

/** 일정용 커스텀 태그 목록. 'OFF'는 기록의 쉬는 날을 뜻하는 예약 이름이라 일정에는
    저장하거나 노출하지 않는다. 일정 프리셋을 아는 UI는 두 번째 인자로 함께 제외하고,
    서버·IDB 경계는 기본값으로 호출해 클라이언트 전용 프리셋과 무관하게 OFF만 방어한다. */
export function normalizeCustomEventTagList(
  list: unknown,
  presetTags: readonly string[] = [],
): string[] {
  return normalizeCustomTagList(list, [...presetTags, 'OFF']);
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

export const ENTRY_PHOTO_LIMIT = 4;
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
  /** 다중 선택된 공부 종류 — 최소 1개, 공용 결정 순서, 최대 8개, 'OFF'면 단독. */
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

/* ---------- 크루 일정 ---------- */

export interface CrewEvent {
  id: string; // 클라이언트 생성 UUID — 멱등 CAS 업서트의 키
  m: MemberId; // 등록자 = 소유자
  /** 일정 당사자 — 등록자와 독립이며 최소 한 명, MEMBER_IDS 고정 순서. */
  participants: MemberId[];
  title: string;
  tag: Tag;
  memo: string;
  day: string; // YYYY-MM-DD 시작일
  endDay: string | null; // 포함 종료일. 단일 날짜 일정은 null
  v: number; // 서버 리비전. 신규 로컬 행은 0
  updatedAt: string; // 서버 시계 기준 (클라이언트 값은 잠정치)
  deletedAt: string | null; // soft delete
}

export const EVENT_LIMITS = {
  title: 80,
  memo: 200,
  spanDays: 90,
} as const;

const EVENT_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 형식뿐 아니라 실제 달력에 존재하는 날짜인지 확인한다. */
function isEventDay(day: string): boolean {
  if (!EVENT_DAY_RE.test(day)) return false;
  const [year, month, date] = day.split('-').map(Number);
  const parsed = new Date(Date.UTC(year!, month! - 1, date!));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month! - 1 &&
    parsed.getUTCDate() === date
  );
}

function isWellFormedText(value: string): boolean {
  const isWellFormed = (value as string & { isWellFormed?: () => boolean }).isWellFormed;
  return isWellFormed ? isWellFormed.call(value) : !LONE_SURROGATE_RE.test(value);
}

/** 일정 당사자 정규화 — 유효한 멤버만 남기고 입력 순서와 무관한 크루 고정 순서로 만든다.
    구버전 행처럼 필드가 없거나 전부 손상됐으면 등록자를 당사자로 되살린다. */
function normalizeEventParticipants(list: unknown, owner: MemberId): MemberId[] {
  if (!Array.isArray(list)) return [owner];
  const seen = new Set(list.filter((id): id is string => typeof id === 'string'));
  const participants = MEMBER_IDS.filter((id) => seen.has(id));
  return participants.length > 0 ? [...participants] : [owner];
}

/** Worker·IDB·pull이 공유하는 일정 경계 정규화.
    잘못된 tag/endDay는 안전한 기본값으로 복구하고, 그 밖의 필수 필드가 손상된 행은 버린다. */
export function normalizeCrewEvent(raw: unknown): CrewEvent | null {
  if (raw === null || typeof raw !== 'object') return null;
  const value = raw as Partial<CrewEvent>;
  if (
    typeof value.id !== 'string' ||
    !UUID_RE.test(value.id) ||
    !(MEMBER_IDS as readonly string[]).includes(value.m ?? '') ||
    typeof value.title !== 'string' ||
    !isWellFormedText(value.title) ||
    typeof value.memo !== 'string' ||
    !isWellFormedText(value.memo) ||
    value.memo.includes('\u0000') ||
    typeof value.day !== 'string' ||
    !isEventDay(value.day) ||
    !Number.isInteger(value.v) ||
    value.v! < 0 ||
    value.v! > 2_000_000_000 ||
    typeof value.updatedAt !== 'string'
  ) {
    return null;
  }

  const title = value.title.trim().normalize('NFC');
  const memo = value.memo.normalize('NFC');
  if (
    !title ||
    CONTROL_CHAR_RE.test(title) ||
    [...title].length > EVENT_LIMITS.title ||
    [...memo].length > EVENT_LIMITS.memo
  ) {
    return null;
  }

  const updatedAtMs = Date.parse(value.updatedAt);
  if (!Number.isFinite(updatedAtMs)) return null;
  let deletedAt: string | null = null;
  if (value.deletedAt !== null && value.deletedAt !== undefined) {
    if (typeof value.deletedAt !== 'string') return null;
    const deletedAtMs = Date.parse(value.deletedAt);
    if (!Number.isFinite(deletedAtMs)) return null;
    deletedAt = new Date(deletedAtMs).toISOString();
  }

  let endDay: string | null = null;
  if (typeof value.endDay === 'string' && isEventDay(value.endDay)) {
    const startMs = Date.parse(`${value.day}T00:00:00.000Z`);
    const endMs = Date.parse(`${value.endDay}T00:00:00.000Z`);
    const span = (endMs - startMs) / 86_400_000;
    if (span > 0 && span <= EVENT_LIMITS.spanDays) endDay = value.endDay;
  }

  const normalizedTag = sanitizeCustomTag(value.tag);
  const m = value.m as MemberId;
  return {
    id: canonicalUuid(value.id),
    m,
    participants: normalizeEventParticipants(value.participants, m),
    title,
    tag: normalizedTag === null || normalizedTag === 'OFF' ? '기타' : normalizedTag,
    memo,
    day: value.day,
    endDay,
    v: value.v!,
    updatedAt: new Date(updatedAtMs).toISOString(),
    deletedAt,
  };
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

/* ---------- 라운지 글 ---------- */

/** 라운지(자유 게시판) 글 — 텍스트+사진뿐, 별점·태그·수정 없음.
    내용은 불변(수정 기능이 없다) — 서버는 본문·사진을 절대 덮어쓰지 않는다.
    삭제는 soft delete로 전파되고, 한 번 지워진 글은 되살아나지 않는다. */
export interface Post {
  id: string; // 클라이언트 생성 UUID — 멱등 업서트의 키
  m: MemberId; // 작성자
  /** 본문 — 사진이 있으면 비어 있어도 된다("사진 없이 글만"의 역도 성립). */
  body: string;
  /** 표시용 사진 메타 — Entry.photos와 같은 규약(바이너리는 R2, 최대 4장). */
  photos: EntryPhoto[];
  createdAt: string; // 작성 기기 시각(서버가 범위 검증) — 표시·정렬 기준
  updatedAt: string; // 서버 시계 — pull 커서·중복 판별 기준
  deletedAt: string | null;
}

/** 라운지 글에 달리는 댓글 — Comment(기록 댓글)와 같은 불변+soft delete 의미론.
    스트림을 분리한 이유: 댓글의 키·인덱스·알림 팬아웃이 전부 entryId를 전제하므로
    (entryId, postId)를 한 컬럼에 섞으면 여섯 계층이 동시에 흔들린다. */
export interface PostComment {
  id: string; // 클라이언트 생성 UUID — 멱등 업서트의 키
  postId: string; // 대상 글 id
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
  /** 크루 일정 — 없으면 빈 배열로 취급하는 구버전 호환 스트림. */
  events?: CrewEvent[];
  /** 없으면 빈 배열로 취급 — 이행기의 구버전 클라이언트 호환 */
  comments?: Comment[];
  reactions?: ReactionSet[];
  /** 라운지 글·댓글 — 위와 같은 구버전 호환 규약 */
  posts?: Post[];
  postComments?: PostComment[];
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

export interface EventPushResult {
  id: string;
  applied: boolean;
  row: CrewEvent;
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

/** applied=false면 row는 서버의 현재 행 — 클라이언트가 그대로 채택한다(이길 수 없다). */
export interface PostPushResult {
  id: string;
  applied: boolean;
  row: Post;
}
export interface PostCommentPushResult {
  id: string;
  applied: boolean;
  row: PostComment;
}

export interface PushResponse {
  ok: true;
  serverTime: string;
  results: PushRowResult[];
  /** 새 서버는 (보낸 게 없어도) 항상 실어 보낸다. 클라이언트는 보냈는데 이 필드가
      없으면 "구버전 Worker가 무시했다"로 보고 큐를 비우지 않는다 — 조용한 유실 방지. */
  commentResults?: CommentPushResult[];
  reactionResults?: ReactionPushResult[];
  postResults?: PostPushResult[];
  postCommentResults?: PostCommentPushResult[];
  eventResults?: EventPushResult[];
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
  events?: CrewEvent[];
  eventCursor?: PullCursor | null;
  /** 전 멤버의 지금 상태 — 멤버당 1행뿐이라 매 pull에 통째로 실어 보낸다. */
  statuses: MemberStatus[];
  comments?: Comment[];
  commentCursor?: PullCursor | null;
  reactions?: ReactionSet[];
  reactionCursor?: ReactionCursor | null;
  posts?: Post[];
  postCursor?: PullCursor | null;
  postComments?: PostComment[];
  postCommentCursor?: PullCursor | null;
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
  /** 마지막 공부 시작 시각. 꺼도 지우지 않으며, 오늘 도장 카운트의 기준이다. */
  lastStartedAt: string | null;
  updatedAt: string; // 액션 시각(토글한 순간) — 도착 순서가 아니라 이 시각으로 LWW 판정한다
}

export interface StatusSetRequest {
  on: boolean;
  place?: Place;
  since?: string; // 오프라인에서 켠 경우를 위해 클라이언트 시각을 보낸다 (서버가 범위 검증)
  /** 마지막 공부 시작 시각 — OFF 동기화도 시작 이력을 잃지 않게 함께 보낸다. */
  lastStartedAt?: string;
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

/* ---------- 개인 커스텀 태그 설정 ---------- */

/** 멤버당 1행. 목록에서 지워도 과거 기록의 태그는 건드리지 않는다. */
export interface TagPrefs {
  m: MemberId;
  tags: string[];
  /** 일정 시트 전용 커스텀 태그. 기록용 tags와 섞지 않는다. */
  eventTags: string[];
  updatedAt: string; // 액션 시각 — 도착 순서가 아니라 이 시각으로 LWW 판정한다
}

/** PUT /api/tags/prefs 요청. */
export interface TagPrefsPutRequest {
  tags: string[];
  /** 구버전 클라이언트가 생략하면 서버의 기존 목록을 유지한다. */
  eventTags?: string[];
  at: string;
}

/** GET /api/tags/prefs 응답. */
export interface TagPrefsResponse {
  ok: true;
  prefs: TagPrefs;
}

/** PUT /api/tags/prefs 응답. */
export interface TagPrefsPutResponse extends TagPrefsResponse {
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

const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function localDayKeyFromTs(ts: string | null): string | null {
  if (ts === null) return null;
  const t = Date.parse(ts);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** HTTP/IDB 경계의 구버전 status 행을 최신 형태로 맞춘다. */
export function normalizeMemberStatus(raw: unknown): MemberStatus | null {
  if (raw === null || typeof raw !== 'object') return null;
  const value = raw as Partial<MemberStatus>;
  if (
    !(MEMBER_IDS as readonly string[]).includes(value.m ?? '') ||
    typeof value.on !== 'boolean' ||
    typeof value.updatedAt !== 'string'
  ) {
    return null;
  }
  const updatedAt = Date.parse(value.updatedAt);
  if (!Number.isFinite(updatedAt)) return null;
  const since = typeof value.since === 'string' && Number.isFinite(Date.parse(value.since))
    ? new Date(Date.parse(value.since)).toISOString()
    : null;
  const lastStartedAt =
    typeof value.lastStartedAt === 'string' && Number.isFinite(Date.parse(value.lastStartedAt))
      ? new Date(Date.parse(value.lastStartedAt)).toISOString()
      : value.on && since !== null
        ? since
        : null;
  return {
    m: value.m as MemberId,
    on: value.on,
    place: (PLACES as readonly string[]).includes(value.place ?? '') ? value.place! : null,
    since,
    lastStartedAt,
    updatedAt: new Date(updatedAt).toISOString(),
  };
}

function maxValidIso(a: string | null | undefined, b: string | null | undefined): string | null {
  const am = typeof a === 'string' ? Date.parse(a) : NaN;
  const bm = typeof b === 'string' ? Date.parse(b) : NaN;
  const av = Number.isFinite(am) ? am : null;
  const bv = Number.isFinite(bm) ? bm : null;
  if (av === null && bv === null) return null;
  return new Date(Math.max(av ?? -Infinity, bv ?? -Infinity)).toISOString();
}

/** Status rows are current-state LWW by updatedAt, while lastStartedAt is monotonic history. */
export function mergeMemberStatus(current: MemberStatus | null | undefined, incoming: MemberStatus): MemberStatus {
  const base = current && current.updatedAt > incoming.updatedAt ? current : incoming;
  const lastStartedAt = maxValidIso(current?.lastStartedAt, incoming.lastStartedAt);
  return base.lastStartedAt === lastStartedAt ? base : { ...base, lastStartedAt };
}

/** Status action identity excludes lastStartedAt, which is independent monotonic history. */
export function sameStatusActionIdentity(a: MemberStatus, b: MemberStatus): boolean {
  return (
    a.m === b.m &&
    a.updatedAt === b.updatedAt &&
    a.on === b.on &&
    a.place === b.place &&
    a.since === b.since
  );
}

/** 오늘의 크루 도장 판정. 카운트는 기록 작성과 분리해 "오늘 공부 시작" 이력만 본다. */
export function hasTodayStudyStamp(
  s: MemberStatus | undefined,
  now: number,
  todayKey: string,
): boolean {
  if (!s || !DAY_KEY_RE.test(todayKey)) return false;
  if (localDayKeyFromTs(s.lastStartedAt) === todayKey) return true;
  if (s.on && isFreshSince(s.since, now)) return true;
  if (!s.on && s.lastStartedAt !== null && localDayKeyFromTs(s.updatedAt) === todayKey) {
    const started = Date.parse(s.lastStartedAt);
    const ended = Date.parse(s.updatedAt);
    return (
      Number.isFinite(started) &&
      Number.isFinite(ended) &&
      started <= ended &&
      ended - started < STATUS_TTL_MS
    );
  }
  return false;
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
  /** 라운지 글 본문 길이 — 기록 body(4000)보다 짧게: 자유 글은 짧은 근황이 본질이다.
      사진 장수는 photos(=ENTRY_PHOTO_LIMIT)를, 댓글 길이는 commentBody를 그대로 쓴다. */
  postBody: 2000,
} as const;
