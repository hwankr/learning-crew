export const OVERLAY_HISTORY_STATE_KEY = '__learningCrewOverlayHistory';

interface OverlayHistoryMarker {
  version: 1;
  session: string;
  entry: number;
}

export type OverlayClose = () => boolean | void;

export interface OpenOverlay {
  id: string;
  close: OverlayClose;
}

export interface OverlayHistoryPort {
  getState: () => unknown;
  pushState: (state: unknown) => void;
  back: () => void;
  subscribe: (listener: (state: unknown) => void) => () => void;
}

interface OverlayRecord {
  overlayId: string;
  marker: OverlayHistoryMarker;
  close: OverlayClose;
  active: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readMarker(state: unknown): OverlayHistoryMarker | null {
  if (!isRecord(state)) return null;
  const marker = state[OVERLAY_HISTORY_STATE_KEY];
  if (!isRecord(marker)) return null;
  if (
    marker.version !== 1
    || typeof marker.session !== 'string'
    || typeof marker.entry !== 'number'
    || !Number.isSafeInteger(marker.entry)
  ) {
    return null;
  }
  return marker as unknown as OverlayHistoryMarker;
}

function markerKey(marker: OverlayHistoryMarker): string {
  return `${marker.session}:${marker.entry}`;
}

function sameMarker(a: OverlayHistoryMarker | null, b: OverlayHistoryMarker | null): boolean {
  return a !== null && b !== null && markerKey(a) === markerKey(b);
}

function stateWithMarker(state: unknown, marker: OverlayHistoryMarker): Record<string, unknown> {
  return {
    ...(isRecord(state) ? state : {}),
    [OVERLAY_HISTORY_STATE_KEY]: marker,
  };
}

function makeSessionId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

/**
 * React 상태와 비동기 history traversal 사이를 직렬화한다.
 * 닫힌 marker는 한 번에 하나씩만 back해서, 그 popstate가 아래 오버레이를 닫는 입력으로
 * 잘못 해석되지 않게 한다.
 */
export class OverlayHistoryController {
  private readonly session: string;
  private nextEntry = 0;
  private desired = new Map<string, OverlayClose>();
  private readonly records = new Map<string, OverlayRecord>();
  private readonly activeByOverlay = new Map<string, string>();
  private current: OverlayHistoryMarker | null = null;
  private pendingBack: string | null = null;
  private unsubscribe: (() => void) | null = null;
  private started = false;

  constructor(
    private readonly port: OverlayHistoryPort,
    session = makeSessionId(),
  ) {
    this.session = session;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.current = readMarker(this.port.getState());
    this.unsubscribe = this.port.subscribe((state) => this.onPopState(state));
    // 새로고침 뒤 남은 예전 세션 marker는 보이는 오버레이가 없으므로 먼저 걷어 낸다.
    this.reconcile();
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  sync(overlays: readonly OpenOverlay[]): void {
    const next = new Map<string, OverlayClose>();
    for (const overlay of overlays) next.set(overlay.id, overlay.close);
    this.desired = next;

    for (const [overlayId, key] of this.activeByOverlay) {
      const record = this.records.get(key);
      const close = next.get(overlayId);
      if (record && close) {
        record.close = close;
      } else {
        if (record) record.active = false;
        this.activeByOverlay.delete(overlayId);
      }
    }

    this.reconcile();
  }

  private onPopState(state: unknown): void {
    const previous = this.current;
    const next = readMarker(state);
    this.current = next;

    // 같은 state를 알리는 비표준 이벤트는 traversal 완료로 세지 않는다.
    if (sameMarker(previous, next)) return;

    if (this.pendingBack !== null) {
      const consumed = this.pendingBack;
      this.pendingBack = null;
      if (previous && markerKey(previous) === consumed) this.retire(previous);
      this.reconcile();
      return;
    }

    if (previous?.session === this.session) {
      const record = this.records.get(markerKey(previous));
      if (record?.active) {
        this.retire(previous);
        // close가 상태를 갱신한 다음 layout effect가 실제 열린 목록을 다시 알려 준다.
        // false는 저장 중처럼 기존 닫기 콜백이 거절한 경우라 즉시 보호 marker를 복구한다.
        this.desired.delete(record.overlayId);
        const accepted = this.callClose(record.close);
        if (!accepted) this.desired.set(record.overlayId, record.close);
      } else {
        this.retire(previous);
      }
    }

    this.reconcile();
  }

  private callClose(close: OverlayClose): boolean {
    try {
      return close() !== false;
    } catch {
      // 콜백 실패로 열린 UI만 marker 없이 남기는 것보다 같은 화면을 계속 보호하는 편이 안전하다.
      return false;
    }
  }

  private retire(marker: OverlayHistoryMarker): void {
    const key = markerKey(marker);
    const record = this.records.get(key);
    if (!record) return;
    this.records.delete(key);
    if (this.activeByOverlay.get(record.overlayId) === key) {
      this.activeByOverlay.delete(record.overlayId);
    }
    record.active = false;
  }

  private reconcile(): void {
    if (!this.started || this.pendingBack !== null) return;
    this.current = readMarker(this.port.getState());

    if (this.current) {
      if (this.current.session !== this.session) {
        this.consumeCurrent();
        return;
      }

      const currentRecord = this.records.get(markerKey(this.current));
      if (!currentRecord?.active) {
        this.consumeCurrent();
        return;
      }
    } else if (this.activeByOverlay.size > 0) {
      // 사용자가 여러 칸을 건너뛰거나 외부 코드가 marker state를 바꾼 경우다. 현재 위치에
      // 다시 push하면 forward 쪽의 옛 marker가 잘리고, 보이는 오버레이 보호가 복구된다.
      for (const key of this.activeByOverlay.values()) {
        const record = this.records.get(key);
        if (record) record.active = false;
      }
      this.activeByOverlay.clear();
    }

    for (const [overlayId, close] of this.desired) {
      if (this.activeByOverlay.has(overlayId)) continue;
      const marker: OverlayHistoryMarker = {
        version: 1,
        session: this.session,
        entry: ++this.nextEntry,
      };
      const record: OverlayRecord = { overlayId, marker, close, active: true };
      const key = markerKey(marker);
      this.port.pushState(stateWithMarker(this.port.getState(), marker));
      this.records.set(key, record);
      this.activeByOverlay.set(overlayId, key);
      this.current = marker;
    }
  }

  private consumeCurrent(): void {
    if (!this.current) return;
    this.pendingBack = markerKey(this.current);
    try {
      this.port.back();
    } catch {
      // history 구현이 traversal을 거부해도 앱 이벤트 처리 자체는 깨뜨리지 않는다.
      this.pendingBack = null;
    }
  }
}
