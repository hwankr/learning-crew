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
  getTagPrefs: vi.fn(async (_db: unknown, m: string) => ({
    m,
    tags: [] as string[],
    updatedAt: '1970-01-01T00:00:00.000Z',
  })),
  pullSince: vi.fn(async () => ({ rows: [], cursor: null })),
  allStatuses: vi.fn(async () => []),
  pullComments: vi.fn(async () => ({ rows: [], cursor: null })),
  pullReactions: vi.fn(async () => ({ rows: [], cursor: null })),
  pullNotifications: vi.fn(async () => ({ rows: [], cursor: null })),
  pullPosts: vi.fn(async () => ({ rows: [], cursor: null })),
  pullPostComments: vi.fn(async () => ({ rows: [], cursor: null })),
  putTagPrefs: vi.fn(async (
    _db: unknown,
    m: string,
    p: { tags: string[]; at: string },
  ) => ({
    applied: true,
    prefs: { m, tags: p.tags, updatedAt: p.at },
  })),
  put: vi.fn(),
}));

vi.mock('@neondatabase/serverless', () => ({ neon: () => ({}) }));
vi.mock('drizzle-orm/neon-http', () => ({ drizzle: () => ({}) }));
vi.mock('./queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./queries')>()),
  hasPhotoTombstone: mocks.hasPhotoTombstone,
  rearmPhotoTombstone: mocks.rearmPhotoTombstone,
  getTagPrefs: mocks.getTagPrefs,
  putTagPrefs: mocks.putTagPrefs,
  pullSince: mocks.pullSince,
  allStatuses: mocks.allStatuses,
  pullComments: mocks.pullComments,
  pullReactions: mocks.pullReactions,
  pullNotifications: mocks.pullNotifications,
  pullPosts: mocks.pullPosts,
  pullPostComments: mocks.pullPostComments,
}));

import worker from './index';

describe('GET/PUT /api/tags/prefs', () => {
  const secret = 'test-secret';
  const env = { DATABASE_URL: 'postgres://unused', AUTH_SECRET: secret };

  beforeEach(() => {
    mocks.getTagPrefs.mockReset();
    mocks.putTagPrefs.mockReset();
    mocks.getTagPrefs.mockImplementation(async (_db, m) => ({
      m,
      tags: [],
      updatedAt: '1970-01-01T00:00:00.000Z',
    }));
    mocks.putTagPrefs.mockImplementation(async (_db, m, p) => ({
      applied: true,
      prefs: { m, tags: p.tags, updatedAt: p.at },
    }));
  });

  it('인증된 멤버의 행이 없으면 GET 기본값을 그대로 돌려준다', async () => {
    const token = await makeToken('sh', secret);
    const response = await worker.fetch(
      new Request('https://example.test/api/tags/prefs', {
        headers: { Authorization: `Bearer ${token}` },
      }),
      env as never,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      prefs: { m: 'sh', tags: [], updatedAt: '1970-01-01T00:00:00.000Z' },
    });
    expect(mocks.getTagPrefs).toHaveBeenCalledWith({}, 'sh');
  });

  it('태그를 공용 규칙으로 재검증하고 미래 액션 시각은 서버 시각으로 캡한다', async () => {
    vi.useFakeTimers();
    vi.setSystemTime('2026-08-15T12:00:00.000Z');
    try {
      const token = await makeToken('wg', secret);
      const response = await worker.fetch(
        new Request('https://example.test/api/tags/prefs', {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            tags: [' 영어 ', ' 수학 ', 'e\u0301', 'é', '알고리즘', '제어\n문자'],
            at: '2099-01-01T00:00:00.000Z',
          }),
        }),
        env as never,
        {} as ExecutionContext,
      );

      expect(response.status).toBe(200);
      expect(mocks.putTagPrefs).toHaveBeenCalledWith({}, 'wg', {
        tags: ['é', '수학', '알고리즘'],
        at: '2026-08-15T12:00:00.000Z',
      });
      await expect(response.json()).resolves.toEqual({
        ok: true,
        prefs: {
          m: 'wg',
          tags: ['é', '수학', '알고리즘'],
          updatedAt: '2026-08-15T12:00:00.000Z',
        },
        applied: true,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('배열이 아닌 tags와 파싱할 수 없는 at은 400으로 거부한다', async () => {
    const token = await makeToken('th', secret);
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const badTags = await worker.fetch(
      new Request('https://example.test/api/tags/prefs', {
        method: 'PUT', headers, body: JSON.stringify({ tags: '수학', at: new Date().toISOString() }),
      }),
      env as never,
      {} as ExecutionContext,
    );
    const badAt = await worker.fetch(
      new Request('https://example.test/api/tags/prefs', {
        method: 'PUT', headers, body: JSON.stringify({ tags: [], at: 'not-a-date' }),
      }),
      env as never,
      {} as ExecutionContext,
    );

    expect(badTags.status).toBe(400);
    expect(badAt.status).toBe(400);
    expect(mocks.putTagPrefs).not.toHaveBeenCalled();
  });

  it('인증 없이는 조회할 수 없다', async () => {
    const response = await worker.fetch(
      new Request('https://example.test/api/tags/prefs'),
      env as never,
      {} as ExecutionContext,
    );
    expect(response.status).toBe(401);
    expect(mocks.getTagPrefs).not.toHaveBeenCalled();
  });
});

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

describe('GET /api/sync/pull 라운지 커서 검증 (핸들러 경계)', () => {
  const secret = 'test-secret';
  const env = { DATABASE_URL: 'postgres://unused', AUTH_SECRET: secret };
  const PO = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1';

  beforeEach(() => {
    mocks.pullPosts.mockClear();
    mocks.pullPostComments.mockClear();
  });

  async function pull(qs: string): Promise<Response> {
    const token = await makeToken('sh', secret);
    return worker.fetch(
      new Request(`https://example.test/api/sync/pull?${qs}`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
      env as never,
      {} as ExecutionContext,
    );
  }

  it('형식이 맞는 psince/psinceId는 커서로 전달된다', async () => {
    const res = await pull(`psince=${encodeURIComponent('2026-08-15T00:00:00.000Z')}&psinceId=${PO}`);
    expect(res.status).toBe(200);
    expect(mocks.pullPosts).toHaveBeenCalledWith({}, { ts: '2026-08-15T00:00:00.000Z', id: PO });
  });

  it('파싱할 수 없는 시각은 커서를 버리고 처음부터 pull한다 — timestamptz 캐스트 500을 막는다', async () => {
    const res = await pull(`psince=not-a-date&psinceId=${PO}&pcsince=also-bad&pcsinceId=${PO}`);
    expect(res.status).toBe(200);
    expect(mocks.pullPosts).toHaveBeenCalledWith({}, null);
    expect(mocks.pullPostComments).toHaveBeenCalledWith({}, null);
  });

  it('UUID가 아닌 pcsinceId도 커서를 버린다', async () => {
    const res = await pull(`pcsince=${encodeURIComponent('2026-08-15T00:00:00.000Z')}&pcsinceId=nope`);
    expect(res.status).toBe(200);
    expect(mocks.pullPostComments).toHaveBeenCalledWith({}, null);
  });
});
