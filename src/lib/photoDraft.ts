/* 고른 파일을 시트에 붙이는 흐름. 리사이즈는 한 장씩 시간이 걸리고, 그 사이 시트가 닫히거나
   다른 기록으로 바뀔 수 있다 — 그때 도착한 결과는 붙일 자리가 없으므로 화면만 건너뛰면
   안 되고 로컬 JPEG까지 되돌려야 한다(안 그러면 photoBlobs·IDB에 주인 없는 사진이 남고,
   같은 기록을 다시 열었을 때 취소한 사진이 새 세션에 끼어든다). */
import type { EntryPhoto } from '../../shared/types';

export interface AddDraftPhotosOptions {
  files: readonly File[];
  /** 지금 시트에 아직 들어갈 수 있는 장수 */
  room: number;
  /** 디코드·리사이즈해 스토어에 넣는다. added는 이 묶음에서 이미 붙인 사진(자리 계산용) —
      디코드는 한 장씩 끝나지만 네 장 경계는 "지금 시트에 있는 전부"를 기준으로 세야 한다. */
  prepare: (file: File, added: readonly EntryPhoto[]) => Promise<EntryPhoto>;
  /** 결과를 붙일 시트가 아직 그대로인가(같은 세션인가) */
  isCurrent: () => boolean;
  attach: (photo: EntryPhoto) => void;
  /** 세션이 끝난 뒤 도착한 사진을 되돌린다(removeDraftPhoto) */
  discard: (photoId: string) => void;
  onError: (err: unknown) => void;
}

/** 붙는 데 성공한 사진들. 한 장이라도 실패하면 거기서 멈춘다 — 같은 이유로 뒤도 실패할
    가능성이 크고, 토스트를 파일 수만큼 쏟아내지 않는다. */
export async function addDraftPhotos(o: AddDraftPhotosOptions): Promise<EntryPhoto[]> {
  const added: EntryPhoto[] = [];
  for (const file of o.files.slice(0, o.room)) {
    if (!o.isCurrent()) break;
    let photo: EntryPhoto;
    try {
      photo = await o.prepare(file, added);
    } catch (err) {
      o.onError(err);
      break;
    }
    if (!o.isCurrent()) {
      o.discard(photo.id);
      break;
    }
    added.push(photo);
    o.attach(photo);
  }
  return added;
}
