import type { PhotoBlobRecord, PhotoKind, PhotoUploadState } from './idb';

export interface PhotoUploadItem extends PhotoBlobRecord {
  id: string;
}

/** 큐가 저장 위치를 모르도록 한 얇은 경계 — CrewStore의 IDB/메모리 폴백이 이를 구현한다. */
export interface PhotoUploadStorage {
  listPhotoUploads(): PhotoUploadItem[];
  getPhotoUpload(photoId: string): PhotoBlobRecord | undefined;
  setPhotoUploadState(photoId: string, state: PhotoUploadState, pct: number): void;
}

export interface PhotoUploadEnvironment {
  isOnline(): boolean;
  addEventListener(type: 'online' | 'offline', listener: () => void): void;
  removeEventListener(type: 'online' | 'offline', listener: () => void): void;
}

export type PhotoUploadTransport = (
  photoId: string,
  kind: PhotoKind,
  blob: Blob,
  token: string,
  onProgress: (loaded: number) => void,
  signal: AbortSignal,
) => Promise<void>;

class UploadInterrupted extends Error {}

function browserEnvironment(): PhotoUploadEnvironment {
  return {
    // navigator.onLine은 "서버 도달 가능" 판정은 아니지만 offline 이벤트와 같은 기준을
    // 써야 네트워크 오류(fail)와 명시적인 오프라인 대기(wait)가 서로 뒤집히지 않는다.
    isOnline: () => typeof navigator === 'undefined' || navigator.onLine,
    addEventListener: (type, listener) => window.addEventListener(type, listener),
    removeEventListener: (type, listener) => window.removeEventListener(type, listener),
  };
}

/** 두 요청의 실제 바이트를 합산한 진행률. thumb가 작아도 50%로 부풀리지 않는다. */
export function combinedUploadPercent(
  thumbSize: number,
  fullSize: number,
  thumbLoaded: number,
  fullLoaded: number,
): number {
  const total = Math.max(0, thumbSize) + Math.max(0, fullSize);
  if (total === 0) return 100;
  const loaded =
    Math.min(Math.max(0, thumbLoaded), Math.max(0, thumbSize)) +
    Math.min(Math.max(0, fullLoaded), Math.max(0, fullSize));
  return Math.max(0, Math.min(100, Math.round((loaded / total) * 100)));
}

/** upload.onprogress가 필요한 바이너리 전송만 XHR로 격리한다. */
export const uploadPhotoWithXHR: PhotoUploadTransport = (
  photoId,
  kind,
  blob,
  token,
  onProgress,
  signal,
) =>
  new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let settled = false;
    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', abort);
      fn();
    };
    const abort = (): void => {
      xhr.abort();
      finish(() => reject(new UploadInterrupted('upload aborted')));
    };

    xhr.open('PUT', `/api/photos/${encodeURIComponent(photoId)}?kind=${kind}`);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.setRequestHeader('Content-Type', 'image/jpeg');
    xhr.upload.onprogress = (event) => {
      // 일부 엔진은 lengthComputable=false여도 loaded는 정확히 준다. 상한은 큐에서 blob.size로 건다.
      onProgress(event.loaded);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) finish(resolve);
      else finish(() => reject(new Error(`photo ${kind} ${xhr.status}`)));
    };
    xhr.onerror = () => finish(() => reject(new Error(`photo ${kind} network error`)));
    xhr.onabort = () => finish(() => reject(new UploadInterrupted('upload aborted')));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    else xhr.send(blob);
  });

export interface PhotoUploadQueueOptions {
  token: string | null;
  demo: boolean;
  environment?: PhotoUploadEnvironment;
  transport?: PhotoUploadTransport;
}

/**
 * 한 장의 thumb→full을 끝낸 뒤 다음 사진으로 넘어가는 직렬 큐.
 * 실패는 fail에서 멈추며 retryPhoto만 다시 넣는다. online은 wait만 자동 재개한다.
 */
