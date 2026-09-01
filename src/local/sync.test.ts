import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  CrewEvent,
  Entry,
  PullResponse,
  TagPrefsPutResponse,
  TagPrefsResponse,
} from '../../shared/types';
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
    studyMinutes: null,
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

async function syncStatus(client: SyncClient): Promise<void> {
  await (client as unknown as { pushStatus(): Promise<void> }).pushStatus();
}

async function push(client: SyncClient): Promise<void> {
  await (client as unknown as { push(): Promise<void> }).push();
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

describe('SyncClient 크루 일정 동기화', () => {
  const EVENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const event = (partial: Partial<CrewEvent> = {}): CrewEvent => ({
    id: EVENT_ID,
    m: 'sh',
    participants: ['sh', 'wg'],
    title: '면접',
    tag: '기타',
    memo: '',
    day: '2026-08-20',
    endDay: null,
    v: 0,
    updatedAt: '2026-08-16T00:00:00.000Z',
    deletedAt: null,
    ...partial,
  });

  it('events를 같은 push 요청에 싣고 eventResults로 큐를 정산한다', async () => {
    const store = new CrewStore();
    const client = new SyncClient(store, 'token', 'sh');
    store.upsertEvent(event());
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { events: CrewEvent[] };
      expect(body.events).toHaveLength(1);
      expect(body.events[0]?.participants).toEqual(['sh', 'wg']);
      return new Response(JSON.stringify({
        ok: true,
        serverTime: '2026-08-16T01:00:00.000Z',
        results: [],
        eventResults: [{
          id: EVENT_ID,
          applied: true,
          row: { ...body.events[0]!, v: 1, updatedAt: '2026-08-16T01:00:00.000Z' },
        }],
      }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await push(client);
    expect(store.pendingEvents()).toHaveLength(0);
    expect(store.getSnapshot().events[0]).toMatchObject({
      participants: ['sh', 'wg'], v: 1, updatedAt: '2026-08-16T01:00:00.000Z',
    });
  });

  it('보냈는데 eventResults가 없으면 구버전 Worker로 보고 큐를 지킨다', async () => {
    const store = new CrewStore();
    const client = new SyncClient(store, 'token', 'sh');
    store.upsertEvent(event());
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      serverTime: '2026-08-16T01:00:00.000Z',
      results: [],
    }), { status: 200 })));

    await expect(push(client)).rejects.toThrow('push event results missing');
    expect(store.pendingEvents()).toHaveLength(1);
  });

  it('pull의 events/eventCursor를 독립 스트림으로 채택한다', async () => {
    const store = new CrewStore();
    const client = new SyncClient(store, 'token', 'sh');
    const cursor = { ts: '2026-08-16T01:00:00.123456Z', id: EVENT_ID };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      rows: [],
      cursor: null,
      statuses: [],
      events: [event({ m: 'wg', v: 1, updatedAt: '2026-08-16T01:00:00.000Z' })],
      eventCursor: cursor,
    } satisfies PullResponse), { status: 200 })));

    await pull(client);
    expect(store.getSnapshot().events).toEqual([
      expect.objectContaining({ id: EVENT_ID, m: 'wg', v: 1 }),
    ]);
  });
});

