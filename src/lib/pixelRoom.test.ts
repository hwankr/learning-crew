import { describe, expect, it } from 'vitest';
import { STATUS_TTL_MS, type MemberStatus } from '../../shared/types';
import { MEMBERS } from './constants';
import { ROOM_PERSONALITY, ROOM_SPOTS, ROOM_WIDTH, ROOM_HEIGHT, roomActivity, roomDestination, roomFacing, roomMotion, roomRoute, roomStatusLabel, type RoomPoint } from './pixelRoom';

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
      // Library and café have separate doors. Outside paths may pass beside either building.
      if (a.x > 70 && a.x < 634 && Math.min(a.y, b.y) < 354 && Math.max(a.y, b.y) > 354) {
        expect(a.x).toBe(352);
        expect(b.x).toBe(352);
      }
      if (a.x > 682 && a.x < 964 && Math.min(a.y, b.y) < 345 && Math.max(a.y, b.y) > 345) {
        expect(a.x).toBe(816);
        expect(b.x).toBe(816);
      }
      // Table bodies extend below each seated foot position. Walk via their sides.
      for (const seat of MEMBERS.map((_, member) => dest(member, 'library'))) {
        const crossesDesk = a.x === b.x
          ? a.x > seat.x - 35 && a.x < seat.x + 36 && Math.max(a.y, b.y) > seat.y + 2 && Math.min(a.y, b.y) < seat.y + 30
          : a.y > seat.y + 2 && a.y < seat.y + 30 && Math.max(a.x, b.x) > seat.x - 35 && Math.min(a.x, b.x) < seat.x + 36;
        expect(crossesDesk).toBe(false);
      }
    }
  }

  it('gives all five members distinct, stable seats and resting spots', () => {
    for (const activity of ['library', 'rest'] as const) {
      const points = MEMBERS.map((_, i) => dest(i, activity));
      expect(new Set(points.map((p) => `${p.x},${p.y}`)).size).toBe(MEMBERS.length);
      expect(points.every((p) => p.x >= 0 && p.x <= ROOM_WIDTH && p.y >= 0 && p.y <= ROOM_HEIGHT)).toBe(true);
    }
    const seats = MEMBERS.map((_, i) => dest(i, 'library'));
    expect(seats.filter((p) => p.y === 186)).toHaveLength(3);
    expect(seats.filter((p) => p.y === 282)).toHaveLength(2);
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

  it('connects every activity, seat and exit without crossing either building wall or furniture', () => {
    const points = [...Object.values(ROOM_SPOTS), ...MEMBERS.flatMap((_, i) => [dest(i, 'library'), dest(i, 'rest')]), dest(0, 'away')].map(({ x, y }) => ({ x, y }));
    for (const from of points) for (const to of points) {
      const route = roomRoute(from, to);
      expect(route[0]).toEqual(from);
      expect(route.at(-1)).toEqual(to);
      assertWalkable(route);
      for (let i = 1; i < route.length; i++) {
        const a = route[i - 1]!; const b = route[i]!;
        // The pond and flower bed are scenery, never shortcuts between garden activities.
        for (const [left, top, right, bottom] of [[65, 478, 235, 597], [500, 508, 610, 554]] as const) {
          const enters = a.x === b.x
            ? a.x > left && a.x < right && Math.max(a.y, b.y) > top && Math.min(a.y, b.y) < bottom
            : a.y > top && a.y < bottom && Math.max(a.x, b.x) > left && Math.min(a.x, b.x) < right;
          expect(enters).toBe(false);
        }
      }
    }
  });

  it('redirects between autonomous activities from fractional positions along every turn', () => {
    for (const from of Object.values(ROOM_SPOTS)) {
      const route = roomRoute(from, dest(0, 'library'));
      for (let i = 1; i < route.length; i++) {
        const a = route[i - 1]!; const b = route[i]!;
        const current = { x: a.x + (b.x - a.x) * .417, y: a.y + (b.y - a.y) * .417 };
        for (const to of [ROOM_SPOTS.chat_left, ROOM_SPOTS.flowers, dest(0, 'away')]) {
          const redirected = roomRoute(current, to);
          expect(redirected[0]).toEqual(current);
          expect(redirected.at(-1)).toMatchObject({ x: to.x, y: to.y });
          assertWalkable(redirected);
        }
      }
    }
  });

  it('can redirect all members from every leg of entry and exit, including fractional animation positions', () => {
    MEMBERS.forEach((_, member) => {
      for (const activity of ['library', 'rest', 'away'] as const) {
        const original = roomRoute(dest(member, 'library'), dest(member, activity));
        for (let i = 1; i < original.length; i++) {
          const a = original[i - 1]!; const b = original[i]!;
          const current = { x: a.x + (b.x - a.x) * .371, y: a.y + (b.y - a.y) * .371 };
          for (const target of ['library', 'rest', 'away'] as const) {
            const redirected = roomRoute(current, dest(member, target));
            expect(redirected[0]).toEqual(current);
            expect(redirected.at(-1)).toEqual(dest(member, target));
            assertWalkable(redirected);
          }
        }
      }
    });
  });

  it('faces the actual direction of travel on all four axes', () => {
    const start = { x: 350, y: 314 };
    expect(roomFacing(start, { x: 528, y: 314 })).toBe('east');
    expect(roomFacing(start, { x: 286, y: 314 })).toBe('west');
    expect(roomFacing(start, { x: 350, y: 190 })).toBe('north');
    expect(roomFacing(start, { x: 350, y: 364 })).toBe('south');
  });

  it('gives the scene varied study and rest activities for the five-member crew', () => {
    expect(new Set(MEMBERS.map((m) => ROOM_PERSONALITY[m.id].study))).toEqual(new Set(['read', 'write', 'type']));
    expect(new Set(MEMBERS.map((m) => ROOM_PERSONALITY[m.id].rest))).toEqual(new Set(['stretch', 'sip', 'read', 'wave']));
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