export class PhotoUploadQueue {
  private readonly environment: PhotoUploadEnvironment;
  private readonly transport: PhotoUploadTransport;
  private readonly pending: string[] = [];
  private readonly queued = new Set<string>();
  private active: { id: string; controller: AbortController } | null = null;
  private running: Promise<void> | null = null;
  private started = false;

  private readonly onOnline = (): void => {
    if (!this.started || this.options.demo || !this.options.token) return;
    for (const item of this.storage.listPhotoUploads()) {
      if (item.state !== 'wait') continue;
      this.storage.setPhotoUploadState(item.id, 'up', 0);
      this.enqueueReady(item.id);
    }
  };

  private readonly onOffline = (): void => {
    if (!this.started || this.options.demo) return;
    this.pending.length = 0;
    this.queued.clear();
    for (const item of this.storage.listPhotoUploads()) {
      if (item.state === 'up') this.storage.setPhotoUploadState(item.id, 'wait', item.pct);
    }
    this.active?.controller.abort();
  };

  constructor(
    private readonly storage: PhotoUploadStorage,
    private readonly options: PhotoUploadQueueOptions,
  ) {
    this.environment = options.environment ?? browserEnvironment();
    this.transport = options.transport ?? uploadPhotoWithXHR;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.environment.addEventListener('online', this.onOnline);
    this.environment.addEventListener('offline', this.onOffline);

    for (const item of this.storage.listPhotoUploads()) {
      if (item.state === 'done' || item.state === 'fail') continue;
      this.queuePhoto(item.id);
    }
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.environment.removeEventListener('online', this.onOnline);
    this.environment.removeEventListener('offline', this.onOffline);
    this.pending.length = 0;
    this.queued.clear();
    const active = this.active;
    if (active) {
      const item = this.storage.getPhotoUpload(active.id);
      if (item?.state === 'up') this.storage.setPhotoUploadState(active.id, 'wait', item.pct);
      active.controller.abort();
    }
  }

  /** 새로 저장된 사진 또는 시작 시 복구한 사진을 현재 연결 상태에 맞춰 넣는다. */
  queuePhoto(photoId: string): void {
    const item = this.storage.getPhotoUpload(photoId);
    if (!item) return;
    if (this.options.demo) {
      this.storage.setPhotoUploadState(photoId, 'done', 100);
      return;
    }
    // done은 불변 UUID라 다시 올리지 않고, fail은 오직 retryPhoto만 빠져나갈 수 있다.
    if (item.state === 'done' || item.state === 'fail') return;
    // 같은 Entry의 다른 필드가 저장돼도 진행 중인 사진을 0%로 되감거나 중복 PUT하지 않는다.
    if (item.state === 'up' && (this.active?.id === photoId || this.queued.has(photoId))) return;
    if (!this.options.token || !this.environment.isOnline()) {
      this.storage.setPhotoUploadState(photoId, 'wait', item.pct);
      return;
    }
    // XHR 재개(resume)는 지원하지 않으므로 앱 재시작/수동 재시도 모두 0부터 다시 센다.
    this.storage.setPhotoUploadState(photoId, 'up', 0);
    this.enqueueReady(photoId);
  }

  /** fail만 수동 재시도한다. 오프라인이면 wait로 바꿔 다음 online 이벤트에 맡긴다. */
  retryPhoto(photoId: string): boolean {
    const item = this.storage.getPhotoUpload(photoId);
    if (!item || item.state !== 'fail') return false;
    this.storage.setPhotoUploadState(photoId, 'wait', item.pct);
    this.queuePhoto(photoId);
    return true;
  }

  /** 시트/기록에서 사진을 버릴 때 진행 중 XHR도 함께 끊는다. 행 삭제는 CrewStore가 한다. */
  cancel(photoId: string): void {
    const i = this.pending.indexOf(photoId);
    if (i >= 0) this.pending.splice(i, 1);
    this.queued.delete(photoId);
    if (this.active?.id === photoId) this.active.controller.abort();
  }

