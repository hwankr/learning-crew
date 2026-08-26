import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeToken } from './auth';
import { kstDayStr } from '../shared/notify';

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
    eventTags: [] as string[],
    updatedAt: '1970-01-01T00:00:00.000Z',
  })),
  pullSince: vi.fn(async () => ({ rows: [], cursor: null })),
  pullEvents: vi.fn(async () => ({ rows: [], cursor: null })),
  pushEvents: vi.fn(async (_db: unknown, _rows: unknown[], _me: string) => ({
    applied: [],
    conflicts: [],
  })),
  allStatuses: vi.fn(async () => []),
  pullComments: vi.fn(async () => ({ rows: [], cursor: null })),
  pullReactions: vi.fn(async () => ({ rows: [], cursor: null })),
  pullNotifications: vi.fn(async () => ({ rows: [], cursor: null })),
  pullPosts: vi.fn(async () => ({ rows: [], cursor: null })),
  pullPostComments: vi.fn(async () => ({ rows: [], cursor: null })),
  pullStudyDays: vi.fn(async () => ({ rows: [], cursor: null })),
  recordStudyDays: vi.fn(async (_db: unknown, _m: string, _days: string[]) => undefined),
  putTagPrefs: vi.fn(async (
    _db: unknown,
    m: string,
    p: { tags: string[]; eventTags?: string[]; at: string },
  ) => ({
    applied: true,
    prefs: { m, tags: p.tags, eventTags: p.eventTags ?? [], updatedAt: p.at },
  })),
  getStatusRow: vi.fn(async () => null as {
    on: boolean;
    since: string | null;
    lastNotifiedAt: string | null;
  } | null),
  setStatus: vi.fn(async (
    _db: unknown,
    m: string,
    s: { on: boolean; place: string | null; since: string | null; lastStartedAt: string | null; at: string },
  ) => ({
    applied: true,
    status: { m, ...s, updatedAt: s.at },
  })),
  claimNotifySlot: vi.fn(async () => false),
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
  getStatusRow: mocks.getStatusRow,
  setStatus: mocks.setStatus,
  claimNotifySlot: mocks.claimNotifySlot,
  pullSince: mocks.pullSince,
  pullEvents: mocks.pullEvents,
  pushEvents: mocks.pushEvents,
  allStatuses: mocks.allStatuses,
  pullComments: mocks.pullComments,
  pullReactions: mocks.pullReactions,
  pullNotifications: mocks.pullNotifications,
  pullPosts: mocks.pullPosts,
  pullPostComments: mocks.pullPostComments,
  pullStudyDays: mocks.pullStudyDays,
  recordStudyDays: mocks.recordStudyDays,
}));

import worker from './index';

