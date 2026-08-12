/* 로컬 퍼스트 저장소.
   - UI는 이 스토어(메모리 Map)만 읽고 쓴다 — 상호작용은 네트워크를 기다리지 않는다.
   - 실제 쓰기는 IndexedDB에 지속 + 큐에 등록 → SyncClient가 백그라운드로 push.
   - id가 UUID가 아닌 행(데모 시드 s*)은 메모리 전용: 저장도 동기화도 하지 않는다. */
import type { Entry, MemberId, PullCursor } from '../../shared/types';
import { openCrewDB, type CrewDatabase } from './idb';
import { seedEntries } from '../lib/constants';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// 구 프로토타입이 쓰던 localStorage 키 — 이관용이므로 이 이름 그대로 둬야 한다
const LEGACY_KEY = 'running-crew-entries-v2';
const MIGRATED_FLAG = 'migrated-legacy-v2';

export interface StoreSnapshot {
  rev: number;
  entries: Entry[]; // deletedAt이 없는 살아있는 행만
}

export class CrewStore {
  private map = new Map<string, Entry>();
  private queue = new Set<string>();
  private listeners = new Set<() => void>();
  private snapshot: StoreSnapshot = { rev: 0, entries: [] };
  private db: CrewDatabase | null = null;

  /** SyncClient가 등록 — 로컬 쓰기 직후 push를 예약한다. */
  onLocalWrite: (() => void) | null = null;

  async init(opts: { demo: boolean; memberId: MemberId }): Promise<void> {
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
      for (const e of await this.db.getAll('entries')) this.map.set(e.id, e);
      for (const k of await this.db.getAllKeys('queue')) this.queue.add(String(k));
    }
    if (!opts.demo) await this.migrateLegacy(opts.memberId);
    if (opts.demo && this.map.size === 0) {
      for (const e of seedEntries()) this.map.set(e.id, e);
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
    return [...this.queue];
  }

  /* ---------- 쓰기 (UI 경로 — 항상 즉시 반영) ---------- */
  upsert(entry: Entry): void {
    this.map.set(entry.id, entry);
    if (UUID_RE.test(entry.id)) {
      void this.db?.put('entries', entry);
      this.queue.add(entry.id);
      void this.db?.put('queue', true, entry.id);
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
  /** pull 결과 병합. 큐에 있는(아직 push 안 된) 행은 로컬이 이긴다. */
  applyServer(rows: Entry[]): void {
    let changed = false;
    for (const row of rows) {
      if (this.queue.has(row.id)) continue;
      if (row.deletedAt) {
        if (this.map.delete(row.id)) changed = true;
        void this.db?.delete('entries', row.id);
      } else {
        this.map.set(row.id, row);
        void this.db?.put('entries', row);
        changed = true;
      }
    }
    if (changed) this.bump();
  }

  /** push 성공 후: 큐 비우고, 서버에 반영된 tombstone은 로컬에서 완전히 제거. */
  ackPushed(ids: string[]): void {
    for (const id of ids) {
      this.queue.delete(id);
      void this.db?.delete('queue', id);
      const e = this.map.get(id);
      if (e?.deletedAt) {
        this.map.delete(id);
        void this.db?.delete('entries', id);
      }
    }
    this.bump();
  }

  /** 큐에 있지만 내 것이 아닌 행(비정상 상태)을 버려 push가 막히지 않게 한다. */
  dropFromQueue(id: string): void {
    this.queue.delete(id);
    void this.db?.delete('queue', id);
  }

  async getCursor(): Promise<PullCursor | null> {
    const v = await this.db?.get('meta', 'cursor');
    return v && typeof v === 'object' ? v : null;
  }
  async setCursor(c: PullCursor): Promise<void> {
    await this.db?.put('meta', c, 'cursor');
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
    };
    for (const fn of this.listeners) fn();
  }
}
