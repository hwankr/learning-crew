/* 리액션 칩 집계 규칙 — 표시 순서·개수·내가 눌렀는지 판정. */
import { describe, expect, it } from 'vitest';
import type { MemberId, ReactionEmoji, ReactionSet } from '../../shared/types';
import { clampPopoverLeft } from '../components/EntrySocial';
import { tallyReactions } from './reactions';

function set(m: MemberId, emojis: ReactionEmoji[]): ReactionSet {
  return {
    entryId: '11111111-1111-4111-8111-111111111111',
    m,
    emojis,
    actedAt: '2026-08-13T01:00:00.000Z',
    updatedAt: '2026-08-13T01:00:00.000Z',
  };
}

describe('tallyReactions', () => {
  it('REACTIONS 순서로 내보낸다 (입력 순서와 무관)', () => {
    const out = tallyReactions([set('sh', ['😴', '👏']), set('wg', ['🔥'])], 'th');
    expect(out.map((t) => t.emoji)).toEqual(['👏', '🔥', '😴']);
  });

  it('아무도 안 누른 이모지는 칩을 만들지 않는다', () => {
    expect(tallyReactions([], 'sh')).toEqual([]);
    expect(tallyReactions([set('sh', [])], 'sh')).toEqual([]);
  });

  it('개수는 그 이모지를 누른 멤버 수다', () => {
    const out = tallyReactions([set('sh', ['👏']), set('wg', ['👏']), set('th', ['🔥'])], 'jj');
    expect(out.map((t) => [t.emoji, t.n])).toEqual([['👏', 2], ['🔥', 1]]);
  });

  it('mine은 내 멤버 id가 그 이모지를 눌렀을 때만 참이다', () => {
    const sets = [set('sh', ['👏', '💪']), set('wg', ['👏'])];
    const mineSh = tallyReactions(sets, 'sh');
    expect(mineSh.map((t) => [t.emoji, t.mine])).toEqual([['👏', true], ['💪', true]]);
    const mineWg = tallyReactions(sets, 'wg');
    expect(mineWg.map((t) => [t.emoji, t.mine])).toEqual([['👏', true], ['💪', false]]);
    expect(tallyReactions(sets, 'jj').every((t) => !t.mine)).toBe(true);
  });

  it('names는 멤버 고정 순서(sh·wg·th·jj)의 표시 이름이다', () => {
    const out = tallyReactions([set('jj', ['👏']), set('sh', ['👏']), set('th', ['👏'])], 'sh');
    expect(out[0]?.names).toEqual(['승환', '태현', '진주']);
  });

  it('입력 배열을 뒤집지 않는다 — 스냅샷 맵을 그대로 쓰는 호출부가 있다', () => {
    const sets = [set('jj', ['🔥']), set('sh', ['🔥'])];
    tallyReactions(sets, 'sh');
    expect(sets.map((s) => s.m)).toEqual(['jj', 'sh']);
  });
});

describe('clampPopoverLeft', () => {
  it('여유가 있으면 + 버튼 왼쪽에 맞춘다', () => {
    expect(clampPopoverLeft(114, 360, 190)).toBe(114);
    expect(clampPopoverLeft(0, 360, 190)).toBe(0);
  });

  it('오른쪽으로 새면 줄 오른쪽 끝에 붙인다 — 가로 스크롤이 생기지 않게', () => {
    expect(clampPopoverLeft(300, 360, 190)).toBe(170);
    expect(clampPopoverLeft(360, 360, 190)).toBe(170);
  });

  it('줄이 팝오버보다 좁으면 0 — 음수 left로 왼쪽이 잘리는 게 더 나쁘다', () => {
    expect(clampPopoverLeft(100, 150, 190)).toBe(0);
    expect(clampPopoverLeft(0, 0, 190)).toBe(0);
  });

  it('폭을 못 잰 경우(popW=0)도 버튼 위치를 넘지 않는다', () => {
    expect(clampPopoverLeft(114, 360, 0)).toBe(114);
  });
});