describe('POST /api/sync/status', () => {
  const secret = 'test-secret';
  const env = { DATABASE_URL: 'postgres://unused', AUTH_SECRET: secret };

  beforeEach(() => {
    mocks.getStatusRow.mockReset();
    mocks.setStatus.mockClear();
    mocks.claimNotifySlot.mockClear();
    mocks.getStatusRow.mockResolvedValue(null);
    mocks.setStatus.mockImplementation(async (_db, m, s) => ({
      applied: true,
      status: { m, ...s, updatedAt: s.at },
    }));
    mocks.claimNotifySlot.mockResolvedValue(false);
    mocks.recordStudyDays.mockClear();
  });

  it('오래된 since만 있는 legacy ON은 TTL OFF로 강등하되 오늘 lastStartedAt을 만들지 않는다', async () => {
    vi.useFakeTimers();
    vi.setSystemTime('2026-08-15T12:00:00.000Z');
    try {
      const token = await makeToken('sh', secret);
      const response = await worker.fetch(
        new Request('https://example.test/api/sync/status', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            on: true,
            place: '도서관',
            since: '2026-08-13T11:59:00.000Z',
          }),
        }),
        env as never,
        { waitUntil: vi.fn() } as unknown as ExecutionContext,
      );

      expect(response.status).toBe(200);
      expect(mocks.setStatus).toHaveBeenCalledWith({}, 'sh', {
        on: false,
        place: null,
        since: null,
        lastStartedAt: '2026-08-13T11:59:00.000Z',
        at: '2026-08-13T11:59:00.000Z',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('정상 legacy ON은 raw since를 시작 이력으로 보존해 오늘 도장을 만들 수 있다', async () => {
    vi.useFakeTimers();
    vi.setSystemTime('2026-08-15T12:00:00.000Z');
    try {
      mocks.getStatusRow.mockResolvedValue({
        on: true,
        since: '2026-08-15T11:55:00.000Z',
        lastNotifiedAt: null,
      });
      const token = await makeToken('sh', secret);
      const response = await worker.fetch(
        new Request('https://example.test/api/sync/status', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            on: true,
            place: '도서관',
            since: '2026-08-15T11:50:00.000Z',
          }),
        }),
        env as never,
        { waitUntil: vi.fn() } as unknown as ExecutionContext,
      );

      expect(response.status).toBe(200);
      expect(mocks.setStatus).toHaveBeenCalledWith({}, 'sh', {
        on: true,
        place: '도서관',
        since: '2026-08-15T11:50:00.000Z',
        lastStartedAt: '2026-08-15T11:50:00.000Z',
        at: '2026-08-15T11:50:00.000Z',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('valid ON의 parseable 시작 후보가 at보다 뒤면 action at을 시작 이력으로 저장한다', async () => {
    vi.useFakeTimers();
    vi.setSystemTime('2026-08-15T12:00:00.000Z');
    try {
      const token = await makeToken('sh', secret);
      const response = await worker.fetch(
        new Request('https://example.test/api/sync/status', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            on: true,
            place: '도서관',
            since: '2026-08-15T11:00:00.000Z',
            lastStartedAt: '2026-08-15T11:30:00.000Z',
            at: '2026-08-15T10:00:00.000Z',
          }),
        }),
        env as never,
        { waitUntil: vi.fn() } as unknown as ExecutionContext,
      );

      expect(response.status).toBe(200);
      expect(mocks.setStatus).toHaveBeenCalledWith({}, 'sh', {
        on: true,
        place: '도서관',
        since: '2026-08-15T11:00:00.000Z',
        lastStartedAt: '2026-08-15T10:00:00.000Z',
        at: '2026-08-15T10:00:00.000Z',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('OFF의 explicit lastStartedAt이 at보다 뒤면 시작 이력 후보를 저장하지 않는다', async () => {
    vi.useFakeTimers();
    vi.setSystemTime('2026-08-15T12:00:00.000Z');
    try {
      const token = await makeToken('sh', secret);
      const response = await worker.fetch(
        new Request('https://example.test/api/sync/status', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            on: false,
            lastStartedAt: '2026-08-15T11:00:00.000Z',
            at: '2026-08-15T10:00:00.000Z',
          }),
        }),
        env as never,
        { waitUntil: vi.fn() } as unknown as ExecutionContext,
      );

      expect(response.status).toBe(200);
      expect(mocks.setStatus).toHaveBeenCalledWith({}, 'sh', {
        on: false,
        place: null,
        since: null,
        lastStartedAt: null,
        at: '2026-08-15T10:00:00.000Z',
      });
      // 이력이 없는 액션은 도장을 남기지 않는다 — 빈 배열은 recordStudyDays가 no-op으로 삼킨다
      expect(mocks.recordStudyDays).toHaveBeenCalledWith({}, 'sh', []);
    } finally {
      vi.useRealTimers();
    }
  });

  async function setStatusReq(body: Record<string, unknown>): Promise<Response> {
    const token = await makeToken('sh', secret);
    return worker.fetch(
      new Request('https://example.test/api/sync/status', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
      env as never,
      { waitUntil: vi.fn() } as unknown as ExecutionContext,
    );
  }

  it('ON 체크인은 시작 시각의 KST 날짜를 도장 이력으로 남긴다', async () => {
    vi.useFakeTimers();
    vi.setSystemTime('2026-08-15T12:00:00.000Z');
    try {
      const response = await setStatusReq({
        on: true,
        place: '도서관',
        since: '2026-08-15T11:50:00.000Z', // KST 8/15 20:50
        at: '2026-08-15T11:50:00.000Z',
      });
      expect(response.status).toBe(200);
      expect(mocks.recordStudyDays).toHaveBeenCalledWith({}, 'sh', ['2026-08-15']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('자정(KST)을 넘긴 OFF는 시작일과 종료일 두 날짜를 남긴다', async () => {
    vi.useFakeTimers();
    vi.setSystemTime('2026-08-14T15:30:00.000Z');
    try {
      const response = await setStatusReq({
        on: false,
        lastStartedAt: '2026-08-14T14:30:00.000Z', // KST 8/14 23:30
        at: '2026-08-14T15:30:00.000Z', // KST 8/15 00:30
      });
      expect(response.status).toBe(200);
      expect(mocks.recordStudyDays).toHaveBeenCalledWith({}, 'sh', ['2026-08-14', '2026-08-15']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('lastStartedAt 필드가 없는 구버전 OFF는 서버가 보존한 이력으로 도장을 되살린다', async () => {
    vi.useFakeTimers();
    vi.setSystemTime('2026-08-14T15:30:00.000Z'); // KST 8/15 00:30 — 자정을 막 넘긴 종료
    try {
      // setStatus의 단조 병합이 서버 행의 시작 이력을 보존해 돌려주는 상황
      mocks.setStatus.mockImplementation(async (_db, m, s) => ({
        applied: true,
        status: {
          m,
          ...s,
          lastStartedAt: s.lastStartedAt ?? '2026-08-14T14:30:00.000Z', // KST 8/14 23:30 시작
          updatedAt: s.at,
        },
      }));
      const response = await setStatusReq({ on: false }); // 구버전 — lastStartedAt·at 없음
      expect(response.status).toBe(200);
      expect(mocks.recordStudyDays).toHaveBeenCalledWith({}, 'sh', ['2026-08-14', '2026-08-15']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('TTL을 넘긴 OFF(끄는 걸 잊음)는 종료일 도장을 만들지 않는다', async () => {
    vi.useFakeTimers();
    vi.setSystemTime('2026-08-14T04:00:00.000Z');
    try {
      const response = await setStatusReq({
        on: false,
        lastStartedAt: '2026-08-13T12:00:00.000Z', // KST 8/13 21:00 — 16시간 전
        at: '2026-08-14T04:00:00.000Z',
      });
      expect(response.status).toBe(200);
      expect(mocks.recordStudyDays).toHaveBeenCalledWith({}, 'sh', ['2026-08-13']);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('GET/PUT /api/tags/prefs', () => {
  const secret = 'test-secret';
  const env = { DATABASE_URL: 'postgres://unused', AUTH_SECRET: secret };

  beforeEach(() => {
    mocks.getTagPrefs.mockReset();
    mocks.putTagPrefs.mockReset();
    mocks.getTagPrefs.mockImplementation(async (_db, m) => ({
      m,
      tags: [],
      eventTags: [],
      updatedAt: '1970-01-01T00:00:00.000Z',
    }));
    mocks.putTagPrefs.mockImplementation(async (_db, m, p) => ({
      applied: true,
      prefs: { m, tags: p.tags, eventTags: p.eventTags ?? [], updatedAt: p.at },
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
      prefs: { m: 'sh', tags: [], eventTags: [], updatedAt: '1970-01-01T00:00:00.000Z' },
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
          eventTags: [],
          updatedAt: '2026-08-15T12:00:00.000Z',
        },
        applied: true,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('eventTags가 있으면 별도 목록으로 정화하고, 생략한 구버전 요청은 필드를 넘기지 않는다', async () => {
    const token = await makeToken('wg', secret);
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const at = '2026-08-15T11:00:00.000Z';

    const withEvents = await worker.fetch(
      new Request('https://example.test/api/tags/prefs', {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          tags: ['수학'],
          eventTags: [' 면접 ', '영어', 'OFF', '면접', '제어\n문자'],
          at,
        }),
      }),
      env as never,
      {} as ExecutionContext,
    );

    expect(withEvents.status).toBe(200);
    expect(mocks.putTagPrefs).toHaveBeenLastCalledWith({}, 'wg', {
      tags: ['수학'],
      eventTags: ['면접', '영어'],
      at,
    });

    await worker.fetch(
      new Request('https://example.test/api/tags/prefs', {
        method: 'PUT', headers, body: JSON.stringify({ tags: ['독서'], at }),
      }),
      env as never,
      {} as ExecutionContext,
    );
    expect(mocks.putTagPrefs).toHaveBeenLastCalledWith({}, 'wg', { tags: ['독서'], at });
  });

  it('배열이 아닌 tags/eventTags와 파싱할 수 없는 at은 400으로 거부한다', async () => {
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
    const badEventTags = await worker.fetch(
      new Request('https://example.test/api/tags/prefs', {
        method: 'PUT',
        headers,
        body: JSON.stringify({ tags: [], eventTags: '면접', at: new Date().toISOString() }),
      }),
      env as never,
      {} as ExecutionContext,
    );

    expect(badTags.status).toBe(400);
    expect(badAt.status).toBe(400);
    expect(badEventTags.status).toBe(400);
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

describe('POST /api/sync/push 크루 일정', () => {
  const secret = 'test-secret';
  const env = { DATABASE_URL: 'postgres://unused', AUTH_SECRET: secret };
  const EVENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

  beforeEach(() => {
    mocks.pushEvents.mockReset();
    mocks.pushEvents.mockImplementation(async (_db, rows) => ({
      applied: rows.map((row: { v: number }) => ({
        ...row,
        v: row.v + 1,
        updatedAt: '2026-08-16T10:00:00.000Z',
      })),
      conflicts: [],
    }));
  });

  async function push(body: unknown, member = 'sh'): Promise<Response> {
    const token = await makeToken(member, secret);
    return worker.fetch(
      new Request('https://example.test/api/sync/push', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
      env as never,
      { waitUntil: vi.fn() } as unknown as ExecutionContext,
    );
  }

  const event = (over: Record<string, unknown> = {}) => ({
    id: EVENT_ID,
    m: 'sh',
    participants: ['kj', 'not-a-member', 'sh', 'kj'],
    title: '  최종 면접  ',
    tag: 'OFF',
    memo: '',
    day: '2026-08-20',
    endDay: '2026-02-31',
    v: 0,
    updatedAt: '2026-08-16T09:00:00Z',
    deletedAt: null,
    ...over,
  });

  it('shared 정규화를 거친 행을 CAS 쿼리에 넘기고 eventResults를 돌려준다', async () => {
    const response = await push({ entries: [], events: [event()] });
    expect(response.status).toBe(200);
    expect(mocks.pushEvents).toHaveBeenCalledWith({}, [{
      ...event(),
      participants: ['sh', 'kj'],
      title: '최종 면접',
      tag: '기타',
      endDay: null,
      updatedAt: '2026-08-16T09:00:00.000Z',
    }], 'sh');
    const body = await response.json() as { eventResults: { applied: boolean; row: { v: number } }[] };
    expect(body.eventResults).toEqual([
      expect.objectContaining({ id: EVENT_ID, applied: true, row: expect.objectContaining({ v: 1 }) }),
    ]);
  });

  it('다른 멤버 소유 일정은 400으로 거부한다', async () => {
    const response = await push({ entries: [], events: [event({ m: 'wg' })] });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: 'not your event' });
    expect(mocks.pushEvents).not.toHaveBeenCalled();
  });

  it('events가 없는 구버전 요청도 성공하고 빈 결과 필드를 제공한다', async () => {
    const response = await push({ entries: [] });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ eventResults: [] });
    expect(mocks.pushEvents).toHaveBeenCalledWith({}, [], 'sh');
  });
});

describe('POST /api/sync/push 도장 이력', () => {
  const secret = 'test-secret';
  const env = { DATABASE_URL: 'postgres://unused', AUTH_SECRET: secret };

  beforeEach(() => {
    mocks.recordStudyDays.mockClear();
  });

  async function push(body: unknown): Promise<Response> {
    const token = await makeToken('sh', secret);
    return worker.fetch(
      new Request('https://example.test/api/sync/push', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
      env as never,
      { waitUntil: vi.fn() } as unknown as ExecutionContext,
    );
  }

  it('내 도장 날짜를 기록하고 에코로 정산한다 — 지난 날짜(오프라인 큐 지연 도착)도 허용', async () => {
    const response = await push({ entries: [], studyDays: [{ m: 'sh', day: '2026-08-15' }] });
    expect(response.status).toBe(200);
    expect(mocks.recordStudyDays).toHaveBeenCalledWith({}, 'sh', ['2026-08-15']);
    await expect(response.json()).resolves.toMatchObject({ studyDayResults: ['2026-08-15'] });
  });

  it('다른 멤버의 도장은 400으로 거부한다', async () => {
    const response = await push({ entries: [], studyDays: [{ m: 'wg', day: '2026-08-15' }] });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: 'not your study day' });
    expect(mocks.recordStudyDays).not.toHaveBeenCalled();
  });

  it('달력에 없는 날짜는 date 삽입에 닿기 전에 400으로 거른다', async () => {
    const invalid = await push({ entries: [], studyDays: [{ m: 'sh', day: '2026-02-30' }] });
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toMatchObject({ error: 'bad study day' });
    expect(mocks.recordStudyDays).not.toHaveBeenCalled();
  });

  it('범위 밖 날짜는 400 대신 화해한다 — 큐가 못 비면 push 전체가 막히므로 에코는 요청 그대로', async () => {
    // 빠른 시계의 미래 날짜는 서버 KST 오늘로 눌러 기록한다 — status 경로의 오늘 기록과
    // 같은 행이 되어 체크인 하나가 이틀로 불어나지 않는다
    const future = await push({ entries: [], studyDays: [{ m: 'sh', day: '2030-01-01' }] });
    expect(future.status).toBe(200);
    expect(mocks.recordStudyDays).toHaveBeenCalledWith({}, 'sh', [kstDayStr(Date.now())]);
    await expect(future.json()).resolves.toMatchObject({ studyDayResults: ['2030-01-01'] });

    // 2020년 이전(고장 난 시계)은 기록 없이 에코만 — 큐만 정산된다
    mocks.recordStudyDays.mockClear();
    const ancient = await push({ entries: [], studyDays: [{ m: 'sh', day: '2019-12-31' }] });
    expect(ancient.status).toBe(200);
    expect(mocks.recordStudyDays).toHaveBeenCalledWith({}, 'sh', []);
    await expect(ancient.json()).resolves.toMatchObject({ studyDayResults: ['2019-12-31'] });
  });

  it('studyDays가 없는 구버전 요청도 성공하고 빈 결과 필드를 항상 싣는다', async () => {
    const response = await push({ entries: [] });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ studyDayResults: [] });
    expect(mocks.recordStudyDays).toHaveBeenCalledWith({}, 'sh', []);
  });
});

describe('GET /api/sync/pull 라운지 커서 검증 (핸들러 경계)', () => {
  const secret = 'test-secret';
  const env = { DATABASE_URL: 'postgres://unused', AUTH_SECRET: secret };
  const PO = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1';

  beforeEach(() => {
    mocks.pullEvents.mockClear();
    mocks.pullPosts.mockClear();
    mocks.pullPostComments.mockClear();
    mocks.pullStudyDays.mockClear();
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

  it('형식이 맞는 event 커서만 일정 pull에 전달한다', async () => {
    const ts = '2026-08-15T00:00:00.000Z';
    const res = await pull(`esince=${encodeURIComponent(ts)}&esinceId=${PO.toUpperCase()}`);
    expect(res.status).toBe(200);
    expect(mocks.pullEvents).toHaveBeenCalledWith({}, { ts, id: PO });

    await pull(`esince=bad&esinceId=${PO}`);
    expect(mocks.pullEvents).toHaveBeenLastCalledWith({}, null);
  });

  it('도장 커서는 지평선 하한(m="")도 인정하고, 날짜 형식이 어긋나면 버린다 — ::date 캐스트 500 방지', async () => {
    const ts = '2026-08-15T00:00:00.000Z';
    const res = await pull(
      `sdsince=${encodeURIComponent(ts)}&sdsinceM=&sdsinceDay=0001-01-01`,
    );
    expect(res.status).toBe(200);
    expect(mocks.pullStudyDays).toHaveBeenCalledWith({}, { ts, m: '', day: '0001-01-01' });

    await pull(`sdsince=${encodeURIComponent(ts)}&sdsinceM=sh&sdsinceDay=not-a-day`);
    expect(mocks.pullStudyDays).toHaveBeenLastCalledWith({}, null);

    // 형식은 맞지만 달력에 없는 날 — 손상된 커서가 pull 전체를 500 루프로 몰지 못하게 버린다
    await pull(`sdsince=${encodeURIComponent(ts)}&sdsinceM=sh&sdsinceDay=2026-02-30`);
    expect(mocks.pullStudyDays).toHaveBeenLastCalledWith({}, null);

    await pull(`sdsince=bad&sdsinceM=sh&sdsinceDay=2026-08-15`);
    expect(mocks.pullStudyDays).toHaveBeenLastCalledWith({}, null);
  });
});