  /** 테스트와 명시적인 종료 경계용. 호출 시점까지 들어온 직렬 작업이 가라앉을 때까지 기다린다. */
  async whenIdle(): Promise<void> {
    while (this.running) await this.running;
  }

  private enqueueReady(photoId: string): void {
    if (!this.started || this.queued.has(photoId) || this.active?.id === photoId) return;
    this.queued.add(photoId);
    this.pending.push(photoId);
    this.kick();
  }

  private kick(): void {
    if (this.running || !this.started) return;
    this.running = this.drain().finally(() => {
      this.running = null;
      if (this.pending.length > 0 && this.started) this.kick();
    });
  }

  private async drain(): Promise<void> {
    while (this.started) {
      const photoId = this.pending.shift();
      if (!photoId) return;
      this.queued.delete(photoId);
      const item = this.storage.getPhotoUpload(photoId);
      if (!item || item.state !== 'up') continue;
      await this.uploadOne(photoId, item);
    }
  }

  private async uploadOne(photoId: string, initial: PhotoBlobRecord): Promise<void> {
    const token = this.options.token;
    if (!token) return;
    const controller = new AbortController();
    this.active = { id: photoId, controller };
    let thumbLoaded = 0;
    let fullLoaded = 0;
    const progress = (): void => {
      const current = this.storage.getPhotoUpload(photoId);
      if (!current || current.state !== 'up') return;
      this.storage.setPhotoUploadState(
        photoId,
        'up',
        combinedUploadPercent(initial.thumb.size, initial.full.size, thumbLoaded, fullLoaded),
      );
    };
    const ensureActive = (): void => {
      const current = this.storage.getPhotoUpload(photoId);
      if (
        controller.signal.aborted ||
        !current ||
        current.state !== 'up' ||
        !this.environment.isOnline()
      ) {
        throw new UploadInterrupted('upload no longer active');
      }
    };

    try {
      ensureActive();
      await this.transport(
        photoId,
        'thumb',
        initial.thumb,
        token,
        (loaded) => {
          thumbLoaded = loaded;
          progress();
        },
        controller.signal,
      );
      thumbLoaded = initial.thumb.size;
      progress();
      ensureActive();
      await this.transport(
        photoId,
        'full',
        initial.full,
        token,
        (loaded) => {
          fullLoaded = loaded;
          progress();
        },
        controller.signal,
      );
      const current = this.storage.getPhotoUpload(photoId);
      if (current?.state === 'up') this.storage.setPhotoUploadState(photoId, 'done', 100);
    } catch (error) {
      const current = this.storage.getPhotoUpload(photoId);
      if (!current) return;
      if (
        error instanceof UploadInterrupted ||
        controller.signal.aborted ||
        !this.environment.isOnline() ||
        current.state === 'wait'
      ) {
        if (current.state === 'up') this.storage.setPhotoUploadState(photoId, 'wait', current.pct);
      } else {
        // HTTP·네트워크 오류는 자동 재시도하지 않는다. 사용자의 retryPhoto가 유일한 출구다.
        this.storage.setPhotoUploadState(photoId, 'fail', current.pct);
      }
    } finally {
      if (this.active?.controller === controller) this.active = null;
      // offline 직후 online이 먼저 오면 onOnline은 wait를 up으로 바꾸지만, 아직 active인
      // 같은 id는 enqueueReady가 중복으로 보고 건너뛴다. 그 뒤 abort catch가 wait로
      // 되돌리면 다음 online 이벤트가 없어 영구 대기한다. active 정산 뒤 현재 연결 상태를
      // 다시 확인해 그 한 장만 재큐잉하면 두 이벤트의 순서와 무관하게 수렴한다.
      const current = this.storage.getPhotoUpload(photoId);
      if (
        this.started &&
        current?.state === 'wait' &&
        this.environment.isOnline()
      ) {
        this.queuePhoto(photoId);
      }
    }
  }
}
