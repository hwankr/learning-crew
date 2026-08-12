/* 로컬 퍼스트 저장소.
   - UI는 이 스토어(메모리 Map)만 읽고 쓴다 — 상호작용은 네트워크를 기다리지 않는다.
   - 실제 쓰기는 IndexedDB에 지속 + 큐에 등록 → SyncClient가 백그라운드로 push.
   - 큐 항목은 rev(로컬 수정 카운터)와 base(마지막 서버 일치 스냅샷)를 함께 지녀서:
     · 전송 중 또 수정해도 ACK가 최신 수정을 지우지 못하고(rev 불일치 → 큐 유지),
     · 서버 CAS 충돌 시 base를 기준으로 필드 단위 3-way 병합을 한다 (삭제는 항상 승리).
   - id가 UUID가 아닌 행(데모 시드 s*)은 메모리 전용: 저장도 동기화도 하지 않는다. */
import type { IDBPTransaction } from 'idb';
import type { Entry, MemberId, MemberStatus, Place, PullCursor } from '../../shared/types';
import { openCrewDB, type CrewDatabase, type CrewDB, type QueueMeta } from './idb';
import { seedEntries, seedStatuses } from '../lib/constants';

type StoreName = 'entries' | 'queue' | 'meta';
type CrewTx = IDBPTransaction<CrewDB, StoreName[], 'readwrite'>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// 구 프로토타입이 쓰던 localStorage 키 — 이관용이므로 이 이름 그대로 둬야 한다
const LEGACY_KEY = 'running-crew-entries-v2';
const MIGRATED_FLAG = 'migrated-legacy-v2';

/** 동기화 국면 — SyncClient가 갱신하고 UI가 그대로 표시한다. */
export type SyncPhase = 'ok' | 'syncing' | 'offline' | 'error' | 'auth';
export interface SyncInfo {
  phase: SyncPhase;
  /** 아직 서버에 안 간 변경 수 (기록 큐 + 지금 상태 dirty) */
  pending: number;
}

export interface StoreSnapshot {
  rev: number;
  entries: Entry[]; // deletedAt이 없는 살아있는 행만
  statuses: Partial<Record<MemberId, MemberStatus>>; // 멤버별 지금 상태
  sync: SyncInfo;
}

// meta 스토어의 지금 상태 저장 키
const MY_STATUS_KEY = 'myStatus';
const STATUS_DIRTY_KEY = 'statusDirty';

/** 3-way 병합 대상 필드 — 이 밖의 필드(v/updatedAt)는 동기화 메타데이터다. */
const MERGE_FIELDS = ['day', 'time', 'tag', 'stars', 'memo', 'body'] as const;

function fieldEq(a: Entry, b: Entry, f: (typeof MERGE_FIELDS)[number] | 'todos'): boolean {
  if (f === 'todos') return JSON.stringify(a.todos) === JSON.stringify(b.todos);
  return a[f] === b[f];
}

/** 내용(동기화 메타 제외)이 같은가 — 충돌 응답이 사실상 내 쓰기의 에코일 때를 판별한다. */
export function contentEqual(a: Entry, b: Entry): boolean {
  return (
    MERGE_FIELDS.every((f) => fieldEq(a, b, f)) &&
    fieldEq(a, b, 'todos') &&
    (a.deletedAt === null) === (b.deletedAt === null)
  );
}

/** 필드 단위 3-way 병합 — base에서 로컬이 고친 필드만 로컬을 취하고 나머지는 서버를 따른다.
    양쪽이 같은 필드를 고쳤으면 로컬이 이긴다. base가 없으면(신규 행 에코 등) 전부 로컬. */
export function mergeEntry(base: Entry | null, local: Entry, server: Entry): Entry {
  const pick = <K extends (typeof MERGE_FIELDS)[number] | 'todos'>(f: K): Entry[K] => {
    if (!base || !fieldEq(local, base, f)) return local[f];
    return server[f];
  };
  return {
    ...server, // id/m/v/updatedAt은 서버 기준
    day: pick('day'),
    time: pick('time'),
    tag: pick('tag'),
    stars: pick('stars'),
    memo: pick('memo'),
    body: pick('body'),
    todos: pick('todos'),
    deletedAt: null, // 삭제 충돌은 병합 전에 별도 규칙으로 처리된다
  };
}

