import { useEffect, useState } from 'react';
import type { PhotoKind } from '../local/idb';

export interface PhotoBlobSource {
  getLocalPhotoBlob(photoId: string, kind: PhotoKind): Blob | null;
  getCachedPhotoBlob(photoId: string, kind: PhotoKind): Promise<Blob | null>;
  cachePhotoBlob(photoId: string, kind: PhotoKind, blob: Blob): Promise<void>;
}

interface PhotoProviderConfig {
  source: PhotoBlobSource;
  token: string | null;
  demo: boolean;
  generation: number;
}

type LoadResult =
  | { type: 'found'; blob: Blob }
  | { type: 'missing' }
  | { type: 'auth' }
  | { type: 'transient' };

export type PhotoLoadStatus = 'idle' | 'found' | 'missing' | 'auth' | 'transient';

export interface PhotoUrlState {
  url: string | null;
  missing: boolean;
  status: PhotoLoadStatus;
}

const EMPTY_PHOTO_STATE: PhotoUrlState = { url: null, missing: false, status: 'idle' };
const MISSING_RETRY_MS = [5_000, 15_000, 60_000] as const;
const TRANSIENT_RETRY_MS = [2_000, 5_000, 15_000, 60_000] as const;
const MISSING_RETRY_BUDGET_MS = 15 * 60_000;

function retryEnvironmentReady(): boolean {
  const visible =
    typeof document === 'undefined' ||
    typeof document.visibilityState !== 'string' ||
    document.visibilityState === 'visible';
  const online = typeof navigator === 'undefined' || navigator.onLine !== false;
  return visible && online;
}

/**
 * 같은 photo/kind의 모든 소비자가 공유하는 요청·재시도 상태 머신이다. 마지막 소비자가
 * viewport를 벗어나면 timer와 object URL도 함께 없애 화면 밖 사진이 일을 계속하지 않는다.
 */
class PhotoResource {
  private listeners = new Set<(state: PhotoUrlState) => void>();
  private state: PhotoUrlState = EMPTY_PHOTO_STATE;
  private objectUrl: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private retryType: 'missing' | 'transient' | null = null;
  private retryIndex = 0;
  private retryStartedAt = 0;
  private loading = false;
  private rerunAfterLoad = false;
  private epoch = 0;
  private lastPullGeneration = 0;

  constructor(
    readonly photoId: string,
    readonly kind: PhotoKind,
    private owner: PhotoRequestCoordinator,
  ) {}

  subscribe(listener: (state: PhotoUrlState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    if (this.listeners.size === 1) {
      this.owner.activate(this);
      void this.run();
    }
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.owner.release(this);
    };
  }

  /** token/demo 구성이 바뀌면 진행 중이던 세대의 결과를 버리고 현재 소비자만 다시 읽는다. */
  reset(): void {
    this.epoch += 1;
    this.loading = false;
    this.rerunAfterLoad = false;
    this.clearRetry();
    this.releaseObjectUrl();
    this.update(EMPTY_PHOTO_STATE);
    if (this.listeners.size > 0) void this.run();
  }

  dispose(): void {
    this.epoch += 1;
    this.loading = false;
    this.rerunAfterLoad = false;
    this.clearRetry();
    this.releaseObjectUrl();
  }

  rearm(reason: 'online' | 'visibility' | 'pull', pullGeneration?: number): void {
    if (reason === 'pull') {
      // 한 pull 세대가 여러 페이지/호출 경로에서 전달돼도 retry budget은 한 번만 연다.
      if (pullGeneration === undefined || pullGeneration <= this.lastPullGeneration) return;
      this.lastPullGeneration = pullGeneration;
    }
    const retryable =
      this.state.status === 'missing' ||
      (reason !== 'pull' && this.state.status === 'transient');
    if (!retryable) return;
    this.clearRetry();
    if (!retryEnvironmentReady()) return;
    if (this.loading) {
      this.rerunAfterLoad = true;
      return;
    }
    void this.run();
  }

  private update(state: PhotoUrlState): void {
    this.state = state;
    for (const listener of this.listeners) listener(state);
  }

  private releaseObjectUrl(): void {
    if (!this.objectUrl) return;
    URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = null;
  }

  private clearRetry(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.retryType = null;
    this.retryIndex = 0;
    this.retryStartedAt = 0;
  }

