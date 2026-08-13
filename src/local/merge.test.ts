/* 충돌 병합 규칙 검증 — 필드 단위 3-way 병합과 내용 동등성 판별.
   (스토어의 push 충돌 처리 경로가 이 두 함수로 수렴을 결정한다)
   + 댓글·리액션 스트림의 순수 규칙: 스냅샷 파생, 토글 정규화, ACK 정산 판단. */
import { describe, expect, it } from 'vitest';
import type { Comment, Entry, ReactionSet } from '../../shared/types';
import {
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
  reactionAckSettles,
  toggledEmojis,
} from './store';

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
