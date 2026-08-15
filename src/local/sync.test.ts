import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Entry, PullResponse, TagPrefsPutResponse, TagPrefsResponse } from '../../shared/types';
import * as photoRequests from '../lib/usePhoto';
import { CrewStore } from './store';
import { SyncClient } from './sync';

const ENTRY_ID = '11111111-1111-4111-8111-111111111111';

function entry(v: number): Entry {
  return {
    id: ENTRY_ID,
    m: 'sh',
    day: '2026-08-15',
    time: '08:00',
    tag: '영어',
    tags: ['영어'],
    stars: 4,
    memo: '',
    body: `공부 ${v}`,
    todos: [],
    photos: [{ id: '22222222-2222-4222-8222-222222222222', w: 120, h: 80 }],
    v,
    updatedAt: `2026-08-15T00:00:0${v}.000Z`,
    deletedAt: null,
  };
}

async function pull(client: SyncClient): Promise<void> {
  await (client as unknown as { pull(): Promise<void> }).pull();
}

async function syncTagPrefs(client: SyncClient): Promise<void> {
  await (client as unknown as { syncTagPrefs(): Promise<void> }).syncTagPrefs();
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('SyncClient photo pull rearm', () => {
  it('안전 지평선의 동일 행 재전달은 무시하고 실제 새 Entry 메타만 재무장한다', async () => {
    const store = new CrewStore();
    const client = new SyncClient(store, 'token', 'sh');
    let row = entry(1);
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async (): Promise<PullResponse> => ({
        rows: [row],
        cursor: null,
        statuses: [],
      }),
    }) as Response);
    vi.stubGlobal('fetch', fetchMock);
    const rearm = vi.spyOn(photoRequests, 'rearmMissingPhotosAfterPull');

    await pull(client);
    expect(rearm).toHaveBeenCalledTimes(1);

    await pull(client);
    expect(rearm).toHaveBeenCalledTimes(1);

    row = entry(2);
    await pull(client);
    expect(rearm).toHaveBeenCalledTimes(2);
  });
});

describe('SyncClient 태그 prefs 재시도', () => {
  it('추가 PUT 실패는 dirty를 보류하고 다음 기회에 재전송하며 삭제도 빈 목록으로 전송한다', async () => {
    const store = new CrewStore();
    const client = new SyncClient(store, 'token', 'sh');
    store.setCustomTags(['수학']);
    const first = store.myTagPrefsPending()!;

    const fetchMock = vi.fn();
    fetchMock.mockRejectedValueOnce(new TypeError('offline'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(syncTagPrefs(client)).rejects.toThrow('offline');
    expect(store.myTagPrefsPending()?.updatedAt).toBe(first.updatedAt);
    expect(store.getSnapshot().customTags).toEqual(['수학']);

    fetchMock.mockImplementationOnce(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { tags: string[]; at: string };
      return new Response(JSON.stringify({
        ok: true,
        applied: true,
        prefs: { m: 'sh', tags: body.tags, updatedAt: body.at },
      } satisfies TagPrefsPutResponse), { status: 200 });
    });
    await syncTagPrefs(client);
    expect(store.myTagPrefsPending()).toBeNull();

    store.setCustomTags([]);
    const removed = store.myTagPrefsPending()!;
    fetchMock.mockImplementationOnce(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { tags: string[]; at: string };
      expect(body).toEqual({ tags: [], at: removed.updatedAt });
      return new Response(JSON.stringify({
        ok: true,
        applied: true,
        prefs: { m: 'sh', tags: [], updatedAt: body.at },
      } satisfies TagPrefsPutResponse), { status: 200 });
    });
    await syncTagPrefs(client);
    expect(store.getSnapshot().customTags).toEqual([]);
    expect(store.myTagPrefsPending()).toBeNull();
  });

  it('dirty가 없으면 GET으로 서버의 더 새 prefs를 캐시에 반영한다', async () => {
    const store = new CrewStore();
    const client = new SyncClient(store, 'token', 'sh');
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      prefs: { m: 'sh', tags: ['알고리즘', ' 수학 '], updatedAt: '2026-08-15T03:00:00.000Z' },
    } satisfies TagPrefsResponse), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await syncTagPrefs(client);
    expect(fetchMock).toHaveBeenCalledWith('/api/tags/prefs', expect.objectContaining({
      headers: expect.objectContaining({ authorization: 'Bearer token' }),
    }));
    expect(store.getSnapshot().customTags).toEqual(['수학', '알고리즘']);
    expect(store.myTagPrefsPending()).toBeNull();
  });
});
