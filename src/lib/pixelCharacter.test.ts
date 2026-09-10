import { describe, expect, it } from 'vitest';
import { MEMBER_IDS } from '../../shared/types';
import { characterClip } from './pixelCharacter';
import type { RoomAction } from './pixelRoom';

describe('character animation transitions', () => {
  it('puts away every activity prop while travelling, including an interrupted study or watering task', () => {
    const actions: RoomAction[] = ['study', 'rest', 'browse', 'coffee', 'read', 'water', 'wander', 'chat'];
    for (const id of MEMBER_IDS) for (const action of actions) {
      expect(characterClip(id, 'walk', 'north', action)).toBe('walk-back');
      expect(characterClip(id, 'walk', 'south', action)).toBe('walk-front');
      expect(characterClip(id, 'walk', 'east', action)).toBe('walk-side');
      expect(characterClip(id, 'walk', 'west', action)).toBe('walk-side');
    }
  });

  it('uses the machine-facing action at the café, then lifts the mug when settled at a table', () => {
    for (const id of MEMBER_IDS) {
      expect(characterClip(id, 'idle', 'north', 'coffee')).toBe('brew');
      expect(characterClip(id, 'idle', 'south', 'coffee')).toBe('sip');
    }
  });

  it('keeps personal rest habits and returns to each member’s study frames after a new check-in', () => {
    expect(characterClip('sh', 'idle', 'south', 'rest')).toBe('greet');
    expect(characterClip('jj', 'idle', 'south', 'rest')).toBe('greet');
    expect(characterClip('th', 'idle', 'south', 'rest')).toBe('read');
    expect(characterClip('wg', 'idle', 'south', 'rest')).toBe('sip');
    expect(characterClip('kj', 'idle', 'south', 'rest')).toBe('sip');
    for (const id of MEMBER_IDS) expect(characterClip(id, 'study', 'south', 'study')).toBe('study');
  });
});
