/* 다중 태그 파생 규칙 — 클라이언트(모달·스토어)와 Worker(검증·저장)가 같은 정의를 써야 한다.
   순서가 흔들리거나 tag/tags가 어긋나면 내용이 같은 기록이 서로를 "변경"으로 보고 헛 동기화가 돈다. */
import { describe, expect, it } from 'vitest';
import { TAGS, entryTags, isOffTags, normalizeTags, primaryTag } from './types';

describe('normalizeTags', () => {
  it('유효한 값만 남긴다', () => {
    expect(normalizeTags(['영어', '수학', 42, null])).toEqual(['영어']);
  });

  it('중복을 없앤다', () => {
    expect(normalizeTags(['영어', '영어', '기타'])).toEqual(['영어', '기타']);
  });

  it('입력 순서와 무관하게 TAGS 순서로 고정한다', () => {
    expect(normalizeTags(['기타', '자격증', '영어'])).toEqual(['자격증', '영어', '기타']);
    // 같은 집합을 다르게 적어도 결과가 같아야 헛 동기화가 없다
    expect(normalizeTags(['영어', '기타'])).toEqual(normalizeTags(['기타', '영어']));
  });

  it("'OFF'는 배타적이다 — 섞여 오면 ['OFF']만 남는다", () => {
    expect(normalizeTags(['영어', 'OFF'])).toEqual(['OFF']);
    expect(normalizeTags(['OFF'])).toEqual(['OFF']);
  });

  it('유효한 값이 하나도 없거나 배열이 아니면 빈 배열', () => {
    expect(normalizeTags([])).toEqual([]);
    expect(normalizeTags(['없는태그'])).toEqual([]);
    expect(normalizeTags('영어')).toEqual([]);
    expect(normalizeTags(undefined)).toEqual([]);
    expect(normalizeTags(null)).toEqual([]);
  });

  it('전부 골라도 TAGS 길이를 넘지 않는다 — 정규화가 곧 개수 상한이다', () => {
    // OFF를 뺀 4종이 최대치다 (OFF가 섞이면 단독이 된다)
    expect(normalizeTags([...TAGS, ...TAGS]).length).toBe(1); // OFF 포함 → ['OFF']
    expect(normalizeTags(['기타', '코딩테스트', '영어', '자격증'])).toEqual([
      '자격증', '영어', '코딩테스트', '기타',
    ]);
  });
});

describe('primaryTag', () => {
  it('첫 태그가 대표 태그다 (DB tag 컬럼·구버전 클라이언트가 읽는 값)', () => {
    expect(primaryTag(['영어', '기타'])).toBe('영어');
    expect(primaryTag(['OFF'])).toBe('OFF');
  });
  it("빈 배열이면 '기타'", () => {
    expect(primaryTag([])).toBe('기타');
  });
});

describe('entryTags (구/신 표현을 하나로)', () => {
  it('tags가 있으면 정규화해서 쓴다', () => {
    expect(entryTags({ tag: '자격증', tags: ['기타', '영어'] })).toEqual(['영어', '기타']);
  });

  it('tags가 없으면 대표 태그에서 되살린다 — 구버전 IDB 행·구버전 클라이언트 push', () => {
    expect(entryTags({ tag: '코딩테스트' })).toEqual(['코딩테스트']);
    expect(entryTags({ tag: 'OFF', tags: [] })).toEqual(['OFF']);
  });

  it('tag까지 못 쓰면 기타로 되살린다 — 빈 배열은 절대 돌려주지 않는다', () => {
    expect(entryTags({})).toEqual(['기타']);
    expect(entryTags({ tag: '없는태그', tags: 'x' })).toEqual(['기타']);
  });

  it('tags가 tag보다 우선한다 — 서버는 클라이언트가 보낸 tag를 믿지 않는다', () => {
    const e = { tag: 'OFF', tags: ['영어'] };
    expect(entryTags(e)).toEqual(['영어']);
    expect(primaryTag(entryTags(e))).toBe('영어');
  });
});

describe('isOffTags', () => {
  it("정확히 ['OFF']일 때만 쉬는 날이다 (stars === null 조건과 같은 정의)", () => {
    expect(isOffTags(['OFF'])).toBe(true);
    expect(isOffTags(['영어'])).toBe(false);
    expect(isOffTags([])).toBe(false);
  });
  it('정규화를 지나면 OFF가 섞인 조합 자체가 존재할 수 없다', () => {
    expect(isOffTags(normalizeTags(['OFF', '영어']))).toBe(true);
  });
});
