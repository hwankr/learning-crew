/* 로컬 퍼스트 저장소.
   - UI는 이 스토어(메모리 Map)만 읽고 쓴다 — 상호작용은 네트워크를 기다리지 않는다.
   - 실제 쓰기는 IndexedDB에 지속 + 큐에 등록 → SyncClient가 백그라운드로 push.
   - 큐 항목은 rev(로컬 수정 카운터)와 base(마지막 서버 일치 스냅샷)를 함께 지녀서:
     · 전송 중 또 수정해도 ACK가 최신 수정을 지우지 못하고(rev 불일치 → 큐 유지),
     · 서버 CAS 충돌 시 base를 기준으로 필드 단위 3-way 병합을 한다 (삭제는 항상 승리).
   - id가 UUID가 아닌 행(데모 시드 s*)은 메모리 전용: 저장도 동기화도 하지 않는다.
   - 댓글·리액션도 같은 규칙을 따르되 병합 방식이 다르다:
     · 댓글은 내용이 불변이라 3-way 병합이 없다 — "보낸 삭제 상태 vs 지금 삭제 상태"만 비교한다.
     · 리액션은 기록×멤버당 1행으로 지금 상태(status)와 같은 액션 시각(actedAt) LWW다.
   - IndexedDB는 탭 사이 공유다: 이 탭의 메모리 큐만 보고 IDB를 덮으면 다른 탭이 남긴
     미전송 쓰기(큐 키가 있는 행)가 조용히 사라진다. 그래서 댓글·리액션의 pull 반영과 ACK는
     같은 readwrite 트랜잭션 안에서 큐 스토어·저장된 행을 읽어 판정한다. */
import type { IDBPTransaction } from 'idb';
import type {
  Comment,
  Entry,
  EntryPhoto,
  MemberId,
  MemberStatus,
  Notification,
  NotificationRead,
  Place,
  PullCursor,
  ReactionCursor,
  ReactionEmoji,
  ReactionSet,
} from '../../shared/types';
import {
  MEMBER_IDS,
  ENTRY_PHOTO_LIMIT,
  canonicalUuid,
  entryTags,
  isOffTags,
  normalizeEmojis,
  normalizePhotos,
  primaryTag,
  PUSH_LIMITS,
  UUID_RE,
} from '../../shared/types';
import {
  openCrewDB,
  photoCacheKey,
  reactionKey,
  type CrewDatabase,
  type CrewDB,
  type PhotoBlobRecord,
  type PhotoKind,
  type PhotoUploadState,
  type QueueMeta,
} from './idb';
import { prepareUpload, type PreparedUpload } from '../lib/image';
import {
  PhotoUploadQueue,
  type PhotoUploadItem,
  type PhotoUploadStorage,
} from './photoUpload';
import {
  seedComments,
  seedEntries,
  seedNotifications,
  seedReactionSets,
  seedStatuses,
} from '../lib/constants';

type StoreName =
  | 'entries'
  | 'queue'
  | 'comments'
  | 'commentQueue'
  | 'reactions'
  | 'reactionQueue'
  | 'notifications'
  | 'notifReadQueue'
  | 'photoBlobs'
  | 'photoCache'
  | 'meta';
type CrewTx = IDBPTransaction<CrewDB, StoreName[], 'readwrite'>;

// 구 프로토타입이 쓰던 localStorage 키 — 이관용이므로 이 이름 그대로 둬야 한다
const LEGACY_KEY = 'running-crew-entries-v2';
const MIGRATED_FLAG = 'migrated-legacy-v2';

/** 동기화 국면 — SyncClient가 갱신하고 UI가 그대로 표시한다.
    ('동기화 중' 표시는 pending>0에서 파생되므로 별도 국면이 필요 없다) */
export type SyncPhase = 'ok' | 'offline' | 'error' | 'auth';
export interface SyncInfo {
  phase: SyncPhase;
  /** 아직 서버에 안 간 변경 수 (기록 큐 + 지금 상태 dirty + 댓글 큐 + 리액션 dirty) */
  pending: number;
}

export interface StoreSnapshot {
  rev: number;
  entries: Entry[]; // deletedAt이 없는 살아있는 행만
  statuses: Partial<Record<MemberId, MemberStatus>>; // 멤버별 지금 상태
  /** entryId → 살아있는 댓글, (createdAt, id) 오름차순 */
  comments: Map<string, Comment[]>;
  /** entryId → 이모지가 하나 이상인 멤버별 리액션 집합 */
  reactions: Map<string, ReactionSet[]>;
  /** 내 알림 내역 — (createdAt, id) 내림차순(최신 먼저). 읽은 행도 담긴다(내역 화면용) */
  notifications: Notification[];
  /** 안 읽은 알림 수 — 벨 배지가 이 값 하나만 본다 */
  unreadNotifications: number;
  /** 내 사진의 이 기기 전용 상태 — UI 배지는 photoId로 이 Map만 구독한다. */
  photoUploads: Map<string, PhotoUploadInfo>;
  sync: SyncInfo;
}

export interface PhotoUploadInfo {
  state: PhotoUploadState;
  pct: number;
}

export class PhotoLimitError extends Error {
  readonly code = 'PHOTO_LIMIT_REACHED';

  constructor() {
    super(`사진은 기록마다 최대 ${ENTRY_PHOTO_LIMIT}장까지 첨부할 수 있습니다.`);
    this.name = 'PhotoLimitError';
  }
}

// meta 스토어의 지금 상태 저장 키
const MY_STATUS_KEY = 'myStatus';
const STATUS_DIRTY_KEY = 'statusDirty';
// meta 스토어의 스트림별 pull 커서 키 (기록 커서는 기존 이름 'cursor')
const ENTRY_CURSOR_KEY = 'cursor';
const COMMENT_CURSOR_KEY = 'commentCursor';
const REACTION_CURSOR_KEY = 'reactionCursor';
/** 알림 커서만 멤버별 키다 — 이 스트림은 토큰 주인 것만 오므로, 같은 기기에서 멤버를
    바꿔 로그인했을 때 공용 커서를 물려받으면 그 멤버의 기존 알림을 영구히 건너뛴다. */
const notifCursorKey = (m: MemberId): string => `notifCursor:${m}`;

/** 읽음 큐의 IDB 키 — `${memberId}|${notifId}`. 멤버 구분 이유는 idb.ts 참고. */
const notifReadKey = (m: MemberId, id: string): string => `${m}|${id}`;

/** 알림 보관 기간 — 서버(NOTIF_RETENTION_DAYS)와 같은 30일. 서버는 하드 삭제라 tombstone이
    안 오므로, 클라이언트가 스스로 나이 든 행을 지워야 로컬 복제본이 무한히 자라지 않는다. */
const NOTIF_RETENTION_MS = 30 * 86_400_000;

/** 3-way 병합 대상 필드 — 이 밖의 필드(v/updatedAt)는 동기화 메타데이터다.
    tag는 tags에서 파생되는 값이라 병합 대상이 아니다 — 병합 후 다시 계산한다. */
const MERGE_FIELDS = ['day', 'time', 'tags', 'stars', 'memo', 'body', 'photos'] as const;

function fieldEq(a: Entry, b: Entry, f: (typeof MERGE_FIELDS)[number] | 'todos'): boolean {
  // 배열 필드는 JSON 비교 — 정규화가 순서를 고정하므로(TAGS 순서) 안전하다
  if (f === 'todos' || f === 'tags' || f === 'photos') {
    return JSON.stringify(a[f]) === JSON.stringify(b[f]);
  }
  return a[f] === b[f];
}

/** 삭제 "상태"가 같은가 — tombstone 시각 문자열이 아니라 살았는지/지워졌는지만 본다. */
function sameLiveness(a: Entry, b: Entry): boolean {
  return (a.deletedAt === null) === (b.deletedAt === null);
}

/** 내용(동기화 메타 제외)이 같은가 — 충돌 응답이 사실상 내 쓰기의 에코일 때를 판별한다. */
export function contentEqual(a: Entry, b: Entry): boolean {
  return (
    MERGE_FIELDS.every((f) => fieldEq(a, b, f)) && fieldEq(a, b, 'todos') && sameLiveness(a, b)
  );
}

/** IDB에서 읽은 행 정규화 — 구버전 데이터에 v가 없으면 0(서버 리비전 모름)으로.
    첫 push가 CAS 충돌을 내면 병합 경로가 base를 되찾아 준다.
    tags/photos도 같은 이유로 여기서 채운다: 예전에 저장된 IDB 행과 구버전 Worker
    응답에는 새 필드가 없다 — 그대로 두면 병합 비교와 push가 undefined를 진짜 값으로 본다. */
export function normalizeEntry(e: Entry): Entry {
  const tags = entryTags(e);
  const photos = normalizePhotos(e.photos);
  const v = typeof e.v === 'number' ? e.v : 0;
  // OFF의 별점도 같은 경계에서 맞춘다. 구버전/깨진 IDB 행이 OFF+숫자를 들고 있으면
  // 서버 ACK 전까지 로컬 불변식이 깨지고, 병합에서 그 숫자를 "로컬 별점 수정"으로 오판한다.
  // 비-OFF+null은 레거시 "평가 없음"이므로 값을 지어내지 않고 그대로 보존한다.
  const stars = isOffTags(tags) ? null : e.stars;
  if (
    v === e.v &&
    e.tag === primaryTag(tags) &&
    e.stars === stars &&
    JSON.stringify(e.tags) === JSON.stringify(tags) &&
    JSON.stringify(e.photos) === JSON.stringify(photos)
  ) {
    return e;
  }
  return { ...e, v, tags, tag: primaryTag(tags), stars, photos };
}

/** 필드 단위 3-way 병합 — base에서 로컬이 고친 필드만 로컬을 취하고 나머지는 서버를 따른다.
    양쪽이 같은 필드를 고쳤으면 로컬이 이긴다. base가 없으면(신규 행 에코 등) 전부 로컬. */
export function mergeEntry(baseRaw: Entry | null, localRaw: Entry, serverRaw: Entry): Entry {
  // 큐의 base도 IDB에 함께 저장된다. 다중 태그 배포 전에 만들어진 dirty 큐는 base에
  // tags가 없으므로, 여기서까지 정규화하지 않으면 local.tags와 undefined를 비교해
  // 사용자가 태그를 고친 것으로 오판하고 서버의 실제 태그 변경을 덮는다.
  const base = baseRaw ? normalizeEntry(baseRaw) : null;
  const local = normalizeEntry(localRaw);
  const server = normalizeEntry(serverRaw);
  const pick = <K extends (typeof MERGE_FIELDS)[number] | 'todos'>(f: K): Entry[K] => {
    if (!base || !fieldEq(local, base, f)) return local[f];
    return server[f];
  };
  const tagsFromLocal = !base || !fieldEq(local, base, 'tags');
  const tags = tagsFromLocal ? local.tags : server.tags;
  const pickedStars = pick('stars');
  // tags와 stars는 대부분 독립 병합하되 OFF 경계를 넘을 때 함께 보정한다.
  // 비-OFF+null 자체는 레거시 "평가 없음"으로 허용하지만, 다른 쪽에 숫자 별점이 있으면
  // 태그 승자 쪽의 기존 별점을 보존한다. OFF가 최종 태그면 어떤 경우에도 null이다.
  const stars = isOffTags(tags)
    ? null
    : (pickedStars ?? (tagsFromLocal ? local.stars : server.stars));
  return {
    ...server, // id/m/v/updatedAt은 서버 기준
    day: pick('day'),
    time: pick('time'),
    tags,
    tag: primaryTag(tags), // 파생 필드 — 병합 결과의 tags에 다시 맞춘다
    stars,
    memo: pick('memo'),
    body: pick('body'),
    todos: pick('todos'),
    photos: pick('photos'),
    deletedAt: null, // 삭제 충돌은 병합 전에 별도 규칙으로 처리된다
  };
}

/* ---------- 댓글·리액션 순수 로직 (스토어가 이 규칙들로 스냅샷과 정산을 결정한다) ---------- */

