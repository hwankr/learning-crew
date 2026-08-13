/* 리액션 칩 집계 — 렌더와 분리된 순수 함수라 테스트가 UI 없이 규칙을 붙든다. */
import { MEMBER_IDS, MEMBER_NAMES, REACTIONS } from '../../shared/types';
import type { MemberId, ReactionEmoji, ReactionSet } from '../../shared/types';

export interface ReactionTally {
  emoji: ReactionEmoji;
  n: number;
  mine: boolean;
  /** 누른 멤버 표시 이름 — 칩의 title로 보여준다. */
  names: string[];
}

/** REACTIONS 순서로, 하나 이상 눌린 이모지만. names는 누른 멤버 표시 이름(칩 title).
    이모지도 멤버도 고정 순서로 정렬한다 — 스냅샷이 오는 순서에 따라 칩이나 이름이
    자리를 바꾸면, 내용은 그대로인데 화면만 들썩인다. */
export function tallyReactions(sets: ReactionSet[], me: MemberId): ReactionTally[] {
  const ordered = [...sets].sort((a, b) => MEMBER_IDS.indexOf(a.m) - MEMBER_IDS.indexOf(b.m));
  const out: ReactionTally[] = [];
  for (const emoji of REACTIONS) {
    const hit = ordered.filter((s) => s.emojis.includes(emoji));
    if (hit.length === 0) continue; // 0개짜리 칩은 그리지 않는다
    out.push({
      emoji,
      n: hit.length,
      mine: hit.some((s) => s.m === me),
      names: hit.map((s) => MEMBER_NAMES[s.m]),
    });
  }
  return out;
}
