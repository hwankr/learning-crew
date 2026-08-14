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
  | { type: 'unavailable' };

let provider: PhotoProviderConfig | null = null;
let providerGeneration = 0;
const networkRequests = new Map<string, Promise<LoadResult>>();

/** boot에서 한 번 연결한다. 훅 자체는 스토어 인자를 받지 않아 카드·라이트박스가 간단해진다. */
export function configurePhotoProvider(
  source: PhotoBlobSource,
  options: { token: string | null; demo: boolean },
): void {
  providerGeneration += 1;
  provider = { source, ...options, generation: providerGeneration };
  networkRequests.clear();
}

async function fetchPhoto(
  cfg: PhotoProviderConfig,
  photoId: string,
  kind: PhotoKind,
): Promise<LoadResult> {
  if (cfg.demo) return { type: 'missing' };
  if (!cfg.token) return { type: 'unavailable' };
  const key = `${cfg.generation}:${photoId}:${kind}`;
  const existing = networkRequests.get(key);
  if (existing) return existing;

  const request = (async (): Promise<LoadResult> => {
    try {
      const response = await fetch(`/api/photos/${encodeURIComponent(photoId)}?kind=${kind}`, {
        headers: { Authorization: `Bearer ${cfg.token}` },
      });
      if (response.status === 404) return { type: 'missing' };
      if (!response.ok) return { type: 'unavailable' };
      const blob = await response.blob();
      // IDB가 다른 트랜잭션을 기다려도 화면 표시는 늦추지 않는다. Map 캐시는 호출 즉시 채워진다.
      void cfg.source.cachePhotoBlob(photoId, kind, blob).catch(() => undefined);
      return { type: 'found', blob };
    } catch {
      return { type: 'unavailable' };
    }
  })();
  networkRequests.set(key, request);
  void request.finally(() => {
    if (networkRequests.get(key) === request) networkRequests.delete(key);
  });
  return request;
}

async function loadPhoto(
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
  return fetchPhoto(cfg, photoId, kind);
}

const RETRY_MS = [5_000, 15_000, 60_000] as const;

/**
 * 내 photoBlobs → 다운로드 캐시 → 인증 fetch 순으로 URL을 제공한다.
 * 404는 상대 기기의 업로드가 아직 끝나지 않은 상태이므로 보이는 탭에서만 백오프한다.
 */
export function usePhotoUrl(
  photoId: string,
  kind: PhotoKind,
): { url: string | null; missing: boolean } {
  const [value, setValue] = useState<{ url: string | null; missing: boolean }>({
    url: null,
    missing: false,
  });

  useEffect(() => {
    const cfg = provider;
    let disposed = false;
    let loading = false;
    let objectUrl: string | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let retryIndex = 0;
    let waitingForVisibility = false;

    const visible = (): boolean =>
      typeof document === 'undefined' || document.visibilityState === 'visible';

    const replaceObjectUrl = (blob: Blob): void => {
      const next = URL.createObjectURL(blob);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = next;
      setValue({ url: next, missing: false });
    };

    const scheduleMissingRetry = (): void => {
      if (disposed) return;
      if (!visible()) {
        waitingForVisibility = true;
        return;
      }
      const delay = RETRY_MS[Math.min(retryIndex, RETRY_MS.length - 1)]!;
      retryIndex += 1;
      timer = setTimeout(() => {
        timer = null;
        if (!visible()) {
          waitingForVisibility = true;
          return;
        }
        void run();
      }, delay);
    };

    const run = async (): Promise<void> => {
      if (!cfg || disposed || loading) return;
      loading = true;
      const result = await loadPhoto(cfg, photoId, kind);
      loading = false;
      if (disposed) return;
      if (result.type === 'found') {
        replaceObjectUrl(result.blob);
        return;
      }
      if (result.type === 'missing') {
        if (objectUrl) {
          URL.revokeObjectURL(objectUrl);
          objectUrl = null;
        }
        setValue({ url: null, missing: true });
        if (!cfg.demo) scheduleMissingRetry();
      } else {
        setValue({ url: null, missing: false });
      }
    };

    const onVisibility = (): void => {
      if (!waitingForVisibility || !visible()) return;
      waitingForVisibility = false;
      void run();
    };

    setValue({ url: null, missing: false });
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibility);
    }
    void run();

    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility);
      }
    };
  }, [photoId, kind]);

  return value;
}
