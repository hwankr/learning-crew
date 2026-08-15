import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Entry, PullResponse } from '../../shared/types';
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
