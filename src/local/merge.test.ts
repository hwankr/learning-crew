/* 충돌 병합 규칙 검증 — 필드 단위 3-way 병합과 내용 동등성 판별.
   (스토어의 push 충돌 처리 경로가 이 두 함수로 수렴을 결정한다)
   + 댓글·리액션 스트림의 순수 규칙: 스냅샷 파생, 토글 정규화, ACK 정산 판단. */
import { describe, expect, it } from 'vitest';
import type { Comment, Entry, Notification, ReactionSet } from '../../shared/types';
import { primaryTag } from '../../shared/types';
import {
  CrewStore,
  adoptCommentFromDB,
  commentAckOutcome,
  commentAckSettles,
  contentEqual,
  groupComments,
  groupReactions,
  isDuplicateComment,
  isDuplicateReaction,
  mergeEntry,
  mergeMyReactionFromDB,
  normalizeEntry,
  normalizeTagPrefs,
  notifPullAction,
  reactionAckSettles,
  sortNotifications,
  toggledEmojis,
} from './store';

/** tag는 tags의 파생값이라 픽스처가 직접 정하지 않는다 — 항상 primaryTag(tags)다. */
function e(partial: Partial<Entry>): Entry {
  const row: Entry = {
    id: '11111111-1111-4111-8111-111111111111',
    m: 'sh',
    day: '2026-08-12',
    time: '10:00',
    tag: '영어',
    tags: ['영어'],
    stars: 3,
    memo: '',
    body: '원래 본문',
    todos: [{ t: '단어 암기', done: false }],
    photos: [],
    v: 1,
    updatedAt: '2026-08-12T01:00:00.000Z',
    deletedAt: null,
    ...partial,
  };
  return { ...row, tag: primaryTag(row.tags) };
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

  it('로컬 경계에서 태그 순서와 어긋난 대표 태그를 함께 정규화한다', () => {
    const raw = {
      ...e({}),
      tags: ['기타', '영어'] as Entry['tags'],
      tag: 'OFF' as const,
    };
    const merged = mergeEntry(null, raw, e({ v: 1 }));
    expect(merged.tags).toEqual(['영어', '기타']);
    expect(merged.tag).toBe('영어');
  });

  it('구버전 IDB 행에 photos가 없으면 빈 배열로 복원한다', () => {
    const legacy = e({}) as Omit<Entry, 'photos'> & { photos?: Entry['photos'] };
    delete legacy.photos;
    expect(normalizeEntry(legacy as Entry).photos).toEqual([]);
  });

  it('사진과 본문을 다른 기기에서 고쳐도 3-way 병합이 둘 다 보존한다', () => {
    const photo = { id: '22222222-2222-4222-8222-222222222222', w: 1600, h: 900 };
    const base = e({});
    const local = e({ photos: [photo] });
    const server = e({ body: '서버에서 수정', v: 2 });
    const merged = mergeEntry(base, local, server);
    expect(merged.photos).toEqual([photo]);
    expect(merged.body).toBe('서버에서 수정');
  });

  it('base 사진은 local 또는 server 어느 한쪽에서 제거해도 삭제가 이긴다', () => {
    const p = { id: '22222222-2222-4222-8222-222222222222', w: 1600, h: 900 };
    const base = e({ photos: [p] });
    expect(mergeEntry(base, e({ photos: [] }), e({ photos: [p], v: 2 })).photos).toEqual([]);
    expect(mergeEntry(base, e({ photos: [p] }), e({ photos: [], v: 2 })).photos).toEqual([]);
  });

  it('양쪽 독립 신규 사진은 stable union하고 중복 없이 네 장으로 제한한다', () => {
    const p = (n: number) => ({
      id: `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
      w: 1600,
      h: 900,
    });
    const merged = mergeEntry(
      e({ photos: [] }),
      e({ photos: [p(1), p(2), p(3)] }),
      e({ photos: [p(4), p(2), p(5)], v: 2 }),
    );
    expect(merged.photos.map((photo) => photo.id)).toEqual([
      p(1).id,
      p(4).id,
      p(2).id,
      p(3).id,
    ]);
  });

  it('레거시 이관의 비-OFF+null은 보존하고 OFF의 숫자 별점만 null로 강제한다', () => {
    const legacyNoRating = normalizeEntry(e({ tags: ['기타'], stars: null }));
    expect(legacyNoRating.tag).toBe('기타');
    expect(legacyNoRating.tags).toEqual(['기타']);
    expect(legacyNoRating.stars).toBeNull();

    const off = normalizeEntry(e({ tags: ['OFF'], stars: 4 }));
    expect(off.tag).toBe('OFF');
    expect(off.stars).toBeNull();
  });

  it('로컬이 안 고친 필드는 서버를 따른다', () => {
    const base = e({});
    const local = e({}); // 아무것도 안 고침
    const server = e({ stars: 5, tags: ['자격증'], v: 2 });
    const merged = mergeEntry(base, local, server);
    expect(merged.stars).toBe(5);
    expect(merged.tags).toEqual(['자격증']);
    expect(merged.tag).toBe('자격증'); // 파생 필드가 tags를 따라온다
  });

  it('휴대폰이 태그를 늘리고 노트북이 본문을 고쳐도 서로를 덮지 않는다', () => {
    const base = e({});
    const local = e({ tags: ['영어', '기타'] }); // 휴대폰: 태그만 추가
    const server = e({ body: '노트북 본문', v: 2 }); // 노트북: 본문만 수정
    const merged = mergeEntry(base, local, server);
    expect(merged.tags).toEqual(['영어', '기타']);
    expect(merged.tag).toBe('영어');
    expect(merged.body).toBe('노트북 본문');
  });

  it('양쪽이 태그를 고치면 로컬이 이기고 tag는 로컬 tags에서 다시 계산된다', () => {
    const base = e({});
    const local = e({ tags: ['자격증', '코딩테스트'] });
    const server = e({ tags: ['기타'], v: 2 });
    const merged = mergeEntry(base, local, server);
    expect(merged.tags).toEqual(['자격증', '코딩테스트']);
    expect(merged.tag).toBe('자격증');
  });

  it('로컬이 태그를 안 고쳤으면 서버가 늘린 태그를 그대로 따른다', () => {
    const base = e({});
    const local = e({ body: '내 본문' }); // 태그는 그대로
    const server = e({ tags: ['영어', '코딩테스트'], v: 2 });
    const merged = mergeEntry(base, local, server);
    expect(merged.tags).toEqual(['영어', '코딩테스트']);
    expect(merged.tag).toBe('영어');
    expect(merged.body).toBe('내 본문');
  });

  it('구버전 큐 base에 tags가 없어도 태그를 로컬 변경으로 오판하지 않는다', () => {
    const legacyBase = e({}) as Omit<Entry, 'tags'> & { tags?: Entry['tags'] };
    delete legacyBase.tags; // 다중 태그 배포 전에 IDB queue.base에 저장된 실제 모양
    const local = e({ body: '내 본문' });
    const server = e({ tags: ['자격증'], v: 2 });
    const merged = mergeEntry(legacyBase as Entry, local, server);
    expect(merged.tags).toEqual(['자격증']);
    expect(merged.tag).toBe('자격증');
    expect(merged.body).toBe('내 본문');
  });

  it('태그와 별점을 따로 병합해도 OFF/null 불변식은 깨지지 않는다', () => {
    const base = e({ tags: ['영어'], stars: 3 });
    // 로컬은 태그만 비-OFF로 변경, 서버는 OFF로 변경: 로컬 tags와 서버 null을 섞으면 안 된다.
    const localTagsWin = mergeEntry(
      base,
      e({ tags: ['자격증'], stars: 3 }),
      e({ tags: ['OFF'], stars: null, v: 2 }),
    );
    expect(localTagsWin.tags).toEqual(['자격증']);
    expect(localTagsWin.stars).toBe(3);

    // 로컬은 별점만 변경, 서버는 OFF로 변경: OFF가 이기면 별점은 반드시 null이다.
    const serverOffWins = mergeEntry(
      base,
      e({ stars: 5 }),
      e({ tags: ['OFF'], stars: null, v: 2 }),
    );
    expect(serverOffWins.tags).toEqual(['OFF']);
    expect(serverOffWins.tag).toBe('OFF');
    expect(serverOffWins.stars).toBeNull();
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
  it('태그를 하나 더 골랐으면 다른 내용이다', () => {
    expect(contentEqual(e({}), e({ tags: ['영어', '기타'] }))).toBe(false);
  });
  it('같은 태그 집합은 같은 내용이다 — 정규화가 순서를 고정하므로 JSON 비교가 안전하다', () => {
    expect(contentEqual(e({ tags: ['영어', '기타'] }), e({ tags: ['영어', '기타'], v: 9 }))).toBe(true);
  });
});

function c(partial: Partial<Comment>): Comment {
  return {
    id: 'c-1',
    entryId: 'E1',
    m: 'sh',
    body: '좋아요',
    createdAt: '2026-08-12T01:00:00.000Z',
    updatedAt: '2026-08-12T01:00:00.000Z',
    deletedAt: null,
    ...partial,
  };
}

describe('groupComments (스냅샷 파생)', () => {
  it('기록별로 묶고 (createdAt, id) 오름차순으로 준다', () => {
    const map = groupComments([
      c({ id: 'b', createdAt: '2026-08-12T03:00:00.000Z' }),
      c({ id: 'a', createdAt: '2026-08-12T03:00:00.000Z' }),
      c({ id: 'z', createdAt: '2026-08-12T01:00:00.000Z' }),
      c({ id: 'other', entryId: 'E2' }),
    ]);
    expect(map.get('E1')?.map((x) => x.id)).toEqual(['z', 'a', 'b']);
    expect(map.get('E2')?.map((x) => x.id)).toEqual(['other']);
  });

  it('tombstone은 스냅샷에 나오지 않는다 (아직 push 전이라 메모리에는 남아 있다)', () => {
    const map = groupComments([c({ id: 'x', deletedAt: '2026-08-12T04:00:00.000Z' })]);
    expect(map.has('E1')).toBe(false);
  });
});

function r(partial: Partial<ReactionSet>): ReactionSet {
  return {
    entryId: 'E1',
    m: 'sh',
    emojis: ['👏'],
    actedAt: '2026-08-12T01:00:00.000Z',
    updatedAt: '2026-08-12T01:00:00.000Z',
    ...partial,
  };
}

describe('groupReactions (스냅샷 파생)', () => {
  it('빈 집합("다 뗐다"를 전하려 남긴 행)은 빼고 멤버 순서로 정렬한다', () => {
    const map = groupReactions([
      r({ m: 'jj' }),
      r({ m: 'sh' }),
      r({ m: 'th', emojis: [] }),
      r({ m: 'wg', entryId: 'E2' }),
    ]);
    expect(map.get('E1')?.map((x) => x.m)).toEqual(['sh', 'jj']);
    expect(map.get('E2')?.map((x) => x.m)).toEqual(['wg']);
  });
});

describe('toggledEmojis (리액션 토글)', () => {
  it('없으면 더하고 REACTIONS 순서로 정규화한다 — 순서가 흔들리면 헛 동기화가 돈다', () => {
    expect(toggledEmojis(['😴'], '👏')).toEqual(['👏', '😴']);
  });
  it('이미 있으면 뺀다', () => {
    expect(toggledEmojis(['👏', '💪'], '👏')).toEqual(['💪']);
  });
  it('마지막 하나를 빼면 빈 집합이 된다 (행은 남아 서버로 전해진다)', () => {
    expect(toggledEmojis(['👏'], '👏')).toEqual([]);
  });
});

describe('commentAckSettles (전송 중 재수정 보호 — 저장된 행 기준)', () => {
  it('보낸 뒤 지웠으면 ACK가 큐를 비우지 못한다 — 그 삭제가 유실되면 안 된다', () => {
    const sent = c({ deletedAt: null });
    const stored = c({ deletedAt: '2026-08-12T02:00:00.000Z' });
    expect(commentAckSettles(sent, stored)).toBe(false);
  });
  it('다른 탭이 지운 tombstone이 IDB에 있으면 큐 키를 남긴다 (탭 사이 공유 스토어)', () => {
    // 탭 A가 살아 있는 댓글을 보내는 사이 탭 B가 같은 댓글을 지웠다 —
    // A의 ACK가 큐 키를 지우면 B의 삭제를 아무도 보내지 않는다
    expect(commentAckSettles(c({}), c({ deletedAt: '2026-08-12T02:00:00.000Z' }))).toBe(false);
  });
  it('보낸 tombstone이 저장된 행과 같으면 큐를 비운다', () => {
    const t = '2026-08-12T02:00:00.000Z';
    expect(commentAckSettles(c({ deletedAt: t }), c({ deletedAt: t }))).toBe(true);
  });
  it('삭제 상태가 그대로면 큐를 비운다', () => {
    expect(commentAckSettles(c({}), c({}))).toBe(true);
  });
  it('저장된 행이 이미 사라졌으면 메모리 전용 탭은 큐를 비운다 (공유 진실이 없다)', () => {
    expect(commentAckSettles(c({}), undefined)).toBe(true);
  });
});

describe('commentAckOutcome (IDB를 볼 수 있는 ACK 경로 — 부활 금지)', () => {
  it('저장 행 없음 + 살아 있는 서버 응답 → 부활하지 않는다', () => {
    // 탭 A가 새 댓글을 push하는 사이 탭 B가 같은 댓글을 지우고 tombstone을 push·ACK까지
    // 끝내 IDB에서 행을 지웠다. 뒤늦은 A의 ACK가 살아 있는 서버 행을 다시 넣으면
    // 지평선을 지난 커서는 그 tombstone을 다시 실어 주지 못해 영구히 되살아난다
    expect(commentAckOutcome(c({ deletedAt: null }), undefined)).toBe('gone');
  });
  it('보낸 게 tombstone이어도 저장 행이 없으면 채택 없이 큐만 비운다', () => {
    const t = '2026-08-12T02:00:00.000Z';
    expect(commentAckOutcome(c({ deletedAt: t }), undefined)).toBe('gone');
  });
  it('삭제 상태가 그대로면 서버 행을 채택한다', () => {
    expect(commentAckOutcome(c({}), c({}))).toBe('adopt');
  });
  it('전송 중에 지워졌으면 큐 키를 남긴다 — 그 삭제를 다음 라운드가 보낸다', () => {
    expect(commentAckOutcome(c({}), c({ deletedAt: '2026-08-12T02:00:00.000Z' }))).toBe('hold');
  });
});

describe('adoptCommentFromDB (다른 탭의 IDB 행 채택 — 삭제 승리)', () => {
  it('큐에 없는 행은 IDB를 따른다', () => {
    expect(adoptCommentFromDB(c({}), { queued: false, adopted: false })).toBe(true);
  });
  it('두 탭이 같은 큐 키를 갖고 있어도 IDB가 tombstone이면 삭제가 이긴다', () => {
    const dead = c({ deletedAt: '2026-08-12T02:00:00.000Z' });
    expect(adoptCommentFromDB(dead, { queued: true, adopted: false })).toBe(true);
  });
  it('큐에 있고 IDB도 살아 있으면 로컬 미전송 쓰기가 이긴다', () => {
    expect(adoptCommentFromDB(c({}), { queued: true, adopted: false })).toBe(false);
  });
  it('이번 병합에서 큐 키를 새로 채택했으면 그 행도 IDB 기준으로 읽는다', () => {
    expect(adoptCommentFromDB(c({}), { queued: true, adopted: true })).toBe(true);
  });
});

describe('reactionAckSettles (전송 중 재토글 보호 — 저장된 행 기준)', () => {
  it('액션 시각이 같으면 dirty를 내린다', () => {
    expect(reactionAckSettles(r({}), r({}))).toBe(true);
  });
  it('전송 중 다른 탭이 다시 토글했으면(IDB의 actedAt이 다름) dirty를 남긴다', () => {
    const sent = r({ actedAt: '2026-08-12T01:00:00.000Z' });
    const stored = r({ emojis: ['🔥'], actedAt: '2026-08-12T01:00:05.000Z' });
    expect(reactionAckSettles(sent, stored)).toBe(false);
  });
  it('저장된 행이 없으면(메모리 전용 탭) 그대로 정산한다', () => {
    expect(reactionAckSettles(r({}), undefined)).toBe(true);
  });
});

describe('mergeMyReactionFromDB (다른 탭의 IDB 행·dirty 키 병합)', () => {
  const t1 = '2026-08-12T01:00:00.000Z';
  const t2 = '2026-08-12T01:00:05.000Z';

  it('메모리에 행이 없으면 IDB 행과 dirty를 그대로 채택한다', () => {
    expect(mergeMyReactionFromDB({ rowActedAt: t1, curActedAt: undefined, dbDirty: true, memDirty: false }))
      .toEqual({ takeRow: true, dirty: true });
  });
  it('IDB의 토글이 더 새로우면 채택한다', () => {
    expect(mergeMyReactionFromDB({ rowActedAt: t2, curActedAt: t1, dbDirty: false, memDirty: true }))
      .toEqual({ takeRow: true, dirty: false });
  });
  it('actedAt이 같아 행은 그대로여도 IDB가 dirty면 dirty를 떠맡는다 (고아 키 방지)', () => {
    expect(mergeMyReactionFromDB({ rowActedAt: t1, curActedAt: t1, dbDirty: true, memDirty: false }))
      .toEqual({ takeRow: false, dirty: true });
  });
  it('같은 토글을 다른 탭이 이미 push했으면 dirty만 내린다', () => {
    expect(mergeMyReactionFromDB({ rowActedAt: t1, curActedAt: t1, dbDirty: false, memDirty: true }))
      .toEqual({ takeRow: false, dirty: false });
  });
  it('메모리 행이 더 새로우면 유지한다 — 더 새 토글을 되돌리면 안 된다', () => {
    expect(mergeMyReactionFromDB({ rowActedAt: t1, curActedAt: t2, dbDirty: true, memDirty: false }))
      .toEqual({ takeRow: false, dirty: true });
  });
  it('메모리 행이 더 새롭고 이미 dirty면 그대로 dirty를 유지한다', () => {
    expect(mergeMyReactionFromDB({ rowActedAt: t1, curActedAt: t2, dbDirty: false, memDirty: true }))
      .toEqual({ takeRow: false, dirty: true });
  });
});

describe('isDuplicateComment (pull 중복 전달 판정 — 밀리초 동률 깨기)', () => {
  it('같은 행이 그대로 다시 오면 중복이다', () => {
    expect(isDuplicateComment(c({}), c({}))).toBe(true);
  });
  it('같은 밀리초에 삭제까지 갔으면 중복이 아니다 — 그 tombstone을 버리면 영구 유실이다', () => {
    // 서버는 경계에서 밀리초까지만 내보낸다(Postgres는 마이크로초) — 같은 행이 1ms 안에
    // 두 번 갱신되면 두 상태의 updatedAt 문자열이 같아진다
    const ts = '2026-08-12T01:00:00.123Z';
    const cur = c({ updatedAt: ts, deletedAt: null });
    const row = c({ updatedAt: ts, deletedAt: '2026-08-12T01:00:00.123Z' });
    expect(isDuplicateComment(cur, row)).toBe(false);
  });
  it('updatedAt이 다르면 중복이 아니다', () => {
    expect(isDuplicateComment(c({}), c({ updatedAt: '2026-08-12T02:00:00.000Z' }))).toBe(false);
  });
});

describe('isDuplicateReaction (pull 중복 전달 판정 — 밀리초 동률 깨기)', () => {
  it('같은 행이 그대로 다시 오면 중복이다', () => {
    expect(isDuplicateReaction(r({}), r({}))).toBe(true);
  });
  it('같은 밀리초라도 actedAt이 다르면 중복이 아니다 — 새 이모지 집합을 버리면 안 된다', () => {
    const ts = '2026-08-12T01:00:00.123Z';
    const cur = r({ updatedAt: ts, actedAt: '2026-08-12T00:59:59.000Z', emojis: ['👏'] });
    const row = r({ updatedAt: ts, actedAt: '2026-08-12T00:59:59.500Z', emojis: ['👏', '🔥'] });
    expect(isDuplicateReaction(cur, row)).toBe(false);
  });
  it('updatedAt이 다르면 중복이 아니다', () => {
    expect(isDuplicateReaction(r({}), r({ updatedAt: '2026-08-12T02:00:00.000Z' }))).toBe(false);
  });
});

describe('notifPullAction (알림 pull 반영 — 같은 세대의 읽음만 로컬 우선)', () => {
  const N = (p: Partial<Notification>): Notification => ({
    id: 'nnnnnnnn-nnnn-4nnn-8nnn-nnnnnnnnnnnn',
    m: 'sh', kind: 'comment', why: 'mine', actor: 'wg', entryId: null,
    quote: '', ctx: '', actors: [], count: 1,
    createdAt: '2026-08-12T01:00:00.000Z',
    updatedAt: '2026-08-12T01:00:00.000Z',
    readAt: null,
    ...p,
  });
  const NOW = '2026-08-12T09:00:00.000Z';
  const GEN1 = '2026-08-12T01:00:00.000Z';

  it('처음 보는 행은 그대로 채택한다', () => {
    const row = N({});
    expect(notifPullAction(undefined, row, null, NOW)).toBe(row);
  });
  it('같은 행의 중복 전달(커서 안전 윈도우)은 건너뛴다', () => {
    expect(notifPullAction(N({}), N({}), null, NOW)).toBe('skip');
  });
  it('같은 밀리초의 집계 갱신은 count가 다르면 중복이 아니다', () => {
    expect(notifPullAction(N({}), N({ count: 2 }), null, NOW)).not.toBe('skip');
  });
  it('같은 세대의 미전송 읽음은 서버의 안 읽음 행을 이긴다', () => {
    // 메모리가 이미 읽음이면 실질 변화가 없어 skip — 안 읽음으로 되돌리지만 않으면 된다
    const cur = N({ readAt: '2026-08-12T02:00:00.000Z' });
    expect(notifPullAction(cur, N({}), GEN1, NOW)).toBe('skip');
    // 메모리에 행이 없어도(보관 정리 직후 등) 큐의 세대와 같으면 읽음을 살려 채택한다
    const out = notifPullAction(undefined, N({}), GEN1, NOW);
    expect(out).not.toBe('skip');
    expect((out as Notification).readAt).toBe(NOW);
  });
  it('더 새 세대(집계에 새 응원)의 안 읽음은 옛 읽음을 이긴다 — 다시 안 읽음이 정답', () => {
    const cur = N({ readAt: '2026-08-12T02:00:00.000Z' });
    const row = N({ updatedAt: '2026-08-12T03:00:00.000Z', count: 4, readAt: null });
    expect(notifPullAction(cur, row, GEN1, NOW)).toBe(row);
  });
  it('큐가 정산된 뒤의 서버 읽음 확정은 그대로 채택한다', () => {
    const cur = N({ readAt: '2026-08-12T02:00:00.000Z' });
    const row = N({ updatedAt: '2026-08-12T03:00:00.000Z', readAt: '2026-08-12T02:00:01.000Z' });
    expect(notifPullAction(cur, row, null, NOW)).toBe(row);
  });
  it('느린 응답(더 오래된 updatedAt)은 되돌리지 못한다', () => {
    const cur = N({ updatedAt: '2026-08-12T05:00:00.000Z' });
    expect(notifPullAction(cur, N({}), null, NOW)).toBe('skip');
  });
});

describe('sortNotifications (스냅샷 정렬 + 보관 기간)', () => {
  const NOW = Date.parse('2026-08-12T09:00:00.000Z');
  const N = (id: string, createdAt: string): Notification => ({
    id, m: 'sh', kind: 'start', why: 'daily', actor: 'wg', entryId: null,
    quote: '', ctx: '', actors: [], count: 1,
    createdAt, updatedAt: createdAt, readAt: null,
  });
  it('최신이 먼저 오고, 30일 지난 행은 빠진다', () => {
    const fresh = N('a', '2026-08-12T08:00:00.000Z');
    const older = N('b', '2026-08-10T08:00:00.000Z');
    const expired = N('c', '2026-07-01T08:00:00.000Z');
    expect(sortNotifications([older, expired, fresh], NOW).map((n) => n.id)).toEqual(['a', 'b']);
  });
  it('같은 시각이면 id 내림차순 — 탭마다 순서가 흔들리지 않는다', () => {
    const x = N('x', '2026-08-12T08:00:00.000Z');
    const y = N('y', '2026-08-12T08:00:00.000Z');
    expect(sortNotifications([x, y], NOW).map((n) => n.id)).toEqual(['y', 'x']);
  });
});

describe('커스텀 태그 캐시 LWW 병합', () => {
  it('IDB·HTTP 복원 경계에서 멤버·시각을 검사하고 shared 순서로 맞춘다', () => {
    expect(normalizeTagPrefs({
      m: 'sh', tags: ['알고리즘', ' 영어 ', ' 수학 '], updatedAt: '2026-08-15T01:00:00Z',
    }, 'sh')).toEqual({
      m: 'sh',
      tags: ['수학', '알고리즘'],
      eventTags: [],
      updatedAt: '2026-08-15T01:00:00.000Z',
    });
    expect(normalizeTagPrefs({
      m: 'sh', tags: [], eventTags: '면접', updatedAt: '2026-08-15T01:00:00Z',
    }, 'sh')).toBeNull();
    expect(normalizeTagPrefs({
      m: 'wg', tags: ['수학'], updatedAt: '2026-08-15T01:00:00.000Z',
    }, 'sh')).toBeNull();
  });

  it('일정용 목록을 왕복하고 어느 setter도 같은 행의 다른 목록을 지우지 않는다', () => {
    const store = new CrewStore();
    store.setCustomTags(['수학']);
    store.setCustomEventTags([' 영어 ', ' 면접 준비 ', 'OFF']);
    expect(store.getCustomTags()).toEqual(['수학']);
    expect(store.getCustomEventTags()).toEqual(['면접 준비', '영어']);
    expect(store.getSnapshot()).toMatchObject({
      customTags: ['수학'],
      customEventTags: ['면접 준비', '영어'],
    });

    store.setCustomTags(['독서']);
    expect(store.getCustomEventTags()).toEqual(['면접 준비', '영어']);
    store.setCustomEventTags(['발표']);
    expect(store.getCustomTags()).toEqual(['독서']);
    expect(store.myTagPrefsPending()).toMatchObject({
      tags: ['독서'],
      eventTags: ['발표'],
    });
  });

  it('로컬 추가는 캐시·dirty에 즉시 반영되고 GET은 더 새 서버 시각만 채택한다', () => {
    const store = new CrewStore();
    store.setCustomTags(['알고리즘', ' 수학 ']);
    const local = store.myTagPrefsPending()!;
    expect(store.getSnapshot().customTags).toEqual(['수학', '알고리즘']);
    expect(store.getSnapshot().sync.pending).toBe(1);

    expect(store.mergeTagPrefsFromGet({
      m: 'sh', tags: ['독서'], updatedAt: '1970-01-01T00:00:00.000Z',
    })).toBe(true);
    expect(store.getSnapshot().customTags).toEqual(['수학', '알고리즘']);
    expect(store.myTagPrefsPending()?.updatedAt).toBe(local.updatedAt);

    const newerAt = new Date(Date.parse(local.updatedAt) + 1_000).toISOString();
    expect(store.mergeTagPrefsFromGet({ m: 'sh', tags: ['독서'], updatedAt: newerAt })).toBe(true);
    expect(store.getSnapshot().customTags).toEqual(['독서']);
    expect(store.myTagPrefsPending()).toBeNull();
  });

  it('PUT의 applied:false는 서버 prefs를 채택하되 전송 중 더 새 로컬 액션은 보존한다', () => {
    const store = new CrewStore();
    store.setCustomTags(['수학']);
    const sent = store.myTagPrefsPending()!;
    const winnerAt = new Date(Date.parse(sent.updatedAt) + 1_000).toISOString();
    expect(store.ackTagPrefs(sent.updatedAt, {
      m: 'sh', tags: ['독서'], updatedAt: winnerAt,
    }, false)).toBe(true);
    expect(store.getSnapshot().customTags).toEqual(['독서']);
    expect(store.myTagPrefsPending()).toBeNull();

    store.setCustomTags(['코딩']);
    const inFlight = store.myTagPrefsPending()!;
    store.setCustomTags(['코딩', '영어 회화']);
    expect(store.ackTagPrefs(inFlight.updatedAt, {
      m: 'sh', tags: ['코딩'], updatedAt: inFlight.updatedAt,
    }, true)).toBe(true);
    expect(store.getSnapshot().customTags).toEqual(['영어 회화', '코딩']);
    expect(store.myTagPrefsPending()).not.toBeNull();
  });

  it('데모는 목록을 메모리에만 반영하고 미전송으로 남기지 않는다', async () => {
    const store = new CrewStore();
    await store.init({ demo: true, memberId: 'sh', token: null });
    store.setCustomTags(['수학']);
    expect(store.getSnapshot().customTags).toEqual(['수학']);
    store.setCustomEventTags(['면접 준비']);
    expect(store.getSnapshot().customEventTags).toEqual(['면접 준비']);
    expect(store.myTagPrefsPending()).toBeNull();
    expect(store.getSnapshot().sync.pending).toBe(0);
  });
});
