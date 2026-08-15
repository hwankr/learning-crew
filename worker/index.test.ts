import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeToken } from './auth';

const mocks = vi.hoisted(() => ({
  hasPhotoTombstone: vi.fn(async (_db: unknown, _photoId: string, _owner: string) => true),
  rearmPhotoTombstone: vi.fn(async (
    _db: unknown,
    _photoId: string,
    _owner: string,
  ) => null as {
    photoId: string;
    owner: string;
    cleanupGeneration: number;
  } | null),
  put: vi.fn(),
}));

vi.mock('@neondatabase/serverless', () => ({ neon: () => ({}) }));
vi.mock('drizzle-orm/neon-http', () => ({ drizzle: () => ({}) }));
vi.mock('./queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./queries')>()),
  hasPhotoTombstone: mocks.hasPhotoTombstone,
  rearmPhotoTombstone: mocks.rearmPhotoTombstone,
}));

import worker from './index';

describe('PUT /api/photos/:photoId', () => {
  beforeEach(() => {
    mocks.hasPhotoTombstone.mockReset();
    mocks.rearmPhotoTombstone.mockReset();
    mocks.put.mockReset();
    mocks.hasPhotoTombstone.mockResolvedValue(true);
    mocks.rearmPhotoTombstone.mockResolvedValue(null);
  });

  it('톰스톤 뒤에 도착한 업로드를 R2에 쓰기 전 410으로 거부한다', async () => {
    const secret = 'test-secret';
    const token = await makeToken('sh', secret);
    const photoId = 'f1111111-1111-4111-8111-111111111111';
    const request = new Request(`https://example.test/api/photos/${photoId}?kind=full`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'image/jpeg',
      },
      body: new Uint8Array([1, 2, 3]),
    });
    const env = {
      DATABASE_URL: 'postgres://unused',
      AUTH_SECRET: secret,
      PHOTOS: { put: mocks.put },
    };

    const response = await worker.fetch(request, env as never, {} as ExecutionContext);

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual({ error: 'photo was removed' });
    expect(mocks.hasPhotoTombstone).toHaveBeenCalledWith({}, photoId, 'sh');
    expect(mocks.put).not.toHaveBeenCalled();
  });

  it('다른 멤버의 tombstone은 소유자의 PUT을 막지 않는다', async () => {
    const secret = 'test-secret';
    const token = await makeToken('sh', secret);
    const photoId = 'f1111111-1111-4111-8111-111111111112';
    const head = vi.fn(async () => null);
    const remove = vi.fn(async () => {});
    mocks.hasPhotoTombstone.mockImplementation(async (_db, _id, owner) => owner === 'wg');
    mocks.put.mockResolvedValue({ httpEtag: '"etag-owner"' });
    const request = new Request(`https://example.test/api/photos/${photoId}?kind=full`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'image/jpeg',
      },
      body: new Uint8Array([1, 2, 3]),
    });
    const env = {
      DATABASE_URL: 'postgres://unused',
      AUTH_SECRET: secret,
      PHOTOS: { head, put: mocks.put, delete: remove },
    };

    const response = await worker.fetch(request, env as never, {} as ExecutionContext);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, etag: '"etag-owner"' });
    expect(mocks.hasPhotoTombstone).toHaveBeenCalledWith({}, photoId, 'sh');
    expect(mocks.rearmPhotoTombstone).toHaveBeenCalledWith({}, photoId, 'sh');
    expect(remove).not.toHaveBeenCalled();
  });

  it('사전 검사 뒤 생긴 tombstone은 post-put에서 rearm하고 객체를 지운 뒤 410을 반환한다', async () => {
    const secret = 'test-secret';
    const token = await makeToken('sh', secret);
    const photoId = 'f2222222-2222-4222-8222-222222222222';
    const head = vi.fn(async () => null);
    const remove = vi.fn(async () => {});
    mocks.hasPhotoTombstone.mockResolvedValue(false);
    mocks.rearmPhotoTombstone.mockResolvedValue({ photoId, owner: 'sh', cleanupGeneration: 1 });
    mocks.put.mockResolvedValue({ httpEtag: '"etag-1"' });
    const request = new Request(`https://example.test/api/photos/${photoId}?kind=thumb`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'image/jpeg',
      },
      body: new Uint8Array([1, 2, 3]),
    });
    const env = {
      DATABASE_URL: 'postgres://unused',
      AUTH_SECRET: secret,
      PHOTOS: { head, put: mocks.put, delete: remove },
    };

    const response = await worker.fetch(request, env as never, {} as ExecutionContext);

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual({ error: 'photo was removed' });
    expect(mocks.hasPhotoTombstone).toHaveBeenCalledWith({}, photoId, 'sh');
    expect(mocks.put).toHaveBeenCalledOnce();
    expect(mocks.rearmPhotoTombstone).toHaveBeenCalledWith({}, photoId, 'sh');
    expect(remove).toHaveBeenCalledWith(`p/${photoId}.t`);
    expect(mocks.put.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.rearmPhotoTombstone.mock.invocationCallOrder[0]!,
    );
  });

  it('post-put rearm DB 호출이 실패하면 방금 쓴 객체를 지우고 410을 반환한다', async () => {
    const secret = 'test-secret';
    const token = await makeToken('sh', secret);
    const photoId = 'f3333333-3333-4333-8333-333333333333';
    const head = vi.fn(async () => null);
    const remove = vi.fn(async () => {});
    mocks.hasPhotoTombstone.mockResolvedValue(false);
    mocks.rearmPhotoTombstone.mockRejectedValue(new Error('database unavailable'));
    mocks.put.mockResolvedValue({ httpEtag: '"etag-2"' });
    const request = new Request(`https://example.test/api/photos/${photoId}?kind=full`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'image/jpeg',
      },
      body: new Uint8Array([1, 2, 3]),
    });
    const env = {
      DATABASE_URL: 'postgres://unused',
      AUTH_SECRET: secret,
      PHOTOS: { head, put: mocks.put, delete: remove },
    };

    const response = await worker.fetch(request, env as never, {} as ExecutionContext);

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual({ error: 'photo was removed' });
    expect(mocks.rearmPhotoTombstone).toHaveBeenCalledWith({}, photoId, 'sh');
    expect(remove).toHaveBeenCalledWith(`p/${photoId}`);
  });

  it('post-put rearm과 보수적 delete가 모두 실패해도 410과 구조화 로그를 남긴다', async () => {
    const secret = 'test-secret';
    const token = await makeToken('sh', secret);
    const photoId = 'f4444444-4444-4444-8444-444444444444';
    const head = vi.fn(async () => null);
    const remove = vi.fn(async () => {
      throw new Error('R2 delete unavailable');
    });
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.hasPhotoTombstone.mockResolvedValue(false);
    mocks.rearmPhotoTombstone.mockRejectedValue(new Error('database unavailable'));
    mocks.put.mockResolvedValue({ httpEtag: '"etag-3"' });
    const request = new Request(`https://example.test/api/photos/${photoId}?kind=thumb`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'image/jpeg',
      },
      body: new Uint8Array([1, 2, 3]),
    });
    const env = {
      DATABASE_URL: 'postgres://unused',
      AUTH_SECRET: secret,
      PHOTOS: { head, put: mocks.put, delete: remove },
    };

    try {
      const response = await worker.fetch(request, env as never, {} as ExecutionContext);

      expect(response.status).toBe(410);
      await expect(response.json()).resolves.toEqual({ error: 'photo was removed' });
      expect(remove).toHaveBeenCalledWith(`p/${photoId}.t`);
      expect(errorLog).toHaveBeenCalledOnce();
      expect(JSON.parse(String(errorLog.mock.calls[0]![0]))).toEqual({
        message: 'post-put tombstone rearm and delete failed',
        rearmError: 'database unavailable',
        deleteError: 'R2 delete unavailable',
        photoId,
        kind: 'thumb',
      });
    } finally {
      errorLog.mockRestore();
    }
  });
});