export class CrewStore {
  private map = new Map<string, Entry>();
  private queue = new Map<string, QueueMeta>();
  private statuses = new Map<MemberId, MemberStatus>();
  private statusDirty = false; // 내 상태가 아직 서버에 안 갔음
  private me: MemberId = 'sh';
  private demo = false;
  private listeners = new Set<() => void>();
  private syncPhase: SyncPhase = 'ok';
  private snapshot: StoreSnapshot = {
    rev: 0,
    entries: [],
    statuses: {},
    sync: { phase: 'ok', pending: 0 },
  };
  private db: CrewDatabase | null = null;
  // 같은 기기의 다른 탭과 변경을 주고받는 채널 — 한 탭이 pull/push한 결과를 다른 탭도 반영한다
  private bc: BroadcastChannel | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private refreshing = false;

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
      // 구버전(IDB v1 이전 데이터)에 v가 없을 수 있다 — 0(=서버 리비전 모름)으로 정규화.
      // 첫 push가 CAS 충돌을 내면 병합 경로가 base를 되찾아 준다.
      for (const e of await this.db.getAll('entries')) {
        this.map.set(e.id, { ...e, v: typeof e.v === 'number' ? e.v : 0 });
      }
      const tx = this.db.transaction('queue');
      let cur = await tx.store.openCursor();
      while (cur) {
        this.queue.set(String(cur.key), cur.value);
        cur = await cur.continue();
      }
      // 내 상태는 지속 — 다른 멤버 상태는 어차피 첫 pull에 실려 온다
      const st = await this.db.get('meta', MY_STATUS_KEY);
      if (!opts.demo && st && typeof st === 'object' && 'm' in st && st.m === opts.memberId) {
        this.statuses.set(st.m, st);
        this.statusDirty = !!(await this.db.get('meta', STATUS_DIRTY_KEY));
      }
    }
    if (!opts.demo) await this.migrateLegacy(opts.memberId);
    if (opts.demo) {
      if (this.map.size === 0) for (const e of seedEntries()) this.map.set(e.id, e);
      for (const s of seedStatuses()) if (s.m !== opts.memberId) this.statuses.set(s.m, s);
    }
    if (this.db && !opts.demo && typeof BroadcastChannel !== 'undefined') {
      this.bc = new BroadcastChannel('lc-sync');
      this.bc.onmessage = () => {
        // 다른 탭이 IDB를 갱신했다 — 짧게 모아서 다시 읽는다
        if (this.refreshTimer) clearTimeout(this.refreshTimer);
        this.refreshTimer = setTimeout(() => void this.refreshFromDB(), 200);
      };
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

  /** push용 스냅샷 — 각 행의 현재 rev를 함께 찍는다. ACK는 이 rev와 일치할 때만 큐를 비운다. */
  pendingSnapshot(): { entry: Entry; rev: number }[] {
    const out: { entry: Entry; rev: number }[] = [];
    for (const [id, meta] of this.queue) {
      const entry = this.map.get(id);
      if (entry) out.push({ entry, rev: meta.rev });
    }
    return out;
  }

  /* ---------- 쓰기 (UI 경로 — 항상 즉시 반영) ---------- */
  upsert(entry: Entry): void {
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

  /* ---------- 동기화 경로 (SyncClient 전용) ---------- */
  /** pull 결과 반영 — 행 저장과 커서 전진을 한 IndexedDB 트랜잭션으로 묶는다.
      (따로 쓰면 "행은 저장됐는데 커서만 전진" 같은 반쪽 상태가 생길 수 있다) */
  applyPull(rows: Entry[], statuses: MemberStatus[] | undefined, cursor: PullCursor | null): void {
    let changed = false;
    const puts: Entry[] = [];
    const dels: string[] = [];
    for (const row of rows) {
      if (this.queue.has(row.id)) continue; // 아직 push 안 된 로컬 수정이 이긴다
      const cur = this.map.get(row.id);
      if (cur && cur.v === row.v) continue; // 커서 안전 윈도우의 중복 전달 — 조용히 무시
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
        this.statuses.set(r.m, r);
        if (r.m === this.me) myStatus = r;
        changed = true;
      }
    }
    this.txWrite(['entries', 'meta'], (tx) => {
      const store = tx.objectStore('entries');
      for (const e of puts) void store.put(e);
      for (const id of dels) void store.delete(id);
      if (myStatus) void tx.objectStore('meta').put(myStatus, MY_STATUS_KEY);
      if (cursor) void tx.objectStore('meta').put(cursor, 'cursor');
    });
    if (changed) this.bump();
  }

  /** push 반영 성공. rev가 다르면 전송 중 또 수정된 것 — 큐에 남기되 서버 행을 새 base로 삼는다. */
  ackApplied(id: string, rev: number, server: Entry): void {
    const q = this.queue.get(id);
    if (!q) return;
    const cur = this.map.get(id);
    if (q.rev !== rev) {
      // 방금 서버에 반영된 내용이 이 행의 새 base — 다음 push가 그 위에 CAS한다
      const meta: QueueMeta = { rev: q.rev, base: server };
      this.queue.set(id, meta);
      if (cur) {
        const next = { ...cur, v: server.v };
        this.map.set(id, next);
        this.persistEntry(next, meta);
      }
      return;
    }
    this.queue.delete(id);
    if (server.deletedAt) {
      this.map.delete(id);
      this.txWrite(['entries', 'queue'], (tx) => {
        void tx.objectStore('entries').delete(id);
        void tx.objectStore('queue').delete(id);
      });
    } else {
      this.map.set(id, server);
      this.txWrite(['entries', 'queue'], (tx) => {
        void tx.objectStore('entries').put(server);
        void tx.objectStore('queue').delete(id);
      });
    }
    this.bump();
  }

  /** push CAS 충돌 — 서버 현재 행과 병합한다.
      규칙: ① 어느 쪽이든 삭제면 삭제 승리(부활 방지) ② 남의 행이면 서버 채택
            ③ 그 외 base 기준 필드 단위 병합 → 서버와 같아지면 종료, 다르면 재전송 대기. */
  resolveConflict(id: string, server: Entry): void {
    const q = this.queue.get(id);
    const local = this.map.get(id);
    if (!q || !local) {
      this.applyPull([server], undefined, null);
      return;
    }
    // ① 서버가 삭제 — 로컬 수정을 버리고 삭제를 따른다 (삭제된 기록 부활 방지)
    if (server.deletedAt) {
      this.queue.delete(id);
      this.map.delete(id);
      this.txWrite(['entries', 'queue'], (tx) => {
        void tx.objectStore('entries').delete(id);
        void tx.objectStore('queue').delete(id);
      });
      this.bump();
      return;
    }
    // ② 내 행이 아니면 이길 수 없다 — 서버를 채택하고 큐에서 뺀다
    if (server.m !== this.me) {
      this.queue.delete(id);
      this.map.set(id, server);
      this.txWrite(['entries', 'queue'], (tx) => {
        void tx.objectStore('entries').put(server);
        void tx.objectStore('queue').delete(id);
      });
      this.bump();
      return;
    }
    // ① 로컬이 삭제 — 서버 리비전 위에 tombstone을 다시 얹어 재전송한다 (삭제 승리)
    if (local.deletedAt) {
      const next = { ...local, v: server.v };
      const meta: QueueMeta = { rev: q.rev + 1, base: server };
      this.map.set(id, next);
      this.queue.set(id, meta);
      this.persistEntry(next, meta);
      return;
    }
    // ③ 필드 단위 3-way 병합
    const merged = mergeEntry(q.base, local, server);
    if (contentEqual(merged, server)) {
      // 병합 결과가 서버와 동일(내 쓰기의 에코 포함) — 재전송 없이 서버 버전을 채택
      this.queue.delete(id);
      this.map.set(id, server);
      this.txWrite(['entries', 'queue'], (tx) => {
        void tx.objectStore('entries').put(server);
        void tx.objectStore('queue').delete(id);
      });
      this.bump();
      return;
    }
    const next = { ...merged, updatedAt: local.updatedAt };
    const meta: QueueMeta = { rev: q.rev + 1, base: server };
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

  async getCursor(): Promise<PullCursor | null> {
    const v = await this.db?.get('meta', 'cursor');
    return v && typeof v === 'object' && 'ts' in v ? v : null;
  }

  /* ---------- IndexedDB 쓰기 (원자 단위) ---------- */
  /** 기록 + 큐 메타를 한 트랜잭션으로 — "기록은 있는데 큐가 없음" 반쪽 상태를 막는다. */
  private persistEntry(entry: Entry, meta: QueueMeta): void {
    this.txWrite(['entries', 'queue'], (tx) => {
      void tx.objectStore('entries').put(entry);
      void tx.objectStore('queue').put(meta, entry.id);
    });
  }

  /** fire-and-forget IDB 트랜잭션 — UI는 기다리지 않고, 실패해도 트랜잭션이라 반쪽 상태는 없다.
      커밋되면 다른 탭에 알린다(BroadcastChannel) — 그쪽 메모리도 IDB를 다시 읽는다. */
  private txWrite(stores: StoreName[], fill: (tx: CrewTx) => void): void {
    const db = this.db;
    if (!db) return;
    try {
      const tx = db.transaction(stores, 'readwrite');
      fill(tx);
      tx.done.then(
        () => this.bc?.postMessage('changed'),
        () => {},
      );
    } catch {
      // 닫힌 DB 등 — 메모리 상태는 유효하므로 무시
    }
  }

  /** IndexedDB를 다시 읽어 다른 탭의 변경을 메모리에 반영한다.
      원칙: 내 큐(dirty)가 이긴다 — 단, 다른 탭의 더 새 로컬 쓰기(rev가 높은 큐)는 채택한다. */
  async refreshFromDB(): Promise<void> {
    const db = this.db;
    if (!db || this.demo || this.refreshing) return;
    this.refreshing = true;
    try {
      const tx = db.transaction(['entries', 'queue', 'meta']);
      const [rows, qkeys, qvals, dbSt, dbDirty] = await Promise.all([
        tx.objectStore('entries').getAll(),
        tx.objectStore('queue').getAllKeys(),
        tx.objectStore('queue').getAll(),
        tx.objectStore('meta').get(MY_STATUS_KEY),
        tx.objectStore('meta').get(STATUS_DIRTY_KEY),
      ]);
      await tx.done;
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

      // 행 병합 — 큐에 없는(clean) 행과 방금 채택한 dirty 행은 IDB 내용을 따른다
      const dbIds = new Set<string>();
      for (const e of rows) {
        dbIds.add(e.id);
        if (this.queue.has(e.id) && !adopted.has(e.id)) continue;
        const norm: Entry = { ...e, v: typeof e.v === 'number' ? e.v : 0 };
        const cur = this.map.get(e.id);
        if (!cur || JSON.stringify(cur) !== JSON.stringify(norm)) {
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

      // 내 지금 상태 — 더 새 액션 시각이면 채택, 같은 액션을 다른 탭이 push했으면 dirty 해제
      if (dbSt && typeof dbSt === 'object' && 'm' in dbSt && dbSt.m === this.me) {
        const mem = this.statuses.get(this.me);
        const dbT = Date.parse(dbSt.updatedAt);
        const memT = mem ? Date.parse(mem.updatedAt) : Number.NEGATIVE_INFINITY;
        if (Number.isFinite(dbT) && dbT >= memT && dbSt.updatedAt !== mem?.updatedAt) {
          this.statuses.set(this.me, dbSt);
          this.statusDirty = !!dbDirty;
          changed = true;
        } else if (mem && dbSt.updatedAt === mem.updatedAt && this.statusDirty && !dbDirty) {
          this.statusDirty = false;
          changed = true;
        }
      }

      if (changed) this.bump();
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
            this.upsert({
              id: crypto.randomUUID(),
              m: me,
              day: String(e.day ?? ''),
              time: String(e.time ?? ''),
              tag: (e.tag ?? '기타') as Entry['tag'],
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
      sync: { phase: this.syncPhase, pending: this.queue.size + (this.statusDirty ? 1 : 0) },
    };
    for (const fn of this.listeners) fn();
  }
}
