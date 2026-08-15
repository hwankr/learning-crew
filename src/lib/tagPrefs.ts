import { TAGS, TAG_LIMITS, normalizeCustomTagList, sanitizeCustomTag } from '../../shared/types';

export const CUSTOM_TAG_ERROR = {
  invalid: `태그 이름은 비어 있지 않은 ${TAG_LIMITS.nameLen}자 이하로 적어 주세요.`,
  known: '기본 태그와 같은 이름은 추가할 수 없어요.',
  duplicate: '이미 추가한 태그예요.',
  limit: `커스텀 태그는 ${TAG_LIMITS.perMember}개까지 추가할 수 있어요.`,
} as const;

export type AddCustomTagResult =
  | { tags: string[]; error: null }
  | { tags: string[]; error: string };

/** EntryModal의 추가 계약을 위한 순수 검증. 이름·목록 규칙은 모두 shared의
    sanitize/normalize가 결정하고, 여기서는 사용자에게 보여 줄 실패 사유만 구분한다. */
export function addCustomTag(current: unknown, raw: string): AddCustomTagResult {
  const tags = normalizeCustomTagList(current);
  const tag = sanitizeCustomTag(raw);
  if (tag === null) return { tags, error: CUSTOM_TAG_ERROR.invalid };
  if ((TAGS as readonly string[]).includes(tag)) return { tags, error: CUSTOM_TAG_ERROR.known };
  if (tags.includes(tag)) return { tags, error: CUSTOM_TAG_ERROR.duplicate };
  if (tags.length >= TAG_LIMITS.perMember) return { tags, error: CUSTOM_TAG_ERROR.limit };
  return { tags: normalizeCustomTagList([...tags, tag]), error: null };
}

/** 삭제는 선택지에서만 빼며 과거 Entry는 건드리지 않는다. */
export function removeCustomTag(current: unknown, raw: string): string[] {
  const tags = normalizeCustomTagList(current);
  const tag = sanitizeCustomTag(raw);
  return tag === null ? tags : normalizeCustomTagList(tags.filter((item) => item !== tag));
}
