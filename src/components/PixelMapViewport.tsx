import { useCallback, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { MemberId } from '../../shared/types';
import { useFocusTrap } from '../lib/useFocusTrap';
import { Icon, X_D } from './icons';

/** Keep the same world mounted while the camera fills the browser window. */
function FullscreenSession({ map }: { map: RefObject<HTMLDivElement | null> }) {
  useFocusTrap(map);
  useLayoutEffect(() => {
    const element = map.current;
    if (!element) return;
    // The map lives deep inside the crew panel. Only siblings along its ancestor
    // path become inert, so its own characters remain selectable.
    const background: HTMLElement[] = [];
    for (let branch: HTMLElement | null = element; branch?.parentElement; branch = branch.parentElement) {
      for (const sibling of branch.parentElement.children) {
        if (sibling !== branch && sibling instanceof HTMLElement && !sibling.inert) {
          sibling.inert = true;
          background.push(sibling);
        }
      }
      if (branch.parentElement === document.body) break;
    }
    const overflow = document.documentElement.style.overflow;
    const gutter = document.documentElement.style.scrollbarGutter;
    document.documentElement.style.overflow = 'hidden';
    document.documentElement.style.scrollbarGutter = 'auto';
    element.querySelector<HTMLButtonElement>('.pixel-map-close')?.focus({ preventScroll: true });
    return () => {
      document.documentElement.style.overflow = overflow;
      document.documentElement.style.scrollbarGutter = gutter;
      for (const sibling of background) sibling.inert = false;
    };
  }, [map]);
  return null;
}

/** Camera movement is independent of the world: zooming never restarts an actor's walk. */
export function PixelMapViewport({ selected, motion, children }: {
  selected: MemberId; motion: boolean; children: ReactNode;
}) {
  const map = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const pendingCenter = useRef<{ x: number; y: number } | null>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const gesture = useRef<{ id: number; x: number; y: number; moved: boolean; revealOnTap: boolean } | null>(null);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [inlineHeight, setInlineHeight] = useState<number>();
  const [fullscreenZoom, setFullscreenZoom] = useState<number | null>(null);
  const [manualZoom, setManualZoom] = useState<number | null>(null);
  const [baseWidth, setBaseWidth] = useState<number>();
  const [viewportHeight, setViewportHeight] = useState(0);
  // Keep characters legible in a sidebar as well as a phone. Explicit zoom choices
  // survive resizing. Portrait fullscreen also uses the available height.
  const targetWidth = fullscreen && viewportHeight > (baseWidth ?? 0) ? Math.max(700, viewportHeight * 1.6) : 700;
  const zoom = (fullscreen ? fullscreenZoom : manualZoom)
    ?? (baseWidth ? Math.min(3, Math.max(1, Math.ceil(targetWidth / baseWidth * 2) / 2)) : 1);
  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const resize = () => {
      const width = Math.min(element.clientWidth, element.clientHeight * 1.6);
      if (width > 0) setBaseWidth(width);
      setViewportHeight(element.clientHeight);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const focusMember = useCallback(() => {
    const element = viewport.current;
    const actor = element?.querySelector<SVGGElement>(`[data-member="${selected}"]`);
    if (!element || !actor || actor.getAttribute('aria-hidden') === 'true') return;
    const matrix = actor.getScreenCTM();
    const rect = element.getBoundingClientRect();
    if (matrix) element.scrollTo({ left: element.scrollLeft + matrix.e - rect.left - rect.width / 2,
      top: element.scrollTop + matrix.f - rect.top - rect.height / 2 - 18 });
  }, [selected]);
  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    if (pendingCenter.current) {
      const point = pendingCenter.current;
      element.scrollTo(point.x * element.scrollWidth - element.clientWidth / 2, point.y * element.scrollHeight - element.clientHeight / 2);
      pendingCenter.current = null;
    } else focusMember();
  }, [zoom, baseWidth, focusMember]);
  const changeZoom = (value: number) => {
    const next = Math.max(1, Math.min(3, value));
    const element = viewport.current;
    if (element && next !== zoom) pendingCenter.current = { x: (element.scrollLeft + element.clientWidth / 2) / element.scrollWidth,
      y: (element.scrollTop + element.clientHeight / 2) / element.scrollHeight };
    if (fullscreen) setFullscreenZoom(next);
    else setManualZoom(next);
  };
  const endGesture = () => {
    gesture.current = null;
    drag.current = null;
    if (viewport.current) delete viewport.current.dataset.dragging;
  };
  const closeFullscreen = () => {
    endGesture();
    setControlsVisible(true);
    setFullscreen(false);
  };
  return <div className="pixel-map-frame" style={fullscreen ? { height: inlineHeight } : undefined}>
    <div ref={map} className="pixel-map" data-fullscreen={fullscreen}
      role={fullscreen ? 'dialog' : undefined} aria-modal={fullscreen ? true : undefined}
      aria-label={fullscreen ? '숲속 캠퍼스 전체화면' : undefined}
      onKeyDown={(event) => {
        if (fullscreen && event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          closeFullscreen();
        }
      }}>
      {fullscreen && <div className="pixel-map-fullscreen-head">
        <strong>숲속 캠퍼스</strong>
        <span>빈 곳을 탭하면 확대 버튼을 숨기거나 표시할 수 있어요</span>
        <button type="button" className="pixel-map-close" onClick={closeFullscreen} aria-label="전체화면 닫기">
          <span>닫기</span><Icon d={X_D} size={16} sw={1.8} />
        </button>
      </div>}
      <div className="pixel-map-toolbar" role="group" aria-label="지도 보기" hidden={!controlsVisible}>
        <span className="pixel-map-hint">드래그해서 둘러보기</span>
        <button type="button" className="pixel-map-expand" hidden={fullscreen} aria-label="지도 전체화면으로 보기"
          aria-haspopup="dialog" onClick={() => {
            endGesture();
            setInlineHeight(map.current?.getBoundingClientRect().height);
            setFullscreenZoom(null);
            setFullscreen(true);
          }}>
          <Icon d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5" size={13} sw={1.8} />
          <span>전체화면</span>
        </button>
        <div className="pixel-map-zoom">
          <button type="button" onClick={() => changeZoom(zoom - .5)} disabled={zoom <= 1} aria-label="지도 축소">−</button>
          <button type="button" onClick={() => changeZoom(1)} aria-label="지도 전체 보기">{Math.round(zoom * 100)}%</button>
          <button type="button" onClick={() => changeZoom(zoom + .5)} disabled={zoom >= 3} aria-label="지도 확대">+</button>
        </div>
      </div>
      <div ref={viewport} className="pixel-map-viewport pixel-room-stage" data-motion={motion ? 'on' : 'off'}
        data-zoom={zoom} tabIndex={0} role="region" aria-label="숲속 캠퍼스 지도 · 방향키 또는 드래그로 이동 · 빈 곳을 탭하거나 Enter 키로 확대 버튼 표시"
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setControlsVisible((visible) => !visible);
          }
        }}
        onPointerDown={(event) => {
          if (!event.isPrimary || event.button !== 0) return;
          const onActor = !!(event.target as Element).closest('[role="button"]');
          gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false,
            revealOnTap: !controlsVisible && !onActor };
          setControlsVisible(false);
          // Touch keeps native scrolling; only a blank-space tap can bring controls back.
          if (event.pointerType !== 'mouse' || onActor) return;
          const element = event.currentTarget;
          drag.current = { x: event.clientX, y: event.clientY, left: element.scrollLeft, top: element.scrollTop };
          element.setPointerCapture(event.pointerId);
          element.dataset.dragging = 'true';
        }} onPointerMove={(event) => {
          const current = gesture.current;
          if (!current || current.id !== event.pointerId) return;
          if (Math.hypot(event.clientX - current.x, event.clientY - current.y) > 8) current.moved = true;
          if (!drag.current) return;
          event.currentTarget.scrollTo(drag.current.left - event.clientX + drag.current.x, drag.current.top - event.clientY + drag.current.y);
        }} onPointerUp={(event) => {
          const current = gesture.current;
          if (!current || current.id !== event.pointerId) return;
          if (current.revealOnTap && !current.moved) setControlsVisible(true);
          endGesture();
        }} onPointerCancel={endGesture} onLostPointerCapture={endGesture}>
        <div className="pixel-map-canvas" style={{ width: baseWidth ? baseWidth * zoom : `${zoom * 100}%` }}>{children}</div>
      </div>
      {fullscreen && <FullscreenSession map={map} />}
    </div>
  </div>;
}
