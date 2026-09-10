import type { MemberId } from '../../shared/types';
import { ROOM_PERSONALITY, type RoomAction, type RoomFacing } from './pixelRoom';

export type CharacterPose = 'idle' | 'walk' | 'study';
export type CharacterClip = 'idle' | 'walk-side' | 'walk-front' | 'walk-back' | 'read' | 'sip' | 'chat' | 'water' | 'study' | 'browse' | 'brew' | 'greet';
export const CHARACTER_FRAME = { width: 192, height: 224, baseline: 204, columns: 6, rows: 12 } as const;
export const CHARACTER_CLIPS: Record<CharacterClip, { row: number; seconds: number }> = {
  idle: { row: 0, seconds: 5.8 },
  'walk-side': { row: 1, seconds: .58 },
  'walk-front': { row: 2, seconds: .58 },
  'walk-back': { row: 3, seconds: .58 },
  read: { row: 4, seconds: 5.6 },
  sip: { row: 5, seconds: 6.4 },
  chat: { row: 6, seconds: 3.2 },
  water: { row: 7, seconds: 3.6 },
  study: { row: 8, seconds: 3.2 },
  browse: { row: 9, seconds: 4.2 },
  brew: { row: 10, seconds: 3.8 },
  greet: { row: 11, seconds: 7.2 },
};

/** Travel owns the pose even when an interrupted activity still owns the destination. */
export function characterClip(id: MemberId, pose: CharacterPose, facing: RoomFacing, action: RoomAction): CharacterClip {
  if (pose === 'walk') return facing === 'north' ? 'walk-back' : facing === 'south' ? 'walk-front' : 'walk-side';
  if (pose === 'study' || action === 'study') return 'study';
  if (action === 'water') return 'water';
  if (action === 'browse') return 'browse';
  if (action === 'coffee') return facing === 'north' ? 'brew' : 'sip';
  if (action === 'chat') return 'chat';
  if (action === 'read') return 'read';
  if (action === 'rest') {
    const rest = ROOM_PERSONALITY[id].rest;
    return rest === 'sip' ? 'sip' : rest === 'read' ? 'read' : 'greet';
  }
  return 'idle';
}
