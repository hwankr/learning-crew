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
  MemberId,
  MemberStatus,
  Place,
  PullCursor,
  ReactionCursor,
  ReactionEmoji,
  ReactionSet,
} from '../../shared/types';
import {
  MEMBER_IDS,
  entryTags,
  isOffTags,
  normalizeEmojis,
  primaryTag,
  PUSH_LIMITS,
  UUID_RE,
} from '../../shared/types';
import { openCrewDB, reactionKey, type CrewDatabase, type CrewDB, type QueueMeta } from './idb';
import { seedComments, seedEntries, seedReactionSets, seedStatuses } from '../lib/constants';

type StoreName =
  | 'entries'
  | 'queue'
  | 'comments'
  | 'commentQueue'
  | 'reactions'
  | 'reactionQueue'
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
  sync: SyncInfo;
}

// meta 스토어의 지금 상태 저장 키
const MY_STATUS_KEY = 'myStatus';
const STATUS_DIRTY_KEY = 'statusDirty';
// meta 스토어의 스트림별 pull 커서 키 (기록 커서는 기존 이름 'cursor')
const ENTRY_CURSOR_KEY = 'cursor';
const COMMENT_CURSOR_KEY = 'commentCursor';
const REACTION_CURSOR_KEY = 'reactionCursor';

/** 3-way 병합 대상 필드 — 이 밖의 필드(v/updatedAt)는 동기화 메타데이터다.
    tag는 tags에서 파생되는 값이라 병합 대상이 아니다 — 병합 후 다시 계산한다. */
const MERGE_FIELDS = ['day', 'time', 'tags', 'stars', 'memo', 'body'] as const;

