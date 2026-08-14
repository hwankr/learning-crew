/** 브라우저에서 사진 원본을 버리고 표시용 JPEG 두 장만 만드는 경계. */

export interface ImageSize {
  w: number;
  h: number;
}

export interface PreparedUpload extends ImageSize {
  full: Blob;
  thumb: Blob;
}

/** UI가 HEIC 미지원 같은 디코드 실패를 일반 업로드 오류와 구분할 수 있는 에러. */
export class ImageDecodeError extends Error {
  readonly code = 'IMAGE_DECODE_FAILED';

  constructor(cause?: unknown) {
    super('선택한 이미지를 이 브라우저에서 읽을 수 없습니다.', { cause });
    this.name = 'ImageDecodeError';
  }
}

export class ImageEncodeError extends Error {
  readonly code = 'IMAGE_ENCODE_FAILED';

  constructor() {
    super('이미지를 JPEG로 변환하지 못했습니다.');
    this.name = 'ImageEncodeError';
  }
}

/** 긴 변만 제한하고 작은 이미지는 늘리지 않는다. 반올림 뒤에도 두 축은 최소 1px이다. */
export function containedImageSize(width: number, height: number, maxEdge: number): ImageSize {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    !Number.isFinite(maxEdge) ||
    width <= 0 ||
    height <= 0 ||
    maxEdge <= 0
  ) {
    throw new RangeError('image dimensions must be positive finite numbers');
  }
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return {
    w: Math.max(1, Math.round(width * scale)),
    h: Math.max(1, Math.round(height * scale)),
  };
}

function canvasJpeg(bitmap: ImageBitmap, size: ImageSize, quality: number): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = size.w;
  canvas.height = size.h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.reject(new ImageEncodeError());
  ctx.drawImage(bitmap, 0, 0, size.w, size.h);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new ImageEncodeError())),
      'image/jpeg',
      quality,
    );
  });
}

/**
 * EXIF 방향을 반영해 디코드한 뒤 표시용(1600px, q=.82)과 썸네일(400px, q=.8)을 만든다.
 * 원본 Blob은 반환하거나 저장하지 않는다.
 */
export async function prepareUpload(file: File): Promise<PreparedUpload> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch (error) {
    throw new ImageDecodeError(error);
  }

  try {
    if (bitmap.width <= 0 || bitmap.height <= 0) throw new ImageDecodeError();
    const fullSize = containedImageSize(bitmap.width, bitmap.height, 1600);
    const thumbSize = containedImageSize(bitmap.width, bitmap.height, 400);
    const [full, thumb] = await Promise.all([
      canvasJpeg(bitmap, fullSize, 0.82),
      canvasJpeg(bitmap, thumbSize, 0.8),
    ]);
    return { full, thumb, w: fullSize.w, h: fullSize.h };
  } finally {
    bitmap.close();
  }
}
