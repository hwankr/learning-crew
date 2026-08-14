import { describe, expect, it } from 'vitest';
import type { PhotoBlobRecord, PhotoUploadState } from './idb';
import {
  PhotoUploadQueue,
  combinedUploadPercent,
  type PhotoUploadEnvironment,
  type PhotoUploadStorage,
  type PhotoUploadTransport,
} from './photoUpload';

class MemoryPhotos implements PhotoUploadStorage {
  readonly rows = new Map<string, PhotoBlobRecord>();
  readonly transitions: { id: string; state: PhotoUploadState; pct: number }[] = [];

  listPhotoUploads() {
    return [...this.rows].map(([id, row]) => ({ id, ...row }));
  }

  getPhotoUpload(id: string) {
    return this.rows.get(id);
  }

  setPhotoUploadState(id: string, state: PhotoUploadState, pct: number) {
    const row = this.rows.get(id);
    if (!row) return;
    this.rows.set(id, { ...row, state, pct });
    this.transitions.push({ id, state, pct });
  }
}

class OnlineSwitch implements PhotoUploadEnvironment {
  private listeners = { online: new Set<() => void>(), offline: new Set<() => void>() };

  constructor(private online: boolean) {}

  isOnline = () => this.online;
  addEventListener = (type: 'online' | 'offline', fn: () => void) => this.listeners[type].add(fn);
  removeEventListener = (type: 'online' | 'offline', fn: () => void) => this.listeners[type].delete(fn);

  set(online: boolean): void {
    this.online = online;
    for (const fn of this.listeners[online ? 'online' : 'offline']) fn();
  }
}

function row(state: PhotoUploadState): PhotoBlobRecord {
  return {
    full: new Blob([new Uint8Array(900)]),
    thumb: new Blob([new Uint8Array(100)]),
    state,
    pct: 0,
    entryId: 'entry-1',
    addedAt: 1,
  };
}

describe('combinedUploadPercent', () => {
  it('thumb와 full의 실제 바이트를 합산한다', () => {
    expect(combinedUploadPercent(100, 900, 100, 0)).toBe(10);
    expect(combinedUploadPercent(100, 900, 100, 450)).toBe(55);
  });
});

