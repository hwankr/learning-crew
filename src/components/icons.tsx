import type { CSSProperties } from 'react';
import type { Member } from '../lib/constants';

export const STAR_D =
  'M12 2.6l2.9 5.9 6.5 1-4.7 4.6 1.1 6.5-5.8-3.1-5.8 3.1 1.1-6.5-4.7-4.6 6.5-1z';
export const CHECK_D = 'M20 6 9 17l-5-5';
export const PLUS_D = 'M12 5v14M5 12h14';
export const X_D = 'M6 6l12 12M18 6L6 18';

const block: CSSProperties = { display: 'block', flex: 'none' };

export function Icon({ d, size, sw }: { d: string; size: number; sw: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" style={block}>
      <path d={d} />
    </svg>
  );
}

export function CheckMark({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#16181D"
      strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
      <path d={CHECK_D} />
    </svg>
  );
}

export function StarsRow({ n, w, h }: { n: number; w: number; h: number }) {
  return (
    <svg width={w} height={h} viewBox="0 0 120 24" style={{ display: 'block' }}>
      {[0, 1, 2, 3, 4].map((i) => (
        <path key={i} d={STAR_D} transform={i ? `translate(${i * 24} 0)` : undefined}
          fill={i < n ? '#FFB800' : '#E4E7EC'} />
      ))}
    </svg>
  );
}

export function Avatar({
  m, size, ring, dash, opacity, className, bg,
}: {
  m: Member;
  size: number;
  ring?: string;
  dash?: string;
  opacity?: number;
  className?: string;
  bg?: string;
}) {
  const style: CSSProperties = { ...block };
  if (opacity !== undefined) style.opacity = opacity;
  if (bg) style.background = bg;
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" className={className} style={style}>
      <circle cx={24} cy={24} r={21.5} fill={m.soft} stroke={ring ?? m.color} strokeWidth={3}
        strokeDasharray={dash ?? '0'} />
      <circle cx={24} cy={27} r={12.5} fill="#F6D7BC" />
      <path d={m.hair} fill={m.hairC} />
      <circle cx={19.5} cy={27.5} r={1.6} fill="#23262E" />
      <circle cx={28.5} cy={27.5} r={1.6} fill="#23262E" />
      <path d="M20.5 31.5c1 1.2 2.2 1.8 3.5 1.8s2.5-.6 3.5-1.8" stroke="#23262E" strokeWidth={1.6}
        fill="none" strokeLinecap="round" />
    </svg>
  );
}
