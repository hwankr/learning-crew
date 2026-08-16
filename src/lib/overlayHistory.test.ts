import { describe, expect, it, vi } from 'vitest';
import {
  OVERLAY_HISTORY_STATE_KEY,
  OverlayHistoryController,
  type OpenOverlay,
  type OverlayHistoryPort,
} from './overlayHistory';

class FakeHistory {
  readonly entries: unknown[];
  index: number;
  pushes = 0;
  backRequests = 0;
  private queuedBacks = 0;
  private readonly listeners = new Set<(state: unknown) => void>();

  constructor(entries: unknown[] = [{ page: 'outside' }, { page: 'app' }]) {
    this.entries = [...entries];
    this.index = this.entries.length - 1;
  }

  readonly port: OverlayHistoryPort = {
    getState: () => this.entries[this.index],
    pushState: (state) => {
      this.entries.splice(this.index + 1);
      this.entries.push(state);
      this.index += 1;
      this.pushes += 1;
    },
    // 실제 history.back처럼 popstate는 나중에 전달한다.
    back: () => {
      this.backRequests += 1;
      this.queuedBacks += 1;
    },
    subscribe: (listener) => {
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    },
  };

  flushBack(): void {
    expect(this.queuedBacks).toBeGreaterThan(0);
    this.queuedBacks -= 1;
    this.traverseBack();
  }

  userBack(): void {
    this.traverseBack();
  }

  private traverseBack(): void {
    if (this.index > 0) this.index -= 1;
    const state = this.entries[this.index];
    for (const listener of this.listeners) listener(state);
  }
}

function target(id: string, close = vi.fn()): OpenOverlay {
  return { id, close };
}

describe('OverlayHistoryController', () => {
  it('열릴 때 하나만 push하고 사용자 back마다 최상단 하나만 닫는다', () => {
    const history = new FakeHistory();
    const controller = new OverlayHistoryController(history.port, 'session');
    const closeSheet = vi.fn();
    const closeConfirm = vi.fn();
    const sheet = target('sheet', closeSheet);
    const confirm = target('confirm', closeConfirm);
    controller.start();

    controller.sync([sheet]);
    controller.sync([sheet]);
    expect(history.pushes).toBe(1);

    controller.sync([sheet, confirm]);
    expect(history.pushes).toBe(2);

    history.userBack();
    expect(closeConfirm).toHaveBeenCalledOnce();
    expect(closeSheet).not.toHaveBeenCalled();

    controller.sync([sheet]);
    history.userBack();
    expect(closeSheet).toHaveBeenCalledOnce();
    expect(history.index).toBe(1);
  });

  it('UI 닫기는 marker를 비동기로 소비하고 다음 back은 정상 내비게이션한다', () => {
    const history = new FakeHistory();
    const controller = new OverlayHistoryController(history.port, 'session');
    const close = vi.fn();
    controller.start();
    controller.sync([target('sheet', close)]);

    controller.sync([]);
    expect(history.backRequests).toBe(1);
    expect(history.index).toBe(2);
    expect(close).not.toHaveBeenCalled();

    history.flushBack();
    expect(history.index).toBe(1);
    expect(close).not.toHaveBeenCalled();

    history.userBack();
    expect(history.index).toBe(0);
    expect(close).not.toHaveBeenCalled();
  });

  it('UI back의 늦은 popstate가 아래 오버레이를 이중으로 닫지 않는다', () => {
    const history = new FakeHistory();
    const controller = new OverlayHistoryController(history.port, 'session');
    const closeLightbox = vi.fn();
    const closeConfirm = vi.fn();
    const lightbox = target('lightbox', closeLightbox);
    controller.start();
    controller.sync([lightbox, target('confirm', closeConfirm)]);

    controller.sync([lightbox]);
    history.flushBack();
    expect(closeConfirm).not.toHaveBeenCalled();
    expect(closeLightbox).not.toHaveBeenCalled();

    history.userBack();
    expect(closeLightbox).toHaveBeenCalledOnce();
  });

  it('같은 렌더에서 닫힌 여러 marker를 한 번씩 직렬 소비한다', () => {
    const history = new FakeHistory();
    const controller = new OverlayHistoryController(history.port, 'session');
    const closeSheet = vi.fn();
    const closeConfirm = vi.fn();
    controller.start();
    controller.sync([target('sheet', closeSheet), target('confirm', closeConfirm)]);

    controller.sync([]);
    expect(history.backRequests).toBe(1);
    history.flushBack();
    expect(history.backRequests).toBe(2);
    history.flushBack();

    expect(history.index).toBe(1);
    expect(closeSheet).not.toHaveBeenCalled();
    expect(closeConfirm).not.toHaveBeenCalled();
    history.userBack();
    expect(history.index).toBe(0);
  });

  it('아래 오버레이가 먼저 사라져도 사용자 back은 보이는 최상단만 닫고 tombstone을 걷는다', () => {
    const history = new FakeHistory();
    const controller = new OverlayHistoryController(history.port, 'session');
    const closeLightbox = vi.fn();
    const closeConfirm = vi.fn();
    const confirm = target('confirm', closeConfirm);
    controller.start();
    controller.sync([target('lightbox', closeLightbox), confirm]);

    controller.sync([confirm]);
    expect(history.backRequests).toBe(0);

    history.userBack();
    expect(closeConfirm).toHaveBeenCalledOnce();
    expect(closeLightbox).not.toHaveBeenCalled();
    expect(history.backRequests).toBe(1);

    history.flushBack();
    expect(history.index).toBe(1);
  });

  it('새로고침으로 남은 이전 세션 marker를 콜백 없이 정리한다', () => {
    const history = new FakeHistory();
    const old = new OverlayHistoryController(history.port, 'old-session');
    old.start();
    old.sync([target('sheet'), target('confirm')]);
    old.stop();

    const current = new OverlayHistoryController(history.port, 'new-session');
    current.start();
    expect(history.backRequests).toBe(1);
    history.flushBack();
    expect(history.backRequests).toBe(2);
    history.flushBack();
    expect(history.index).toBe(1);

    current.sync([target('sheet')]);
    expect(history.pushes).toBe(3);
    expect(history.index).toBe(2);
  });

  it('기존 닫기 콜백이 거절하면 현재 화면을 지키는 marker를 즉시 복구한다', () => {
    const history = new FakeHistory();
    const controller = new OverlayHistoryController(history.port, 'session');
    const rejectClose = vi.fn(() => false);
    controller.start();
    controller.sync([target('sheet', rejectClose)]);

    history.userBack();
    expect(rejectClose).toHaveBeenCalledOnce();
    expect(history.pushes).toBe(2);
    expect(history.index).toBe(2);
  });

  it('pushState가 현재 앱 history.state의 다른 필드를 보존한다', () => {
    const history = new FakeHistory([{ page: 'app', keep: 7 }]);
    const controller = new OverlayHistoryController(history.port, 'session');
    controller.start();
    controller.sync([target('sheet')]);

    expect(history.entries[history.index]).toMatchObject({
      page: 'app',
      keep: 7,
      [OVERLAY_HISTORY_STATE_KEY]: { version: 1, session: 'session', entry: 1 },
    });
  });
});