describe('SyncClient status sync', () => {
  it('오프라인 ON 뒤 OFF해도 lastStartedAt을 보존해 payload에 싣는다', async () => {
    vi.useFakeTimers();
    try {
      const store = new CrewStore();
      const client = new SyncClient(store, 'token', 'sh');
      vi.setSystemTime('2026-08-15T00:00:00.000Z');
      store.setMyStatus(true, '도서관');
      vi.setSystemTime('2026-08-15T00:05:00.000Z');
      store.setMyStatus(false, null);
      const pending = store.myStatusPending()!;
      expect(pending).toMatchObject({
        on: false,
        since: null,
        lastStartedAt: '2026-08-15T00:00:00.000Z',
        updatedAt: '2026-08-15T00:05:00.000Z',
      });

      const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body));
        expect(body).toEqual({
          on: false,
          lastStartedAt: '2026-08-15T00:00:00.000Z',
          at: '2026-08-15T00:05:00.000Z',
        });
        return new Response(JSON.stringify({
          ok: true,
          applied: true,
          status: { ...pending, m: 'sh' },
        }), { status: 200 });
      });
      vi.stubGlobal('fetch', fetchMock);

      await syncStatus(client);
      expect(store.myStatusPending()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('구버전 ON 상태를 채택한 뒤 OFF해도 since를 lastStartedAt으로 payload에 싣는다', async () => {
    vi.useFakeTimers();
    try {
      const store = new CrewStore();
      const client = new SyncClient(store, 'token', 'sh');
      store.applyPull({
        rows: [],
        cursor: null,
        statuses: [{
          m: 'sh',
          on: true,
          place: '도서관',
          since: '2026-08-15T00:00:00.000Z',
          updatedAt: '2026-08-15T00:00:00.000Z',
        } as never],
      });

      vi.setSystemTime('2026-08-15T00:05:00.000Z');
      store.setMyStatus(false, null);
      const pending = store.myStatusPending()!;
      expect(pending).toMatchObject({
        on: false,
        since: null,
        lastStartedAt: '2026-08-15T00:00:00.000Z',
        updatedAt: '2026-08-15T00:05:00.000Z',
      });

      const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
        expect(JSON.parse(String(init?.body))).toEqual({
          on: false,
          lastStartedAt: '2026-08-15T00:00:00.000Z',
          at: '2026-08-15T00:05:00.000Z',
        });
        return new Response(JSON.stringify({
          ok: true,
          applied: true,
          status: { ...pending, m: 'sh' },
        }), { status: 200 });
      });
      vi.stubGlobal('fetch', fetchMock);

      await syncStatus(client);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(store.myStatusPending()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('SyncClient 라운지 글 push 정산', () => {
  const POST_ID = '33333333-3333-4333-8333-333333333333';

  it('postResults로 큐를 정산하고 서버 행을 채택한다', async () => {
    const store = new CrewStore();
    const client = new SyncClient(store, 'token', 'sh');
    store.addPost({ id: POST_ID, body: '도서관 도착', photos: [] });
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { posts: { id: string; body: string }[] };
      expect(body.posts.map((p) => p.id)).toEqual([POST_ID]);
      const sent = body.posts[0]!;
      return new Response(JSON.stringify({
        ok: true,
        serverTime: '2026-08-15T12:00:00.000Z',
        results: [], commentResults: [], reactionResults: [], notificationReadResults: [],
        postResults: [{ id: sent.id, applied: true, row: { ...sent, m: 'sh', photos: [], createdAt: '2026-08-15T11:59:00.000Z', updatedAt: '2026-08-15T12:00:00.000Z', deletedAt: null } }],
        postCommentResults: [],
      }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await push(client);
    expect(store.pendingPosts()).toHaveLength(0);
    expect(store.getSnapshot().posts[0]!.updatedAt).toBe('2026-08-15T12:00:00.000Z');
  });

  it('글 댓글도 같은 요청에 실려 postCommentResults로 정산된다', async () => {
    const store = new CrewStore();
    const client = new SyncClient(store, 'token', 'sh');
    store.addPost({ id: POST_ID, body: '글', photos: [] });
    store.addPostComment(POST_ID, '첫 댓글');
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        posts: { id: string }[];
        postComments: { id: string; postId: string; body: string }[];
      };
      expect(body.postComments).toHaveLength(1);
      const sentPost = body.posts[0]!;
      const sentComment = body.postComments[0]!;
      return new Response(JSON.stringify({
        ok: true,
        serverTime: '2026-08-15T12:00:00.000Z',
        results: [], commentResults: [], reactionResults: [], notificationReadResults: [],
        postResults: [{ id: sentPost.id, applied: true, row: { ...sentPost, m: 'sh', body: '글', photos: [], createdAt: '2026-08-15T11:59:00.000Z', updatedAt: '2026-08-15T12:00:00.000Z', deletedAt: null } }],
        postCommentResults: [{ id: sentComment.id, applied: true, row: { ...sentComment, m: 'sh', createdAt: '2026-08-15T11:59:30.000Z', updatedAt: '2026-08-15T12:00:00.000Z', deletedAt: null } }],
      }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await push(client);
    expect(store.pendingPosts()).toHaveLength(0);
    expect(store.pendingPostComments()).toHaveLength(0);
    expect(store.getSnapshot().postComments.get(POST_ID)![0]!.body).toBe('첫 댓글');
  });

  it('행 없이 커서만 실린 반쪽 응답은 라운지 커서를 전진시키지 않는다', async () => {
    const store = new CrewStore();
    const client = new SyncClient(store, 'token', 'sh');
    // 댓글 스트림을 가득 찬 페이지(500행)로 만들어 pull 루프가 두 번째 페이지를 돌게 한다
    const fullComments = Array.from({ length: 500 }, (_, i) => ({
      id: `44444444-4444-4444-8444-${String(i).padStart(12, '0')}`,
      entryId: ENTRY_ID,
      m: 'wg',
      body: `${i}`,
      createdAt: '2026-08-15T00:00:00.000Z',
      updatedAt: '2026-08-15T00:00:01.000Z',
      deletedAt: null,
    }));
    const urls: string[] = [];
    const fetchMock = vi.fn(async (url: string) => {
      urls.push(url);
      const first = urls.length === 1;
      return new Response(JSON.stringify({
        rows: [], cursor: null, statuses: [],
        comments: first ? fullComments : [],
        commentCursor: { ts: '2026-08-15T00:00:01.000Z', id: fullComments[499]!.id },
        // 반쪽 응답: posts 배열 없이 커서만 — 프록시·구버전 경계의 뒤섞인 응답을 흉내 낸다
        ...(first ? { postCursor: { ts: '2026-08-15T09:00:00.000Z', id: ENTRY_ID } } : {}),
      }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await pull(client);
    expect(urls.length).toBeGreaterThan(1);
    // 두 번째 페이지 요청에 psince가 실렸다면 적용한 적 없는 커서를 믿은 것이다
    expect(urls[1]).not.toContain('psince');
  });

  it('보냈는데 postResults가 없으면(구버전 Worker) 큐를 지키고 오류로 재시도를 예약한다', async () => {
    const store = new CrewStore();
    const client = new SyncClient(store, 'token', 'sh');
    store.addPost({ id: POST_ID, body: '유실되면 안 되는 글', photos: [] });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      serverTime: '2026-08-15T12:00:00.000Z',
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(push(client)).rejects.toThrow('push post results missing');
    expect(store.pendingPosts()).toHaveLength(1); // 큐 보존 — 조용한 유실 방지
  });
});

describe('SyncClient 태그 prefs 재시도', () => {
  it('추가 PUT 실패는 dirty를 보류하고 다음 기회에 재전송하며 삭제도 빈 목록으로 전송한다', async () => {
    const store = new CrewStore();
    const client = new SyncClient(store, 'token', 'sh');
    store.setCustomTags(['수학']);
    store.setCustomEventTags(['면접 준비']);
    const first = store.myTagPrefsPending()!;

    const fetchMock = vi.fn();
    fetchMock.mockRejectedValueOnce(new TypeError('offline'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(syncTagPrefs(client)).rejects.toThrow('offline');
    expect(store.myTagPrefsPending()?.updatedAt).toBe(first.updatedAt);
    expect(store.getSnapshot().customTags).toEqual(['수학']);

    fetchMock.mockImplementationOnce(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        tags: string[];
        eventTags: string[];
        at: string;
      };
      expect(body).toEqual({
        tags: ['수학'], eventTags: ['면접 준비'], at: first.updatedAt,
      });
      return new Response(JSON.stringify({
        ok: true,
        applied: true,
        prefs: { m: 'sh', tags: body.tags, eventTags: body.eventTags, updatedAt: body.at },
      } satisfies TagPrefsPutResponse), { status: 200 });
    });
    await syncTagPrefs(client);
    expect(store.myTagPrefsPending()).toBeNull();

    store.setCustomTags([]);
    const removed = store.myTagPrefsPending()!;
    fetchMock.mockImplementationOnce(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        tags: string[];
        eventTags: string[];
        at: string;
      };
      expect(body).toEqual({ tags: [], eventTags: ['면접 준비'], at: removed.updatedAt });
      return new Response(JSON.stringify({
        ok: true,
        applied: true,
        prefs: { m: 'sh', tags: [], eventTags: body.eventTags, updatedAt: body.at },
      } satisfies TagPrefsPutResponse), { status: 200 });
    });
    await syncTagPrefs(client);
    expect(store.getSnapshot().customTags).toEqual([]);
    expect(store.getSnapshot().customEventTags).toEqual(['면접 준비']);
    expect(store.myTagPrefsPending()).toBeNull();
  });

  it('dirty가 없으면 GET으로 서버의 더 새 prefs를 캐시에 반영한다', async () => {
    const store = new CrewStore();
    const client = new SyncClient(store, 'token', 'sh');
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      prefs: {
        m: 'sh',
        tags: ['알고리즘', ' 수학 '],
        eventTags: [' 발표 ', '영어', 'OFF'],
        updatedAt: '2026-08-15T03:00:00.000Z',
      },
    } satisfies TagPrefsResponse), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await syncTagPrefs(client);
    expect(fetchMock).toHaveBeenCalledWith('/api/tags/prefs', expect.objectContaining({
      headers: expect.objectContaining({ authorization: 'Bearer token' }),
    }));
    expect(store.getSnapshot().customTags).toEqual(['수학', '알고리즘']);
    expect(store.getSnapshot().customEventTags).toEqual(['발표', '영어']);
    expect(store.myTagPrefsPending()).toBeNull();
  });
});
