import { describe, expect, it } from 'vitest';
import { STATUS_TTL_MS, type MemberStatus } from '../../shared/types';
import { MEMBERS } from './constants';
import { roomActivity, roomDestination, roomMotion, roomRoute, roomStatusLabel, type RoomPoint } from './pixelRoom';

const now = Date.parse('2026-09-10T05:00:00.000Z');
const active: MemberStatus = {
  m: 'sh', on: true, place: '도서관', since: new Date(now - 60_000).toISOString(),
  lastStartedAt: new Date(now - 60_000).toISOString(), updatedAt: new Date(now).toISOString(),
};

describe('pixel room follows check-in truth', () => {
  it('shows fresh library check-ins at a desk, with missing/off states resting', () => {
    expect(roomActivity(active, now)).toBe('library');
    expect(roomActivity(undefined, now)).toBe('rest');
    expect(roomActivity({ ...active, on: false }, now)).toBe('rest');
  });

  it('expires at exactly the same 14-hour boundary as the existing board', () => {
    const status = { ...active, since: new Date(now - STATUS_TTL_MS).toISOString() };
    expect(roomActivity(status, now - 1)).toBe('library');
    expect(roomActivity(status, now)).toBe('rest');
    expect(roomStatusLabel(status, now)).toBe('휴식 중');
  });

  it('never seats a member at the library when they checked in somewhere else', () => {
    for (const place of ['집', '카페', '기타', null] as const) {
      const status = { ...active, place };
      expect(roomActivity(status, now)).toBe('away');
      expect(roomStatusLabel(status, now)).toBe(`${place ?? '기타'}에서 공부 중`);
    }
  });

  it('rejects a missing or invalid start time even if the ON flag remains', () => {
    for (const since of [null, 'invalid']) expect(roomActivity({ ...active, since }, now)).toBe('rest');
  });

  it('an ACK timestamp or last-started stamp cannot revive an expired session', () => {
    expect(roomActivity({ ...active, since: new Date(now - STATUS_TTL_MS).toISOString(), updatedAt: new Date(now + 1000).toISOString() }, now)).toBe('rest');
    expect(roomActivity({ ...active, on: false, since: null }, now)).toBe('rest');
  });
});

describe('pixel room routes', () => {
  const dest = (i: number, activity: 'library' | 'rest' | 'away') => roomDestination(i, MEMBERS.length, activity);

  function assertWalkable(points: RoomPoint[]) {
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!;
      const b = points[i]!;
      expect(a.x === b.x || a.y === b.y).toBe(true);
      if (Math.min(a.y, b.y) < 232 && Math.max(a.y, b.y) > 232) {
        expect(a.x).toBe(240);
        expect(b.x).toBe(240);
      }
    }
  }

  it('gives all five members distinct, stable seats and resting spots', () => {
    for (const activity of ['library', 'rest'] as const) {
      const points = MEMBERS.map((_, i) => dest(i, activity));
      expect(new Set(points.map((p) => `${p.x},${p.y}`)).size).toBe(MEMBERS.length);
      expect(points.every((p) => p.x >= 60 && p.x <= 420)).toBe(true);
    }
  });

  it('uses the door in both directions for every member, including off-scene departures', () => {
    MEMBERS.forEach((_, i) => {
      for (const from of ['library', 'rest', 'away'] as const) {
        for (const to of ['library', 'rest', 'away'] as const) {
          const route = roomRoute(dest(i, from), dest(i, to));
          expect(route[0]).toEqual(dest(i, from));
          expect(route.at(-1)).toEqual(dest(i, to));
          assertWalkable(route);
        }
      }
    });
  });

  it('can redirect at any point along a walk without teleporting or cutting through the wall', () => {
    const original = roomRoute(dest(0, 'rest'), dest(0, 'library'));
    for (let i = 1; i < original.length; i++) {
      const a = original[i - 1]!;
      const b = original[i]!;
      const current = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      for (const activity of ['library', 'rest', 'away'] as const) {
        const redirected = roomRoute(current, dest(0, activity));
        expect(redirected[0]).toEqual(current);
        expect(redirected.at(-1)).toEqual(dest(0, activity));
        assertWalkable(redirected);
      }
    }
  });

  it('does not replay a walk for an unchanged destination', () => {
    const position = dest(2, 'library');
    expect(roomRoute(position, position)).toEqual([position]);
    expect(roomMotion([position]).duration).toBe(0);
  });

  it('assigns strictly increasing, distance-based offsets and finite durations', () => {
    const motion = roomMotion(roomRoute(dest(0, 'rest'), dest(0, 'library')));
    expect(motion.frames[0]!.offset).toBe(0);
    expect(motion.frames.at(-1)!.offset).toBe(1);
    expect(motion.duration).toBeGreaterThan(0);
    expect(Number.isFinite(motion.duration)).toBe(true);
    motion.frames.slice(1).forEach((frame, i) => expect(frame.offset).toBeGreaterThan(motion.frames[i]!.offset));
  });
});
