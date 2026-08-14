import { describe, expect, it } from 'vitest';
import { containedImageSize } from './image';

describe('containedImageSize', () => {
  it('가로·세로 사진의 긴 변을 제한하고 비율을 유지한다', () => {
    expect(containedImageSize(4000, 3000, 1600)).toEqual({ w: 1600, h: 1200 });
    expect(containedImageSize(3000, 4000, 400)).toEqual({ w: 300, h: 400 });
  });

  it('작은 이미지는 업스케일하지 않는다', () => {
    expect(containedImageSize(320, 180, 1600)).toEqual({ w: 320, h: 180 });
  });

  it('아주 가느다란 이미지도 축을 0px로 만들지 않는다', () => {
    expect(containedImageSize(1, 10_000, 400)).toEqual({ w: 1, h: 400 });
  });

  it('잘못된 크기는 조용히 보정하지 않는다', () => {
    expect(() => containedImageSize(0, 100, 400)).toThrow(RangeError);
    expect(() => containedImageSize(100, Number.NaN, 400)).toThrow(RangeError);
  });
});