  private scheduleRetry(type: 'missing' | 'transient'): void {
    if (this.listeners.size === 0 || !retryEnvironmentReady()) return;
    if (this.retryType !== type) {
      this.retryType = type;
      this.retryIndex = 0;
      this.retryStartedAt = Date.now();
    }

    let delay: number | undefined;
    if (type === 'missing') {
      const elapsed = Date.now() - this.retryStartedAt;
      const candidate = MISSING_RETRY_MS[Math.min(this.retryIndex, MISSING_RETRY_MS.length - 1)]!;
      // 마지막 요청도 15분 창 안에서만 시작한다. 이후에는 pull/online/visibility만 재무장한다.
      if (elapsed + candidate > MISSING_RETRY_BUDGET_MS) return;
      delay = candidate;
    } else {
      // transient는 네 번만 자동 재시도한다. 환경 변화가 오면 같은 mount에서 새 창을 연다.
      delay = TRANSIENT_RETRY_MS[this.retryIndex];
      if (delay === undefined) return;
    }
    this.retryIndex += 1;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!retryEnvironmentReady()) return;
      void this.run();
    }, delay);
  }

  private applyResult(result: LoadResult, forceRerun: boolean): void {
    if (result.type === 'found') {
      this.clearRetry();
      this.releaseObjectUrl();
      this.objectUrl = URL.createObjectURL(result.blob);
      this.update({ url: this.objectUrl, missing: false, status: 'found' });
      return;
    }

    this.releaseObjectUrl();
    this.update({ url: null, missing: result.type === 'missing', status: result.type });
    if (result.type === 'auth') {
      // 401은 사진별 polling으로 해결할 수 없다. 기존 전역 sync auth UI가 재로그인을 맡는다.
      this.clearRetry();
      return;
    }
    if (forceRerun && retryEnvironmentReady()) {
      this.clearRetry();
      void this.run();
      return;
    }
    if (!this.owner.isDemo()) this.scheduleRetry(result.type);
  }

  private async run(): Promise<void> {
    if (this.listeners.size === 0 || this.loading) return;
    const cfg = this.owner.currentProvider();
    if (!cfg) return;
    const epoch = this.epoch;
    this.loading = true;
    const result = await this.owner.load(cfg, this.photoId, this.kind);
    if (epoch !== this.epoch || this.listeners.size === 0) return;
    this.loading = false;
    const forceRerun = this.rerunAfterLoad;
    this.rerunAfterLoad = false;
    this.applyResult(result, forceRerun);
  }
}

/** 테스트에서도 동일한 상태 머신을 직접 구동할 수 있도록 인스턴스 경계를 둔다. */
export class PhotoRequestCoordinator {
  private provider: PhotoProviderConfig | null = null;
  private providerGeneration = 0;
  private resources = new Map<string, PhotoResource>();
  private activeResources = new Set<PhotoResource>();
  private networkRequests = new Map<string, Promise<LoadResult>>();
  private listening = false;

  private onOnline = (): void => this.rearm('online');
  private onVisibility = (): void => {
    if (retryEnvironmentReady()) this.rearm('visibility');
  };

  configure(
    source: PhotoBlobSource,
    options: { token: string | null; demo: boolean },
  ): void {
    this.providerGeneration += 1;
    this.provider = { source, ...options, generation: this.providerGeneration };
    this.networkRequests.clear();
    for (const resource of this.resources.values()) resource.reset();
  }

  subscribe(
    photoId: string,
    kind: PhotoKind,
    listener: (state: PhotoUrlState) => void,
  ): () => void {
    const key = `${photoId}:${kind}`;
    let resource = this.resources.get(key);
    if (!resource) {
      resource = new PhotoResource(photoId, kind, this);
      this.resources.set(key, resource);
    }
    return resource.subscribe(listener);
  }

  /** 새 metadata가 실제로 pull된 때는 오래된 404 예산만 세대당 한 번 새로 연다. */
  rearm(reason: 'online' | 'visibility'): void;
  rearm(reason: 'pull', pullGeneration: number): void;
  rearm(reason: 'online' | 'visibility' | 'pull', pullGeneration?: number): void {
    for (const resource of this.activeResources) resource.rearm(reason, pullGeneration);
  }

  /** 테스트 종료나 앱 재구성에서 남은 browser resource를 결정적으로 정리한다. */
  dispose(): void {
    for (const resource of this.resources.values()) resource.dispose();
    this.resources.clear();
    this.activeResources.clear();
    this.networkRequests.clear();
    this.stopListening();
  }

