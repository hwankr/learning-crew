import {
  TAG_LIMITS,
  normalizeCustomEventTagList,
  normalizeCustomTagList,
  sanitizeCustomTag,
} from '../../shared/types';
import { EVENT_TAGS } from './constants';

export const CUSTOM_TAG_ERROR = {
  invalid: `태그 이름은 비어 있지 않은 ${TAG_LIMITS.nameLen}자 이하로 적어 주세요.`,
  known: '기본 태그와 같은 이름은 추가할 수 없어요.',
  duplicate: '이미 추가한 태그예요.',
  limit: `커스텀 태그는 ${TAG_LIMITS.perMember}개까지 추가할 수 있어요.`,
} as const;

export type AddCustomTagResult =
  | { tags: string[]; error: null }
  | { tags: string[]; error: string };

type NormalizeCustomTags = (value: unknown) => string[];

/** 피커별 공용 추가 계약. normalize([tag])가 빈 배열이면 그 피커의 예약 이름이다. */
function addNormalizedCustomTag(
  current: unknown,
  raw: string,
  normalize: NormalizeCustomTags,
): AddCustomTagResult {
  const tags = normalize(current);
  const tag = sanitizeCustomTag(raw);
  if (tag === null) return { tags, error: CUSTOM_TAG_ERROR.invalid };
  if (normalize([tag]).length === 0) return { tags, error: CUSTOM_TAG_ERROR.known };
  if (tags.includes(tag)) return { tags, error: CUSTOM_TAG_ERROR.duplicate };
  if (tags.length >= TAG_LIMITS.perMember) return { tags, error: CUSTOM_TAG_ERROR.limit };
  return { tags: normalize([...tags, tag]), error: null };
}

function removeNormalizedCustomTag(
  current: unknown,
  raw: string,
  normalize: NormalizeCustomTags,
): string[] {
  const tags = normalize(current);
  const tag = sanitizeCustomTag(raw);
  return tag === null ? tags : normalize(tags.filter((item) => item !== tag));
}

/** EntryModal의 추가 계약을 위한 순수 검증. */
export function addCustomTag(current: unknown, raw: string): AddCustomTagResult {
  return addNormalizedCustomTag(current, raw, normalizeCustomTagList);
}

/** 삭제는 선택지에서만 빼며 과거 Entry는 건드리지 않는다. */
export function removeCustomTag(current: unknown, raw: string): string[] {
  return removeNormalizedCustomTag(current, raw, normalizeCustomTagList);
}

/** 일정 피커 전용 검증. EVENT_TAGS와 쉬는 날 예약 이름 OFF를 한 곳에서 막는다. */
export function addCustomEventTag(current: unknown, raw: string): AddCustomTagResult {
  return addNormalizedCustomTag(
    current,
    raw,
    (value) => normalizeCustomEventTagList(value, EVENT_TAGS),
  );
}

export function removeCustomEventTag(current: unknown, raw: string): string[] {
  return removeNormalizedCustomTag(
    current,
    raw,
    (value) => normalizeCustomEventTagList(value, EVENT_TAGS),
  );
}
