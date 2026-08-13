import { describe, expect, it } from 'vitest';
import type { Tag } from '../../shared/types';
import { toggledTags } from './EntryModal';

describe('toggledTags (기록 모달 다중 선택)', () => {
  it('선택 순서와 무관하게 TAGS 순서로 고정하고 여러 태그를 유지한다', () => {
    let tags: Tag[] = [];
    tags = toggledTags(tags, '기타');
    tags = toggledTags(tags, '자격증');
    tags = toggledTags(tags, '영어');
    expect(tags).toEqual(['자격증', '영어', '기타']);
  });

  it('OFF를 켜면 기존 공부 태그를 전부 지운다', () => {
    expect(toggledTags(['자격증', '영어', '기타'], 'OFF')).toEqual(['OFF']);
  });

  it('OFF가 켜진 상태에서 공부 태그를 고르면 OFF가 빠진다', () => {
    expect(toggledTags(['OFF'], '코딩테스트')).toEqual(['코딩테스트']);
  });

  it('이미 고른 태그를 다시 누르면 그 태그만 해제하고 OFF도 단독 해제할 수 있다', () => {
    expect(toggledTags(['자격증', '영어'], '자격증')).toEqual(['영어']);
    expect(toggledTags(['OFF'], 'OFF')).toEqual([]);
  });
});
