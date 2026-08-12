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
      <svg width={v.icon} height={v.icon} viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', flex: 'none' }}>
        <path d={tm.icon} />
      </svg>
      <span className="chip-label">{tag}</span>
    </span>
  );
}