function fieldEq(a: Entry, b: Entry, f: (typeof MERGE_FIELDS)[number] | 'todos'): boolean {
  // 배열 필드는 JSON 비교 — 정규화가 순서를 고정하므로(TAGS 순서) 안전하다
  if (f === 'todos' || f === 'tags') return JSON.stringify(a[f]) === JSON.stringify(b[f]);
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
    tags도 같은 이유로 여기서 채운다: 다중 태그 이전에 저장된 IDB 행과 구버전 Worker 응답에는
    tags가 없다 — 그대로 두면 병합 비교와 push가 빈 배열을 진짜 값으로 본다. */
export function normalizeEntry(e: Entry): Entry {
  const tags = entryTags(e);
  const v = typeof e.v === 'number' ? e.v : 0;
  // OFF의 별점도 같은 경계에서 맞춘다. 구버전/깨진 IDB 행이 OFF+숫자를 들고 있으면
  // 서버 ACK 전까지 로컬 불변식이 깨지고, 병합에서 그 숫자를 "로컬 별점 수정"으로 오판한다.
  // 비-OFF+null은 레거시 "평가 없음"이므로 값을 지어내지 않고 그대로 보존한다.
  const stars = isOffTags(tags) ? null : e.stars;
  if (
    v === e.v &&
    e.tag === primaryTag(tags) &&
    e.stars === stars &&
    JSON.stringify(e.tags) === JSON.stringify(tags)
  ) {
    return e;
  }
  return { ...e, v, tags, tag: primaryTag(tags), stars };
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

export class CrewStore {
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

  /** SyncClient가 등록 — 로컬 쓰기 직후 push를 예약한다. */
  onLocalWrite: (() => void) | null = null;

  async init(opts: { demo: boolean; memberId: MemberId }): Promise<void> {
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
        'meta',
      ]);
      const [rows, qkeys, qvals, cRows, cQueue, rRows, rQueue, st, dirty] = await Promise.all([
        tx.objectStore('entries').getAll(),
        tx.objectStore('queue').getAllKeys(),
        tx.objectStore('queue').getAll(),
        tx.objectStore('comments').getAll(),
        tx.objectStore('commentQueue').getAllKeys(),
        tx.objectStore('reactions').getAll(),
        tx.objectStore('reactionQueue').getAllKeys(),
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
    }
    if (this.db && !opts.demo && typeof BroadcastChannel !== 'undefined') {
      this.bc = new BroadcastChannel('lc-sync');
      // 다른 탭이 IDB를 갱신했다 — 짧게 모아서 다시 읽는다
      this.bc.onmessage = () => this.scheduleRefresh();
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

  /* ---------- 쓰기 (UI 경로 — 항상 즉시 반영) ---------- */
  upsert(raw: Entry): void {
    // UI/레거시 이관을 포함한 모든 로컬 쓰기의 마지막 경계. 호출자가 실수로 tag를 직접
    // 대입하거나 tags 순서를 뒤섞어도 IDB와 push 큐에는 정규형만 들어가게 한다.
    const entry = normalizeEntry(raw);
    const prev = this.map.get(entry.id);
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
      if (row.deletedAt) {
        if (this.map.delete(row.id)) changed = true;
        dels.push(row.id);
      } else {
        this.map.set(row.id, row);
        puts.push(row);
        changed = true;
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
    const notify =
      puts.length > 0 ||
      dels.length > 0 ||
      myStatus !== null ||
      cPuts.length > 0 ||
      cDels.length > 0 ||
      rPuts.length > 0;
    if (!notify && !cursorChanged && !commentCursorChanged && !reactionCursorChanged) {
      if (changed) this.bump();
      return;
    }
    if (cursorChanged) this.lastCursor = cursor;
    if (commentCursorChanged) this.lastCommentCursor = cc;
    if (reactionCursorChanged) this.lastReactionCursor = rc;
    // 손댈 스토어만 트랜잭션에 넣는다 — 안 쓰는 스토어까지 잠그면 다른 탭의 쓰기를 괜히 막는다.
    // 큐 스토어까지 넣는 이유: 다른 탭의 미전송 쓰기를 같은 트랜잭션 안에서 읽어 피해 가야 한다
    const stores: StoreName[] = ['meta'];
    if (puts.length > 0 || dels.length > 0) stores.push('entries');
    if (cPuts.length > 0 || cDels.length > 0) stores.push('comments', 'commentQueue');
    if (rPuts.length > 0) stores.push('reactions', 'reactionQueue');
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
        const meta = tx.objectStore('meta');
        if (myStatus) void meta.put(myStatus, MY_STATUS_KEY);
        if (cursor) void meta.put(cursor, ENTRY_CURSOR_KEY);
        // 커서는 응답 객체를 글자 그대로 저장한다 — 행의 updatedAt으로 재구성하면
        // Postgres 마이크로초가 밀리초로 잘려 같은 행을 영원히 다시 싣는다
        if (cc) void meta.put(cc, COMMENT_CURSOR_KEY);
        if (rc) void meta.put(rc, REACTION_CURSOR_KEY);
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
        this.map.set(id, next);
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
    if (tombstone) this.map.delete(id);
    else this.map.set(id, server);
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
    this.map.set(id, next);
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
  }> {
    const none = { entries: null, comments: null, reactions: null };
    const db = this.db;
    if (!db) return none;
    try {
      const tx = db.transaction('meta');
      const [e, c, r] = await Promise.all([
        tx.objectStore('meta').get(ENTRY_CURSOR_KEY),
        tx.objectStore('meta').get(COMMENT_CURSOR_KEY),
        tx.objectStore('meta').get(REACTION_CURSOR_KEY),
      ]);
      await tx.done;
      return { entries: asPullCursor(e), comments: asPullCursor(c), reactions: asReactionCursor(r) };
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
        'meta',
      ]);
      const [rows, qkeys, qvals, dbComments, dbCQueue, dbReactions, dbRQueue, dbSt, dbDirty] =
        await Promise.all([
          tx.objectStore('entries').getAll(),
          tx.objectStore('queue').getAllKeys(),
          tx.objectStore('queue').getAll(),
          tx.objectStore('comments').getAll(),
          tx.objectStore('commentQueue').getAllKeys(),
          tx.objectStore('reactions').getAll(),
          tx.objectStore('reactionQueue').getAllKeys(),
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
          this.map.set(e.id, norm);
          changed = true;
        }
      }
      // IDB에서 사라진 행(다른 탭이 tombstone을 ack) — 내 큐에 없으면 메모리에서도 제거
      for (const id of [...this.map.keys()]) {
        if (!dbIds.has(id) && !this.queue.has(id) && UUID_RE.test(id)) {
          this.map.delete(id);
          changed = true;
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

      if (changed) this.bump();
      if (tookDirty) this.onLocalWrite?.();
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
    this.snapshot = {
      rev: this.snapshot.rev + 1,
      entries: [...this.map.values()].filter((e) => !e.deletedAt),
      statuses: Object.fromEntries(this.statuses) as Partial<Record<MemberId, MemberStatus>>,
      comments: groupComments(this.comments.values()),
      reactions: groupReactions(this.reactions.values()),
      sync: {
        phase: this.syncPhase,
        pending:
          this.queue.size +
          (this.statusDirty ? 1 : 0) +
          this.commentQueue.size +
          this.reactionDirty.size,
      },
    };
    for (const fn of this.listeners) fn();
  }
}
