import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const photo = vi.hoisted(() => ({
  full: { url: null as string | null, missing: false, status: 'idle' },
  thumb: { url: 'blob:thumb' as string | null, missing: false, status: 'found' },
}));

vi.mock('../lib/usePhoto', () => ({
  usePhotoUrl: (_photoId: string, kind: 'full' | 'thumb') => photo[kind],
}));

import { PhotoImg } from './PhotoImg';

function renderPhoto(): string {
  return renderToStaticMarkup(
    <PhotoImg
      photoId="11111111-1111-4111-8111-111111111111"
      kind="full"
      preview="thumb"
      alt="크게 보는 기록 사진"
      icon={24}
      immediate
    />,
  );
}

describe('PhotoImg full preview fallback', () => {
  it('대기 중에만 preview를 블러 처리하고 full 실패 후에는 선명한 폴백으로 남겨 두었다가 회복한다', () => {
    photo.full = { url: null, missing: false, status: 'idle' };
    const waiting = renderPhoto();
    expect(waiting).toContain(
      '<img class="photo-img blur" src="blob:thumb" alt="" aria-hidden="true"/>',
    );

    for (const status of ['missing', 'auth', 'transient'] as const) {
      photo.full = { url: null, missing: status === 'missing', status };
      const failed = renderPhoto();
      expect(failed).toContain('class="photo-img"');
      expect(failed).not.toContain('class="photo-img blur"');
      expect(failed).toContain('src="blob:thumb"');
      expect(failed).toContain(
        '<img class="photo-img" src="blob:thumb" alt="크게 보는 기록 사진"/>',
      );
    }

    photo.full = { url: 'blob:full', missing: false, status: 'found' };
    const recovered = renderPhoto();
    expect(recovered).toContain('class="photo-img"');
    expect(recovered).toContain('src="blob:full"');
    expect(recovered).not.toContain('blob:thumb');
    expect(recovered).not.toContain('class="photo-img blur"');
  });
});
