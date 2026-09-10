import { memo, type CSSProperties } from 'react';
import type { Member } from '../lib/constants';
import type { RoomAction, RoomFacing } from '../lib/pixelRoom';
import { CHARACTER_CLIPS, CHARACTER_FRAME, characterClip, type CharacterClip, type CharacterPose } from '../lib/pixelCharacter';
import sh from '../assets/pixel-characters/sh-v5.webp';
import wg from '../assets/pixel-characters/wg-v5.webp';
import th from '../assets/pixel-characters/th-v5.webp';
import jj from '../assets/pixel-characters/jj-v5.webp';
import kj from '../assets/pixel-characters/kj-v5.webp';

const ATLASES = { sh, wg, th, jj, kj };

/** Registered, transparent full-body frames; CSS advances pixels without a React render per frame. */
export const PixelCharacter = memo(function PixelCharacter({ m, pose = 'idle', facing = 'south', action = 'wander', motion = true, speed = 1, previewClip }: {
  m: Member;
  pose?: CharacterPose;
  facing?: RoomFacing;
  action?: RoomAction;
  motion?: boolean;
  speed?: number;
  previewClip?: CharacterClip;
}) {
  const clip = previewClip ?? characterClip(m.id, pose, facing, action);
  const { row, seconds } = CHARACTER_CLIPS[clip];
  const { width, height, columns, rows } = CHARACTER_FRAME;
  const mirror = facing === 'west';
  return <g className={`px-person px-person-${pose} px-action-${action}`} data-facing={facing} data-clip={clip}
    data-animated={motion} style={{ '--px-cycle': `${seconds / speed}s` } as CSSProperties}>
    <g transform={mirror ? `translate(${width} 0) scale(-1 1)` : undefined}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} overflow="hidden" aria-hidden="true">
        <g transform={`translate(0 ${-row * height})`}>
          <image key={clip} className="px-sprite-sheet" href={ATLASES[m.id]} width={width * columns} height={height * rows} />
        </g>
      </svg>
    </g>
  </g>;
});

export function PixelPortrait({ m }: { m: Member }) {
  return <svg className="px-portrait" viewBox="38 36 116 174" aria-hidden="true">
    <PixelCharacter m={m} motion={false} />
  </svg>;
}

/** The same character's face, cropped from a still frame for app-wide identity. */
export function PixelFace({ m }: { m: Member }) {
  const { width, height, columns, rows } = CHARACTER_FRAME;
  const top = CHARACTER_CLIPS.idle.row * height + 34;
  return <svg width="100%" height="100%" viewBox={`38 ${top} 116 116`} aria-hidden="true">
    <image href={ATLASES[m.id]} width={width * columns} height={height * rows} />
  </svg>;
}
