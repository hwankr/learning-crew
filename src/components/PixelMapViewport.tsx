import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { MemberId } from '../../shared/types';

/** Camera movement is independent of the world: zooming never restarts an actor's walk. */
export function PixelMapViewport({ selected, compact, motion, children }: {
  selected: MemberId; compact: boolean; motion: boolean; children: ReactNode;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const pendingCenter = useRef<{ x: number; y: number } | null>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const [zoom, setZoom] = useState(() => typeof window !== 'undefined' && (compact || window.innerWidth < 680) ? 2.5 : 1);
  const [baseWidth, setBaseWidth] = useState<number>();
  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const resize = () => setBaseWidth(Math.min(element.clientWidth, element.clientHeight * 1.6));
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
    const element = viewport.current;
    if (element) pendingCenter.current = { x: (element.scrollLeft + element.clientWidth / 2) / element.scrollWidth,
      y: (element.scrollTop + element.clientHeight / 2) / element.scrollHeight };
    setZoom(Math.max(1, Math.min(3, value)));
  };
  return <div className="pixel-map">
    <div className="pixel-map-toolbar" role="group" aria-label="지도 보기">
      <span className="pixel-map-hint">드래그해서 둘러보기</span>
      <button type="button" onClick={focusMember} aria-label="선택한 크루로 화면 이동">크루 찾기
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true"><circle cx="8" cy="8" r="4" /><path d="M8 1v4m0 6v4M1 8h4m6 0h4" /></svg>
      </button>
      <div className="pixel-map-zoom">
        <button type="button" onClick={() => changeZoom(zoom - .5)} disabled={zoom <= 1} aria-label="지도 축소">−</button>
        <button type="button" onClick={() => changeZoom(1)} aria-label="지도 전체 보기">{Math.round(zoom * 100)}%</button>
        <button type="button" onClick={() => changeZoom(zoom + .5)} disabled={zoom >= 3} aria-label="지도 확대">+</button>
      </div>
    </div>
    <div ref={viewport} className="pixel-map-viewport pixel-room-stage" data-motion={motion ? 'on' : 'off'}
      data-zoom={zoom} tabIndex={0} role="region" aria-label="숲속 캠퍼스 지도 · 방향키 또는 드래그로 이동"
      onPointerDown={(event) => {
        if (event.pointerType !== 'mouse' || event.button !== 0 || (event.target as Element).closest('[role="button"]')) return;
        const element = event.currentTarget;
        drag.current = { x: event.clientX, y: event.clientY, left: element.scrollLeft, top: element.scrollTop };
        element.setPointerCapture(event.pointerId);
        element.dataset.dragging = 'true';
      }} onPointerMove={(event) => {
        if (!drag.current) return;
        event.currentTarget.scrollTo(drag.current.left - event.clientX + drag.current.x, drag.current.top - event.clientY + drag.current.y);
      }} onPointerUp={(event) => { drag.current = null; delete event.currentTarget.dataset.dragging; }}
      onLostPointerCapture={(event) => { drag.current = null; delete event.currentTarget.dataset.dragging; }}>
      <div className="pixel-map-canvas" style={{ width: baseWidth ? baseWidth * zoom : `${zoom * 100}%` }}>{children}</div>
    </div>
  </div>;
}
