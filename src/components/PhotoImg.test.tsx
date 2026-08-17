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

    /* 회복 — 본 사진은 페이드 준비 상태(fade, 아직 on 아님)로 서고, preview는 밑장으로
       블러인 채 남는다: URL이 생긴 순간 걷으면 디코드되는 동안 자리가 번쩍인다. */
    photo.full = { url: 'blob:full', missing: false, status: 'found' };
    const recovered = renderPhoto();
    expect(recovered).toContain('<img class="photo-img fade" src="blob:full" alt="크게 보는 기록 사진"/>');
    expect(recovered).toContain('class="photo-img blur"');
    expect(recovered).toContain('src="blob:thumb"');
  });
});
