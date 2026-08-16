/* 다중 태그 파생 규칙 — 클라이언트(모달·스토어)와 Worker(검증·저장)가 같은 정의를 써야 한다.
   순서가 흔들리거나 tag/tags가 어긋나면 내용이 같은 기록이 서로를 "변경"으로 보고 헛 동기화가 돈다. */
import { describe, expect, it } from 'vitest';
import {
  TAGS,
  TAG_LIMITS,
  entryTags,
  hasTodayStudyStamp,
  isOffTags,
  mergeMemberStatus,
  normalizeMemberStatus,
  normalizeCustomTagList,
  normalizePhotos,
  normalizeTags,
  primaryTag,
  sanitizeCustomTag,
} from './types';

const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const P3 = '33333333-3333-4333-8333-333333333333';
const P4 = '44444444-4444-4444-8444-444444444444';
const P5 = '55555555-5555-4555-8555-555555555555';

describe('normalizePhotos', () => {
  it('유효한 UUID만 남기고 대소문자만 다른 중복도 첫 항목 하나로 합친다', () => {
    expect(
      normalizePhotos([
        { id: P1.toUpperCase(), w: 1600, h: 900 },
        { id: 'not-a-uuid', w: 100, h: 100 },
        { id: P1, w: 800, h: 600 },
        null,
      ]),
    ).toEqual([{ id: P1, w: 1600, h: 900 }]);
  });

  it('4장을 넘으면 유효한 첫 4장까지만 남긴다', () => {
    const photos = [P1, P2, P3, P4, P5].map((id) => ({ id, w: 100, h: 100 }));
    expect(normalizePhotos(photos).map((p) => p.id)).toEqual([P1, P2, P3, P4]);
  });

  it('w/h를 가장 가까운 정수로 만든 뒤 1~10000으로 클램프한다', () => {
    expect(
      normalizePhotos([
        { id: P1, w: 0, h: 10_001 },
        { id: P2, w: 10.6, h: Number.NaN },
        { id: P3, w: Number.POSITIVE_INFINITY, h: Number.NEGATIVE_INFINITY },
      ]),
    ).toEqual([
      { id: P1, w: 1, h: 10_000 },
      { id: P2, w: 11, h: 1 },
      { id: P3, w: 10_000, h: 1 },
    ]);
  });

  it('배열이 아니면 빈 배열이다', () => {
    expect(normalizePhotos(undefined)).toEqual([]);
    expect(normalizePhotos('photo')).toEqual([]);
  });
});

describe('sanitizeCustomTag', () => {
  it('trim·NFC·내부 공백 축약을 한 문자열로 고정한다', () => {
    expect(sanitizeCustomTag('  Cafe\u0301   복습  ')).toBe('Café 복습');
  });

  it('빈 값·비문자열·제어문자·코드포인트 12자 초과를 버린다', () => {
    expect(sanitizeCustomTag('   ')).toBeNull();
    expect(sanitizeCustomTag(42)).toBeNull();
    expect(sanitizeCustomTag('수학\n복습')).toBeNull();
    expect(sanitizeCustomTag('😀'.repeat(TAG_LIMITS.nameLen))).toBe('😀'.repeat(12));
    expect(sanitizeCustomTag('😀'.repeat(TAG_LIMITS.nameLen + 1))).toBeNull();
  });

  it('짝 없는 UTF-16 surrogate는 버리고 정상 쌍은 보존한다', () => {
    expect(sanitizeCustomTag('\uD800')).toBeNull();
    expect(sanitizeCustomTag('\uDC00')).toBeNull();
    expect(sanitizeCustomTag('\uD83D\uDE00')).toBe('😀');
  });
});

describe('normalizeTags', () => {
  it('커스텀 태그를 정화해 기본 태그 뒤에 남긴다', () => {
    expect(normalizeTags(['영어', '  수학   복습 ', 42, null])).toEqual(['영어', '수학 복습']);
  });

  it('정화 뒤 중복과 NFC 표현 차이도 없앤다', () => {
    expect(normalizeTags(['영어', '영어', '기타', 'e\u0301', 'é'])).toEqual([
      '영어', '기타', 'é',
    ]);
  });

  it('입력 순서와 무관하게 기본은 TAGS, 커스텀은 코드포인트 순서로 고정한다', () => {
    expect(normalizeTags(['알고리즘', '기타', '자격증', '수학'])).toEqual([
      '자격증', '기타', '수학', '알고리즘',
    ]);
    // 같은 집합을 다르게 적어도 결과가 같아야 헛 동기화가 없다
    expect(normalizeTags(['알고리즘', '수학'])).toEqual(normalizeTags(['수학', '알고리즘']));
  });

  it("'OFF'는 배타적이다 — 섞여 오면 ['OFF']만 남는다", () => {
    expect(normalizeTags(['영어', 'OFF'])).toEqual(['OFF']);
    expect(normalizeTags(['OFF'])).toEqual(['OFF']);
  });

  it('유효한 값이 하나도 없거나 배열이 아니면 빈 배열', () => {
    expect(normalizeTags([])).toEqual([]);
    expect(normalizeTags(['수학\n복습', '열세글자태그는버립니다!!'])).toEqual([]);
    expect(normalizeTags('영어')).toEqual([]);
    expect(normalizeTags(undefined)).toEqual([]);
    expect(normalizeTags(null)).toEqual([]);
  });

  it('기본+커스텀 합계가 기록당 8개를 넘지 않는다', () => {
    expect(normalizeTags([...TAGS, ...TAGS]).length).toBe(1); // OFF 포함 → ['OFF']
    expect(normalizeTags([
      '기타', '코딩테스트', '영어', '자격증', 'h', 'g', 'f', 'e', 'd', 'c', 'b', 'a',
    ])).toEqual([
      '자격증', '영어', '코딩테스트', '기타', 'a', 'b', 'c', 'd',
    ]);
  });
});

