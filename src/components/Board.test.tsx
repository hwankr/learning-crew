import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Entry } from '../../shared/types';
import { COPY } from '../lib/constants';
import { Board } from './Board';

const base: Entry = {
  id: 'e1', m: 'wg', day: '2026-08-14', time: '12:00',
  tag: '영어', tags: ['영어'], stars: 4, memo: '', body: '본문 첫 줄\n둘째 줄',
  todos: [{ t: '할 일 첫 줄', done: false }],
  v: 0, updatedAt: '2026-08-14T03:00:00.000Z', deletedAt: null,
};

function board(entry: Entry): string {
  return renderToStaticMarkup(
    <Board todays={[entry]} statuses={{}} now={Date.parse('2026-08-14T12:00:00+09:00')}
      meId="sh" wit={COPY} />,
  );
}

describe('크루 패널 최신 기록 요약', () => {
  it('본문과 할 일이 함께 있으면 디자인 규칙대로 본문 첫 줄을 보여 준다', () => {
    const html = board(base);
    expect(html).toContain('본문 첫 줄');
    expect(html).not.toContain('할 일 첫 줄');
  });

  it('본문이 빈 기록은 할 일을 대체 요약으로 쓴다', () => {
    expect(board({ ...base, body: '' })).toContain('할 일 첫 줄');
  });
});
