import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { observePhotoViewport, PHOTO_VIEWPORT_ROOT_MARGIN } from '../components/PhotoImg';
import {
  PhotoRequestCoordinator,
  type PhotoBlobSource,
  type PhotoUrlState,
} from './usePhoto';

const PHOTO_ID = '11111111-1111-4111-8111-111111111111';

function response(status: number, blob = new Blob()): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    blob: vi.fn(async () => blob),
  } as unknown as Response;
}

function source(): PhotoBlobSource & {
  getLocalPhotoBlob: ReturnType<typeof vi.fn>;
  getCachedPhotoBlob: ReturnType<typeof vi.fn>;
  cachePhotoBlob: ReturnType<typeof vi.fn>;
} {
  return {
    getLocalPhotoBlob: vi.fn(() => null),
    getCachedPhotoBlob: vi.fn(async () => null),
    cachePhotoBlob: vi.fn(async () => undefined),
  };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
}

const coordinators: PhotoRequestCoordinator[] = [];

function coordinator(src: PhotoBlobSource): PhotoRequestCoordinator {
  const value = new PhotoRequestCoordinator();
  value.configure(src, { token: 'token', demo: false });
  coordinators.push(value);
  return value;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  for (const value of coordinators.splice(0)) value.dispose();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('PhotoImg viewport gate', () => {
  it('viewport 밖에서는 cache/network/timer/object URL을 시작하지 않고 정리도 모두 끝낸다', async () => {
    const src = source();
    const requests = coordinator(src);
    const fetchMock = vi.fn(async () => response(200, new Blob(['photo'])));
    vi.stubGlobal('fetch', fetchMock);
    const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:photo');
    const revokeUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

    let callback!: IntersectionObserverCallback;
    let options: IntersectionObserverInit | undefined;
    const observe = vi.fn();
    const unobserve = vi.fn();
    const disconnect = vi.fn();
    class FakeIntersectionObserver {
      constructor(cb: IntersectionObserverCallback, init?: IntersectionObserverInit) {
        callback = cb;
        options = init;
      }
      readonly root = null;
      readonly rootMargin = PHOTO_VIEWPORT_ROOT_MARGIN;
      readonly thresholds = [0];
      observe = observe;
      unobserve = unobserve;
      disconnect = disconnect;
      takeRecords(): IntersectionObserverEntry[] { return []; }
    }
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);

    const target = {} as Element;
    let unsubscribe: (() => void) | null = null;
    const stopObserver = observePhotoViewport(target, (active) => {
      if (active && !unsubscribe) {
        unsubscribe = requests.subscribe(PHOTO_ID, 'thumb', () => undefined);
      } else if (!active && unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
    });

    expect(options?.rootMargin).toBe('600px 0px');
    expect(observe).toHaveBeenCalledWith(target);
    expect(src.getLocalPhotoBlob).not.toHaveBeenCalled();
    expect(src.getCachedPhotoBlob).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(createUrl).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);

    callback([
      { target, isIntersecting: true, intersectionRatio: 1 } as IntersectionObserverEntry,
    ], {} as IntersectionObserver);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(createUrl).toHaveBeenCalledTimes(1);

    callback([
      { target, isIntersecting: false, intersectionRatio: 0 } as IntersectionObserverEntry,
    ], {} as IntersectionObserver);
    expect(revokeUrl).toHaveBeenCalledWith('blob:photo');

    // 재진입 결과가 404면 timer가 하나 생기지만, component unmount는 구독과 observer를 모두 정리한다.
    fetchMock.mockResolvedValueOnce(response(404));
    callback([
      { target, isIntersecting: true, intersectionRatio: 1 } as IntersectionObserverEntry,
    ], {} as IntersectionObserver);
    await flush();
    expect(vi.getTimerCount()).toBe(1);
    (unsubscribe as (() => void) | null)?.();
    unsubscribe = null;
    stopObserver();
    expect(vi.getTimerCount()).toBe(0);
    expect(unobserve).toHaveBeenCalledWith(target);
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('IntersectionObserver 미지원 브라우저는 즉시 활성화한다', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const active = vi.fn();
    const cleanup = observePhotoViewport({} as Element, active);
    expect(active).toHaveBeenCalledWith(true);
    expect(cleanup()).toBeUndefined();
  });
});

describe('photo GET retry 상태 머신', () => {
  it('network failure 뒤 online 이벤트가 같은 mount를 즉시 다시 읽는다', async () => {
    const fakeWindow = new EventTarget();
    const fakeDocument = Object.assign(new EventTarget(), { visibilityState: 'visible' });
    vi.stubGlobal('window', fakeWindow);
    vi.stubGlobal('document', fakeDocument);
    vi.stubGlobal('navigator', { onLine: true });
    const src = source();
    const requests = coordinator(src);
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce(response(200, new Blob(['photo'])));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:recovered');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const states: PhotoUrlState[] = [];
    const unsubscribe = requests.subscribe(PHOTO_ID, 'full', (state) => states.push(state));

    await flush();
    expect(states.at(-1)?.status).toBe('transient');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);

    fakeWindow.dispatchEvent(new Event('online'));
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(states.at(-1)).toMatchObject({ status: 'found', url: 'blob:recovered' });
    expect(vi.getTimerCount()).toBe(0);
    unsubscribe();
  });

  it('404는 5/15/60초 간격으로 15분 안에서만 polling하고 pull/visibility/online이 재무장한다', async () => {
    const src = source();
    const requests = coordinator(src);
    const fetchMock = vi.fn(async () => response(404));
    vi.stubGlobal('fetch', fetchMock);
    const states: PhotoUrlState[] = [];
    const unsubscribe = requests.subscribe(PHOTO_ID, 'thumb', (state) => states.push(state));
    await flush();
    expect(states.at(-1)).toMatchObject({ status: 'missing', missing: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(4);

    await vi.advanceTimersByTimeAsync(15 * 60_000);
    const stoppedAt = fetchMock.mock.calls.length;
    expect(stoppedAt).toBeGreaterThan(4);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(fetchMock).toHaveBeenCalledTimes(stoppedAt);

    let rearmedCount = stoppedAt;
    requests.rearm('pull', 1);
    await flush();
    rearmedCount += 1;
    expect(fetchMock).toHaveBeenCalledTimes(rearmedCount);
    for (const reason of ['visibility', 'online'] as const) {
      requests.rearm(reason);
      await flush();
      rearmedCount += 1;
      expect(fetchMock).toHaveBeenCalledTimes(rearmedCount);
    }
    unsubscribe();
  });

  it('같은 pull generation 재전달은 한 번만 재무장하고 새 generation만 다시 연다', async () => {
    const src = source();
    const requests = coordinator(src);
    const fetchMock = vi.fn(async () => response(404));
    vi.stubGlobal('fetch', fetchMock);
    const unsubscribe = requests.subscribe(PHOTO_ID, 'thumb', () => undefined);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    requests.rearm('pull', 7);
    requests.rearm('pull', 7);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    requests.rearm('pull', 8);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    unsubscribe();
  });

  it('401은 auth로 분류하고 사진별 retry loop를 만들지 않는다', async () => {
    const src = source();
    const requests = coordinator(src);
    const fetchMock = vi.fn(async () => response(401));
    vi.stubGlobal('fetch', fetchMock);
    const states: PhotoUrlState[] = [];
    const unsubscribe = requests.subscribe(PHOTO_ID, 'thumb', (state) => states.push(state));
    await flush();

    expect(states.at(-1)).toMatchObject({ status: 'auth', missing: false });
    expect(vi.getTimerCount()).toBe(0);
    requests.rearm('online');
    requests.rearm('visibility');
    requests.rearm('pull', 1);
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('같은 photo/kind 두 소비자는 in-flight와 retry timer를 하나만 소유한다', async () => {
    const src = source();
    const requests = coordinator(src);
    let resolveFetch!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => { resolveFetch = resolve; });
    const fetchMock = vi.fn(() => pending);
    vi.stubGlobal('fetch', fetchMock);
    const first = requests.subscribe(PHOTO_ID, 'full', () => undefined);
    const second = requests.subscribe(PHOTO_ID, 'full', () => undefined);
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolveFetch(response(404));
    await flush();
    expect(vi.getTimerCount()).toBe(1);
    first();
    expect(vi.getTimerCount()).toBe(1);
    second();
    expect(vi.getTimerCount()).toBe(0);
  });
});
