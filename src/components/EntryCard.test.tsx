import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Entry } from '../../shared/types';
import type { PhotoUploadInfo } from '../local/store';
import { EntryCard, type EntryActions } from './EntryCard';

const entry: Entry = {
  id: 'e1', m: 'sh', day: '2026-08-14', time: '12:00',
  tag: '코딩테스트', tags: ['코딩테스트'], stars: 4, memo: '', body: '오늘의 기록',
  todos: [{ t: '기출 1회', done: true }, { t: '오답 정리', done: false }],
  photos: [],
  v: 0, updatedAt: '2026-08-14T03:00:00.000Z', deletedAt: null,
};

const actions: EntryActions = {
  onEdit: vi.fn(), onDelete: vi.fn(), onToggleTodo: vi.fn(),
  onAddComment: vi.fn(), onDeleteComment: vi.fn(), onToggleReaction: vi.fn(),
  onOpenPhoto: vi.fn(), onRetryPhoto: vi.fn(),
};

function card(
  mine: boolean,
  e: Entry = entry,
  photoUploads: Map<string, PhotoUploadInfo> = new Map(),
  compact = false,
): string {
  return renderToStaticMarkup(
    <EntryCard e={e} compact={compact} mine={mine} meId="sh" editing={false}
      comments={[]} reactions={[]} photoUploads={photoUploads} actions={actions} />,
  );
}

describe('EntryCard 할 일 접근성', () => {
  it('내 할 일은 상태와 조작을 이름에 담은 토글 버튼이다', () => {
    const html = card(true);
    expect(html).toContain('aria-label="기출 1회: 완료 해제"');
    expect(html).toContain('aria-label="오답 정리: 완료로 표시"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-pressed="false"');
  });

  it('남의 할 일은 작동하지 않는 버튼 대신 완료 상태로 읽힌다', () => {
    const html = card(false);
    expect(html).not.toContain('<button class="todo-check');
    expect(html).toContain('role="img" aria-label="완료"');
    expect(html).toContain('role="img" aria-label="미완료"');
  });

  it('별점을 그림에도 텍스트 대체로 남긴다', () => {
    expect(card(false)).toContain('role="img" aria-label="만족도 4점"');
  });
});

const PHOTO_A = '11111111-1111-4111-8111-111111111111';
const PHOTO_B = '22222222-2222-4222-8222-222222222222';
const withPhotos: Entry = {
  ...entry,
  photos: [{ id: PHOTO_A, w: 1600, h: 1200 }, { id: PHOTO_B, w: 1600, h: 900 }],
};
const uploading = new Map<string, PhotoUploadInfo>([
  [PHOTO_A, { state: 'up', pct: 42 }],
  [PHOTO_B, { state: 'fail', pct: 10 }],
]);

describe('EntryCard 사진 모자이크', () => {
  it('사진 자리마다 몇 번째인지 이름에 담는다', () => {
    const html = card(true, withPhotos);
    expect(html).toContain('aria-label="사진 2장 중 1번째 크게 보기"');
    expect(html).toContain('aria-label="사진 2장 중 2번째 크게 보기"');
  });

  it('내 기록에서는 업로드 진행·실패를 배지로 알린다', () => {
    const html = card(true, withPhotos, uploading);
    expect(html).toContain('42%');
    expect(html).toContain('올리는 중');
    // 실패한 사진은 "크게 보기"가 아니라 재시도 버튼이 된다
    expect(html).toContain('aria-label="업로드 실패 — 다시 시도"');
  });

  it('남의 기록에는 같은 상태라도 배지를 씌우지 않는다 — 진행률은 내 기기의 사정이다', () => {
    const html = card(false, withPhotos, uploading);
    expect(html).not.toContain('올리는 중');
    expect(html).not.toContain('42%');
    expect(html).toContain('aria-label="사진 2장 중 2번째 크게 보기"');
  });

  it('올리는 중·대기 사진은 눌러도 열 것이 없어 버튼 대신 상태로 읽힌다', () => {
    const pending = new Map<string, PhotoUploadInfo>([
      [PHOTO_A, { state: 'up', pct: 42 }],
      [PHOTO_B, { state: 'wait', pct: 0 }],
    ]);
    const html = card(true, withPhotos, pending);
    expect(html).toContain('role="img" aria-label="사진 2장 중 1번째 — 올리는 중 42%"');
    expect(html).toContain('role="img" aria-label="사진 2장 중 2번째 — 올릴 차례를 기다리는 중"');
    // 크게 보기라고 부르는 죽은 버튼이 남아 있으면 안 된다
    expect(html).not.toContain('크게 보기');
    expect(html).not.toContain('<button class="photo-cell');
  });

  it('실패한 사진은 여전히 재시도 버튼이다', () => {
    const html = card(true, withPhotos, new Map([[PHOTO_A, { state: 'fail', pct: 0 }]]));
    expect(html).toContain('<button class="photo-cell" aria-label="업로드 실패 — 다시 시도"');
  });
});

describe('EntryCard 컴팩트 사진 필', () => {
  it('썸네일·장수·여는 사진을 전부 done 기준으로 맞춘다', () => {
    // 첫 장이 올라가는 중이면 보이는 것도 열리는 것도 두 번째 사진이어야 한다
    const html = card(true, withPhotos, new Map([[PHOTO_A, { state: 'up', pct: 42 }]]), true);
    expect(html).toContain('aria-label="사진 1장 크게 보기"');
    expect(html).toContain('사진 1장');
    expect(html).not.toContain('사진 2장');
    // 장수 배지는 두 장 이상일 때만 — 보이는 사진이 한 장이면 붙지 않는다
    expect(html).not.toContain('photo-fill-n');
  });

  it('크게 볼 수 있는 사진이 없으면 죽은 버튼 대신 상태만 남는다', () => {
    const html = card(true, withPhotos, uploading, true);
    expect(html).toContain('role="img" aria-label="사진 2장 · 올리는 중"');
    expect(html).not.toContain('크게 보기');
    expect(html).not.toContain('<button class="photo-fill');
  });

  it('다 올라간 사진은 장수 배지와 함께 라이트박스를 연다', () => {
    const html = card(true, withPhotos, new Map(), true);
    expect(html).toContain('aria-label="사진 2장 크게 보기"');
    expect(html).toContain('photo-fill-n');
  });
});
