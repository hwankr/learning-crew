import { describe, expect, it } from 'vitest';
import type { Entry, EntryPhoto } from '../../shared/types';
import type { PreparedUpload } from '../lib/image';
import { CrewStore, PhotoLimitError } from './store';

const ENTRY_ID = '11111111-1111-4111-8111-111111111111';
const NEW_ENTRY_ID = '44444444-4444-4444-8444-444444444444';
const PHOTO_1 = '22222222-2222-4222-8222-222222222222';
const PHOTO_2 = '33333333-3333-4333-8333-333333333333';
const MISSING_PHOTO = '55555555-5555-4555-8555-555555555555';

function prepared(w = 1600, h = 900): PreparedUpload {
  return {
    full: new Blob(['full'], { type: 'image/jpeg' }),
    thumb: new Blob(['thumb'], { type: 'image/jpeg' }),
    w,
    h,
  };
}

function entry(photos: EntryPhoto[], partial: Partial<Entry> = {}): Entry {
  return {
    id: ENTRY_ID,
    m: 'sh',
    day: '2026-08-15',
    time: '08:00',
    tag: '영어',
    tags: ['영어'],
    stars: 4,
    memo: '',
    body: '공부',
    todos: [],
    photos,
    v: 0,
    updatedAt: '2026-08-15T00:00:00.000Z',
    deletedAt: null,
    ...partial,
  };
}

/** refreshFromDB가 읽는 IDB 스냅샷만 최소한으로 구현한다. 쓰기 트랜잭션은
    즉시 성공으로 정산해, 테스트가 보려는 "다른 탭의 Entry 채택" 규칙에만 초점을 맞춘다. */
function refreshDatabase(entries: Entry[], photos: [string, ReturnType<CrewStore['getPhotoUpload']>][]) {
  const values: Record<string, unknown[]> = {
    entries,
    queue: [],
    comments: [],
    commentQueue: [],
    reactions: [],
    reactionQueue: [],
    notifications: [],
    notifReadQueue: [],
    photoBlobs: photos.map(([, row]) => row).filter((row) => row !== undefined),
    meta: [],
  };
  const keys: Record<string, string[]> = {
    queue: [],
    commentQueue: [],
    reactionQueue: [],
    notifReadQueue: [],
    photoBlobs: photos.map(([id]) => id),
  };
  return {
    transaction: () => ({
      done: Promise.resolve(),
      objectStore: (name: string) => ({
        getAll: () => Promise.resolve(values[name] ?? []),
        getAllKeys: () => Promise.resolve(keys[name] ?? []),
        get: () => Promise.resolve(undefined),
        put: () => Promise.resolve(),
        delete: () => Promise.resolve(),
      }),
    }),
  };
}

function installRefreshDatabase(
  store: CrewStore,
  entries: Entry[],
  photos: [string, ReturnType<CrewStore['getPhotoUpload']>][],
): void {
  (store as unknown as { db: unknown }).db = refreshDatabase(entries, photos);
}

