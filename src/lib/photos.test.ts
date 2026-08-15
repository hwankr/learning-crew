import { describe, expect, it } from 'vitest';
import type { EntryPhoto } from '../../shared/types';
import type { PhotoUploadInfo } from '../local/store';
import { lightboxIndex, shownPhotos } from './photos';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const photos: EntryPhoto[] = [
  { id: A, w: 1600, h: 900 },
  { id: B, w: 1600, h: 900 },
  { id: C, w: 1600, h: 900 },
];

describe('lightboxIndex (확대 뷰가 보고 있는 자리)', () => {
  it('앞 사진의 업로드가 끝나 목록이 늘어도 보던 사진을 계속 가리킨다', () => {
    // A가 올라가는 중이라 B·C만 보이던 상태에서 B를 열었다(그때 자리는 0번)
    const uploading = new Map<string, PhotoUploadInfo>([[A, { state: 'up', pct: 40 }]]);
    const before = shownPhotos(photos, true, uploading);
    expect(before.map((p) => p.id)).toEqual([B, C]);
    expect(lightboxIndex(before, B)).toBe(0);

    // 보는 동안 A의 업로드가 끝나 목록 앞에 끼어든다 — 숫자 0을 들고 있었다면 A가 열린다
    const after = shownPhotos(photos, true, new Map());
    expect(lightboxIndex(after, B)).toBe(1);
    expect(after[lightboxIndex(after, B)]?.id).toBe(B);
  });

  it('보던 사진이 목록에서 빠지면 첫 장으로 돌아간다', () => {
    expect(lightboxIndex(photos, 'gone')).toBe(0);
    expect(lightboxIndex([], A)).toBe(0);
  });
});
