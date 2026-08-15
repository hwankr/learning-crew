import { describe, expect, it } from 'vitest';
import { TAG_LIMITS } from '../../shared/types';
import { CUSTOM_TAG_ERROR, addCustomTag, removeCustomTag } from './tagPrefs';

describe('커스텀 태그 추가·삭제 계약', () => {
  it('shared 규칙으로 정화한 태그를 결정적 순서로 추가하고 삭제한다', () => {
    const added = addCustomTag(['수학'], '  Cafe\u0301   복습  ');
    expect(added).toEqual({ tags: ['Café 복습', '수학'], error: null });
    expect(removeCustomTag(added.tags, ' Café  복습 ')).toEqual(['수학']);
  });

  it('중복·기본 태그·이름·개수 초과를 각각 사유로 돌려준다', () => {
    expect(addCustomTag(['수학'], ' 수학 ').error).toBe(CUSTOM_TAG_ERROR.duplicate);
    expect(addCustomTag([], ' 영어 ').error).toBe(CUSTOM_TAG_ERROR.known);
    expect(addCustomTag([], '😀'.repeat(TAG_LIMITS.nameLen + 1)).error).toBe(
      CUSTOM_TAG_ERROR.invalid,
    );
    const full = Array.from({ length: TAG_LIMITS.perMember }, (_, i) => `태그${String(i).padStart(2, '0')}`);
    expect(addCustomTag(full, '초과').error).toBe(CUSTOM_TAG_ERROR.limit);
  });
});
