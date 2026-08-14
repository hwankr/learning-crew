import type { Tag } from '../../shared/types';
import { TAGMETA } from '../lib/constants';

const VARIANTS = {
  xs: { icon: 10, cls: 'chip chip-xs' },
  sm: { icon: 11, cls: 'chip chip-sm' },
  sm2: { icon: 10, cls: 'chip chip-sm' },
  md: { icon: 11, cls: 'chip chip-md' },
} as const;

export function Chip({ tag, variant }: { tag: Tag; variant: keyof typeof VARIANTS }) {
  const tm = TAGMETA[tag];
  const v = VARIANTS[variant];
  return (
    <span className={v.cls} style={{ background: tm.bg, color: tm.fg }}>
      {/* display·flex는 인라인이 아니라 CSS(.chip svg)가 준다 — 보드 스트립처럼 아이콘을
          접어야 하는 자리가 있는데, 인라인 style이면 스타일시트로 덮을 수가 없다 */}
      <svg width={v.icon} height={v.icon} viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
        <path d={tm.icon} />
      </svg>
      <span className="chip-label">{tag}</span>
    </span>
  );
}

/** 자리가 좁아 못 보여준 태그 수 — 칩과 같은 크기 체계를 쓰되 색은 중립(무채색)이다.
    태그 색을 쓰면 없는 태그의 색을 주장하게 되고, 여러 개일 때 어느 색을 쓸지도 정할 수 없다. */
export function MoreChip({ n, variant }: { n: number; variant: keyof typeof VARIANTS }) {
  return <span className={VARIANTS[variant].cls + ' chip-more'}>+{n}</span>;
}
