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
    super('선택한 이미지를 읽을 수 없습니다. JPG/PNG로 변환하거나 사진 앱에서 공유해 주세요.', {
      cause,
    });
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

function canvasJpeg(source: CanvasImageSource, size: ImageSize, quality: number): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = size.w;
  canvas.height = size.h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.reject(new ImageEncodeError());
  // JPEG에는 alpha가 없다. 먼저 흰 바탕을 그려 PNG/WEBP 투명 영역이 검게 합성되지 않게 한다.
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, size.w, size.h);
  ctx.drawImage(source, 0, 0, size.w, size.h);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new ImageEncodeError())),
      'image/jpeg',
      quality,
    );
  });
}

interface DecodedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
}

function once(fn: () => void): () => void {
  let called = false;
  return () => {
    if (called) return;
    called = true;
    fn();
  };
}

function decodedBitmap(bitmap: ImageBitmap): DecodedImage {
  return {
    source: bitmap,
    width: bitmap.width,
    height: bitmap.height,
    release: once(() => bitmap.close()),
  };
}

/** createImageBitmap 자체가 없거나 두 호출 모두 거부한 WebKit의 마지막 decode 경로. */
async function decodeHtmlImage(file: File): Promise<DecodedImage> {
  const objectUrl = URL.createObjectURL(file);
  const release = once(() => URL.revokeObjectURL(objectUrl));
  try {
    const image = document.createElement('img');
    let loadedResolve!: () => void;
    let loadedReject!: (error: unknown) => void;
    const loaded = new Promise<void>((resolve, reject) => {
      loadedResolve = resolve;
      loadedReject = reject;
    });
    image.onload = () => loadedResolve();
    image.onerror = () => loadedReject(new Error('image element decode failed'));
    image.src = objectUrl;
    try {
      if (typeof image.decode === 'function') {
        try {
          await image.decode();
        } catch (decodeError) {
          // 일부 Safari는 표시 가능한 사진에서도 decode()를 거부한다. 실제 load 결과를 한 번 더 믿는다.
          try {
            await loaded;
          } catch {
            throw decodeError;
          }
        }
      } else {
        await loaded;
      }
    } finally {
      image.onload = null;
      image.onerror = null;
    }
    if (image.naturalWidth <= 0 || image.naturalHeight <= 0) {
      throw new Error('decoded image has no pixels');
    }
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      release,
    };
  } catch (error) {
    release();
    throw error;
  }
}

/** 명시적 EXIF 옵션 → 표준 기본값 → HTMLImageElement 순으로 구형 Safari까지 복구한다. */
async function decodeImage(file: File): Promise<DecodedImage> {
  try {
    return decodedBitmap(await createImageBitmap(file, { imageOrientation: 'from-image' }));
  } catch {
    // Safari 17.1 이하는 from-image enum을 거부할 수 있지만 optionless 기본은 EXIF를 따른다.
  }
  try {
    return decodedBitmap(await createImageBitmap(file));
  } catch {
    // API/format decode까지 실패하면 <img>가 마지막 호환 경계다.
  }
  try {
    return await decodeHtmlImage(file);
  } catch (error) {
    throw new ImageDecodeError(error);
  }
}

/**
 * EXIF 방향을 반영해 디코드한 뒤 표시용(1600px, q=.82)과 썸네일(400px, q=.8)을 만든다.
 * 원본 Blob은 반환하거나 저장하지 않는다.
 */
export async function prepareUpload(file: File): Promise<PreparedUpload> {
  const decoded = await decodeImage(file);

  try {
    if (decoded.width <= 0 || decoded.height <= 0) throw new ImageDecodeError();
    const fullSize = containedImageSize(decoded.width, decoded.height, 1600);
    const thumbSize = containedImageSize(decoded.width, decoded.height, 400);
    // 큰 canvas backing store가 살아 있는 동안 두 번째 canvas까지 만들지 않는다.
    const full = await canvasJpeg(decoded.source, fullSize, 0.82);
    const thumb = await canvasJpeg(decoded.source, thumbSize, 0.8);
    return { full, thumb, w: fullSize.w, h: fullSize.h };
  } finally {
    decoded.release();
  }
}
