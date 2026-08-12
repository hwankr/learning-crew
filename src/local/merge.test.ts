/* 충돌 병합 규칙 검증 — 필드 단위 3-way 병합과 내용 동등성 판별.
   (스토어의 push 충돌 처리 경로가 이 두 함수로 수렴을 결정한다) */
import { describe, expect, it } from 'vitest';
import type { Entry } from '../../shared/types';
import { contentEqual, mergeEntry } from './store';

function e(partial: Partial<Entry>): Entry {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    m: 'sh',
    day: '2026-08-12',
    time: '10:00',
    tag: '영어',
    stars: 3,
    memo: '',
    body: '원래 본문',
    todos: [{ t: '단어 암기', done: false }],
    v: 1,
    updatedAt: '2026-08-12T01:00:00.000Z',
    deletedAt: null,
    ...partial,
  };
}

describe('mergeEntry (필드 단위 3-way 병합)', () => {
  it('휴대폰의 본문 수정과 노트북의 할 일 체크가 서로를 덮지 않는다', () => {
    const base = e({});
    const local = e({ body: '수정한 본문' }); // 휴대폰: 본문만 수정
    const server = e({ todos: [{ t: '단어 암기', done: true }], v: 2 }); // 노트북: 체크만
    const merged = mergeEntry(base, local, server);
    expect(merged.body).toBe('수정한 본문');
    expect(merged.todos).toEqual([{ t: '단어 암기', done: true }]);
    expect(merged.v).toBe(2); // 서버 리비전 채택
  });

  it('양쪽이 같은 필드를 고치면 로컬이 이긴다', () => {
    const base = e({});
    const local = e({ body: '내 수정' });
    const server = e({ body: '남의 수정', v: 2 });
    expect(mergeEntry(base, local, server).body).toBe('내 수정');
  });

  it('base가 없으면(신규 행 에코) 전부 로컬을 취한다', () => {
    const local = e({ body: '로컬 내용', stars: 5 });
    const server = e({ body: '', stars: 1, v: 1 });
    const merged = mergeEntry(null, local, server);
    expect(merged.body).toBe('로컬 내용');
    expect(merged.stars).toBe(5);
  });

  it('로컬이 안 고친 필드는 서버를 따른다', () => {
    const base = e({});
    const local = e({}); // 아무것도 안 고침
    const server = e({ stars: 5, tag: '자격증', v: 2 });
    const merged = mergeEntry(base, local, server);
    expect(merged.stars).toBe(5);
    expect(merged.tag).toBe('자격증');
  });
});

describe('contentEqual (동기화 메타 제외 내용 비교)', () => {
  it('v/updatedAt만 다르면 같은 내용이다 — 잃어버린 응답 재시도의 에코 판별', () => {
    expect(contentEqual(e({ v: 1 }), e({ v: 2, updatedAt: '2026-08-12T02:00:00.000Z' }))).toBe(true);
  });
  it('본문이 다르면 다른 내용이다', () => {
    expect(contentEqual(e({}), e({ body: '다른 본문' }))).toBe(false);
  });
  it('삭제 여부가 다르면 다른 내용이다', () => {
    expect(contentEqual(e({}), e({ deletedAt: '2026-08-12T02:00:00.000Z' }))).toBe(false);
  });
});
