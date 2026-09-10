import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { MemberId } from '../../shared/types';

/** Camera movement is independent of the world: zooming never restarts an actor's walk. */
export function PixelMapViewport({ selected, motion, children }: {
  selected: MemberId; motion: boolean; children: ReactNode;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const pendingCenter = useRef<{ x: number; y: number } | null>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const gesture = useRef<{ id: number; x: number; y: number; moved: boolean; revealOnTap: boolean } | null>(null);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [manualZoom, setManualZoom] = useState<number | null>(null);
  const [baseWidth, setBaseWidth] = useState<number>();
  // Keep characters legible in a sidebar as well as a phone. Explicit zoom choices
  // survive resizing; the default camera adapts to the space the map actually has.
  const zoom = manualZoom ?? (baseWidth ? Math.min(3, Math.max(1, Math.ceil(700 / baseWidth * 2) / 2)) : 1);
  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const resize = () => {
      const width = Math.min(element.clientWidth, element.clientHeight * 1.6);
      if (width > 0) setBaseWidth(width);
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
    setManualZoom(next);
  };
  const endGesture = () => {
    gesture.current = null;
    drag.current = null;
    if (viewport.current) delete viewport.current.dataset.dragging;
  };
  return <div className="pixel-map">
    <div className="pixel-map-toolbar" role="group" aria-label="지도 보기" hidden={!controlsVisible}>
      <span className="pixel-map-hint">드래그해서 둘러보기</span>
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
  </div>;
}
