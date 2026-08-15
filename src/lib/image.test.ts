import { afterEach, describe, expect, it, vi } from 'vitest';
import { COPY } from './constants';
import { ImageDecodeError, ImageEncodeError, containedImageSize, prepareUpload } from './image';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function bitmap(width = 2400, height = 1200): ImageBitmap & { close: ReturnType<typeof vi.fn> } {
  return { width, height, close: vi.fn() } as unknown as ImageBitmap & {
    close: ReturnType<typeof vi.fn>;
  };
}

function immediateCanvasFactory(log: string[] = []): (tag: string) => HTMLElement {
  return (tag) => {
    if (tag !== 'canvas') throw new Error(`unexpected element: ${tag}`);
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({
        fillStyle: '',
        fillRect: () => log.push(`fill:${canvas.width}x${canvas.height}`),
        drawImage: () => log.push(`draw:${canvas.width}x${canvas.height}`),
      }),
      toBlob: (done: BlobCallback) => {
        log.push(`encode:${canvas.width}x${canvas.height}`);
        done(new Blob(['jpeg'], { type: 'image/jpeg' }));
      },
    };
    return canvas as unknown as HTMLElement;
  };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

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

describe('prepareUpload decode fallback', () => {
  it('from-image 실패 → optionless 실패 → img 순서로 fallback하고 object URL을 한 번 해제한다', async () => {
    const createBitmap = vi.fn()
      .mockRejectedValueOnce(new Error('from-image unsupported'))
      .mockRejectedValueOnce(new Error('bitmap decode unsupported'));
    vi.stubGlobal('createImageBitmap', createBitmap);
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fallback');
    const image = {
      naturalWidth: 1200,
      naturalHeight: 800,
      src: '',
      onload: null,
      onerror: null,
      decode: vi.fn(async () => undefined),
    };
    const createElement = vi.fn((tag: string) =>
      tag === 'img' ? image as unknown as HTMLElement : immediateCanvasFactory()(tag));
    vi.stubGlobal('document', { createElement });

    await expect(prepareUpload(new File(['image'], 'photo.heic'))).resolves.toMatchObject({
      w: 1200,
      h: 800,
    });
    expect(createBitmap).toHaveBeenCalledTimes(2);
    expect(createBitmap.mock.calls[0]?.[1]).toEqual({ imageOrientation: 'from-image' });
    expect(createBitmap.mock.calls[1]).toHaveLength(1);
    expect(createElement.mock.calls.map(([tag]) => tag)).toEqual(['img', 'canvas', 'canvas']);
    expect(image.decode).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledWith('blob:fallback');
  });

  it('optionless bitmap 성공/encode 실패에서도 bitmap을 정확히 한 번 닫는다', async () => {
    const decoded = bitmap();
    vi.stubGlobal('createImageBitmap', vi.fn()
      .mockRejectedValueOnce(new Error('enum unsupported'))
      .mockResolvedValueOnce(decoded));
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ fillStyle: '', fillRect: vi.fn(), drawImage: vi.fn() }),
      toBlob: (done: BlobCallback) => done(null),
    };
    vi.stubGlobal('document', { createElement: () => canvas });

    await expect(prepareUpload(new File(['image'], 'bad.jpg'))).rejects.toBeInstanceOf(
      ImageEncodeError,
    );
    expect(decoded.close).toHaveBeenCalledTimes(1);
  });

  it('img fallback 실패에서도 만든 object URL을 정확히 한 번 해제한다', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('no bitmap')));
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:broken');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const image = {
      naturalWidth: 0,
      naturalHeight: 0,
      onload: null as null | (() => void),
      onerror: null as null | (() => void),
      decode: vi.fn(async () => { throw new Error('decode failed'); }),
      set src(_value: string) {
        queueMicrotask(() => this.onerror?.());
      },
    };
    vi.stubGlobal('document', { createElement: () => image });

    await expect(prepareUpload(new File(['bad'], 'broken.heic'))).rejects.toBeInstanceOf(
      ImageDecodeError,
    );
    expect(revoke).toHaveBeenCalledTimes(1);
  });
});

describe('prepareUpload encode 순서와 합성', () => {
  it('full encode가 끝난 뒤 thumb를 시작하고 drawImage 전에 흰색을 채운다', async () => {
    const decoded = bitmap(3200, 1600);
    vi.stubGlobal('createImageBitmap', vi.fn(async () => decoded));
    const log: string[] = [];
    const callbacks: BlobCallback[] = [];
    const canvases: Array<{ width: number; height: number }> = [];
    vi.stubGlobal('document', {
      createElement: (tag: string) => {
        if (tag !== 'canvas') throw new Error(`unexpected element: ${tag}`);
        const canvas = {
          width: 0,
          height: 0,
          getContext: () => ({
            fillStyle: '',
            fillRect: () => log.push(`fill:${canvas.width}x${canvas.height}`),
            drawImage: () => log.push(`draw:${canvas.width}x${canvas.height}`),
          }),
          toBlob: (done: BlobCallback) => {
            log.push(`encode:${canvas.width}x${canvas.height}`);
            callbacks.push(done);
          },
        };
        canvases.push(canvas);
        return canvas;
      },
    });

    const pending = prepareUpload(new File(['image'], 'wide.png'));
    await flush();
    expect(canvases).toHaveLength(1);
    expect(log).toEqual(['fill:1600x800', 'draw:1600x800', 'encode:1600x800']);

    callbacks[0]!(new Blob(['full'], { type: 'image/jpeg' }));
    await flush();
    expect(canvases).toHaveLength(2);
    expect(log).toEqual([
      'fill:1600x800', 'draw:1600x800', 'encode:1600x800',
      'fill:400x200', 'draw:400x200', 'encode:400x200',
    ]);
    callbacks[1]!(new Blob(['thumb'], { type: 'image/jpeg' }));
    await expect(pending).resolves.toMatchObject({ w: 1600, h: 800 });
    expect(decoded.close).toHaveBeenCalledTimes(1);
  });

  it('decode 오류는 사용자가 바로 할 수 있는 변환/공유 방법을 안내한다', () => {
    expect(COPY.photoUnreadable).toContain('JPG/PNG로 변환');
    expect(COPY.photoUnreadable).toContain('사진 앱에서 공유');
    expect(new ImageDecodeError().message).toContain('JPG/PNG로 변환');
  });
});
