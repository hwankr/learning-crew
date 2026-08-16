import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MemberStatus } from '../../shared/types';
import { CrewStore } from './store';

const MY_STATUS_KEY = 'myStatus';
const STATUS_DIRTY_KEY = 'statusDirty';
const STATUS_ACK_SENT_UPDATED_AT_KEY = 'statusAckSentUpdatedAt';

interface HeldTx {
  readonly stores: string[];
  readonly mode: string;
  commit: () => void;
  abort: () => void;
}

function st(over: Partial<MemberStatus> = {}): MemberStatus {
  return {
    m: 'sh',
    on: true,
    place: '도서관',
    since: '2026-08-15T10:00:00.000Z',
    lastStartedAt: '2026-08-15T10:00:00.000Z',
    updatedAt: '2026-08-15T10:05:00.000Z',
    ...over,
  };
}

function statusDatabase(initialMeta: Record<string, unknown> = {}) {
  const meta = new Map<string, unknown>(Object.entries(initialMeta));
  const heldTxs: HeldTx[] = [];
  let holdNextReadwrite = false;
  const values: Record<string, unknown[]> = {
    entries: [],
    queue: [],
    comments: [],
    commentQueue: [],
    reactions: [],
    reactionQueue: [],
    notifications: [],
    notifReadQueue: [],
    posts: [],
    postQueue: [],
    postComments: [],
    postCommentQueue: [],
    photoBlobs: [],
    meta: [],
  };
  const keys: Record<string, string[]> = {
    queue: [],
    commentQueue: [],
    reactionQueue: [],
    notifReadQueue: [],
    postQueue: [],
    postCommentQueue: [],
    photoBlobs: [],
  };

  return {
    meta,
    heldTxs,
    holdNextReadwrite: () => {
      holdNextReadwrite = true;
    },
    db: {
      transaction: (storesArg: string | string[], mode = 'readonly') => {
        const stores = Array.isArray(storesArg) ? storesArg : [storesArg];
        const held = mode === 'readwrite' && holdNextReadwrite;
        holdNextReadwrite = false;
        const stagedMeta = held ? new Map(meta) : meta;
        let resolveDone: () => void = () => undefined;
        let rejectDone: () => void = () => undefined;
        const done = held
          ? new Promise<void>((resolve, reject) => {
            resolveDone = resolve;
            rejectDone = reject;
          })
          : Promise.resolve();
        const tx: HeldTx = {
          stores,
          mode,
          commit: () => {
            meta.clear();
            for (const [key, value] of stagedMeta) meta.set(key, value);
            resolveDone();
          },
          abort: () => rejectDone(),
        };
        if (held) heldTxs.push(tx);
        return {
          done,
          objectStore: (name: string) => ({
            getAll: async () => values[name] ?? [],
            getAllKeys: async () => keys[name] ?? [],
            get: async (key: string) => name === 'meta' ? stagedMeta.get(key) : undefined,
            put: async (value: unknown, key?: string) => {
              if (name === 'meta' && key) stagedMeta.set(key, value);
            },
            delete: async (key: string) => {
              if (name === 'meta') stagedMeta.delete(key);
            },
          }),
        };
      },
    },
  };
}

function installDatabase(store: CrewStore, db: unknown): void {
  const internals = store as unknown as { db: unknown; durableStorage: 'ready' };
  internals.db = db;
  internals.durableStorage = 'ready';
}

function installBroadcast(store: CrewStore, bc: { postMessage: (message: string) => void }): void {
  (store as unknown as { bc: typeof bc }).bc = bc;
}

function replaceMemoryStatus(store: CrewStore, status: MemberStatus, dirty: boolean): void {
  const internals = store as unknown as {
    statuses: Map<string, MemberStatus>;
    statusDirty: boolean;
    bump: () => void;
  };
  internals.statuses.set(status.m, status);
  internals.statusDirty = dirty;
  internals.bump();
}