/** 스냅샷용 댓글 맵 — 살아있는 댓글만 기록별로 묶고 (createdAt, id) 오름차순.
    id를 2차 키로 두는 이유: 같은 초에 달린 댓글의 순서가 탭마다 달라 보이면 안 된다. */
export function groupComments(list: Iterable<Comment>): Map<string, Comment[]> {
  const out = new Map<string, Comment[]>();
  for (const c of list) {
    if (c.deletedAt) continue;
    const arr = out.get(c.entryId);
    if (arr) arr.push(c);
    else out.set(c.entryId, [c]);
  }
  for (const arr of out.values()) {
    arr.sort((a, b) => (a.createdAt === b.createdAt ? cmp(a.id, b.id) : cmp(a.createdAt, b.createdAt)));
  }
  return out;
}

/** 스냅샷용 리액션 맵 — 빈 집합("다 뗐다"를 서버에 전하려고 남겨 둔 행)은 뺀다.
    멤버 순서를 고정해야 칩의 이름 목록이 흔들리지 않는다. */
export function groupReactions(list: Iterable<ReactionSet>): Map<string, ReactionSet[]> {
  const out = new Map<string, ReactionSet[]>();
  for (const r of list) {
    if (r.emojis.length === 0) continue;
    const arr = out.get(r.entryId);
    if (arr) arr.push(r);
    else out.set(r.entryId, [r]);
  }
  for (const arr of out.values()) {
    arr.sort((a, b) => MEMBER_IDS.indexOf(a.m) - MEMBER_IDS.indexOf(b.m));
  }
  return out;
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** 토글 결과 집합 — 있으면 빼고 없으면 더한 뒤 서버와 같은 정규화(REACTIONS 순서)를 건다.
    순서가 어긋나면 내용이 같은데도 서로를 "변경"으로 보고 무의미한 동기화가 돈다. */
export function toggledEmojis(cur: readonly ReactionEmoji[], emoji: ReactionEmoji): ReactionEmoji[] {
  return normalizeEmojis(cur.includes(emoji) ? cur.filter((e) => e !== emoji) : [...cur, emoji]);
}

/** ACK로 댓글 큐를 비워도 되는가 — 저장된 행이 보낸 것과 여전히 같을 때만 비운다.
    stored는 **IDB에 저장된 행**(탭 사이 공유)이다: 전송 중에 이 탭이든 다른 탭이든 지웠으면
    삭제 상태가 어긋나고, 그때 서버 행을 채택하면 그 tombstone이 조용히 유실된다.
    행이 없는 경우를 "정산 가능"으로 보는 건 **메모리 전용 탭 폴백 전용** 규칙이다
    (그 탭에는 공유 IDB라는 진실이 없어 이게 최선이다). 트랜잭션을 열 수 있는 경로는
    `commentAckOutcome`을 쓴다 — 거기서는 행이 없다는 사실 자체가 정보다. */
export function commentAckSettles(sent: Comment, stored: Comment | undefined): boolean {
  return !stored || (stored.deletedAt === null) === (sent.deletedAt === null);
}

/** IDB를 열 수 있는 ACK 경로의 판정 — 저장된 행이 탭 사이의 공유 진실이다.
    'hold'  = 전송 중에 삭제 상태가 바뀌었다 → 큐 키를 남겨 그 쓰기를 다음 라운드가 보낸다.
    'gone'  = 저장된 행이 아예 없다 = **이미 정산된 삭제**다. 다른 탭이 tombstone을 push·ACK까지
              끝내며 행을 지웠다는 뜻이므로, 큐 키만 지우고 **살아 있는 서버 행을 되살리지 않는다**.
              되살리면 90초 안전 지평선을 지난 커서가 그 tombstone을 다시 실어 주지 못해
              로컬 복제본에 지워진 댓글이 영구히 남는다 — "삭제는 항상 승리, 부활 없음"을 어긴다.
    'adopt' = 서버 행을 그대로 채택하고 큐를 비운다(댓글은 이길 수 없는 스트림이다). */
export function commentAckOutcome(
  sent: Comment,
  stored: Comment | undefined,
): 'hold' | 'gone' | 'adopt' {
  if (!stored) return 'gone';
  return commentAckSettles(sent, stored) ? 'adopt' : 'hold';
}

/** ACK로 리액션 dirty를 내려도 되는가 — 저장된 행의 액션 시각이 보낸 값과 같을 때만.
    다르면 전송 중에 (이 탭이든 다른 탭이든) 다시 토글한 것이라 dirty를 남겨 재전송한다. */
export function reactionAckSettles(sent: ReactionSet, stored: ReactionSet | undefined): boolean {
  return !stored || stored.actedAt === sent.actedAt;
}

/** 다른 탭이 IDB에 남긴 **내** 리액션 행을 이 탭이 어떻게 병합할지.
    행 채택은 액션 시각(actedAt)으로 판정한다 — 더 새 토글을 되돌리면 안 되므로
    메모리가 더 새로우면 메모리 행을 유지한다.
    dirty는 행 채택과 별개로 IDB를 따른다: IDB에 dirty 키가 있는데 이 탭이 채택하지 않으면
    (예: actedAt이 같아 행을 그대로 두는 경우) 그 키를 아무도 push하지 못해 고아로 남는다. */
export function mergeMyReactionFromDB(i: {
  rowActedAt: string;
  curActedAt: string | undefined; // 메모리에 행이 없으면 undefined
  dbDirty: boolean;
  memDirty: boolean;
}): { takeRow: boolean; dirty: boolean } {
  if (i.curActedAt === undefined || i.rowActedAt > i.curActedAt) {
    return { takeRow: true, dirty: i.dbDirty };
  }
  // 메모리가 더 새로운데 IDB가 dirty면 그 키는 아직 아무도 못 보낸 것 — 메모리 행으로 보낸다
  if (i.rowActedAt < i.curActedAt) return { takeRow: false, dirty: i.memDirty || i.dbDirty };
  return { takeRow: false, dirty: i.dbDirty };
}

/** 다른 탭이 IDB에 남긴 댓글 행을 이 탭 메모리가 채택해야 하는가.
    queued = 이 탭 큐에 이미 있음, adopted = 이번 병합에서 그 큐 키를 새로 채택했음.
    큐에 있는 행은 로컬 쓰기가 이기지만 **IDB가 tombstone이면 삭제가 이긴다**(부활 없음):
    두 탭이 이미 같은 큐 키를 갖고 있으면 "새로 채택"이 일어나지 않아, 이 예외가 없으면
    다른 탭이 지운 댓글을 살아 있는 채로 계속 push·정산해 삭제가 지연·유실된다. */
export function adoptCommentFromDB(
  db: Comment,
  o: { queued: boolean; adopted: boolean },
): boolean {
  return !o.queued || o.adopted || db.deletedAt !== null;
}

/** pull이 다시 실어 온 댓글이 이미 반영된 중복 전달인가 (커서 안전 윈도우는 같은 행을 또 싣는다).
    updatedAt만으로는 부족하다: 서버는 프로토콜 경계에서 타임스탬프를 밀리초까지만 내보내는데
    (isoTs, Postgres는 마이크로초) 같은 행이 1ms 안에 두 번 갱신되면 두 상태의 문자열이 같아진다.
    기록에는 v(서버 리비전)라는 별도 판별값이 있지만 이 스트림에는 없어서, 그때 뒤의 tombstone을
    "이미 받은 행"으로 오인해 영구히 버린다. 닿기 매우 어려운 조건이지만 판별값을 하나 더 보는
    비용이 사실상 0이라 막아 둔다. 내용은 불변이니 삭제 상태가 곧 두 번째 판별값이다. */
export function isDuplicateComment(cur: Comment, row: Comment): boolean {
  return cur.updatedAt === row.updatedAt && (cur.deletedAt === null) === (row.deletedAt === null);
}

/** 리액션판 같은 판정 — 이모지 집합이 바뀌면 액션 시각도 반드시 바뀌므로
    actedAt이 곧 집합의 판별값이다(집합끼리 비교할 필요가 없다). */
export function isDuplicateReaction(cur: ReactionSet, row: ReactionSet): boolean {
  return cur.updatedAt === row.updatedAt && cur.actedAt === row.actedAt;
}

/** pull이 실어 온 알림 행을 어떻게 반영할지 — 'skip' 또는 저장할 행.
    queuedAt = 이 행의 읽음 처리가 아직 서버에 못 갔을 때, 읽은 시점에 관측한 updatedAt
    (없으면 null). 그 세대(row.updatedAt <= queuedAt)의 안 읽음 행에는 로컬 읽음이 이긴다 —
    그대로 채택하면 방금 읽은 알림이 다시 안 읽음으로 번쩍인다. 반대로 행이 그보다
    새로우면(집계 행에 새 응원) 서버의 "다시 안 읽음"이 이긴다 — 옛 읽음은 옛 세대의 것이다. */
export function notifPullAction(
  cur: Notification | undefined,
  row: Notification,
  queuedAt: string | null,
  nowIso: string,
): 'skip' | Notification {
  // 느린 응답(오래된 스냅샷)이 그 사이 채택된 더 새 행을 되돌리지 못하게 (ISO 사전순 = 시간순)
  if (cur && row.updatedAt < cur.updatedAt) return 'skip';
  const localReadWins = queuedAt !== null && row.readAt === null && row.updatedAt <= queuedAt;
  const next = localReadWins ? { ...row, readAt: cur?.readAt ?? nowIso } : row;
  // 커서 안전 윈도우의 중복 전달 — updatedAt이 같아도 집계 갱신 둘이 같은 밀리초에
  // 몰리면(프로토콜이 ms까지만 내보낸다) count가 다를 수 있어 count까지 본다
  if (
    cur &&
    cur.updatedAt === next.updatedAt &&
    (cur.readAt === null) === (next.readAt === null) &&
    cur.count === next.count
  ) {
    return 'skip';
  }
  return next;
}

/** 스냅샷용 알림 목록 — (createdAt, id) 내림차순. 보관 기간이 지난 행은 뺀다. */
export function sortNotifications(list: Iterable<Notification>, now: number): Notification[] {
  const out = [...list].filter((n) => now - Date.parse(n.createdAt) < NOTIF_RETENTION_MS);
  out.sort((a, b) =>
    a.createdAt === b.createdAt ? cmp(b.id, a.id) : cmp(b.createdAt, a.createdAt),
  );
  return out;
}

/** meta에서 읽은 값이 기록·댓글 커서인가 — 리액션 커서(entryId/m)와 모양으로 구분한다. */
function asPullCursor(v: unknown): PullCursor | null {
  return v !== null && typeof v === 'object' && 'ts' in v && 'id' in v ? (v as PullCursor) : null;
}
function asReactionCursor(v: unknown): ReactionCursor | null {
  return v !== null && typeof v === 'object' && 'ts' in v && 'entryId' in v
    ? (v as ReactionCursor)
    : null;
}
/** meta의 지금 상태 — 리액션 커서도 m을 가지므로 on으로 가려야 한다. */
function asMemberStatus(v: unknown): MemberStatus | null {
  return v !== null && typeof v === 'object' && 'on' in v ? (v as MemberStatus) : null;
}

export class CrewStore implements PhotoUploadStorage {
  private map = new Map<string, Entry>();
  private queue = new Map<string, QueueMeta>();
  private statuses = new Map<MemberId, MemberStatus>();
  private statusDirty = false; // 내 상태가 아직 서버에 안 갔음
  // 댓글: id → 행. 아직 push 안 된 tombstone도 여기 남는다(스냅샷에서만 걸러진다)
  private comments = new Map<string, Comment>();
  private commentQueue = new Set<string>();
  // 리액션: reactionKey(entryId, m) → 행. dirty는 entryId만으로 충분하다 — 내 행만 dirty가 된다
  private reactions = new Map<string, ReactionSet>();
  private reactionDirty = new Set<string>();
  // 알림: id → 행(전부 내 것 — pull이 토큰 주인 것만 준다). 큐가 담는 건 읽음 처리뿐이고,
  // 값은 읽은 시점에 관측한 그 행의 updatedAt(세대 판별값)이다
  private notifications = new Map<string, Notification>();
  private notifReadQueue = new Map<string, string>();
  // 내가 고른 사진은 상태와 함께 메모리에 미러링한다 — IDB 실패 시 이 Map이 세션 폴백이다.
  private photoBlobs = new Map<string, PhotoBlobRecord>();
  // 내려받은 캐시는 보통 IDB에서 필요할 때 읽고, 실패/메모리 전용 경로는 여기서 이어 쓴다.
  private photoCache = new Map<string, Blob>();
  private photoUploader: PhotoUploadQueue | null = null;
  // 여러 파일을 동시에 디코드해도 네 장 경계를 함께 통과하지 못하게 준비 중 자리도 센다.
  private photoReservations = new Map<string, number>();
  // 열려 있는 초안의 참조는 원격 Entry 채택과 수명이 다르다. 동기화가 Entry를
  // 지워도 시트가 살리기를 결정할 때까지 blob을 보호하고, pin이 풀리면 미뤄 둔 정리를 끝낸다.
  private activeDraftPhotoIds = new Set<string>();
  private deferredPhotoCleanup = new Set<string>();
  private me: MemberId = 'sh';
  private demo = false;
  private listeners = new Set<() => void>();
  private syncPhase: SyncPhase = 'ok';
  private snapshot: StoreSnapshot = {
    rev: 0,
    entries: [],
    statuses: {},
    comments: new Map(),
    reactions: new Map(),
    notifications: [],
    unreadNotifications: 0,
    photoUploads: new Map(),
    sync: { phase: 'ok', pending: 0 },
  };
  private db: CrewDatabase | null = null;
  // 같은 기기의 다른 탭과 변경을 주고받는 채널 — 한 탭이 pull/push한 결과를 다른 탭도 반영한다
  private bc: BroadcastChannel | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private refreshing = false;
  // 마지막으로 IDB에 쓴 커서 — 값이 같으면 폴링마다 무의미한 readwrite 트랜잭션을 만들지 않는다
  private lastCursor: PullCursor | null = null;
  private lastCommentCursor: PullCursor | null = null;
  private lastReactionCursor: ReactionCursor | null = null;
  private lastNotifCursor: PullCursor | null = null;

  /** SyncClient가 등록 — 로컬 쓰기 직후 push를 예약한다. */
  onLocalWrite: (() => void) | null = null;

  async init(opts: { demo: boolean; memberId: MemberId; token?: string | null }): Promise<void> {
    this.me = opts.memberId;
    this.demo = opts.demo;
    // IndexedDB가 막힌 환경(사생활 모드, 손상된 프로필)에서도 첫 렌더는 무조건 되어야 한다.
    // 열기가 실패하거나 2초 안에 안 끝나면 메모리 전용으로 동작한다(this.db는 계속 null).
    try {
      this.db = await Promise.race([
        openCrewDB(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000)),
      ]);
    } catch {
      this.db = null;
    }
    if (this.db) {
      // 전부 한 읽기 트랜잭션으로 — 특히 큐의 키·값을 따로 읽으면 다른 탭의 커밋이
      // 사이에 끼어들어 키와 값이 어긋난 채(엉뚱한 base로) 짝지어질 수 있다
      const tx = this.db.transaction([
        'entries',
        'queue',
        'comments',
        'commentQueue',
        'reactions',
        'reactionQueue',
        'notifications',
        'notifReadQueue',
        'photoBlobs',
        'meta',
      ]);
      const [
        rows,
        qkeys,
        qvals,
        cRows,
        cQueue,
        rRows,
        rQueue,
        nRows,
        nQKeys,
        nQVals,
        photoKeys,
        photoRows,
        st,
        dirty,
      ] =
        await Promise.all([
          tx.objectStore('entries').getAll(),
          tx.objectStore('queue').getAllKeys(),
          tx.objectStore('queue').getAll(),
          tx.objectStore('comments').getAll(),
          tx.objectStore('commentQueue').getAllKeys(),
          tx.objectStore('reactions').getAll(),
          tx.objectStore('reactionQueue').getAllKeys(),
          tx.objectStore('notifications').getAll(),
          tx.objectStore('notifReadQueue').getAllKeys(),
          tx.objectStore('notifReadQueue').getAll(),
          tx.objectStore('photoBlobs').getAllKeys(),
          tx.objectStore('photoBlobs').getAll(),
          tx.objectStore('meta').get(MY_STATUS_KEY),
          tx.objectStore('meta').get(STATUS_DIRTY_KEY),
        ]);
      await tx.done;
      for (const e of rows) this.map.set(e.id, normalizeEntry(e));
      qkeys.forEach((k, i) => this.queue.set(String(k), qvals[i]!));
      for (const c of cRows) this.comments.set(c.id, c);
      for (const k of cQueue) this.commentQueue.add(String(k));
      for (const r of rRows) this.reactions.set(reactionKey(r.entryId, r.m), r);
      for (const k of rQueue) this.reactionDirty.add(String(k));
      // 알림 — 남의 행(멤버 전환 잔재)과 보관 기간 지난 행은 걸러 싣고, 후자는 IDB에서도 지운다
      const now = Date.now();
      const expired: string[] = [];
      for (const n of nRows) {
        if (n.m !== opts.memberId) continue;
        if (now - Date.parse(n.createdAt) >= NOTIF_RETENTION_MS) expired.push(n.id);
        else this.notifications.set(n.id, n);
      }
      // 읽음 큐는 내 접두사(`m|`)만 — 다른 멤버의 미전송 읽음을 내 토큰으로 정산해 버리면 안 된다
      const myPrefix = `${opts.memberId}|`;
      nQKeys.forEach((k, i) => {
        const key = String(k);
        if (key.startsWith(myPrefix)) {
          this.notifReadQueue.set(key.slice(myPrefix.length), String(nQVals[i]));
        }
      });
      if (!opts.demo) {
        photoKeys.forEach((k, i) => {
          const row = photoRows[i];
          if (row) this.photoBlobs.set(String(k), row);
        });
      }
      if (expired.length && !opts.demo) {
        this.txWrite(['notifications', 'notifReadQueue'], (tx2) => {
          for (const id of expired) {
            void tx2.objectStore('notifications').delete(id);
            void tx2.objectStore('notifReadQueue').delete(notifReadKey(opts.memberId, id));
          }
        }, false);
        for (const id of expired) this.notifReadQueue.delete(id);
      }
      // 내 상태는 지속 — 다른 멤버 상태는 어차피 첫 pull에 실려 온다
      const mine = asMemberStatus(st);
      if (!opts.demo && mine && mine.m === opts.memberId) {
        this.statuses.set(mine.m, mine);
        this.statusDirty = !!dirty;
      }
    }
    if (!opts.demo) await this.migrateLegacy(opts.memberId);
    if (opts.demo) {
      if (this.map.size === 0) for (const e of seedEntries()) this.map.set(e.id, e);
      for (const s of seedStatuses()) if (s.m !== opts.memberId) this.statuses.set(s.m, s);
      // 시드 댓글·리액션은 시드 기록(s*)에 달려 있어 지속·동기화 대상이 아니다 — 메모리에만 산다
      for (const c of seedComments()) this.comments.set(c.id, c);
      for (const r of seedReactionSets()) this.reactions.set(reactionKey(r.entryId, r.m), r);
      for (const n of seedNotifications(opts.memberId)) this.notifications.set(n.id, n);
    }
    if (this.db && !opts.demo && typeof BroadcastChannel !== 'undefined') {
      this.bc = new BroadcastChannel('lc-sync');
      // 다른 탭이 IDB를 갱신했다 — 짧게 모아서 다시 읽는다
      this.bc.onmessage = () => this.scheduleRefresh();
    }
    // Node 기반 순수 로직 테스트에는 window가 없다. 브라우저에서는 init 직후 미완료 큐를 재개한다.
    if (typeof window !== 'undefined') {
      this.photoUploader = new PhotoUploadQueue(this, {
        token: opts.token ?? null,
        demo: opts.demo,
      });
      this.photoUploader.start();
    }
    this.bump();
  }

  /* ---------- 읽기 (React 바인딩) ---------- */
  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getSnapshot = (): StoreSnapshot => this.snapshot;

  getById(id: string): Entry | undefined {
    return this.map.get(id);
  }
  pendingIds(): string[] {
    return [...this.queue.keys()];
  }

  /** push용 스냅샷 — 각 행의 현재 rev를 함께 찍는다. ACK는 이 rev와 일치할 때만 큐를 비운다.
      행이 없는 고아 큐 키(구버전 반쪽 상태의 잔재)는 여기서 정리한다 — 두면 pending이
      영원히 0이 되지 않아 재동기화가 쉬지 않고 돈다. */
  pendingSnapshot(): { entry: Entry; rev: number }[] {
    const out: { entry: Entry; rev: number }[] = [];
    for (const [id, meta] of this.queue) {
      const entry = this.map.get(id);
      if (!entry) {
        this.dropFromQueue(id);
        continue;
      }
      out.push({ entry, rev: meta.rev });
    }
    return out;
  }

  /* ---------- 사진 바이너리 (UI/업로드 큐/표시 훅의 공용 경계) ---------- */

  /** 파일 선택 경로 — 디코드·리사이즈가 성공한 뒤에만 photoBlobs에 행을 만든다.
      수정 시트는 currentPhotos를 넘겨 "4장에서 한 장 빼고 교체"도 현재 시트 기준으로 센다. */
  async addPhoto(
    entryId: string,
    file: File,
    currentPhotos?: readonly EntryPhoto[],
  ): Promise<EntryPhoto> {
    this.reservePhotoSlot(entryId, currentPhotos);
    try {
      return this.storePreparedPhoto(entryId, await prepareUpload(file), crypto.randomUUID());
    } finally {
      const left = (this.photoReservations.get(entryId) ?? 1) - 1;
      if (left > 0) this.photoReservations.set(entryId, left);
      else this.photoReservations.delete(entryId);
    }
  }

  /** 리사이즈 결과 저장. prepareUpload을 직접 묶는 UI도 currentPhotos를 마지막 인자로 넘긴다. */
  addPreparedPhoto(
    entryId: string,
    prepared: PreparedUpload,
    photoId: string = crypto.randomUUID(),
    currentPhotos?: readonly EntryPhoto[],
  ): EntryPhoto {
    if (this.photoCount(entryId, currentPhotos) >= ENTRY_PHOTO_LIMIT) throw new PhotoLimitError();
    return this.storePreparedPhoto(entryId, prepared, photoId);
  }

  private storePreparedPhoto(
    entryId: string,
    prepared: PreparedUpload,
    photoId: string,
  ): EntryPhoto {
    if (!UUID_RE.test(photoId)) throw new RangeError('photo id must be a UUID');
    const id = canonicalUuid(photoId);
    if (this.photoBlobs.has(id)) throw new Error(`duplicate photo id: ${id}`);
    const state: PhotoUploadState = this.demo ? 'done' : 'wait';
    const row: PhotoBlobRecord = {
      full: prepared.full,
      thumb: prepared.thumb,
      state,
      pct: state === 'done' ? 100 : 0,
      entryId,
      addedAt: Date.now(),
    };
    this.photoBlobs.set(id, row);
    if (!this.demo) {
      this.txWrite(['photoBlobs'], (tx) => {
        void tx.objectStore('photoBlobs').put(row, id);
      });
    }
    this.bump();
    return { id, w: prepared.w, h: prepared.h };
  }

  private photoCount(entryId: string, currentPhotos?: readonly EntryPhoto[]): number {
    const ids = new Set(
      currentPhotos ?? this.map.get(entryId)?.photos ?? [],
    );
    const photoIds = new Set([...ids].map((photo) => photo.id));
    for (const [id, row] of this.photoBlobs) {
      if (row.entryId === entryId) photoIds.add(id);
    }
    return photoIds.size;
  }

  private reservePhotoSlot(entryId: string, currentPhotos?: readonly EntryPhoto[]): void {
    const reserved = this.photoReservations.get(entryId) ?? 0;
    if (this.photoCount(entryId, currentPhotos) + reserved >= ENTRY_PHOTO_LIMIT) {
      throw new PhotoLimitError();
    }
    this.photoReservations.set(entryId, reserved + 1);
  }

  private photoIsAttached(photoId: string, row: PhotoBlobRecord): boolean {
    const entry = this.map.get(row.entryId);
    return (
      !!entry &&
      entry.m === this.me &&
      !entry.deletedAt &&
      entry.photos.some((photo) => photo.id === photoId)
    );
  }

  /** 상태 배지도 현재 토큰 주인의 사진만 본다. Entry가 아직 없는 신규 초안은
      현재 탭에서 만든 행이므로 보이되, 다른 멤버 Entry에 묶인 행은 멤버 전환 뒤 숨긴다. */
  private photoStatusBelongsToMe(row: PhotoBlobRecord): boolean {
    const entry = this.map.get(row.entryId);
    return !entry || entry.m === this.me;
  }

  /** App이 활성 초안의 참조 목록을 교체하는 경계. 중간에 빈 목록을 거치지 않게
      전체 목록을 한 번에 받아야, 사진 추가/제거 렌더 사이에 보호 blob이 사라지지 않는다. */
  setActiveDraftPhotoIds(photoIds: readonly string[]): void {
    const next = new Set(photoIds);
    this.activeDraftPhotoIds = next;
    let changed = false;
    for (const id of [...this.deferredPhotoCleanup]) {
      if (next.has(id)) continue;
      this.deferredPhotoCleanup.delete(id);
      changed = this.dropPhotoBlob(id) || changed;
    }
    if (changed) this.bump();
  }

  /** 시트에서 한 장을 빼는 경로. 아직 업로드 중이면 XHR부터 끊고 로컬 바이너리를 지운다. */
  removeDraftPhoto(photoId: string): void {
    if (this.dropPhotoBlob(photoId)) this.bump();
  }

  /** 기록 삭제/초안 폐기 때 entryId로 묶인 바이너리를 전부 정리한다. */
  removePhotosForEntry(entryId: string): void {
    let changed = false;
    for (const [id, row] of [...this.photoBlobs]) {
      if (row.entryId === entryId) changed = this.dropPhotoBlob(id) || changed;
    }
    if (changed) this.bump();
  }

  retryPhoto(photoId: string): boolean {
    const row = this.photoBlobs.get(photoId);
    if (!row || !this.photoIsAttached(photoId, row)) return false;
    return this.photoUploader?.retryPhoto(photoId) ?? false;
  }

  getPhotoUploadStatus(photoId: string): PhotoUploadInfo | null {
    const row = this.photoBlobs.get(photoId);
    return row && this.photoStatusBelongsToMe(row) ? { state: row.state, pct: row.pct } : null;
  }

  /** PhotoUploadStorage 구현 — 큐는 Map이나 IDB를 직접 만지지 않는다. */
  listPhotoUploads(): PhotoUploadItem[] {
    // 시트에서 고르기만 한 사진은 아직 R2로 보내지 않는다. Entry.photos에 실려 저장된
    // 순간부터 큐 대상이다 — 취소한 초안이 서버에 orphan을 남기지 않게 하는 경계다.
    return [...this.photoBlobs]
      .filter(([id, row]) => this.photoIsAttached(id, row))
      .sort((a, b) => a[1].addedAt - b[1].addedAt || cmp(a[0], b[0]))
      .map(([id, row]) => ({ id, ...row }));
  }

  getPhotoUpload(photoId: string): PhotoBlobRecord | undefined {
    return this.photoBlobs.get(photoId);
  }

  setPhotoUploadState(photoId: string, state: PhotoUploadState, pct: number): void {
    const cur = this.photoBlobs.get(photoId);
    if (!cur) return;
    const nextPct = Math.max(0, Math.min(100, Math.round(pct)));
    if (cur.state === state && cur.pct === nextPct) return;
    const next = { ...cur, state, pct: nextPct };
    this.photoBlobs.set(photoId, next);
    // 진행률은 같은 탭 스냅샷에는 즉시 반영하되 매 1%마다 다른 탭 전체를 깨우지는 않는다.
    if (!this.demo) {
      this.txWrite(['photoBlobs'], (tx) => {
        void tx.objectStore('photoBlobs').put(next, photoId);
      }, cur.state !== state);
    }
    this.bump();
  }

  /** usePhotoUrl 우선순위 1: 내가 올린 사진. done 전에도 로컬 미리보기가 가능하다. */
  getLocalPhotoBlob(photoId: string, kind: PhotoKind): Blob | null {
    return this.photoBlobs.get(photoId)?.[kind] ?? null;
  }

  /** 수정하던 Entry가 원격에서 사라진 뒤 "새 기록으로 살리기" 전용.
      기존 photoId는 삭제된 Entry의 R2 소유권에 묶였으므로 재사용하지 않고, 로컬 JPEG가
      둘 다 남은 사진만 새 UUID와 업로드 상태로 복제한다. blob이 없으면 404 메타를
      만들지 않고 결과에서 뺀다. */
  cloneDraftPhotosForEntry(photos: readonly EntryPhoto[], entryId: string): EntryPhoto[] {
    const out: EntryPhoto[] = [];
    const seen = new Set<string>();
    for (const photo of photos) {
      if (seen.has(photo.id) || out.length >= ENTRY_PHOTO_LIMIT) continue;
      seen.add(photo.id);
      const row = this.photoBlobs.get(photo.id);
      if (!row) continue;
      out.push(
        this.storePreparedPhoto(
          entryId,
          { full: row.full, thumb: row.thumb, w: photo.w, h: photo.h },
          crypto.randomUUID(),
        ),
      );
    }
    return out;
  }

  /** usePhotoUrl 우선순위 2: 내려받은 크루 사진 캐시. IDB 실패 시 Map이 세션 캐시다. */
  async getCachedPhotoBlob(photoId: string, kind: PhotoKind): Promise<Blob | null> {
    const key = photoCacheKey(photoId, kind);
    const memory = this.photoCache.get(key);
    if (memory) return memory;
    if (this.demo) return null;
    const db = this.db;
    if (!db) return null;
    try {
      const blob = await db.get('photoCache', key);
      if (blob) this.photoCache.set(key, blob);
      return blob ?? null;
    } catch {
      return null;
    }
  }

  async cachePhotoBlob(photoId: string, kind: PhotoKind, blob: Blob): Promise<void> {
    const key = photoCacheKey(photoId, kind);
    this.photoCache.set(key, blob);
    if (this.demo) return;
    const db = this.db;
    if (!db) return;
    try {
      await db.put('photoCache', blob, key);
    } catch {
      // 용량 초과·닫힌 DB면 세션 Map만으로 계속 표시한다.
    }
  }

  /** 앱/테스트가 명시적으로 수명을 끝낼 때 online/offline 리스너와 XHR을 정리한다. */
  stopPhotoUploads(): void {
    this.photoUploader?.stop();
  }

  private dropPhotoBlob(photoId: string): boolean {
    if (!this.photoBlobs.has(photoId)) return false;
    this.photoUploader?.cancel(photoId);
    this.photoBlobs.delete(photoId);
    this.activeDraftPhotoIds.delete(photoId);
    this.deferredPhotoCleanup.delete(photoId);
    if (!this.demo) {
      this.txWrite(['photoBlobs'], (tx) => {
        void tx.objectStore('photoBlobs').delete(photoId);
      });
    }
    return true;
  }

  /** 새 기록으로 살리는 경로처럼 draft의 임시 entryId가 바뀌어도 삭제 수명은 최종 기록을 따른다. */
  private associatePhoto(photoId: string, entryId: string): void {
    const cur = this.photoBlobs.get(photoId);
    if (!cur || cur.entryId === entryId) return;
    const next = { ...cur, entryId };
    this.photoBlobs.set(photoId, next);
    if (!this.demo) {
      this.txWrite(['photoBlobs'], (tx) => {
        void tx.objectStore('photoBlobs').put(next, photoId);
      });
    }
  }

  private cleanupPhotoBlob(photoId: string, protectDraft: boolean): boolean {
    if (!this.photoBlobs.has(photoId)) return false;
    if (protectDraft && this.activeDraftPhotoIds.has(photoId)) {
      this.deferredPhotoCleanup.add(photoId);
      return false;
    }
    return this.dropPhotoBlob(photoId);
  }

  /** Entry 참조가 바뀌는 모든 채택 경로의 blob 수명 규칙.
      - 살아 있는 next가 참조하는 사진은 그 Entry에 연결한다.
      - previous에서 빠진 참조(삭제는 해당 entryId의 모든 행)는 정리한다.
      - 원격/CAS/다른 탭 채택은 활성 초안 pin을 보호하고, 로컬 저장은 사용자가
        확정한 photos가 최종 참조이므로 pin과 무관하게 정리한다. */
  private reconcileEntryPhotoReferences(
    previous: Entry | undefined,
    next: Entry | null,
    entryId: string,
    protectDraft: boolean,
  ): boolean {
    const kept = new Set(
      next && !next.deletedAt ? next.photos.map((photo) => photo.id) : [],
    );
    for (const id of kept) {
      this.deferredPhotoCleanup.delete(id);
      this.associatePhoto(id, entryId);
    }

    const removed = new Set<string>();
    for (const photo of previous?.photos ?? []) {
      if (!kept.has(photo.id)) removed.add(photo.id);
    }
    if (!next || next.deletedAt) {
      for (const [id, row] of this.photoBlobs) {
        if (row.entryId === entryId) removed.add(id);
      }
      for (const photo of next?.photos ?? []) removed.add(photo.id);
    }

    let changed = false;
    for (const id of removed) {
      if (!kept.has(id)) changed = this.cleanupPhotoBlob(id, protectDraft) || changed;
    }
    return changed;
  }

  /** 서버·CAS·다른 탭의 Entry를 확정으로 채택한다. blob 정리는 반드시 위의
      참조 기반 규칙을 거쳐, 새 채택 지점이 수명 처리를 빼먹지 않게 한다. */
  private adoptEntry(next: Entry, retainTombstone = false): boolean {
    const previous = this.map.get(next.id);
    const photoChanged = this.reconcileEntryPhotoReferences(previous, next, next.id, true);
    if (next.deletedAt && !retainTombstone) return this.map.delete(next.id) || photoChanged;
    this.map.set(next.id, next);
    return true;
  }

  /** 다른 탭이 tombstone ACK까지 끝내 IDB 행 자체가 사라진 경우의 채택. */
  private adoptMissingEntry(id: string): boolean {
    const previous = this.map.get(id);
    const photoChanged = this.reconcileEntryPhotoReferences(previous, null, id, true);
    return this.map.delete(id) || photoChanged;
  }

  /* ---------- 쓰기 (UI 경로 — 항상 즉시 반영) ---------- */
  upsert(raw: Entry): void {
    // UI/레거시 이관을 포함한 모든 로컬 쓰기의 마지막 경계. 호출자가 실수로 tag를 직접
    // 대입하거나 tags 순서를 뒤섞어도 IDB와 push 큐에는 정규형만 들어가게 한다.
    const entry = normalizeEntry(raw);
    const prev = this.map.get(entry.id);
    this.reconcileEntryPhotoReferences(prev, entry, entry.id, false);
    this.map.set(entry.id, entry);
    if (UUID_RE.test(entry.id)) {
      const q = this.queue.get(entry.id);
      // 첫 dirty 전환 시의 직전(clean) 상태가 3-way 병합의 base — 이미 dirty면 base 유지
      const meta: QueueMeta = q
        ? { rev: q.rev + 1, base: q.base }
        : { rev: 1, base: prev ?? null };
      this.queue.set(entry.id, meta);
      this.persistEntry(entry, meta);
      this.onLocalWrite?.();
    }
    this.bump();
    // Entry push와 바이너리 PUT은 서로 기다리지 않지만, 둘 다 사용자의 저장 동작 뒤 시작한다.
    if (!entry.deletedAt && entry.m === this.me) {
      for (const photo of entry.photos) this.photoUploader?.queuePhoto(photo.id);
    }
  }

  /** 지금 상태 토글 — 켜면 since가 지금으로 시작한다(장소 변경도 새로 시작). */
  setMyStatus(on: boolean, place: Place | null): void {
    const nowIso = new Date().toISOString();
    const st: MemberStatus = {
      m: this.me,
      on,
      place: on ? place : null,
      since: on ? nowIso : null,
      updatedAt: nowIso, // 액션 시각 — 서버가 이 시각 기준 LWW로 판정한다
    };
    this.statuses.set(this.me, st);
    if (!this.demo) {
      // 데모는 메모리 전용 — 지속하면 나중에 실계정 로그인에 새어 들어간다
      this.statusDirty = true;
      this.txWrite(['meta'], (tx) => {
        void tx.objectStore('meta').put(st, MY_STATUS_KEY);
        void tx.objectStore('meta').put(true, STATUS_DIRTY_KEY);
      });
      this.onLocalWrite?.();
    }
    this.bump();
  }

  /** soft delete — deletedAt을 찍어 upsert하면 서버로도 삭제가 전파된다. */
  remove(id: string): void {
    const cur = this.map.get(id);
    if (!cur) return;
    if (!UUID_RE.test(id)) {
      this.removePhotosForEntry(id);
      this.map.delete(id); // 데모 시드는 그냥 지운다
      this.bump();
      return;
    }
    this.upsert({ ...cur, deletedAt: new Date().toISOString() });
  }

  /* ---------- 댓글·리액션 (UI 경로 — 네트워크를 기다리지 않는다) ---------- */

  /** 지속·동기화 대상인가 — 데모 시드 기록(s*)에 달린 것은 메모리에만 산다.
      (데모에서도 조작은 되지만 IDB에 쓰면 나중에 실계정 로그인에 새어 들어간다) */
  private syncable(...ids: string[]): boolean {
    return !this.demo && ids.every((id) => UUID_RE.test(id));
  }

  /** 내 댓글 추가 — 즉시 로컬 반영 + 큐 등록. 빈 문자열은 무시, 길이는 서버 한도로 캡.
      본문을 여기서 trim해 두는 이유: 서버도 trim해서 저장하므로, 안 하면 ACK로 돌아온
      서버 행과 로컬 행이 공백만큼 달라져 매번 "변경"으로 보인다. */
  addComment(entryId: string, body: string): void {
    const text = body.trim().slice(0, PUSH_LIMITS.commentBody).trim();
    if (!text) return;
    const now = new Date().toISOString();
    const c: Comment = {
      id: crypto.randomUUID(),
      entryId,
      m: this.me,
      body: text,
      createdAt: now, // 작성 기기 시각 — 표시·정렬 기준(서버가 범위만 검증한다)
      updatedAt: now, // 잠정치 — 서버 시계가 확정한다
      deletedAt: null,
    };
    this.comments.set(c.id, c);
    if (this.syncable(c.id, entryId)) {
      this.commentQueue.add(c.id);
      this.persistComment(c, true);
      this.onLocalWrite?.();
    }
    this.bump();
  }

  /** 내 댓글 삭제(soft) — 내 댓글이 아니면 무시한다. */
  removeComment(id: string): void {
    const cur = this.comments.get(id);
    if (!cur || cur.m !== this.me || cur.deletedAt) return;
    if (!this.syncable(id, cur.entryId)) {
      this.comments.delete(id); // 데모 시드는 그냥 지운다
      this.bump();
      return;
    }
    // tombstone은 메모리에 남는다 — 아직 서버에 못 전한 삭제를 pendingComments가 실어 보낸다
    const next: Comment = { ...cur, deletedAt: new Date().toISOString() };
    this.comments.set(id, next);
    this.commentQueue.add(id);
    this.persistComment(next, true);
    this.onLocalWrite?.();
    this.bump();
  }

  /** 내 리액션 토글 — 이모지 집합 전체를 새 액션 시각으로 갱신한다(LWW).
      집합이 비어도 행은 남긴다: 서버에 "다 뗐다"를 전해야 다른 기기에서도 사라진다. */
  toggleReaction(entryId: string, emoji: ReactionEmoji): void {
    const key = reactionKey(entryId, this.me);
    const cur = this.reactions.get(key);
    const now = new Date().toISOString();
    const row: ReactionSet = {
      entryId,
      m: this.me,
      emojis: toggledEmojis(cur?.emojis ?? [], emoji),
      actedAt: now, // 토글한 시각 — 서버가 이 시각 기준 LWW로 판정한다
      updatedAt: now,
    };
    this.reactions.set(key, row);
    if (this.syncable(entryId)) {
      this.reactionDirty.add(entryId);
      this.persistReaction(row, true);
      this.onLocalWrite?.();
    }
    this.bump();
  }

  /* ---------- 동기화 경로 (SyncClient 전용) ---------- */
  /** pull 결과 반영 — 행 저장과 커서 전진을 한 IndexedDB 트랜잭션으로 묶는다.
      (따로 쓰면 "행은 저장됐는데 커서만 전진" 같은 반쪽 상태가 생길 수 있다) */
  applyPull(p: {
    rows: Entry[];
    cursor: PullCursor | null;
    statuses?: MemberStatus[];
    /** 없으면 구버전 Worker — 그 스트림은 없는 것으로 보고 커서도 전진시키지 않는다 */
    comments?: Comment[];
    commentCursor?: PullCursor | null;
    reactions?: ReactionSet[];
    reactionCursor?: ReactionCursor | null;
    notifications?: Notification[];
    notificationCursor?: PullCursor | null;
  }): void {
    const { rows, statuses, cursor } = p;
    let changed = false;
    const puts: Entry[] = [];
    const dels: string[] = [];
    for (const raw of rows) {
      // 이행기의 구버전 Worker 응답에는 v가 없을 수 있다 — 그대로 저장하면 이 행의
      // 다음 push가 v 없는 JSON이 되어 조용히 레거시 LWW로 강등된다
      const row = normalizeEntry(raw);
      if (this.queue.has(row.id)) continue; // 아직 push 안 된 로컬 수정이 이긴다
      const cur = this.map.get(row.id);
      // 커서 안전 윈도우의 중복 전달 — 조용히 무시. updatedAt까지 봐야 비정상적으로
      // 로컬만 바뀐(v 동일) 행이 서버 내용으로 복구될 수 있다
      if (cur && cur.v === row.v && cur.updatedAt === row.updatedAt) continue;
      if (this.adoptEntry(row)) changed = true;
      if (row.deletedAt) {
        dels.push(row.id);
      } else {
        puts.push(row);
      }
    }
    let myStatus: MemberStatus | null = null;
    if (statuses) {
      for (const r of statuses) {
        if (r.m === this.me && this.statusDirty) continue; // 아직 push 안 된 내 상태가 이긴다
        const cur = this.statuses.get(r.m);
        if (cur && cur.updatedAt === r.updatedAt) continue;
        // 느린 pull 응답(오래된 스냅샷)이 그 사이 채택된 더 새 상태를 되돌리지 못하게 —
        // 서버 타임스탬프는 전부 ISO라 사전순 비교가 곧 시간 비교다
        if (cur && r.updatedAt < cur.updatedAt) continue;
        this.statuses.set(r.m, r);
        if (r.m === this.me) myStatus = r;
        changed = true;
      }
    }
    // 댓글 — 내용이 불변이라 병합이 없다. 내 큐에 있는 id는 로컬 쓰기가 이긴다.
    const cPuts: Comment[] = [];
    const cDels: string[] = [];
    for (const row of p.comments ?? []) {
      if (this.commentQueue.has(row.id)) continue;
      const cur = this.comments.get(row.id);
      if (cur && isDuplicateComment(cur, row)) continue; // 커서 안전 윈도우의 중복 전달
      // 느린 응답(오래된 스냅샷)이 그 사이 채택된 더 새 행을 되돌리지 못하게 —
      // 서버 타임스탬프는 전부 ISO라 사전순 비교가 곧 시간 비교다(Date.parse는 Safari 편차)
      if (cur && row.updatedAt < cur.updatedAt) continue;
      if (row.deletedAt) {
        if (this.comments.delete(row.id)) changed = true;
        cDels.push(row.id);
      } else {
        this.comments.set(row.id, row);
        cPuts.push(row);
        changed = true;
      }
    }

    // 리액션 — 기록×멤버당 1행. 아직 push 안 된 내 토글은 서버 행보다 우선한다.
    const rPuts: ReactionSet[] = [];
    for (const row of p.reactions ?? []) {
      if (row.m === this.me && this.reactionDirty.has(row.entryId)) continue;
      const key = reactionKey(row.entryId, row.m);
      const cur = this.reactions.get(key);
      if (cur && isDuplicateReaction(cur, row)) continue; // 커서 안전 윈도우의 중복 전달
      // 느린 응답이 그 사이 채택된 더 새 행을 되돌리지 못하게 (ISO 사전순 = 시간순)
      if (cur && row.updatedAt < cur.updatedAt) continue;
      this.reactions.set(key, row);
      rPuts.push(row);
      changed = true;
    }

    // 알림 — 서버만 만드는 스트림. 같은 세대의 안 읽음 행에는 아직 못 보낸 로컬 "읽음"이 이긴다.
    const nowIso = new Date().toISOString();
    const nPuts: Notification[] = [];
    for (const row of p.notifications ?? []) {
      if (row.m !== this.me) continue; // 방어 — 서버가 내 것만 주지만 멤버 전환 잔재를 막는다
      const act = notifPullAction(
        this.notifications.get(row.id),
        row,
        this.notifReadQueue.get(row.id) ?? null,
        nowIso,
      );
      if (act === 'skip') continue;
      this.notifications.set(act.id, act);
      nPuts.push(act);
      changed = true;
    }

    // 실질 변경도 커서 전진도 없는 폴링에서는 IDB에 손대지 않고,
    // 커서만 전진했으면 쓰되 다른 탭은 깨우지 않는다
    const cursorChanged =
      !!cursor && (this.lastCursor?.ts !== cursor.ts || this.lastCursor?.id !== cursor.id);
    const cc = p.commentCursor;
    const commentCursorChanged =
      !!cc && (this.lastCommentCursor?.ts !== cc.ts || this.lastCommentCursor?.id !== cc.id);
    const rc = p.reactionCursor;
    const reactionCursorChanged =
      !!rc &&
      (this.lastReactionCursor?.ts !== rc.ts ||
        this.lastReactionCursor?.entryId !== rc.entryId ||
        this.lastReactionCursor?.m !== rc.m);
    const nc = p.notificationCursor;
    const notifCursorChanged =
      !!nc && (this.lastNotifCursor?.ts !== nc.ts || this.lastNotifCursor?.id !== nc.id);
    const notify =
      puts.length > 0 ||
      dels.length > 0 ||
      myStatus !== null ||
      cPuts.length > 0 ||
      cDels.length > 0 ||
      rPuts.length > 0 ||
      nPuts.length > 0;
    if (
      !notify &&
      !cursorChanged &&
      !commentCursorChanged &&
      !reactionCursorChanged &&
      !notifCursorChanged
    ) {
      if (changed) this.bump();
      return;
    }
    if (cursorChanged) this.lastCursor = cursor;
    if (commentCursorChanged) this.lastCommentCursor = cc;
    if (reactionCursorChanged) this.lastReactionCursor = rc;
    if (notifCursorChanged) this.lastNotifCursor = nc;
    // 손댈 스토어만 트랜잭션에 넣는다 — 안 쓰는 스토어까지 잠그면 다른 탭의 쓰기를 괜히 막는다.
    // 큐 스토어까지 넣는 이유: 다른 탭의 미전송 쓰기를 같은 트랜잭션 안에서 읽어 피해 가야 한다
    const stores: StoreName[] = ['meta'];
    if (puts.length > 0 || dels.length > 0) stores.push('entries');
    if (cPuts.length > 0 || cDels.length > 0) stores.push('comments', 'commentQueue');
    if (rPuts.length > 0) stores.push('reactions', 'reactionQueue');
    if (nPuts.length > 0) stores.push('notifications', 'notifReadQueue');
    this.txWrite(
      stores,
      async (tx) => {
        // (기록 스트림에도 같은 구멍이 있지만 의미론 변경이라 이번 범위가 아니다 —
        //  아래 큐 확인은 댓글·리액션에만 적용한다)
        if (puts.length > 0 || dels.length > 0) {
          const store = tx.objectStore('entries');
          for (const e of puts) void store.put(e);
          for (const id of dels) void store.delete(id);
        }
        if (cPuts.length > 0 || cDels.length > 0) {
          // 큐에 키가 있는 행 = 어느 탭인가 아직 못 보낸 로컬 쓰기. 지평선(90초) 안쪽 행은
          // 이미 지나간 뒤에도 살아 있는 채로 다시 실려 오므로, 덮으면 그 탭의 tombstone이
          // 사라지고 삭제가 조용히 유실된다. 같은 트랜잭션 안에서 읽어야 판정이 안 어긋난다.
          const queued = new Set((await tx.objectStore('commentQueue').getAllKeys()).map(String));
          const store = tx.objectStore('comments');
          let skipped = false;
          for (const c of cPuts) {
            if (queued.has(c.id)) skipped = true;
            else void store.put(c);
          }
          for (const id of cDels) {
            if (queued.has(id)) skipped = true;
            else void store.delete(id);
          }
          // 건너뛴 행이 있다 = 다른 탭이 닫혔거나 뒤처져 그 쓰기가 IDB에만 남아 있다.
          // 메모리를 IDB에 맞춰 그 큐 키를 채택해야 이 탭이 대신 push해 준다
          if (skipped) this.scheduleRefresh();
        }
        if (rPuts.length > 0) {
          // dirty 키는 entryId — 내 행만 dirty가 되므로 남의 행은 그대로 반영한다
          const dirty = new Set((await tx.objectStore('reactionQueue').getAllKeys()).map(String));
          const store = tx.objectStore('reactions');
          let skipped = false;
          for (const r of rPuts) {
            if (r.m === this.me && dirty.has(r.entryId)) {
              skipped = true;
              continue;
            }
            void store.put(r, reactionKey(r.entryId, r.m));
          }
          if (skipped) this.scheduleRefresh();
        }
        if (nPuts.length > 0) {
          // 다른 탭이 남긴 미전송 읽음(IDB 큐)이 이 세대의 행을 읽은 것이면 읽음을 보존한 채
          // 서버의 새 내용을 쓴다 — put을 통째로 건너뛰면 커서만 전진해 IDB 행이 낡은 채
          // 남는다. 행이 큐의 세대보다 새로우면(집계에 새 응원) 서버의 안 읽음이 이긴다.
          const qStore = tx.objectStore('notifReadQueue');
          const store = tx.objectStore('notifications');
          for (const n of nPuts) {
            let next = n;
            if (n.readAt === null && !this.notifReadQueue.has(n.id)) {
              const at = await qStore.get(notifReadKey(this.me, n.id));
              if (typeof at === 'string' && n.updatedAt <= at) {
                const stored = await store.get(n.id);
                next = { ...n, readAt: stored?.readAt ?? nowIso };
              }
            }
            void store.put(next);
          }
        }
        const meta = tx.objectStore('meta');
        if (myStatus) void meta.put(myStatus, MY_STATUS_KEY);
        if (cursor) void meta.put(cursor, ENTRY_CURSOR_KEY);
        // 커서는 응답 객체를 글자 그대로 저장한다 — 행의 updatedAt으로 재구성하면
        // Postgres 마이크로초가 밀리초로 잘려 같은 행을 영원히 다시 싣는다
        if (cc) void meta.put(cc, COMMENT_CURSOR_KEY);
        if (rc) void meta.put(rc, REACTION_CURSOR_KEY);
        if (nc) void meta.put(nc, notifCursorKey(this.me));
      },
      notify,
    );
    if (changed) this.bump();
  }

  /* ---------- 댓글·리액션 push 경로 ---------- */

  /** 큐에 있는 내 댓글 행. 행이 없는 고아 키(반쪽 상태의 잔재)는 여기서 정리한다 —
      두면 pending이 영원히 0이 되지 않아 재동기화가 쉬지 않고 돈다. */
  pendingComments(): Comment[] {
    const out: Comment[] = [];
    for (const id of [...this.commentQueue]) {
      const c = this.comments.get(id);
      if (!c) {
        this.dropCommentFromQueue(id);
        continue;
      }
      out.push(c);
    }
    return out;
  }

  /** 댓글 push 정산 — 정산 여부는 **IDB에 저장된 행**으로 판정한다(큐 키도 IDB가 공유하므로,
      메모리만 보고 지우면 A가 보내는 사이 B가 남긴 tombstone을 ACK가 덮어 삭제가 유실된다).
      불일치면 큐 키를 남기고 메모리를 IDB에 맞춘다 — 다음 라운드가 그 쓰기를 대신 보낸다.
      applied 여부와 무관하게 서버 행을 채택한다: 댓글은 이길 수 없는 스트림이다.
      단 저장된 행이 사라졌으면 채택하지 않는다(`commentAckOutcome`의 'gone') — 지연된 ACK가
      지워진 댓글을 되살리는 경로다. */
  ackComment(sent: Comment, server: Comment): void {
    const settleMemory = (): void => {
      this.commentQueue.delete(sent.id);
      if (server.deletedAt) this.comments.delete(sent.id);
      else this.comments.set(sent.id, server);
      this.bump();
    };
    const started = this.txWrite(['comments', 'commentQueue'], async (tx) => {
      const stored = await tx.objectStore('comments').get(sent.id);
      const outcome = commentAckOutcome(sent, stored);
      if (outcome === 'hold') {
        this.scheduleRefresh();
        return;
      }
      if (outcome === 'gone') {
        // 저장된 행이 없다 = 다른 탭이 이미 tombstone까지 정산했다. 큐 키는 지우되(재전송할
        // 필요가 없다) 서버가 준 살아 있는 행은 IDB에도 메모리에도 넣지 않는다 — 부활 금지.
        void tx.objectStore('commentQueue').delete(sent.id);
        this.commentQueue.delete(sent.id);
        this.comments.delete(sent.id);
        this.bump();
        return;
      }
      if (server.deletedAt) void tx.objectStore('comments').delete(sent.id);
      else void tx.objectStore('comments').put(server);
      void tx.objectStore('commentQueue').delete(sent.id);
      settleMemory();
    });
    // IDB가 없거나 닫힌 탭(메모리 전용) — 공유 진실이 없으니 메모리 기준으로 정산한다.
    // (여기서 정산하지 않으면 큐가 영원히 안 비어 push가 400ms마다 헛돈다)
    if (!started && commentAckSettles(sent, this.comments.get(sent.id))) settleMemory();
  }

  /** dirty 표시된 내 리액션 행. 행이 없는 고아 dirty 키는 정리한다. */
  pendingReactions(): ReactionSet[] {
    const out: ReactionSet[] = [];
    for (const entryId of [...this.reactionDirty]) {
      const row = this.reactions.get(reactionKey(entryId, this.me));
      if (!row) {
        this.dropReactionFromQueue(entryId);
        continue;
      }
      out.push(row);
    }
    return out;
  }

  /** 리액션 push 정산 — 전송 중 또 토글했으면(actedAt이 다름) dirty를 유지해 재전송한다.
      판정 기준은 ackComment와 같은 이유로 **IDB에 저장된 행**이다: 다른 탭이 전송 중에
      다시 토글했으면 그 토글이 아직 IDB에만 있고, 메모리만 보면 그것을 덮어 버린다. */
  ackReaction(sent: ReactionSet, server: ReactionSet): void {
    const key = reactionKey(sent.entryId, sent.m);
    const settleMemory = (): void => {
      this.reactionDirty.delete(sent.entryId);
      this.reactions.set(key, server);
      this.bump();
    };
    const started = this.txWrite(['reactions', 'reactionQueue'], async (tx) => {
      const stored = await tx.objectStore('reactions').get(key);
      if (!reactionAckSettles(sent, stored)) {
        this.scheduleRefresh();
        return;
      }
      void tx.objectStore('reactions').put(server, key);
      void tx.objectStore('reactionQueue').delete(sent.entryId);
      settleMemory();
    });
    if (!started && reactionAckSettles(sent, this.reactions.get(key))) settleMemory();
  }

  /** 큐에 있지만 보낼 수 없는 댓글(내 것이 아닌 행 등)을 버려 push가 막히지 않게 한다. */
  dropCommentFromQueue(id: string): void {
    this.commentQueue.delete(id);
    this.txWrite(['commentQueue'], (tx) => {
      void tx.objectStore('commentQueue').delete(id);
    });
    this.bump();
  }

  dropReactionFromQueue(entryId: string): void {
    this.reactionDirty.delete(entryId);
    this.txWrite(['reactionQueue'], (tx) => {
      void tx.objectStore('reactionQueue').delete(entryId);
    });
    this.bump();
  }

  /* ---------- 알림 (읽음 처리가 유일한 로컬 쓰기다) ---------- */

  /** 알림 읽음 — 즉시 로컬 반영 + 큐 등록. 읽음은 단조라 취소·충돌이 없다. */
  markNotificationRead(id: string): void {
    if (this.markReadInternal(id)) this.bump();
  }

  /** 모두 읽음 — 지금 보이는 안 읽음 전부. 서버에 별도 상태가 없어 id 열거로 보낸다
      (그 사이 도착한 새 알림을 실수로 읽음 처리하지 않는다). */
  markAllNotificationsRead(): void {
    let changed = false;
    for (const n of this.notifications.values()) {
      if (n.readAt === null) changed = this.markReadInternal(n.id) || changed;
    }
    if (changed) this.bump();
  }

  private markReadInternal(id: string): boolean {
    const cur = this.notifications.get(id);
    if (!cur || cur.readAt !== null) return false;
    const next = { ...cur, readAt: new Date().toISOString() };
    this.notifications.set(id, next);
    if (this.syncable(id)) {
      // 큐 값 = 지금 관측한 세대(updatedAt) — 서버는 행이 그 뒤로 갱신됐으면 도장을 거른다
      this.notifReadQueue.set(id, cur.updatedAt);
      this.txWrite(['notifications', 'notifReadQueue'], (tx) => {
        void tx.objectStore('notifications').put(next);
        void tx.objectStore('notifReadQueue').put(cur.updatedAt, notifReadKey(this.me, id));
      });
      this.onLocalWrite?.();
    }
    return true;
  }

  /** 서버로 보낼 읽음 처리들. 행이 사라졌어도(보관 만료) 보낸다 — 서버 정산이 멱등이다. */
  pendingNotificationReads(): NotificationRead[] {
    return [...this.notifReadQueue].map(([id, at]) => ({ id, at }));
  }

  /** 읽음 push 정산 — 보낸 세대(at)가 지금 큐의 세대와 같을 때만 지운다.
      전송 중에 그 행이 새 세대로 바뀌어 다시 읽혔다면(큐 값이 더 새 updatedAt) 그 읽음은
      아직 서버에 못 간 것이다 — 옛 ACK가 그것까지 지우면 유실된다. IDB 쪽도 같은 판정을
      같은 트랜잭션 안에서 한다(다른 탭이 남긴 더 새 읽음 보호). */
  ackNotificationReads(reads: NotificationRead[]): void {
    if (reads.length === 0) return;
    for (const r of reads) {
      if (this.notifReadQueue.get(r.id) === r.at) this.notifReadQueue.delete(r.id);
    }
    this.txWrite(['notifReadQueue'], async (tx) => {
      const store = tx.objectStore('notifReadQueue');
      for (const r of reads) {
        const key = notifReadKey(this.me, r.id);
        const at = await store.get(key);
        if (at === r.at) void store.delete(key);
      }
    });
    this.bump();
  }

  /** push 반영 성공. rev가 다르면 전송 중 또 수정된 것 — 큐에 남기되 서버 행을 새 base로 삼는다. */
  ackApplied(id: string, rev: number, serverRaw: Entry): void {
    // 이행기의 구버전 Worker 응답에는 v도 tags도 없다 — 그대로 채택하면 이 행이
    // 다음 push부터 빈 tags를 진짜 값으로 들고 다닌다
    const server = normalizeEntry(serverRaw);
    const q = this.queue.get(id);
    if (!q) return;
    if (q.rev !== rev) {
      // 방금 서버에 반영된 내용이 이 행의 새 base — 다음 push가 그 위에 CAS한다
      const cur = this.map.get(id);
      const meta: QueueMeta = { rev: q.rev, base: server };
      this.queue.set(id, meta);
      if (cur) {
        const next = { ...cur, v: server.v };
        this.adoptEntry(next, true);
        this.persistEntry(next, meta);
      } else {
        // 행이 없어도 큐 meta는 영속화 — 메모리와 IDB의 base가 어긋나면 안 된다
        this.txWrite(['queue'], (tx) => {
          void tx.objectStore('queue').put(meta, id);
        });
      }
      this.bump();
      return;
    }
    this.settle(id, server);
  }

  /** push CAS 충돌 — 서버 현재 행과 병합한다.
      규칙: ① 어느 쪽이든 삭제면 삭제 승리(부활 방지) ② 남의 행이면 서버 채택
            ③ 그 외 base 기준 필드 단위 병합 → 서버와 같아지면 종료, 다르면 재전송 대기. */
  resolveConflict(id: string, serverRaw: Entry): void {
    const server = normalizeEntry(serverRaw); // ackApplied와 같은 이유(구버전 Worker 응답)
    const q = this.queue.get(id);
    const local = this.map.get(id);
    if (!q || !local) {
      this.settle(id, server); // 큐/행이 없는 비정상 상태 — 서버를 그대로 채택
      return;
    }
    // ① 서버가 삭제 — 로컬 수정을 버리고 삭제를 따른다 (삭제된 기록 부활 방지)
    // ② 내 행이 아니면 이길 수 없다 — 서버를 채택하고 큐에서 뺀다
    if (server.deletedAt || server.m !== this.me) {
      this.settle(id, server);
      return;
    }
    // ① 로컬이 삭제 — 서버 리비전 위에 tombstone을 다시 얹어 재전송한다 (삭제 승리)
    if (local.deletedAt) {
      this.requeue(id, { ...local, v: server.v }, server);
      return;
    }
    // ③ 필드 단위 3-way 병합 — 결과가 서버와 같으면(내 쓰기의 에코 포함) 재전송 불필요
    const merged = mergeEntry(q.base, local, server);
    if (contentEqual(merged, server)) {
      this.settle(id, server);
      return;
    }
    this.requeue(id, { ...merged, updatedAt: local.updatedAt }, server);
  }

  /** 큐 정산 — 서버 행을 확정으로 채택하고 큐에서 뺀다 (tombstone이면 완전히 제거). */
  private settle(id: string, server: Entry): void {
    this.queue.delete(id);
    const tombstone = !!server.deletedAt;
    this.adoptEntry(server);
    this.txWrite(['entries', 'queue'], (tx) => {
      if (tombstone) void tx.objectStore('entries').delete(id);
      else void tx.objectStore('entries').put(server);
      void tx.objectStore('queue').delete(id);
    });
    this.bump();
  }

  /** 재전송 대기 — 서버 행을 새 base로 삼아 rev를 올리고 다시 큐에 넣는다. */
  private requeue(id: string, next: Entry, base: Entry): void {
    const meta: QueueMeta = { rev: (this.queue.get(id)?.rev ?? 0) + 1, base };
    this.adoptEntry(next, true);
    this.queue.set(id, meta);
    this.persistEntry(next, meta);
    this.bump();
  }

  /** 큐에 있지만 내 것이 아닌 행(비정상 상태)을 버려 push가 막히지 않게 한다. */
  dropFromQueue(id: string): void {
    this.queue.delete(id);
    this.txWrite(['queue'], (tx) => {
      void tx.objectStore('queue').delete(id);
    });
    // bump해야 pending 표시가 갱신되고, 진행 중인 refreshFromDB의 rev 가드도 이 변이를 본다
    this.bump();
  }

  /** 서버에 아직 안 보낸 내 상태. 없으면 null. */
  myStatusPending(): MemberStatus | null {
    return this.statusDirty ? (this.statuses.get(this.me) ?? null) : null;
  }

  /** 상태 push 완료(반영 또는 다른 기기 승리) — 전송 중 또 토글했으면 dirty를 유지해 재전송. */
  ackStatus(sentUpdatedAt: string, server: MemberStatus): void {
    if (this.statuses.get(this.me)?.updatedAt !== sentUpdatedAt) return;
    this.statusDirty = false;
    this.statuses.set(server.m, server);
    this.txWrite(['meta'], (tx) => {
      void tx.objectStore('meta').delete(STATUS_DIRTY_KEY);
      void tx.objectStore('meta').put(server, MY_STATUS_KEY);
    });
    this.bump();
  }

  /** SyncClient가 사이클 결과를 알려 준다 — 값이 바뀔 때만 스냅샷을 갱신한다. */
  setSyncPhase(phase: SyncPhase): void {
    if (this.syncPhase === phase) return;
    this.syncPhase = phase;
    this.bump();
  }

  /** 세 스트림의 pull 커서 — 서로 독립이며 하나만 있어도 동작한다.
      한 읽기 트랜잭션으로 묶어 다른 탭의 커밋이 사이에 끼어 섞인 조합을 읽지 않게 한다. */
  async getCursors(): Promise<{
    entries: PullCursor | null;
    comments: PullCursor | null;
    reactions: ReactionCursor | null;
    notifications: PullCursor | null;
  }> {
    const none = { entries: null, comments: null, reactions: null, notifications: null };
    const db = this.db;
    if (!db) return none;
    try {
      const tx = db.transaction('meta');
      const [e, c, r, n] = await Promise.all([
        tx.objectStore('meta').get(ENTRY_CURSOR_KEY),
        tx.objectStore('meta').get(COMMENT_CURSOR_KEY),
        tx.objectStore('meta').get(REACTION_CURSOR_KEY),
        tx.objectStore('meta').get(notifCursorKey(this.me)),
      ]);
      await tx.done;
      return {
        entries: asPullCursor(e),
        comments: asPullCursor(c),
        reactions: asReactionCursor(r),
        notifications: asPullCursor(n),
      };
    } catch {
      return none; // 닫힌 DB(다른 탭 업그레이드에 양보) — 처음부터 pull해도 안전하다
    }
  }

  /* ---------- IndexedDB 쓰기 (원자 단위) ---------- */
  /** 기록 + 큐 메타를 한 트랜잭션으로 — "기록은 있는데 큐가 없음" 반쪽 상태를 막는다. */
  private persistEntry(entry: Entry, meta: QueueMeta): void {
    this.txWrite(['entries', 'queue'], (tx) => {
      void tx.objectStore('entries').put(entry);
      void tx.objectStore('queue').put(meta, entry.id);
    });
  }

  /** 댓글 행 + 큐 표시를 한 트랜잭션으로 — "댓글은 있는데 안 보내짐"을 막는다. */
  private persistComment(c: Comment, queued: boolean): void {
    this.txWrite(['comments', 'commentQueue'], (tx) => {
      void tx.objectStore('comments').put(c);
      if (queued) void tx.objectStore('commentQueue').put(true, c.id);
    });
  }

  /** 리액션 행 + dirty 표시를 한 트랜잭션으로. */
  private persistReaction(r: ReactionSet, dirty: boolean): void {
    this.txWrite(['reactions', 'reactionQueue'], (tx) => {
      void tx.objectStore('reactions').put(r, reactionKey(r.entryId, r.m));
      if (dirty) void tx.objectStore('reactionQueue').put(true, r.entryId);
    });
  }

  /** fire-and-forget IDB 트랜잭션 — UI는 기다리지 않고, 실패해도 트랜잭션이라 반쪽 상태는 없다.
      커밋되면 다른 탭에 알린다(BroadcastChannel) — 그쪽 메모리도 IDB를 다시 읽는다.
      notify=false는 커서 전진 같은 탭-로컬 메타 쓰기용: 다른 탭을 깨울 필요가 없다.
      fill은 async여도 된다(같은 트랜잭션 안에서 읽고 그 결과로 쓸 때) — 단 **IDB 요청 말고는
      절대 await하지 말 것**: 다른 것을 기다리면 그 사이 트랜잭션이 커밋되어 버린다.
      반환값은 "트랜잭션을 열었는가" — 열지 못한(메모리 전용) 탭은 호출부가 메모리로 정산한다. */
  private txWrite(
    stores: StoreName[],
    fill: (tx: CrewTx) => void | Promise<void>,
    notify = true,
  ): boolean {
    const db = this.db;
    if (!db) return false;
    try {
      const tx = db.transaction(stores, 'readwrite');
      void Promise.resolve(fill(tx)).catch(() => {});
      tx.done.then(
        () => {
          if (notify) this.bc?.postMessage('changed');
        },
        () => {},
      );
      return true;
    } catch {
      // 닫힌 DB 등 — 메모리 상태는 유효하므로 무시
      return false;
    }
  }

  /** IDB를 다시 읽도록 짧게 모아서 예약한다 — 다른 탭의 알림과, 이 탭의 판정이 IDB와
      어긋났을 때(ACK 불일치) 메모리를 공유 진실에 맞추는 두 경로가 함께 쓴다. */
  private scheduleRefresh(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => void this.refreshFromDB(), 200);
  }

  /** IndexedDB를 다시 읽어 다른 탭의 변경을 메모리에 반영한다.
      원칙: 내 큐(dirty)가 이긴다 — 단, 다른 탭의 더 새 로컬 쓰기(rev가 높은 큐)는 채택한다. */
  async refreshFromDB(): Promise<void> {
    const db = this.db;
    if (!db || this.demo || this.refreshing) return;
    this.refreshing = true;
    // 읽는 사이 이 탭 자신의 쓰기(pull 반영, 사용자 입력)가 끼어들면 스냅샷이 낡는다 —
    // 그대로 병합하면 방금 반영된 행을 지우거나 되돌리므로, 감지 시 버리고 다시 예약한다.
    const rev0 = this.snapshot.rev;
    try {
      const tx = db.transaction([
        'entries',
        'queue',
        'comments',
        'commentQueue',
        'reactions',
        'reactionQueue',
        'notifications',
        'notifReadQueue',
        'photoBlobs',
        'meta',
      ]);
      const [
        rows,
        qkeys,
        qvals,
        dbComments,
        dbCQueue,
        dbReactions,
        dbRQueue,
        dbNotifs,
        dbNQKeys,
        dbNQVals,
        dbPhotoKeys,
        dbPhotoRows,
        dbSt,
        dbDirty,
      ] = await Promise.all([
        tx.objectStore('entries').getAll(),
        tx.objectStore('queue').getAllKeys(),
        tx.objectStore('queue').getAll(),
        tx.objectStore('comments').getAll(),
        tx.objectStore('commentQueue').getAllKeys(),
        tx.objectStore('reactions').getAll(),
        tx.objectStore('reactionQueue').getAllKeys(),
        tx.objectStore('notifications').getAll(),
        tx.objectStore('notifReadQueue').getAllKeys(),
        tx.objectStore('notifReadQueue').getAll(),
        tx.objectStore('photoBlobs').getAllKeys(),
        tx.objectStore('photoBlobs').getAll(),
        tx.objectStore('meta').get(MY_STATUS_KEY),
        tx.objectStore('meta').get(STATUS_DIRTY_KEY),
      ]);
      await tx.done;
      if (this.snapshot.rev !== rev0) {
        if (this.refreshTimer) clearTimeout(this.refreshTimer);
        this.refreshTimer = setTimeout(() => void this.refreshFromDB(), 150);
        return;
      }
      let changed = false;

      // 사진 행을 Entry보다 먼저 채택한다. 같은 IDB 스냅샷에 이전 photoBlobs 행이
      // 남아 있어도, 아래 Entry 참조 정리가 나중에 실행돼 삭제된 사진을 다시 살리지 않는다.
      const adoptedPhotos: string[] = [];
      dbPhotoKeys.forEach((key, i) => {
        const id = String(key);
        const row = dbPhotoRows[i];
        if (!row) return;
        const cur = this.photoBlobs.get(id);
        if (
          !cur ||
          cur.state !== row.state ||
          cur.pct !== row.pct ||
          cur.entryId !== row.entryId ||
          cur.addedAt !== row.addedAt
        ) {
          this.photoBlobs.set(id, row);
          if (!cur) adoptedPhotos.push(id);
          changed = true;
        }
      });

      // 큐 병합 — 다른 탭의 로컬 쓰기(내게 없거나 rev가 높음)를 채택.
      // 내 메모리에만 있는 큐 항목은 유지한다: 아직 지속 전이거나, 다른 탭이 ack한
      // 것이라면 다음 push의 CAS 에코가 정리해 준다.
      const dbQueue = new Map<string, QueueMeta>();
      qkeys.forEach((k, i) => dbQueue.set(String(k), qvals[i]!));
      const adopted = new Set<string>();
      for (const [id, meta] of dbQueue) {
        const mine = this.queue.get(id);
        if (!mine || meta.rev > mine.rev) {
          this.queue.set(id, meta);
          adopted.add(id);
          changed = true;
        }
      }

      // 행 병합 — 큐에 없는(clean) 행과 방금 채택한 dirty 행은 IDB 내용을 따른다.
      // 변경 감지는 (v, updatedAt, 삭제 상태)로 충분하다: 서버 변경은 v를, 로컬 수정은
      // updatedAt을 반드시 바꾼다 — 본문 전체를 직렬화해 비교할 필요가 없다.
      const dbIds = new Set<string>();
      for (const e of rows) {
        dbIds.add(e.id);
        if (this.queue.has(e.id) && !adopted.has(e.id)) continue;
        const norm = normalizeEntry(e);
        const cur = this.map.get(e.id);
        if (!cur || cur.v !== norm.v || cur.updatedAt !== norm.updatedAt || !sameLiveness(cur, norm)) {
          this.adoptEntry(norm, true);
          changed = true;
        }
      }
      // IDB에서 사라진 행(다른 탭이 tombstone을 ack) — 내 큐에 없으면 메모리에서도 제거
      for (const id of [...this.map.keys()]) {
        if (!dbIds.has(id) && !this.queue.has(id) && UUID_RE.test(id)) {
          changed = this.adoptMissingEntry(id) || changed;
        }
      }

      // 내 지금 상태 — 더 새 액션 시각이면 채택, 같은 액션을 다른 탭이 push했으면 dirty 해제.
      // 타임스탬프는 전부 ISO(로컬 생성 + 서버 정규화)라 사전순 비교가 곧 시간 비교다 —
      // Date.parse는 브라우저별 파싱 차이(특히 Safari)가 있어 쓰지 않는다
      const dbMine = asMemberStatus(dbSt);
      if (dbMine && dbMine.m === this.me) {
        const mem = this.statuses.get(this.me);
        if (!mem || dbMine.updatedAt > mem.updatedAt) {
          this.statuses.set(this.me, dbMine);
          this.statusDirty = !!dbDirty;
          changed = true;
        } else if (dbMine.updatedAt === mem.updatedAt && this.statusDirty && !dbDirty) {
          this.statusDirty = false;
          changed = true;
        }
      }

      // 댓글 — 다른 탭의 미전송 댓글(IDB 큐 키)을 먼저 채택해야 그 행을 IDB 기준으로 읽는다.
      // 중복 push는 서버 업서트가 멱등이라 안전하다(오히려 안 채택하면 그 tombstone을
      // clean으로 오해해 늦게 도착한 pull 응답이 되살릴 수 있다).
      const adoptedC = new Set<string>();
      for (const k of dbCQueue) {
        const id = String(k);
        if (this.commentQueue.has(id)) continue;
        this.commentQueue.add(id);
        adoptedC.add(id);
        changed = true;
      }
      const dbCommentIds = new Set<string>();
      for (const c of dbComments) {
        dbCommentIds.add(c.id);
        // 내 미전송 쓰기가 이기지만, IDB가 tombstone이면 삭제가 이긴다(부활 없음) —
        // 두 탭이 이미 같은 큐 키를 갖고 있으면 위의 "새로 채택"이 일어나지 않아,
        // 그냥 건너뛰면 다른 탭이 지운 댓글을 살아 있는 채로 계속 push해 삭제가 유실된다
        if (!adoptCommentFromDB(c, { queued: this.commentQueue.has(c.id), adopted: adoptedC.has(c.id) }))
          continue;
        const cur = this.comments.get(c.id);
        if (!cur || cur.updatedAt !== c.updatedAt || (cur.deletedAt === null) !== (c.deletedAt === null)) {
          this.comments.set(c.id, c);
          changed = true;
        }
      }
      // IDB에서 사라진 댓글(다른 탭이 tombstone을 ack) — 내 큐에도 없으면 메모리에서도 제거
      for (const [id, c] of [...this.comments]) {
        if (!dbCommentIds.has(id) && !this.commentQueue.has(id) && this.syncable(id, c.entryId)) {
          this.comments.delete(id);
          changed = true;
        }
      }

      // 리액션 — 내 행은 액션 시각(actedAt)으로, 남의 행은 서버 시계(updatedAt)로 판정한다
      const dbRDirty = new Set([...dbRQueue].map(String));
      let tookDirty = false; // 다른 탭이 남긴 미전송 토글을 이 탭이 떠맡았는가
      for (const row of dbReactions) {
        const key = reactionKey(row.entryId, row.m);
        const cur = this.reactions.get(key);
        if (row.m === this.me) {
          const memDirty = this.reactionDirty.has(row.entryId);
          const d = mergeMyReactionFromDB({
            rowActedAt: row.actedAt,
            curActedAt: cur?.actedAt,
            dbDirty: dbRDirty.has(row.entryId),
            memDirty,
          });
          if (d.takeRow) {
            this.reactions.set(key, row);
            changed = true;
          }
          if (d.dirty !== memDirty) {
            // dirty를 새로 떠맡으면 이 탭이 그 행을 push해야 한다 —
            // 안 그러면 IDB에 고아 키로 남아 다음 앱 시작 때까지 정산되지 않는다
            if (d.dirty) {
              this.reactionDirty.add(row.entryId);
              tookDirty = true;
            } else {
              // 같은 토글을 다른 탭이 이미 push했다 — dirty만 내린다
              this.reactionDirty.delete(row.entryId);
            }
            changed = true;
          }
        } else if (!cur || row.updatedAt > cur.updatedAt) {
          this.reactions.set(key, row);
          changed = true;
        }
      }

      // 알림 — 다른 탭의 미전송 읽음(내 접두사 키)을 먼저 채택한다. 값은 세대(updatedAt)라
      // 더 새 세대의 읽음이 이긴다. 중복 push는 서버 정산이 멱등이라 안전하다.
      const myPrefix = `${this.me}|`;
      const refreshNowIso = new Date().toISOString();
      dbNQKeys.forEach((k, i) => {
        const key = String(k);
        if (!key.startsWith(myPrefix)) return;
        const id = key.slice(myPrefix.length);
        const at = String(dbNQVals[i]);
        const mem = this.notifReadQueue.get(id);
        if (mem === undefined || mem < at) {
          this.notifReadQueue.set(id, at);
          tookDirty = true;
          changed = true;
        }
      });
      for (const n of dbNotifs) {
        if (n.m !== this.me) continue;
        // pull 반영과 같은 판정 하나로 — 같은 세대의 안 읽음엔 내 미전송 읽음이 이기고,
        // 더 새 세대(집계 갱신)는 IDB 행이 이긴다
        const act = notifPullAction(
          this.notifications.get(n.id),
          n,
          this.notifReadQueue.get(n.id) ?? null,
          refreshNowIso,
        );
        if (act !== 'skip') {
          this.notifications.set(act.id, act);
          changed = true;
        }
      }

      if (changed) this.bump();
      if (tookDirty) this.onLocalWrite?.();
      for (const id of adoptedPhotos) {
        const row = this.photoBlobs.get(id);
        if (
          row &&
          this.photoIsAttached(id, row) &&
          (row.state === 'wait' || row.state === 'up')
        ) {
          this.photoUploader?.queuePhoto(id);
        }
      }
    } catch {
      // 읽기 실패 — 다음 신호/가시화 때 다시 시도된다
    } finally {
      this.refreshing = false;
    }
  }

  /* ---------- 구 프로토타입(localStorage) 데이터 1회 이관 ---------- */
  private async migrateLegacy(me: MemberId): Promise<void> {
    if (!this.db) return;
    if (await this.db.get('meta', MIGRATED_FLAG)) return;
    try {
      const raw = localStorage.getItem(LEGACY_KEY);
      if (raw) {
        const list: unknown = JSON.parse(raw);
        if (Array.isArray(list)) {
          for (const item of list) {
            const e = item as Record<string, unknown>;
            // 사용자가 만든 행(e*)이고 이 기기의 멤버 본인 것만 — 남의 행은 push가 거부된다
            if (typeof e.id !== 'string' || e.id.charAt(0) !== 'e' || e.m !== me) continue;
            // 구 프로토타입은 단일 태그만 남겼다 — entryTags가 그것을 1개짜리 tags로 되살린다
            const tags = entryTags(e);
            this.upsert({
              id: crypto.randomUUID(),
              m: me,
              day: String(e.day ?? ''),
              time: String(e.time ?? ''),
              tag: primaryTag(tags),
              tags,
              stars: typeof e.stars === 'number' ? e.stars : null,
              memo: String(e.memo ?? ''),
              body: String(e.body ?? ''),
              todos: Array.isArray(e.todos)
                ? (e.todos as { t?: unknown; done?: unknown }[]).map((t) => ({
                    t: String(t.t ?? ''),
                    done: !!t.done,
                  }))
                : [],
              photos: [],
              v: 0,
              updatedAt: new Date().toISOString(),
              deletedAt: null,
            });
          }
        }
      }
    } catch {
      // 손상된 legacy 데이터는 무시
    }
    await this.db.put('meta', true, MIGRATED_FLAG);
  }

  private bump(): void {
    const notifications = sortNotifications(this.notifications.values(), Date.now());
    this.snapshot = {
      rev: this.snapshot.rev + 1,
      entries: [...this.map.values()].filter((e) => !e.deletedAt),
      statuses: Object.fromEntries(this.statuses) as Partial<Record<MemberId, MemberStatus>>,
      comments: groupComments(this.comments.values()),
      reactions: groupReactions(this.reactions.values()),
      notifications,
      unreadNotifications: notifications.filter((n) => n.readAt === null).length,
      photoUploads: new Map(
        [...this.photoBlobs]
          .filter(([, row]) => this.photoStatusBelongsToMe(row))
          .map(([id, row]) => [id, { state: row.state, pct: row.pct }]),
      ),
      sync: {
        phase: this.syncPhase,
        pending:
          this.queue.size +
          (this.statusDirty ? 1 : 0) +
          this.commentQueue.size +
          this.reactionDirty.size +
          this.notifReadQueue.size,
      },
    };
    for (const fn of this.listeners) fn();
  }
}
