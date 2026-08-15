/* 사진 표시 규칙 — 카드 배지·라이트박스·크루 썸네일이 같은 판정을 쓰게 한곳에 둔다. */
import type { EntryPhoto } from '../../shared/types';
import type { PhotoUploadInfo } from '../local/store';

/** 다 올라간 사진 — 상태 행이 없으면 이 값으로 읽는다. */
const DONE: PhotoUploadInfo = { state: 'done', pct: 100 };

/** 이 사진에 배지를 씌울지 정하는 상태.
    photoUploads는 이 기기가 고른 내 사진만 담는다 — 남의 사진이나 다른 기기에서 올린
    내 사진에는 행이 없고, 그건 "여기서 올릴 게 없다"는 뜻이므로 done으로 읽는다. */
export function photoStatusOf(
  photoId: string,
  mine: boolean,
  uploads: Map<string, PhotoUploadInfo>,
): PhotoUploadInfo {
  return (mine ? uploads.get(photoId) : undefined) ?? DONE;
}

/** 크게 볼 수 있는 사진만 — 아직 못 올린 내 사진은 라이트박스에 세우지 않는다
    (상대에게 아직 없는 사진이라 "크게 보기"가 빈 자리로 이어진다). */
export function shownPhotos(
  photos: readonly EntryPhoto[],
  mine: boolean,
  uploads: Map<string, PhotoUploadInfo>,
): EntryPhoto[] {
  return photos.filter((p) => photoStatusOf(p.id, mine, uploads).state === 'done');
}

/** 라이트박스가 보고 있는 사진의 지금 자리. 열린 뷰는 photoId로 들고 있고 자리는 볼 때마다
    다시 센다 — 숫자 index로 보관하면 보는 동안 앞쪽 사진이 done이 되어 목록이 늘었을 때
    같은 index가 다른 사진을 가리킨다. 보던 사진이 목록에서 빠졌으면 첫 장으로 돌아간다. */
export function lightboxIndex(photos: readonly EntryPhoto[], photoId: string): number {
  const i = photos.findIndex((p) => p.id === photoId);
  return i < 0 ? 0 : i;
}

export interface MosaicGrid {
  gridTemplateColumns: string;
  gridTemplateRows: string;
  height: string;
}

/** 피드 모자이크의 격자 — 1장은 넓게, 3장은 첫 장이 왼쪽을 세로로 다 쓴다(디자인). */
export function mosaicGrid(n: number): MosaicGrid {
  if (n === 1) return { gridTemplateColumns: '1fr', gridTemplateRows: '1fr', height: '240px' };
  if (n === 2) return { gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr', height: '168px' };
  if (n === 3) {
    return { gridTemplateColumns: '1.55fr 1fr', gridTemplateRows: '1fr 1fr', height: '220px' };
  }
  return { gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr', height: '220px' };
}

/** 3장 배치에서만 칸 자리를 지정한다 — 나머지는 흐르는 순서가 곧 디자인이다. */
const THREE_AREAS = ['1 / 1 / 3 / 2', '1 / 2 / 2 / 3', '2 / 2 / 3 / 3'];

export function mosaicArea(n: number, i: number): string | undefined {
  return n === 3 ? THREE_AREAS[i] : undefined;
}