async function flushAsyncTx(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  vi.useRealTimers();
});

describe('CrewStore status monotonic merge', () => {
  it('setMyStatus는 같은 ms 재토글도 이전 액션보다 최소 1ms 새 시각으로 식별한다', () => {
    vi.useFakeTimers();
    vi.setSystemTime('2026-08-15T10:05:00.000Z');
    const store = new CrewStore();
    const { db, meta } = statusDatabase();
    installDatabase(store, db);

    store.setMyStatus(true, '도서관');
    const first = store.myStatusPending()!;
    store.setMyStatus(false, null);
    const second = store.myStatusPending()!;

    expect(first.updatedAt).toBe('2026-08-15T10:05:00.000Z');
    expect(first.since).toBe(first.updatedAt);
    expect(first.lastStartedAt).toBe(first.updatedAt);
    expect(second.updatedAt).toBe('2026-08-15T10:05:00.001Z');
    expect(second.lastStartedAt).toBe(first.updatedAt);
    expect(meta.get(MY_STATUS_KEY)).toEqual(second);
    expect(meta.get(STATUS_DIRTY_KEY)).toBe(true);
    expect(meta.has(STATUS_ACK_SENT_UPDATED_AT_KEY)).toBe(false);
  });

  it('applyPull은 dirty 로컬 상태와 같은 updatedAt의 서버 current-state를 무시하고 더 최신 시작 이력만 흡수한다', async () => {
    vi.useFakeTimers();
    vi.setSystemTime('2026-08-15T10:05:00.000Z');
    const store = new CrewStore();
    const { db, meta } = statusDatabase();
    installDatabase(store, db);

    store.setMyStatus(true, '도서관');
    const pending = store.myStatusPending()!;
    const newerLastStartedAt = '2026-08-15T10:10:00.000Z';

    store.applyPull({
      rows: [],
      cursor: null,
      statuses: [st({
        on: false,
        place: null,
        since: null,
        lastStartedAt: newerLastStartedAt,
        updatedAt: pending.updatedAt,
      })],
    });
    await flushAsyncTx();

    const mine = store.getSnapshot().statuses.sh!;
    expect(mine).toEqual({
      ...pending,
      lastStartedAt: newerLastStartedAt,
    });
    expect(store.myStatusPending()).toEqual(mine);
    expect(meta.get(MY_STATUS_KEY)).toEqual(mine);
    expect(meta.get(STATUS_DIRTY_KEY)).toBe(true);
  });

  it('applyPull은 same/slow incoming으로 lastStartedAt을 낮추지 않고 병합 row만 MY_STATUS_KEY에 쓴다', async () => {
    const store = new CrewStore();
    const { db, meta } = statusDatabase();
    installDatabase(store, db);

    const localHistory = st();
    store.applyPull({ rows: [], cursor: null, statuses: [localHistory] });
    await flushAsyncTx();

    const sameActionStaleHistory = st({
      on: false,
      place: null,
      since: null,
      lastStartedAt: '2026-08-15T09:00:00.000Z',
    });
    store.applyPull({ rows: [], cursor: null, statuses: [sameActionStaleHistory] });
    await flushAsyncTx();

    let mine = store.getSnapshot().statuses.sh!;
    expect(mine).toEqual({
      ...sameActionStaleHistory,
      lastStartedAt: localHistory.lastStartedAt,
    });
    expect(meta.get(MY_STATUS_KEY)).toEqual(mine);
    expect(meta.get(MY_STATUS_KEY)).not.toEqual(sameActionStaleHistory);

    const beforeSlow = mine;
    store.applyPull({
      rows: [],
      cursor: null,
      statuses: [st({
        on: true,
        place: '카페',
        since: '2026-08-15T09:30:00.000Z',
        lastStartedAt: '2026-08-15T08:00:00.000Z',
        updatedAt: '2026-08-15T09:30:00.000Z',
      })],
    });
    await flushAsyncTx();

    mine = store.getSnapshot().statuses.sh!;
    expect(mine).toEqual(beforeSlow);
    expect(meta.get(MY_STATUS_KEY)).toEqual(beforeSlow);
  });

  it('applyPull은 stale clean 메모리의 서버 row로 공유 IDB의 더 새 dirty pending을 덮지 않고 refresh로 채택한다', async () => {
    vi.useFakeTimers();
    const { db, meta } = statusDatabase();
    const a = new CrewStore();
    const b = new CrewStore();
    installDatabase(a, db);
    installDatabase(b, db);

    const staleMemory = st({ updatedAt: '2026-08-15T10:04:00.000Z' });
    replaceMemoryStatus(b, staleMemory, false);

    vi.setSystemTime('2026-08-15T10:06:00.000Z');
    a.setMyStatus(false, null);
    await flushAsyncTx();
    const newer = a.myStatusPending()!;
    expect(meta.get(MY_STATUS_KEY)).toEqual(newer);
    expect(meta.get(STATUS_DIRTY_KEY)).toBe(true);

    const stalePull = st({ updatedAt: '2026-08-15T10:05:00.000Z' });
    b.applyPull({ rows: [], cursor: null, statuses: [stalePull] });
    await flushAsyncTx();

    expect(meta.get(MY_STATUS_KEY)).toEqual(newer);
    expect(meta.get(STATUS_DIRTY_KEY)).toBe(true);
    expect(b.getSnapshot().statuses.sh).toEqual(stalePull);
    expect(b.myStatusPending()).toBeNull();

    await vi.advanceTimersByTimeAsync(199);
    expect(b.getSnapshot().statuses.sh).toEqual(stalePull);
    await vi.advanceTimersByTimeAsync(1);

    const adopted = { ...newer, lastStartedAt: stalePull.lastStartedAt };
    expect(b.getSnapshot().statuses.sh).toEqual(adopted);
    expect(b.myStatusPending()).toEqual(adopted);
  });

  it('applyPull은 같은 persisted dirty 액션에서 더 최신 서버 상태만 dirty를 지우고 정산한다', async () => {
    vi.useFakeTimers();
    vi.setSystemTime('2026-08-15T10:05:00.000Z');
    const store = new CrewStore();
    const { db, meta } = statusDatabase();
    installDatabase(store, db);

    store.setMyStatus(true, '도서관');
    await flushAsyncTx();
    const pending = store.myStatusPending()!;
    const serverWinner = st({
      on: false,
      place: null,
      since: null,
      lastStartedAt: pending.lastStartedAt,
      updatedAt: '2026-08-15T10:06:00.000Z',
    });

    store.applyPull({ rows: [], cursor: null, statuses: [serverWinner] });
    await flushAsyncTx();

    expect(store.getSnapshot().statuses.sh).toEqual(serverWinner);
    expect(store.myStatusPending()).toBeNull();
    expect(meta.get(MY_STATUS_KEY)).toEqual(serverWinner);
    expect(meta.has(STATUS_DIRTY_KEY)).toBe(false);
  });

  it('applyPull은 같은 action identity의 lastStartedAt 보강을 dirty guard에서 허용한다', async () => {
    vi.useFakeTimers();
    vi.setSystemTime('2026-08-15T10:05:00.000Z');
    const store = new CrewStore();
    const { db, meta } = statusDatabase();
    installDatabase(store, db);

    replaceMemoryStatus(store, st({
      on: true,
      place: '도서관',
      since: '2026-08-15T10:00:00.000Z',
      lastStartedAt: '2026-08-15T10:00:00.000Z',
      updatedAt: '2026-08-15T10:00:00.000Z',
    }), false);
    store.setMyStatus(false, null);
    await flushAsyncTx();

    const pending = store.myStatusPending()!;
    const persistedHistory = { ...pending, lastStartedAt: '2026-08-15T10:02:00.000Z' };
    meta.set(MY_STATUS_KEY, persistedHistory);
    meta.set(STATUS_DIRTY_KEY, true);

    store.applyPull({
      rows: [],
      cursor: null,
      statuses: [{ ...pending, lastStartedAt: '2026-08-15T10:01:00.000Z' }],
    });
    await flushAsyncTx();

    expect(meta.get(MY_STATUS_KEY)).toEqual(persistedHistory);
    expect(meta.get(STATUS_DIRTY_KEY)).toBe(true);

    await vi.advanceTimersByTimeAsync(200);

    expect(store.getSnapshot().statuses.sh).toEqual(persistedHistory);
    expect(store.myStatusPending()).toEqual(persistedHistory);
  });

  it('applyPull은 same-ms ON/OFF 충돌에서 stale newer row로 다른 탭 pending을 지우지 않는다', async () => {
    vi.useFakeTimers();
    const previous = st({
      on: true,
      place: '도서관',
      since: '2026-08-15T10:00:00.000Z',
      lastStartedAt: '2026-08-15T10:00:00.000Z',
      updatedAt: '2026-08-15T10:00:00.000Z',
    });
    const { db, meta } = statusDatabase({ [MY_STATUS_KEY]: previous });
    const a = new CrewStore();
    const b = new CrewStore();
    installDatabase(a, db);
    installDatabase(b, db);
    replaceMemoryStatus(a, previous, false);
    replaceMemoryStatus(b, previous, false);

    vi.setSystemTime('2026-08-15T10:05:00.000Z');
    b.setMyStatus(true, '카페');
    const bAction = b.myStatusPending()!;
    a.setMyStatus(false, null);
    await flushAsyncTx();
    const aAction = a.myStatusPending()!;

    expect(aAction.updatedAt).toBe(bAction.updatedAt);
    expect(aAction.on).not.toBe(bAction.on);
    expect(meta.get(MY_STATUS_KEY)).toEqual(aAction);
    expect(meta.get(STATUS_DIRTY_KEY)).toBe(true);

    const staleNewerServer = st({
      on: true,
      place: '카페',
      since: '2026-08-15T10:06:00.000Z',
      lastStartedAt: '2026-08-15T10:06:00.000Z',
      updatedAt: '2026-08-15T10:06:00.000Z',
    });
    b.applyPull({ rows: [], cursor: null, statuses: [staleNewerServer] });
    await flushAsyncTx();

    expect(meta.get(MY_STATUS_KEY)).toEqual(aAction);
    expect(meta.get(STATUS_DIRTY_KEY)).toBe(true);
    expect(meta.has(STATUS_ACK_SENT_UPDATED_AT_KEY)).toBe(false);

    await vi.advanceTimersByTimeAsync(200);

    const adopted = { ...aAction, lastStartedAt: staleNewerServer.lastStartedAt };
    expect(b.getSnapshot().statuses.sh).toEqual(adopted);
    expect(b.myStatusPending()).toEqual(adopted);
  });

  it('ackStatus는 늦은 same-updatedAt 응답으로 메모리와 IDB의 시작 이력을 낮추지 않는다', async () => {
    vi.useFakeTimers();
    vi.setSystemTime('2026-08-15T10:05:00.000Z');
    const store = new CrewStore();
    const { db, meta } = statusDatabase();
    installDatabase(store, db);

    store.setMyStatus(true, '도서관');
    const pending = store.myStatusPending()!;
    await store.ackStatus(pending.updatedAt, {
      ...pending,
      lastStartedAt: '2026-08-15T09:00:00.000Z',
    });

    const mine = store.getSnapshot().statuses.sh!;
    expect(mine.lastStartedAt).toBe(pending.lastStartedAt);
    expect(meta.get(MY_STATUS_KEY)).toEqual(mine);
    expect(meta.has(STATUS_DIRTY_KEY)).toBe(false);
    expect(meta.get(STATUS_ACK_SENT_UPDATED_AT_KEY)).toBe(pending.updatedAt);
    expect(store.myStatusPending()).toBeNull();
  });

  it('ackStatus는 ACK 커밋 뒤 BroadcastChannel 알림이 실패해도 성공 Promise를 유지한다', async () => {
    vi.useFakeTimers();
    vi.setSystemTime('2026-08-15T10:05:00.000Z');
    const store = new CrewStore();
    const { db, meta } = statusDatabase();
    installDatabase(store, db);
    installBroadcast(store, {
      postMessage: vi.fn(() => {
        throw new Error('closed');
      }),
    });

    store.setMyStatus(true, '도서관');
    const pending = store.myStatusPending()!;

    await expect(store.ackStatus(pending.updatedAt, pending)).resolves.toBeUndefined();

    expect(meta.get(MY_STATUS_KEY)).toEqual(pending);
    expect(meta.has(STATUS_DIRTY_KEY)).toBe(false);
    expect(store.myStatusPending()).toBeNull();
  });

  it('ackStatus는 성공 ACK를 tx commit 이후 한 번만 다른 탭에 알린다', async () => {
    vi.useFakeTimers();
    vi.setSystemTime('2026-08-15T10:05:00.000Z');
    const store = new CrewStore();
    const dbControl = statusDatabase();
    const bc = { postMessage: vi.fn() };
    installDatabase(store, dbControl.db);
    installBroadcast(store, bc);

    store.setMyStatus(true, '도서관');
    const pending = store.myStatusPending()!;
    await Promise.resolve();
    bc.postMessage.mockClear();
    dbControl.holdNextReadwrite();
    const ack = store.ackStatus(pending.updatedAt, {
      ...pending,
      lastStartedAt: '2026-08-15T09:00:00.000Z',
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(dbControl.heldTxs).toHaveLength(1);
    expect(bc.postMessage).not.toHaveBeenCalled();
    expect(store.myStatusPending()).toEqual(pending);
    expect(dbControl.meta.get(MY_STATUS_KEY)).toEqual(pending);
    expect(dbControl.meta.get(STATUS_DIRTY_KEY)).toBe(true);

    dbControl.heldTxs[0]!.commit();
    await ack;

    const mine = store.getSnapshot().statuses.sh!;
    expect(mine.lastStartedAt).toBe(pending.lastStartedAt);
    expect(bc.postMessage).toHaveBeenCalledTimes(1);
    expect(bc.postMessage).toHaveBeenCalledWith('changed');
    expect(dbControl.meta.get(MY_STATUS_KEY)).toEqual(mine);
    expect(dbControl.meta.has(STATUS_DIRTY_KEY)).toBe(false);
    expect(dbControl.meta.get(STATUS_ACK_SENT_UPDATED_AT_KEY)).toBe(pending.updatedAt);
    expect(store.myStatusPending()).toBeNull();
  });

  it('ackStatus는 tx 대기 중 메모리가 재토글돼도 DB를 바꾼 ACK면 다른 탭에 알린다', async () => {
    vi.useFakeTimers();
    vi.setSystemTime('2026-08-15T10:05:00.000Z');
    const store = new CrewStore();
    const dbControl = statusDatabase();
    const bc = { postMessage: vi.fn() };
    installDatabase(store, dbControl.db);
    installBroadcast(store, bc);

    store.setMyStatus(true, '도서관');
    const sent = store.myStatusPending()!;
    await Promise.resolve();
    bc.postMessage.mockClear();
    dbControl.holdNextReadwrite();
    const ack = store.ackStatus(sent.updatedAt, {
      ...sent,
      lastStartedAt: '2026-08-15T09:00:00.000Z',
    });
    await Promise.resolve();
    await Promise.resolve();

    const retoggled = st({
      on: false,
      place: null,
      since: null,
      lastStartedAt: sent.lastStartedAt,
      updatedAt: '2026-08-15T10:06:00.000Z',
    });
    replaceMemoryStatus(store, retoggled, true);

    dbControl.heldTxs[0]!.commit();
    await ack;

    expect(bc.postMessage).toHaveBeenCalledTimes(1);
    expect(bc.postMessage).toHaveBeenCalledWith('changed');
    expect(store.getSnapshot().statuses.sh).toEqual(retoggled);
    expect(store.myStatusPending()).toEqual(retoggled);
    expect(dbControl.meta.has(STATUS_DIRTY_KEY)).toBe(false);
    expect(dbControl.meta.get(STATUS_ACK_SENT_UPDATED_AT_KEY)).toBe(sent.updatedAt);
  });

  it('ackStatus는 빠른 클라이언트 시계가 서버에서 capped되면 서버 row로 교정하고 dirty를 지운다', async () => {
    vi.useFakeTimers();
    vi.setSystemTime('2026-08-15T10:05:00.000Z');
    const store = new CrewStore();
    const { db, meta } = statusDatabase();
    installDatabase(store, db);

    store.setMyStatus(true, '도서관');
    const pending = store.myStatusPending()!;
    const cappedServer = st({
      on: true,
      place: '도서관',
      since: '2026-08-15T10:00:00.000Z',
      lastStartedAt: '2026-08-15T10:00:00.000Z',
      updatedAt: '2026-08-15T10:00:00.000Z',
    });
    expect(cappedServer.updatedAt < pending.updatedAt).toBe(true);

    await store.ackStatus(pending.updatedAt, cappedServer);

    const mine = store.getSnapshot().statuses.sh!;
    expect(mine).toEqual(cappedServer);
    expect(meta.get(MY_STATUS_KEY)).toEqual(cappedServer);
    expect(meta.has(STATUS_DIRTY_KEY)).toBe(false);
    expect(meta.get(STATUS_ACK_SENT_UPDATED_AT_KEY)).toBe(pending.updatedAt);
    expect(store.myStatusPending()).toBeNull();
  });

  it('ackStatus는 전송 중 다시 토글됐으면 서버 응답을 정산하지 않고 dirty를 유지한다', async () => {
    vi.useFakeTimers();
    const store = new CrewStore();
    const { db, meta } = statusDatabase();
    installDatabase(store, db);

    vi.setSystemTime('2026-08-15T10:05:00.000Z');
    store.setMyStatus(true, '도서관');
    const sent = store.myStatusPending()!;
    vi.setSystemTime('2026-08-15T10:06:00.000Z');
    store.setMyStatus(false, null);
    const retoggled = store.myStatusPending()!;

    await store.ackStatus(sent.updatedAt, st({
      on: true,
      place: '도서관',
      since: '2026-08-15T10:00:00.000Z',
      lastStartedAt: '2026-08-15T10:00:00.000Z',
      updatedAt: '2026-08-15T10:00:00.000Z',
    }));

    expect(store.getSnapshot().statuses.sh).toEqual(retoggled);
    expect(meta.get(MY_STATUS_KEY)).toEqual(retoggled);
    expect(meta.get(STATUS_DIRTY_KEY)).toBe(true);
    expect(meta.has(STATUS_ACK_SENT_UPDATED_AT_KEY)).toBe(false);
    expect(store.myStatusPending()).toEqual(retoggled);
  });

  it('ackStatus는 공유 IDB의 더 새 pending을 stale ACK로 덮거나 clean 처리하지 않는다', async () => {
    vi.useFakeTimers();
    const { db, meta } = statusDatabase();
    const a = new CrewStore();
    const b = new CrewStore();
    const bc = { postMessage: vi.fn() };
    installDatabase(a, db);
    installDatabase(b, db);
    installBroadcast(b, bc);

    vi.setSystemTime('2026-08-15T10:05:00.000Z');
    b.setMyStatus(true, '도서관');
    const sent = b.myStatusPending()!;
    await a.refreshFromDB();
    expect(a.myStatusPending()).toEqual(sent);

    vi.setSystemTime('2026-08-15T10:06:00.000Z');
    a.setMyStatus(false, null);
    const newer = a.myStatusPending()!;
    await Promise.resolve();
    bc.postMessage.mockClear();
    expect(newer.updatedAt > sent.updatedAt).toBe(true);
    expect(meta.get(MY_STATUS_KEY)).toEqual(newer);
    expect(meta.get(STATUS_DIRTY_KEY)).toBe(true);

    await b.ackStatus(sent.updatedAt, {
      ...sent,
      lastStartedAt: '2026-08-15T09:00:00.000Z',
    });

    expect(bc.postMessage).not.toHaveBeenCalled();
    expect(meta.get(MY_STATUS_KEY)).toEqual(newer);
    expect(meta.get(STATUS_DIRTY_KEY)).toBe(true);
    expect(meta.has(STATUS_ACK_SENT_UPDATED_AT_KEY)).toBe(false);
    expect(b.getSnapshot().statuses.sh).toEqual(sent);
    expect(b.myStatusPending()).toEqual(sent);

    await vi.advanceTimersByTimeAsync(199);
    expect(b.getSnapshot().statuses.sh).toEqual(sent);
    expect(b.myStatusPending()).toEqual(sent);
    await vi.advanceTimersByTimeAsync(1);

    expect(b.getSnapshot().statuses.sh).toEqual(newer);
    expect(b.myStatusPending()).toEqual(newer);
  });

  it('ackStatus는 same-ms 다른 place pending을 stale ACK로 덮거나 clean 처리하지 않는다', async () => {
    vi.useFakeTimers();
    const previous = st({
      on: true,
      place: '도서관',
      since: '2026-08-15T10:00:00.000Z',
      lastStartedAt: '2026-08-15T10:00:00.000Z',
      updatedAt: '2026-08-15T10:00:00.000Z',
    });
    const { db, meta } = statusDatabase({ [MY_STATUS_KEY]: previous });
    const a = new CrewStore();
    const b = new CrewStore();
    const bc = { postMessage: vi.fn() };
    installDatabase(a, db);
    installDatabase(b, db);
    installBroadcast(b, bc);
    replaceMemoryStatus(a, previous, false);
    replaceMemoryStatus(b, previous, false);

    vi.setSystemTime('2026-08-15T10:05:00.000Z');
    b.setMyStatus(true, '카페');
    const bAction = b.myStatusPending()!;
    a.setMyStatus(true, '도서관');
    await flushAsyncTx();
    const aAction = a.myStatusPending()!;
    bc.postMessage.mockClear();

    expect(aAction.updatedAt).toBe(bAction.updatedAt);
    expect(aAction.place).not.toBe(bAction.place);
    expect(meta.get(MY_STATUS_KEY)).toEqual(aAction);
    expect(meta.get(STATUS_DIRTY_KEY)).toBe(true);

    await b.ackStatus(bAction.updatedAt, {
      ...bAction,
      lastStartedAt: '2026-08-15T09:00:00.000Z',
    });

    expect(bc.postMessage).not.toHaveBeenCalled();
    expect(meta.get(MY_STATUS_KEY)).toEqual(aAction);
    expect(meta.get(STATUS_DIRTY_KEY)).toBe(true);
    expect(meta.has(STATUS_ACK_SENT_UPDATED_AT_KEY)).toBe(false);
    expect(b.getSnapshot().statuses.sh).toEqual(bAction);
    expect(b.myStatusPending()).toEqual(bAction);

    await vi.advanceTimersByTimeAsync(200);

    expect(b.getSnapshot().statuses.sh).toEqual(aAction);
    expect(b.myStatusPending()).toEqual(aAction);
  });

  it('refreshFromDB는 다른 탭의 capped ACK 표식이 pending 액션과 일치하면 future row를 복구하지 않는다', async () => {
    vi.useFakeTimers();
    vi.setSystemTime('2026-08-15T10:30:00.000Z');
    const { db, meta } = statusDatabase();
    const a = new CrewStore();
    const b = new CrewStore();
    installDatabase(a, db);
    installDatabase(b, db);

    a.setMyStatus(true, '도서관');
    const future = a.myStatusPending()!;
    await b.refreshFromDB();
    expect(b.myStatusPending()).toEqual(future);

    const cappedServer = st({
      on: true,
      place: '도서관',
      since: '2026-08-15T10:00:00.000Z',
      lastStartedAt: '2026-08-15T10:00:00.000Z',
      updatedAt: '2026-08-15T10:00:00.000Z',
    });
    expect(cappedServer.updatedAt < future.updatedAt).toBe(true);
    await b.ackStatus(future.updatedAt, cappedServer);

    await a.refreshFromDB();

    expect(a.getSnapshot().statuses.sh).toEqual(cappedServer);
    expect(b.getSnapshot().statuses.sh).toEqual(cappedServer);
    expect(a.myStatusPending()).toBeNull();
    expect(b.myStatusPending()).toBeNull();
    expect(meta.get(MY_STATUS_KEY)).toEqual(cappedServer);
    expect(meta.has(STATUS_DIRTY_KEY)).toBe(false);
    expect(meta.get(STATUS_ACK_SENT_UPDATED_AT_KEY)).toBe(future.updatedAt);
  });

  it('refreshFromDB는 ACK 표식이 더 새 pending 액션과 다르면 row와 dirty를 함께 보존한다', async () => {
    vi.useFakeTimers();
    vi.setSystemTime('2026-08-15T10:20:00.000Z');
    const store = new CrewStore();
    store.setMyStatus(true, '카페');
    const pending = store.myStatusPending()!;
    const previousAck = '2026-08-15T10:10:00.000Z';
    const dbClean = st({
      on: true,
      place: '도서관',
      since: '2026-08-15T10:00:00.000Z',
      lastStartedAt: '2026-08-15T10:00:00.000Z',
      updatedAt: '2026-08-15T10:00:00.000Z',
    });
    const { db, meta } = statusDatabase({
      [MY_STATUS_KEY]: dbClean,
      [STATUS_ACK_SENT_UPDATED_AT_KEY]: previousAck,
    });
    installDatabase(store, db);

    await store.refreshFromDB();

    expect(store.getSnapshot().statuses.sh).toEqual(pending);
    expect(store.myStatusPending()).toEqual(pending);
    expect(meta.get(MY_STATUS_KEY)).toEqual(pending);
    expect(meta.get(STATUS_DIRTY_KEY)).toBe(true);
    expect(meta.get(STATUS_ACK_SENT_UPDATED_AT_KEY)).toBe(previousAck);
  });

  it('refreshFromDB는 same-updatedAt DB history가 오래되면 메모리를 보존하고 MY_STATUS_KEY를 repair한다', async () => {
    const store = new CrewStore();
    const memory = st();
    store.applyPull({ rows: [], cursor: null, statuses: [memory] });

    const dbRow = st({
      on: false,
      place: null,
      since: null,
      lastStartedAt: '2026-08-15T09:00:00.000Z',
    });
    const { db, meta } = statusDatabase({ [MY_STATUS_KEY]: dbRow });
    installDatabase(store, db);

    await store.refreshFromDB();

    const mine = store.getSnapshot().statuses.sh!;
    expect(mine).toEqual({
      ...dbRow,
      lastStartedAt: memory.lastStartedAt,
    });
    expect(meta.get(MY_STATUS_KEY)).toEqual(mine);
    expect(meta.get(MY_STATUS_KEY)).not.toEqual(dbRow);
  });
});
