import { canonicalUuid, type MemberId } from '../shared/types';
import {
  deletePhotoTombstones,
  pendingPhotoTombstoneIds,
  type Db,
} from './queries';

export type PhotoKind = 'full' | 'thumb';

export const PHOTO_MAX_BYTES: Record<PhotoKind, number> = {
  full: Math.floor(2.5 * 1024 * 1024),
  thumb: 300 * 1024,
};

/** kind 누락은 표시용 원본(full), 명시한 잘못된 값은 400 대상이다. */
export function parsePhotoKind(raw: string | undefined): PhotoKind | null {
  if (raw === undefined || raw === 'full') return 'full';
  return raw === 'thumb' ? 'thumb' : null;
}

/** photoId는 UUID로 검증한 뒤에만 들어오므로 사용자 입력이 R2 경로가 되지 않는다. */
export function photoObjectKey(photoId: string, kind: PhotoKind): string {
  const id = canonicalUuid(photoId);
  return kind === 'thumb' ? `p/${id}.t` : `p/${id}`;
}

export type BoundedBody = { tooLarge: false; data: Uint8Array } | { tooLarge: true };

/** R2 put은 길이를 아는 바디가 안전하고, 요청 스트림을 그대로 버퍼링하면
    Content-Length가 없는 과대 요청이 Worker 메모리를 먼저 소진할 수 있다. 상한+1에서
    즉시 취소해 최대 2.5MB만 메모리에 두고, 길이가 확정된 Uint8Array를 R2에 넘긴다. */
export async function readBoundedPhotoBody(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<BoundedBody> {
  if (body === null) return { tooLarge: false, data: new Uint8Array() };

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        try {
          await reader.cancel('photo exceeds size limit');
        } catch {
          // 이미 끝난/실패한 스트림의 cancel 오류는 413 판정을 바꾸지 않는다.
        }
        return { tooLarge: true };
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const data = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { tooLarge: false, data };
}

export type PutOwnedPhotoResult =
  | { ok: true; etag: string }
  | { ok: false; reason: 'forbidden' | 'conflict' };

/** head→conditional put으로 photoId 소유권을 지킨다.
    두 멤버가 같은 UUID를 동시에 처음 올려도 If-None-Match: *는 한쪽만 이기게 하고,
    진 쪽은 다시 head해 다른 멤버의 객체면 403으로 결정한다. */
export async function putOwnedPhoto(
  bucket: R2Bucket,
  key: string,
  data: Uint8Array,
  memberId: MemberId,
): Promise<PutOwnedPhotoResult> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const existing = await bucket.head(key);
    if (existing && existing.customMetadata?.memberId !== memberId) {
      return { ok: false, reason: 'forbidden' };
    }

    const onlyIf = new Headers();
    if (existing) onlyIf.set('if-match', existing.httpEtag);
    else onlyIf.set('if-none-match', '*');
    const stored = await bucket.put(key, data, {
      onlyIf,
      httpMetadata: { contentType: 'image/jpeg' },
      customMetadata: { memberId },
    });
    if (stored) return { ok: true, etag: stored.httpEtag };
  }

  // 두 번의 조건부 쓰기 사이에 동시 요청이 끼었다. 같은 소유자가 이미
  // 올렸다면 내용 불변 UUID의 멱등 재전송으로 성공 처리하고, 다른 소유자면 금지한다.
  const current = await bucket.head(key);
  if (current?.customMetadata?.memberId === memberId) {
    return { ok: true, etag: current.httpEtag };
  }
  return current ? { ok: false, reason: 'forbidden' } : { ok: false, reason: 'conflict' };
}

export interface PhotoCleanupResult {
  deleted: string[];
  failed: string[];
}

/** 톰스톤이 지키는 photo id의 R2 두 객체를 재시도한다.
    R2 배치가 실패하면 해당 id는 DB에 그대로 남고, 성공한 묶음만 지운다.
    DB 정산이 실패해도 R2 delete는 멱등이므로 다음 cron이 안전하게 다시 시도한다. */
export async function cleanupPhotoTombstones(
  db: Db,
  bucket: R2Bucket,
): Promise<PhotoCleanupResult> {
  const ids = await pendingPhotoTombstoneIds(db);
  const deleted: string[] = [];
  const failed: string[] = [];

  // id 100개 = R2 키 200개로, 배치 delete 상한(1000)보다 작게 둔다.
  for (let offset = 0; offset < ids.length; offset += 100) {
    const batch = ids.slice(offset, offset + 100);
    const keys = batch.flatMap((id) => [
      photoObjectKey(id, 'full'),
      photoObjectKey(id, 'thumb'),
    ]);
    try {
      await bucket.delete(keys);
      await deletePhotoTombstones(db, batch);
      deleted.push(...batch);
    } catch (error) {
      failed.push(...batch);
      console.error(JSON.stringify({
        message: 'photo tombstone cleanup failed',
        error: error instanceof Error ? error.message : String(error),
        count: batch.length,
      }));
    }
  }
  return { deleted, failed };
}