  currentProvider(): PhotoProviderConfig | null {
    return this.provider;
  }

  isDemo(): boolean {
    return this.provider?.demo ?? false;
  }

  activate(resource: PhotoResource): void {
    this.activeResources.add(resource);
    this.startListening();
  }

  release(resource: PhotoResource): void {
    resource.dispose();
    this.activeResources.delete(resource);
    const key = `${resource.photoId}:${resource.kind}`;
    if (this.resources.get(key) === resource) this.resources.delete(key);
    if (this.activeResources.size === 0) this.stopListening();
  }

  async load(
    cfg: PhotoProviderConfig,
    photoId: string,
    kind: PhotoKind,
  ): Promise<LoadResult> {
    const local = cfg.source.getLocalPhotoBlob(photoId, kind);
    if (local) return { type: 'found', blob: local };
    try {
      const cached = await cfg.source.getCachedPhotoBlob(photoId, kind);
      if (cached) return { type: 'found', blob: cached };
    } catch {
      // 깨진/닫힌 IDB 캐시는 네트워크 경로를 막지 않는다.
    }
    return this.fetchPhoto(cfg, photoId, kind);
  }

  private async fetchPhoto(
    cfg: PhotoProviderConfig,
    photoId: string,
    kind: PhotoKind,
  ): Promise<LoadResult> {
    if (cfg.demo) return { type: 'missing' };
    if (!cfg.token) return { type: 'auth' };
    const key = `${cfg.generation}:${photoId}:${kind}`;
    const existing = this.networkRequests.get(key);
    if (existing) return existing;

    const request = (async (): Promise<LoadResult> => {
      try {
        const response = await fetch(`/api/photos/${encodeURIComponent(photoId)}?kind=${kind}`, {
          headers: { Authorization: `Bearer ${cfg.token}` },
        });
        if (response.status === 404) return { type: 'missing' };
        if (response.status === 401) return { type: 'auth' };
        if (
          response.status === 408 ||
          response.status === 429 ||
          response.status >= 500 ||
          !response.ok
        ) {
          return { type: 'transient' };
        }
        const blob = await response.blob();
        // IDB가 다른 트랜잭션을 기다려도 화면 표시는 늦추지 않는다. Map 캐시는 호출 즉시 채워진다.
        void cfg.source.cachePhotoBlob(photoId, kind, blob).catch(() => undefined);
        return { type: 'found', blob };
      } catch {
        return { type: 'transient' };
      }
    })();
    this.networkRequests.set(key, request);
    void request.finally(() => {
      if (this.networkRequests.get(key) === request) this.networkRequests.delete(key);
    });
    return request;
  }

  private startListening(): void {
    if (this.listening) return;
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('online', this.onOnline);
    }
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      document.addEventListener('visibilitychange', this.onVisibility);
    }
    this.listening = true;
  }

  private stopListening(): void {
    if (!this.listening) return;
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('online', this.onOnline);
    }
    if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
      document.removeEventListener('visibilitychange', this.onVisibility);
    }
    this.listening = false;
  }
}

const photoRequests = new PhotoRequestCoordinator();
let pullGeneration = 0;

/** boot에서 한 번 연결한다. 훅 자체는 스토어 인자를 받지 않아 카드·라이트박스가 간단해진다. */
export function configurePhotoProvider(
  source: PhotoBlobSource,
  options: { token: string | null; demo: boolean },
): void {
  photoRequests.configure(source, options);
}

/** 새 entry metadata가 실제 pull된 세대에서만 호출한다. 빈 20초 poll은 404 예산을 되살리지 않는다. */
export function rearmMissingPhotosAfterPull(): void {
  photoRequests.rearm('pull', ++pullGeneration);
}

/**
 * 내 photoBlobs → 다운로드 캐시 → 인증 fetch 순으로 URL을 제공한다. active=false이면
 * source/cache/network에 손대지 않으며, 마지막 active 소비자가 사라질 때 URL도 revoke한다.
 */
export function usePhotoUrl(
  photoId: string,
  kind: PhotoKind,
  active = true,
): PhotoUrlState {
  const [value, setValue] = useState<PhotoUrlState>(EMPTY_PHOTO_STATE);

  useEffect(() => {
    if (!active) {
      setValue(EMPTY_PHOTO_STATE);
      return;
    }
    return photoRequests.subscribe(photoId, kind, setValue);
  }, [photoId, kind, active]);

  return active ? value : EMPTY_PHOTO_STATE;
}
