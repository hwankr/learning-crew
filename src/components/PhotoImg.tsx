/* 사진 한 장을 그리는 자리 — 시트 썸네일·모자이크·라이트박스 썸네일이 함께 쓴다.
   URL은 전부 usePhotoUrl(내 blob → 내려받은 캐시 → 인증 fetch)에서 온다. */
import type { PhotoKind } from '../local/idb';
import { usePhotoUrl } from '../lib/usePhoto';
import { PhotoIcon } from './icons';

/** 감싸는 쪽이 position:relative·배경·radius를 맡는다 — 여기서는 자리 표시 아이콘 위에
    받아 온 이미지를 겹친다. 아직 못 받은 사진(상대 기기가 업로드 중)은 아이콘만 남는다.
    alt는 감싸는 버튼이 이름을 가지면 빈 문자열로 — 같은 말을 두 번 읽지 않게 한다. */
export function PhotoImg({
  photoId, kind, alt, icon, iconColor = 'rgba(22,24,29,0.24)', iconSw = 1.9, lens,
}: {
  photoId: string;
  kind: PhotoKind;
  alt: string;
  icon: number;
  iconColor?: string;
  iconSw?: number;
  lens?: boolean;
}) {
  const { url } = usePhotoUrl(photoId, kind);
  return (
    <>
      <span className="photo-ph" aria-hidden="true">
        <PhotoIcon size={icon} color={iconColor} sw={iconSw} lens={lens} />
      </span>
      {url && <img className="photo-img" src={url} alt={alt} />}
    </>
  );
}