describe('normalizeCustomTagList', () => {
  it('기본 태그를 빼고 정화·NFC 중복 제거·코드포인트 정렬한다', () => {
    expect(normalizeCustomTagList([' 영어 ', '수학', 'e\u0301', 'é', '  알고리즘  '])).toEqual([
      'é', '수학', '알고리즘',
    ]);
  });

  it('멤버당 20개까지만 결정적 순서로 남긴다', () => {
    const tags = Array.from({ length: 22 }, (_, i) => `태그${String(i).padStart(2, '0')}`).reverse();
    expect(normalizeCustomTagList(tags)).toEqual(tags.slice().reverse().slice(0, TAG_LIMITS.perMember));
  });

  it('배열이 아니면 빈 배열이다', () => {
    expect(normalizeCustomTagList(null)).toEqual([]);
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
    expect(entryTags({ tag: '제어\n문자', tags: 'x' })).toEqual(['기타']);
  });

  it('구버전 단일 tag 자리의 커스텀 문자열도 보존한다', () => {
    expect(entryTags({ tag: '수학', tags: 'x' })).toEqual(['수학']);
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

describe('status stamp helpers', () => {
  const today = '2026-08-14';
  const now = Date.parse('2026-08-14T12:00:00+09:00');
  const base = {
    m: 'sh' as const,
    on: false,
    place: null,
    since: null,
    lastStartedAt: null,
    updatedAt: '2026-08-14T00:00:00.000Z',
  };

  it('구버전 OFF status 행의 누락된 lastStartedAt은 null로 둔다', () => {
    expect(normalizeMemberStatus({
      m: 'sh',
      on: false,
      place: '도서관',
      since: null,
      updatedAt: '2026-08-14T01:00:00Z',
    })).toEqual({
      m: 'sh',
      on: false,
      place: '도서관',
      since: null,
      lastStartedAt: null,
      updatedAt: '2026-08-14T01:00:00.000Z',
    });
  });

  it('구버전 ON status 행은 since를 lastStartedAt으로 복구한다', () => {
    expect(normalizeMemberStatus({
      m: 'sh',
      on: true,
      place: '도서관',
      since: '2026-08-14T00:30:00Z',
      updatedAt: '2026-08-14T01:00:00Z',
    })).toEqual({
      m: 'sh',
      on: true,
      place: '도서관',
      since: '2026-08-14T00:30:00.000Z',
      lastStartedAt: '2026-08-14T00:30:00.000Z',
      updatedAt: '2026-08-14T01:00:00.000Z',
    });
  });

  it('오늘 시작 이력과 자정 전 시작 후 오늘 종료를 도장으로 센다', () => {
    expect(hasTodayStudyStamp({
      ...base,
      lastStartedAt: '2026-08-14T01:00:00.000Z',
    }, now, today)).toBe(true);
    expect(hasTodayStudyStamp({
      ...base,
      lastStartedAt: '2026-08-13T14:30:00.000Z',
      updatedAt: '2026-08-14T00:30:00.000Z',
    }, now, today)).toBe(true);
  });

  it('자정을 넘긴 라이브는 오늘 도장 fallback이고 TTL이 지나면 제외한다', () => {
    expect(hasTodayStudyStamp({
      ...base,
      on: true,
      place: '도서관',
      since: '2026-08-13T15:00:00.000Z',
      lastStartedAt: '2026-08-13T15:00:00.000Z',
      updatedAt: '2026-08-13T15:00:00.000Z',
    }, Date.parse('2026-08-14T01:00:00+09:00'), today)).toBe(true);
    expect(hasTodayStudyStamp({
      ...base,
      on: true,
      place: '도서관',
      since: '2026-08-13T00:00:00.000Z',
      lastStartedAt: '2026-08-13T00:00:00.000Z',
      updatedAt: '2026-08-13T00:00:00.000Z',
    }, now, today)).toBe(false);
  });

  it('과거 시작과 과거 종료만 있으면 오늘 도장이 아니다', () => {
    expect(hasTodayStudyStamp({
      ...base,
      lastStartedAt: '2026-08-12T10:00:00.000Z',
      updatedAt: '2026-08-13T10:00:00.000Z',
    }, now, today)).toBe(false);
    expect(hasTodayStudyStamp({
      ...base,
      lastStartedAt: '2026-08-12T10:00:00.000Z',
      updatedAt: '2026-08-14T10:00:00.000Z',
    }, now, today)).toBe(false);
  });

  it('status 병합은 current-state를 updatedAt LWW로 고르고 시작 이력은 max로 보존한다', () => {
    const current = {
      ...base,
      on: true,
      place: '도서관' as const,
      since: '2026-08-15T10:00:00.000Z',
      lastStartedAt: '2026-08-15T10:00:00.000Z',
      updatedAt: '2026-08-15T10:00:00.000Z',
    };

    expect(mergeMemberStatus(current, {
      ...current,
      on: false,
      place: null,
      since: null,
      lastStartedAt: '2026-08-15T09:00:00.000Z',
      updatedAt: current.updatedAt,
    })).toEqual({
      ...current,
      on: false,
      place: null,
      since: null,
      lastStartedAt: current.lastStartedAt,
    });

    expect(mergeMemberStatus(current, {
      ...current,
      on: false,
      place: null,
      since: null,
      lastStartedAt: '2026-08-15T10:30:00.000Z',
      updatedAt: '2026-08-15T09:30:00.000Z',
    })).toEqual({
      ...current,
      lastStartedAt: '2026-08-15T10:30:00.000Z',
    });
  });
});
