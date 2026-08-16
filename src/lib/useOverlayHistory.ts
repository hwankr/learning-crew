import { useLayoutEffect, useRef } from 'react';
import {
  OverlayHistoryController,
  type OpenOverlay,
  type OverlayClose,
  type OverlayHistoryPort,
} from './overlayHistory';

export interface OverlayBackTarget {
  id: string;
  open: boolean;
  close: OverlayClose;
}

function browserHistoryPort(): OverlayHistoryPort {
  return {
    getState: () => window.history.state,
    pushState: (state) => window.history.pushState(state, ''),
    back: () => window.history.back(),
    subscribe: (listener) => {
      const onPopState = (event: PopStateEvent) => listener(event.state);
      window.addEventListener('popstate', onPopState);
      return () => window.removeEventListener('popstate', onPopState);
    },
  };
}

/** 배열 순서는 아래에서 위다. 이미 열린 항목은 자리를 유지하고 새 항목만 맨 위에 쌓인다. */
export function useOverlayHistory(targets: readonly OverlayBackTarget[]): void {
  const controllerRef = useRef<OverlayHistoryController | null>(null);
  if (controllerRef.current === null) {
    controllerRef.current = new OverlayHistoryController(browserHistoryPort());
  }

  useLayoutEffect(() => {
    const controller = controllerRef.current!;
    controller.start();
    return () => controller.stop();
  }, []);

  useLayoutEffect(() => {
    const open: OpenOverlay[] = targets
      .filter((target) => target.open)
      .map(({ id, close }) => ({ id, close }));
    controllerRef.current!.sync(open);
  });
}
