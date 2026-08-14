import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Entry } from '../../shared/types';
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
};

function card(mine: boolean): string {
  return renderToStaticMarkup(
    <EntryCard e={entry} compact={false} mine={mine} meId="sh" editing={false}
      comments={[]} reactions={[]} actions={actions} />,
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
