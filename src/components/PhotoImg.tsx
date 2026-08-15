/* 사진 한 장을 그리는 자리 — 시트 썸네일·모자이크·라이트박스 썸네일이 함께 쓴다.
   URL은 전부 usePhotoUrl(내 blob → 내려받은 캐시 → 인증 fetch)에서 온다. */
import { useEffect, useRef, useState } from 'react';
import type { PhotoKind } from '../local/idb';
import { usePhotoUrl } from '../lib/usePhoto';
import { PhotoIcon } from './icons';

export const PHOTO_VIEWPORT_ROOT_MARGIN = '600px 0px';

/** 화면 인접 영역을 벗어나면 false도 전달한다 — hook 구독이 끊겨 retry와 object URL도 쉰다. */
export function observePhotoViewport(
  target: Element,
  onActive: (active: boolean) => void,
): () => void {
  if (typeof IntersectionObserver === 'undefined') {
    onActive(true); // 구형 브라우저에서는 사진 기능 자체를 보존한다.
    return () => undefined;
  }
  let stopped = false;
  const observer = new IntersectionObserver((entries) => {
    if (stopped) return;
    const entry = entries.find((candidate) => candidate.target === target);
    if (entry) onActive(entry.isIntersecting || entry.intersectionRatio > 0);
  }, { rootMargin: PHOTO_VIEWPORT_ROOT_MARGIN, threshold: 0 });
  observer.observe(target);
  return () => {
    stopped = true;
    observer.unobserve(target);
    observer.disconnect();
  };
}

/** 감싸는 쪽이 position:relative·배경·radius를 맡는다 — 여기서는 자리 표시 아이콘 위에
    받아 온 이미지를 겹친다. 아직 못 받은 사진(상대 기기가 업로드 중)은 아이콘만 남는다.
    alt는 감싸는 버튼이 이름을 가지면 빈 문자열로 — 같은 말을 두 번 읽지 않게 한다. */
export function PhotoImg({
  photoId, kind, alt, icon, iconColor = 'rgba(22,24,29,0.24)', iconSw = 1.9, lens,
  immediate = false, preview,
}: {
  photoId: string;
  kind: PhotoKind;
  alt: string;
  icon: number;
  iconColor?: string;
  iconSw?: number;
  lens?: boolean;
  /** 라이트박스 무대·열린 작성 시트처럼 이미 사용자가 보고 있는 사진. */
  immediate?: boolean;
  /** 본 사진이 도착하기 전에 흐리게 깔아 둘 가벼운 해상도(라이트박스 무대와 같은 방식).
      큰 full을 기다리는 자리에서만 쓴다 — 썸네일 자체를 그리는 자리에는 필요 없다. */
  preview?: PhotoKind;
}) {
  const placeholderRef = useRef<HTMLSpanElement>(null);
  const [intersectsViewport, setIntersectsViewport] = useState(false);

  useEffect(() => {
    if (immediate) return;
    const target = placeholderRef.current;
    if (!target) return;
    return observePhotoViewport(target, setIntersectsViewport);
  }, [immediate]);

  const active = immediate || intersectsViewport;
  const { url, status } = usePhotoUrl(photoId, kind, active);
  // preview가 없으면 구독하지 않는다 — kind를 그대로 넘겨도 active=false라 아무 일도 하지 않는다.
  const previewState = usePhotoUrl(photoId, preview ?? kind, active && preview !== undefined);
  const previewIsFallback =
    status === 'missing' || status === 'auth' || status === 'transient';
  return (
    <>
      <span ref={placeholderRef} className="photo-ph" aria-hidden="true">
        <PhotoIcon size={icon} color={iconColor} sw={iconSw} lens={lens} />
      </span>
      {previewState.url && !url && (
        <img
          className={'photo-img' + (previewIsFallback ? '' : ' blur')}
          src={previewState.url}
          alt={previewIsFallback ? alt : ''}
          aria-hidden={previewIsFallback ? undefined : true}
        />
      )}
      {url && <img className="photo-img" src={url} alt={alt} />}
    </>
  );
}