describe('PhotoUploadQueue', () => {
  it('오프라인의 up을 wait로 내렸다가 online에서 thumb→full 순으로 직렬 재개한다', async () => {
    const photos = new MemoryPhotos();
    photos.rows.set('p1', row('up'));
    photos.rows.set('p2', row('wait'));
    const online = new OnlineSwitch(false);
    const calls: string[] = [];
    const transport: PhotoUploadTransport = async (id, kind, blob, _token, progress) => {
      calls.push(`${id}:${kind}`);
      progress(blob.size);
    };
    const queue = new PhotoUploadQueue(photos, {
      token: 'token', demo: false, environment: online, transport,
    });

    queue.start();
    expect(photos.rows.get('p1')?.state).toBe('wait');
    expect(photos.rows.get('p2')?.state).toBe('wait');

    online.set(true);
    await queue.whenIdle();
    expect(calls).toEqual(['p1:thumb', 'p1:full', 'p2:thumb', 'p2:full']);
    expect(photos.rows.get('p1')).toMatchObject({ state: 'done', pct: 100 });
    expect(photos.rows.get('p2')).toMatchObject({ state: 'done', pct: 100 });
    queue.stop();
  });

  it('실패는 자동 재시도하지 않고 fail→retryPhoto에서만 다시 시작한다', async () => {
    const photos = new MemoryPhotos();
    photos.rows.set('p1', row('wait'));
    const online = new OnlineSwitch(true);
    let fail = true;
    const calls: string[] = [];
    const transport: PhotoUploadTransport = async (_id, kind, blob, _token, progress) => {
      calls.push(kind);
      progress(blob.size / 2);
      if (fail) throw new Error('network');
      progress(blob.size);
    };
    const queue = new PhotoUploadQueue(photos, {
      token: 'token', demo: false, environment: online, transport,
    });

    queue.start();
    await queue.whenIdle();
    expect(photos.rows.get('p1')?.state).toBe('fail');
    expect(calls).toEqual(['thumb']);

    fail = false;
    expect(queue.retryPhoto('p1')).toBe(true);
    await queue.whenIdle();
    expect(calls).toEqual(['thumb', 'thumb', 'full']);
    expect(photos.rows.get('p1')).toMatchObject({ state: 'done', pct: 100 });
    expect(queue.retryPhoto('p1')).toBe(false);
    queue.stop();
  });

  it('전송 중 offline 이벤트는 XHR을 끊고 wait로 보낸 뒤 online에서 처음부터 재개한다', async () => {
    const photos = new MemoryPhotos();
    photos.rows.set('p1', row('wait'));
    const online = new OnlineSwitch(true);
    const calls: string[] = [];
    let announceStart!: () => void;
    const started = new Promise<void>((resolve) => {
      announceStart = resolve;
    });
    const transport: PhotoUploadTransport = (id, kind, blob, _token, progress, signal) => {
      calls.push(`${id}:${kind}`);
      if (calls.length === 1) {
        announceStart();
        return new Promise<void>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        });
      }
      progress(blob.size);
      return Promise.resolve();
    };
    const queue = new PhotoUploadQueue(photos, {
      token: 'token', demo: false, environment: online, transport,
    });

    queue.start();
    await started;
    online.set(false);
    await queue.whenIdle();
    expect(photos.rows.get('p1')?.state).toBe('wait');

    online.set(true);
    await queue.whenIdle();
    expect(calls).toEqual(['p1:thumb', 'p1:thumb', 'p1:full']);
    expect(photos.rows.get('p1')).toMatchObject({ state: 'done', pct: 100 });
    queue.stop();
  });

  it('abort 정산 전 즉시 재연결돼도 다음 online 이벤트 없이 재큐잉한다', async () => {
    const photos = new MemoryPhotos();
    photos.rows.set('p1', row('wait'));
    const online = new OnlineSwitch(true);
    const calls: string[] = [];
    let announceStart!: () => void;
    let announceAbort!: () => void;
    let rejectFirst!: (error: Error) => void;
    const started = new Promise<void>((resolve) => {
      announceStart = resolve;
    });
    const abortObserved = new Promise<void>((resolve) => {
      announceAbort = resolve;
    });
    const transport: PhotoUploadTransport = (id, kind, blob, _token, progress, signal) => {
      calls.push(`${id}:${kind}`);
      if (calls.length === 1) {
        announceStart();
        return new Promise<void>((_resolve, reject) => {
          rejectFirst = reject;
          // 실제 XHR의 onabort/catch 정산을 의도적으로 늦춰 이벤트 경합을 만든다.
          signal.addEventListener('abort', announceAbort, { once: true });
        });
      }
      progress(blob.size);
      return Promise.resolve();
    };
    const queue = new PhotoUploadQueue(photos, {
      token: 'token', demo: false, environment: online, transport,
    });

    queue.start();
    await started;
    online.set(false);
    await abortObserved;
    online.set(true); // 아직 active라 onOnline의 enqueueReady는 같은 id를 건너뛴다.
    rejectFirst(new Error('aborted'));

    await queue.whenIdle();
    expect(calls).toEqual(['p1:thumb', 'p1:thumb', 'p1:full']);
    expect(photos.rows.get('p1')).toMatchObject({ state: 'done', pct: 100 });
    queue.stop();
  });

  it('데모 모드는 전송 없이 즉시 done으로 끝낸다', async () => {
    const photos = new MemoryPhotos();
    photos.rows.set('p1', row('wait'));
    const online = new OnlineSwitch(true);
    const transport: PhotoUploadTransport = async () => {
      throw new Error('데모에서 호출되면 안 됨');
    };
    const queue = new PhotoUploadQueue(photos, {
      token: null, demo: true, environment: online, transport,
    });
    queue.start();
    await queue.whenIdle();
    expect(photos.rows.get('p1')).toMatchObject({ state: 'done', pct: 100 });
    queue.stop();
  });
});