describe('CrewStore 사진 blob 수명', () => {
  it('초안에서 제거하면 메모리 폴백의 full/thumb와 상태가 함께 사라진다', () => {
    const store = new CrewStore();
    store.addPreparedPhoto(ENTRY_ID, prepared(), PHOTO_1);
    expect(store.getLocalPhotoBlob(PHOTO_1, 'full')).toBeInstanceOf(Blob);
    expect(store.getSnapshot().photoUploads.get(PHOTO_1)?.state).toBe('wait');

    store.removeDraftPhoto(PHOTO_1);
    expect(store.getLocalPhotoBlob(PHOTO_1, 'full')).toBeNull();
    expect(store.getSnapshot().photoUploads.has(PHOTO_1)).toBe(false);
  });

  it('상태 변경은 기존 store 구독을 깨우고 photoId별 pct를 새 스냅샷에 싣는다', () => {
    const store = new CrewStore();
    store.addPreparedPhoto(ENTRY_ID, prepared(), PHOTO_1);
    let notified = 0;
    const unsubscribe = store.subscribe(() => {
      notified += 1;
    });

    store.setPhotoUploadState(PHOTO_1, 'up', 42.4);
    expect(notified).toBe(1);
    expect(store.getSnapshot().photoUploads.get(PHOTO_1)).toEqual({ state: 'up', pct: 42 });
    unsubscribe();
  });

  it('IDB가 없어도 내려받은 blob을 세션 메모리 캐시에서 다시 준다', async () => {
    const store = new CrewStore();
    const blob = new Blob(['remote'], { type: 'image/jpeg' });
    await store.cachePhotoBlob(PHOTO_1, 'thumb', blob);
    expect(await store.getCachedPhotoBlob(PHOTO_1, 'thumb')).toBe(blob);
  });

  it('데이터 경계에서도 기록당 네 장을 넘겨 orphan blob을 만들지 않는다', () => {
    const store = new CrewStore();
    const ids = [
      '10000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000002',
      '10000000-0000-4000-8000-000000000003',
      '10000000-0000-4000-8000-000000000004',
      '10000000-0000-4000-8000-000000000005',
    ];
    for (const id of ids.slice(0, 4)) store.addPreparedPhoto(ENTRY_ID, prepared(), id);
    expect(() => store.addPreparedPhoto(ENTRY_ID, prepared(), ids[4])).toThrow(PhotoLimitError);
    expect(store.getSnapshot().photoUploads.size).toBe(4);
  });

  it('시트에서 뺀(로컬 보관) 사진은 네 장 경계에서 빠져 그 자리를 다시 채울 수 있다', () => {
    // 오프라인·실패 사진은 로컬 JPEG가 유일본이라 취소 복구를 위해 남겨 둔다.
    // 그 blob을 계속 세면 3/4 화면에서도 교체가 PhotoLimitError로 막힌다.
    const store = new CrewStore();
    const ids = [
      '10000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000002',
      '10000000-0000-4000-8000-000000000003',
      '10000000-0000-4000-8000-000000000004',
    ];
    const saved = ids.map((id) => store.addPreparedPhoto(ENTRY_ID, prepared(), id));
    store.upsert(entry(saved));

    const sheet = saved.slice(1); // 첫 장을 시트에서 뺐다(아직 못 올린 사진이라 blob은 남긴다)
    const replacement = '10000000-0000-4000-8000-000000000009';
    expect(() => store.addPreparedPhoto(ENTRY_ID, prepared(), replacement, sheet))
      .toThrow(PhotoLimitError);

    store.detachDraftPhoto(saved[0]!.id);
    const next = store.addPreparedPhoto(ENTRY_ID, prepared(), replacement, sheet);
    expect(store.getLocalPhotoBlob(replacement, 'full')).toBeInstanceOf(Blob);
    // 취소 복구용 원본은 저장 전까지 그대로 남아 있다
    expect(store.getLocalPhotoBlob(saved[0]!.id, 'full')).toBeInstanceOf(Blob);

    // 저장하면 빠진 사진은 참조가 끊겨 정리되고, 남은 넷이 최종 참조다
    store.upsert({ ...entry([...sheet, next]), updatedAt: '2026-08-15T00:01:00.000Z' });
    expect(store.getLocalPhotoBlob(saved[0]!.id, 'full')).toBeNull();
    expect(store.getById(ENTRY_ID)?.photos.map((p) => p.id))
      .toEqual([...sheet.map((p) => p.id), replacement]);
  });

  it('뺐다가 되돌아온 사진은 다시 한 장으로 센다', () => {
    const store = new CrewStore();
    const p1 = store.addPreparedPhoto(ENTRY_ID, prepared(), PHOTO_1);
    store.upsert(entry([p1]));
    store.detachDraftPhoto(PHOTO_1);
    // 취소하고 그대로 저장하면 다시 이 기록의 사진이다 — 자리 계산에서도 되살아난다
    store.upsert({ ...entry([p1]), body: '취소 후 저장', updatedAt: '2026-08-15T00:01:00.000Z' });

    const ids = [
      '10000000-0000-4000-8000-000000000002',
      '10000000-0000-4000-8000-000000000003',
      '10000000-0000-4000-8000-000000000004',
    ];
    for (const id of ids) store.addPreparedPhoto(ENTRY_ID, prepared(), id);
    expect(() => store.addPreparedPhoto(ENTRY_ID, prepared(), MISSING_PHOTO))
      .toThrow(PhotoLimitError);
  });

  it('save/edit은 유지·추가 사진을 보존하고 빠진 사진 blob만 정리한다', () => {
    const store = new CrewStore();
    const p1 = store.addPreparedPhoto(ENTRY_ID, prepared(), PHOTO_1);
    expect(store.listPhotoUploads()).toHaveLength(0); // 시트에서 고르기만 한 동안은 R2 큐 밖
    store.upsert(entry([p1]));
    expect(store.listPhotoUploads()).toHaveLength(1);
    expect(store.getById(ENTRY_ID)?.photos).toEqual([p1]);

    const p2 = store.addPreparedPhoto(ENTRY_ID, prepared(900, 1600), PHOTO_2);
    store.upsert({
      ...entry([p1, p2]),
      body: '수정',
      updatedAt: '2026-08-15T00:01:00.000Z',
    });
    expect(store.getLocalPhotoBlob(PHOTO_1, 'thumb')).toBeInstanceOf(Blob);
    expect(store.getLocalPhotoBlob(PHOTO_2, 'thumb')).toBeInstanceOf(Blob);

    store.upsert({
      ...entry([p2]),
      updatedAt: '2026-08-15T00:02:00.000Z',
    });
    expect(store.getLocalPhotoBlob(PHOTO_1, 'thumb')).toBeNull();
    expect(store.getLocalPhotoBlob(PHOTO_2, 'thumb')).toBeInstanceOf(Blob);
    expect(store.getById(ENTRY_ID)?.photos).toEqual([p2]);
  });

  it('기록을 삭제하면 그 기록에 연결된 photoBlobs를 전부 정리한다', () => {
    const store = new CrewStore();
    const p1 = store.addPreparedPhoto(ENTRY_ID, prepared(), PHOTO_1);
    const p2 = store.addPreparedPhoto(ENTRY_ID, prepared(), PHOTO_2);
    store.upsert(entry([p1, p2]));

    store.remove(ENTRY_ID);
    expect(store.getLocalPhotoBlob(PHOTO_1, 'full')).toBeNull();
    expect(store.getLocalPhotoBlob(PHOTO_2, 'full')).toBeNull();
    expect(store.getSnapshot().photoUploads.size).toBe(0);
  });

  it('멤버 전환 뒤에는 이전 멤버 Entry의 사진을 업로드 큐·상태 구독에서 제외한다', async () => {
    const store = new CrewStore();
    const p1 = store.addPreparedPhoto(ENTRY_ID, prepared(), PHOTO_1);
    store.upsert(entry([p1]));
    expect(store.listPhotoUploads().map((photo) => photo.id)).toEqual([PHOTO_1]);
    expect(store.getSnapshot().photoUploads.has(PHOTO_1)).toBe(true);

    await store.init({ demo: true, memberId: 'jj', token: null });

    expect(store.listPhotoUploads()).toEqual([]);
    expect(store.getSnapshot().photoUploads.has(PHOTO_1)).toBe(false);
    expect(store.getPhotoUploadStatus(PHOTO_1)).toBeNull();
  });

  it('원격 삭제 중에도 활성 수정 초안 blob을 pin하고 살리기 시 새 photoId로 복제한다', () => {
    const store = new CrewStore();
    const p1 = store.addPreparedPhoto(ENTRY_ID, prepared(), PHOTO_1);
    store.upsert(entry([p1]));
    store.ackApplied(ENTRY_ID, 1, entry([p1], { v: 1 }));
    const p2 = store.addPreparedPhoto(ENTRY_ID, prepared(900, 1600), PHOTO_2);
    store.setActiveDraftPhotoIds([p1.id, p2.id]);

    store.applyPull({
      rows: [entry([p1], {
        v: 2,
        updatedAt: '2026-08-15T00:02:00.000Z',
        deletedAt: '2026-08-15T00:02:00.000Z',
      })],
      cursor: null,
    });

    expect(store.getById(ENTRY_ID)).toBeUndefined();
    expect(store.getLocalPhotoBlob(PHOTO_1, 'full')).toBeInstanceOf(Blob);
    expect(store.getLocalPhotoBlob(PHOTO_2, 'full')).toBeInstanceOf(Blob);

    const revived = store.cloneDraftPhotosForEntry(
      [p1, p2, { id: MISSING_PHOTO, w: 400, h: 400 }],
      NEW_ENTRY_ID,
    );
    expect(revived).toHaveLength(2);
    expect(revived.map((photo) => photo.id)).not.toContain(PHOTO_1);
    expect(revived.map((photo) => photo.id)).not.toContain(PHOTO_2);
    for (const photo of revived) {
      expect(store.getLocalPhotoBlob(photo.id, 'full')).toBeInstanceOf(Blob);
      expect(store.getPhotoUpload(photo.id)).toMatchObject({ state: 'wait', pct: 0 });
    }

    store.upsert(entry(revived, { id: NEW_ENTRY_ID }));
    store.setActiveDraftPhotoIds([]);
    expect(store.getLocalPhotoBlob(PHOTO_1, 'full')).toBeNull();
    expect(store.getLocalPhotoBlob(PHOTO_2, 'full')).toBeNull();
    expect(store.listPhotoUploads().map((photo) => photo.id).sort()).toEqual(
      revived.map((photo) => photo.id).sort(),
    );
  });

  it('CAS 병합이 서버의 photos 삭제를 채택하면 재전송 전에 blob을 정리한다', () => {
    const store = new CrewStore();
    const p1 = store.addPreparedPhoto(ENTRY_ID, prepared(), PHOTO_1);
    const base = entry([p1], { v: 1 });
    store.applyPull({ rows: [base], cursor: null });
    store.upsert({
      ...base,
      body: '로컬 본문',
      updatedAt: '2026-08-15T00:01:00.000Z',
    });

    store.resolveConflict(ENTRY_ID, {
      ...base,
      photos: [],
      v: 2,
      updatedAt: '2026-08-15T00:02:00.000Z',
    });

    expect(store.getById(ENTRY_ID)?.body).toBe('로컬 본문');
    expect(store.getById(ENTRY_ID)?.photos).toEqual([]);
    expect(store.getLocalPhotoBlob(PHOTO_1, 'full')).toBeNull();
    expect(store.pendingIds()).toContain(ENTRY_ID);
  });

  it('다른 탭의 photos 삭제를 refreshFromDB로 채택할 때 이전 blob 행을 다시 살리지 않는다', async () => {
    const store = new CrewStore();
    const p1 = store.addPreparedPhoto(ENTRY_ID, prepared(), PHOTO_1);
    const base = entry([p1], { v: 1 });
    store.applyPull({ rows: [base], cursor: null });
    const photoRow = store.getPhotoUpload(PHOTO_1);
    installRefreshDatabase(
      store,
      [entry([], { v: 2, updatedAt: '2026-08-15T00:02:00.000Z' })],
      [[PHOTO_1, photoRow]],
    );

    await store.refreshFromDB();

    expect(store.getById(ENTRY_ID)?.photos).toEqual([]);
    expect(store.getLocalPhotoBlob(PHOTO_1, 'full')).toBeNull();
  });

  it('다른 탭이 tombstone ACK로 Entry 행을 지운 경우도 refreshFromDB가 blob을 함께 정리한다', async () => {
    const store = new CrewStore();
    const p1 = store.addPreparedPhoto(ENTRY_ID, prepared(), PHOTO_1);
    const base = entry([p1], { v: 1 });
    store.applyPull({ rows: [base], cursor: null });
    const photoRow = store.getPhotoUpload(PHOTO_1);
    installRefreshDatabase(store, [], [[PHOTO_1, photoRow]]);

    await store.refreshFromDB();

    expect(store.getById(ENTRY_ID)).toBeUndefined();
    expect(store.getLocalPhotoBlob(PHOTO_1, 'full')).toBeNull();
  });

  it('데모 모드는 네트워크 큐 없이 로컬 사진을 즉시 done으로 둔다', async () => {
    const store = new CrewStore();
    await store.init({ demo: true, memberId: 'sh', token: null });
    store.addPreparedPhoto(ENTRY_ID, prepared(), PHOTO_1);
    expect(store.getSnapshot().photoUploads.get(PHOTO_1)).toEqual({ state: 'done', pct: 100 });
  });
});
