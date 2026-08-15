import { createRef } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Comment, Entry, EntryPhoto } from '../../shared/types';
import { PhotoLightbox, lightboxKeyAction } from './PhotoLightbox';
import type { EntryActions } from './EntryCard';

const actions: EntryActions = {
  onEdit: vi.fn(), onDelete: vi.fn(), onToggleTodo: vi.fn(),
  onAddComment: vi.fn(), onDeleteComment: vi.fn(), onToggleReaction: vi.fn(),
  onOpenPhoto: vi.fn(), onRetryPhoto: vi.fn(),
};

const entry: Entry = {
  id: 'e1', m: 'sh', day: '2026-08-14', time: '12:00',
  tag: '영어', tags: ['영어'], stars: 4, memo: '', body: '오늘의 기록',
  todos: [], photos: [],
  v: 0, updatedAt: '2026-08-14T03:00:00.000Z', deletedAt: null,
};
const photos: EntryPhoto[] = [
  { id: '11111111-1111-4111-8111-111111111111', w: 1600, h: 900 },
  { id: '22222222-2222-4222-8222-222222222222', w: 1600, h: 900 },
];
const comments: Comment[] = [
  {
    id: 'c1', entryId: 'e1', m: 'wg', body: '좋아요',
    createdAt: '2026-08-14T04:00:00.000Z', updatedAt: '2026-08-14T04:00:00.000Z', deletedAt: null,
  },
];

/* useFocusTrap이 렌더 중에 document.activeElement를 읽는다 — 서버 렌더에는 문서가 없으니
   그 한 값만 흉내 낸다(effect는 어차피 돌지 않는다). */
beforeAll(() => {
  if (typeof globalThis.document === 'undefined') {
    vi.stubGlobal('document', { activeElement: null });
  }
});
afterAll(() => {
  vi.unstubAllGlobals();
});

function light(desktop: boolean): string {
  return renderToStaticMarkup(
    <PhotoLightbox entry={entry} photos={photos} index={0} onIndex={() => {}}
      onClose={() => {}} desktop={desktop} meId="sh" comments={comments} reactions={[]}
      actions={actions} fallbackRef={createRef<HTMLElement>()} />,
  );
}

describe('PhotoLightbox 소셜 배치', () => {
  for (const [name, desktop] of [['데스크톱 패널', true], ['모바일 시트', false]] as const) {
    it(`${name}은 본문만 굴리고 댓글 입력은 바닥에 고정한다`, () => {
      const html = light(desktop);
      const scroll = html.indexOf('class="light-scroll"');
      const foot = html.indexOf('class="light-foot"');
      expect(scroll).toBeGreaterThan(-1);
      expect(foot).toBeGreaterThan(scroll);
      // 입력은 굴러가는 영역 밖이다 — 스크롤 안에 있으면 댓글이 쌓일수록 밀려 내려간다
      expect(html.slice(scroll, foot)).not.toContain('comment-input');
      expect(html.slice(foot)).toContain('comment-input');
      // 카드용 한 덩어리(.entry-social)를 통째로 넣지 않는다 — 그러면 입력이 스크롤 안이다
      expect(html).not.toContain('entry-social');
      // 메모·본문·탤리·댓글은 함께 굴러간다
      expect(html.slice(scroll, foot)).toContain('comment-list');
      expect(html.slice(scroll, foot)).toContain('react-row');
    });
  }

  it('리액션 피커는 잘리지 않게 줄 아래로 연다', () => {
    // 탤리는 스크롤 상자 맨 위라, 카드처럼 위로 열면 상자 밖에서 잘린다
    expect(light(true)).toContain('class="react-row below"');
  });
});

describe('lightboxKeyAction (키 우선순위)', () => {
  it('Escape는 라이트박스를 닫는다', () => {
    expect(lightboxKeyAction('Escape', { pickerOpen: false, inField: false })).toBe('close');
  });

  it('리액션 피커가 열려 있으면 Escape는 피커 몫이다 — 사진까지 함께 닫히지 않는다', () => {
    expect(lightboxKeyAction('Escape', { pickerOpen: true, inField: false })).toBe(null);
  });

  it('←/→로 사진을 넘기되 입력 중에는 글자 사이를 오간다', () => {
    expect(lightboxKeyAction('ArrowLeft', { pickerOpen: false, inField: false })).toBe('prev');
    expect(lightboxKeyAction('ArrowRight', { pickerOpen: false, inField: false })).toBe('next');
    expect(lightboxKeyAction('ArrowRight', { pickerOpen: false, inField: true })).toBe(null);
    expect(lightboxKeyAction('a', { pickerOpen: false, inField: false })).toBe(null);
  });
});
