import { MEMBER_IDS, isStatusActive, type MemberId, type MemberStatus } from '../../shared/types';

export type RoomActivity = 'library' | 'rest' | 'away';
export interface RoomPoint { x: number; y: number }
export const ROOM_WIDTH = 640;
export const ROOM_HEIGHT = 400;
export type RoomMood = 'sunset' | 'night' | 'rain';
export type RoomFacing = 'south' | 'north' | 'east' | 'west';
export type StudyPose = 'read' | 'write' | 'type';
export type RestPose = 'stretch' | 'sip' | 'read' | 'wave';
export const ROOM_PERSONALITY: Record<MemberId, { study: StudyPose; rest: RestPose; studyLabel: string; restLabel: string }> = {
  sh: { study: 'write', rest: 'stretch', studyLabel: '노트에 차곡차곡 정리하는 중', restLabel: '기지개를 켜며 쉬어가는 중' },
  wg: { study: 'read', rest: 'sip', studyLabel: '한 페이지씩 천천히 읽는 중', restLabel: '따뜻한 차를 마시는 중' },
  th: { study: 'type', rest: 'read', studyLabel: '노트북으로 공부하는 중', restLabel: '정원에서 책을 뒤적이는 중' },
  jj: { study: 'write', rest: 'wave', studyLabel: '중요한 문장에 밑줄 긋는 중', restLabel: '친구에게 반갑게 손 흔드는 중' },
  kj: { study: 'read', rest: 'sip', studyLabel: '좋아하는 창가에서 읽는 중', restLabel: '커피 한 모금으로 쉬어가는 중' },
};

/** The scene follows the same expiry rule as the check-in card and crew board. */
export function roomActivity(status: MemberStatus | undefined, now: number): RoomActivity {
  if (!isStatusActive(status, now)) return 'rest';
  return status.place === '도서관' ? 'library' : 'away';
}

export function roomStatusLabel(status: MemberStatus | undefined, now: number): string {
  if (!isStatusActive(status, now)) return '휴식 중';
  return `${status.place ?? '기타'}에서 공부 중`;
}

/** Seats belong to members, not to their order of arrival. */
export function roomDestination(index: number, count: number, activity: RoomActivity): RoomPoint {
  if (activity === 'away') return { x: 668, y: 314 };
  if (activity === 'rest') {
    const spots = [{ x: 198, y: 350 }, { x: 242, y: 350 }, { x: 324, y: 364 }, { x: 448, y: 351 }, { x: 492, y: 351 }];
    return spots[index] ?? { x: 180 + index * 24, y: 364 };
  }
  const topCount = Math.ceil(count / 2);
  const top = index < topCount;
  const n = top ? topCount : count - topCount;
  const i = top ? index : index - topCount;
  return { x: n === 1 ? 345 : Math.round((top ? 225 : 275) + i * (top ? 240 : 170) / (n - 1)), y: top ? 145 : 224 };
}

type Segment = readonly [RoomPoint, RoomPoint];
const distance = (a: RoomPoint, b: RoomPoint) => Math.hypot(b.x - a.x, b.y - a.y);
const key = (p: RoomPoint) => `${p.x},${p.y}`;

/** Connected walkways pass beside desks, through the door, and around the garden seating. */
function walkways(): Segment[] {
  const seats = MEMBER_IDS.map((_, i) => roomDestination(i, MEMBER_IDS.length, 'library'));
  return [
    [{ x: 267, y: 190 }, { x: 507, y: 190 }],
    [{ x: 317, y: 270 }, { x: 487, y: 270 }],
    [{ x: 350, y: 190 }, { x: 350, y: 364 }],
    [{ x: 286, y: 314 }, { x: 668, y: 314 }],
    [{ x: 198, y: 350 }, { x: 286, y: 350 }],
    [{ x: 286, y: 314 }, { x: 286, y: 350 }],
    [{ x: 324, y: 364 }, { x: 350, y: 364 }],
    [{ x: 448, y: 351 }, { x: 528, y: 351 }],
    [{ x: 528, y: 314 }, { x: 528, y: 351 }],
    ...seats.flatMap((seat): Segment[] => [
      [seat, { x: seat.x + 42, y: seat.y }],
      [{ x: seat.x + 42, y: seat.y }, { x: seat.x + 42, y: seat.y < 190 ? 190 : 270 }],
    ]),
  ];
}

function project(p: RoomPoint, [a, b]: Segment): RoomPoint {
  return { x: Math.max(Math.min(a.x, b.x), Math.min(Math.max(a.x, b.x), p.x)),
    y: Math.max(Math.min(a.y, b.y), Math.min(Math.max(a.y, b.y), p.y)) };
}

/** Split the small walkway graph at the current position, then take its shortest route.
 * An interrupted walk follows the same floor plan instead of restarting from its old seat. */
export function roomRoute(from: RoomPoint, to: RoomPoint): RoomPoint[] {
  if (distance(from, to) < 0.01) return [from];
  const segments = walkways();
  const nearest = (p: RoomPoint) => segments.map((s) => project(p, s)).sort((a, b) => distance(p, a) - distance(p, b))[0]!;
  const start = nearest(from);
  const end = nearest(to);
  const nodes = new Map<string, RoomPoint>();
  const add = (p: RoomPoint) => nodes.set(key(p), p);
  segments.forEach(([a, b]) => { add(a); add(b); });
  add(start); add(end);
  for (const [a, b] of segments) {
    for (const [c, d] of segments) {
      if (a.y !== b.y || c.x !== d.x) continue;
      const crossing = { x: c.x, y: a.y };
      if (distance(crossing, project(crossing, [a, b])) < 0.01 && distance(crossing, project(crossing, [c, d])) < 0.01) add(crossing);
    }
  }
  const edges = new Map<string, string[]>();
  nodes.forEach((_, id) => edges.set(id, []));
  for (const segment of segments) {
    const line = [...nodes.values()].filter((p) => distance(p, project(p, segment)) < 0.01)
      .sort((a, b) => a.x - b.x || a.y - b.y);
    line.slice(1).forEach((p, i) => {
      edges.get(key(p))!.push(key(line[i]!));
      edges.get(key(line[i]!))!.push(key(p));
    });
  }
  const costs = new Map([[key(start), 0]]);
  const previous = new Map<string, string>();
  const pending = new Set(nodes.keys());
  while (pending.size) {
    const id = [...pending].sort((a, b) => (costs.get(a) ?? Infinity) - (costs.get(b) ?? Infinity))[0]!;
    if (id === key(end)) break;
    pending.delete(id);
    for (const neighbor of edges.get(id)!) {
      const cost = (costs.get(id) ?? Infinity) + distance(nodes.get(id)!, nodes.get(neighbor)!);
      if (cost < (costs.get(neighbor) ?? Infinity)) { costs.set(neighbor, cost); previous.set(neighbor, id); }
    }
  }
  const path = [end];
  let current = key(end);
  while (current !== key(start)) {
    const before = previous.get(current);
    if (!before) throw new Error('Pixel room walkway is disconnected');
    path.unshift(nodes.get(before)!);
    current = before;
  }
  const route = [from, ...path, to].filter((p, i, list) => i === 0 || distance(p, list[i - 1]!) > 0.01);
  // Remove straight-line junctions so a character only changes direction at actual turns.
  return route.filter((p, i) => {
    const a = route[i - 1]; const b = route[i + 1];
    return !a || !b || (Math.abs(a.x - p.x) + Math.abs(p.x - b.x) > 0.01 && Math.abs(a.y - p.y) + Math.abs(p.y - b.y) > 0.01);
  });
}

export function roomFacing(from: RoomPoint, to: RoomPoint): RoomFacing {
  if (Math.abs(to.x - from.x) > Math.abs(to.y - from.y)) return to.x > from.x ? 'east' : 'west';
  return to.y > from.y ? 'south' : 'north';
}

/** Distance-based offsets keep the pace steady through turns. No per-frame React updates. */
export function roomMotion(points: RoomPoint[]): {
  frames: { transform: string; offset: number }[];
  duration: number;
} {
  const distances = points.map((p, i) => i === 0 ? 0 : Math.hypot(p.x - points[i - 1]!.x, p.y - points[i - 1]!.y));
  const total = distances.reduce((sum, n) => sum + n, 0);
  let travelled = 0;
  return {
    frames: points.map((p, i) => {
      travelled += distances[i]!;
      return { transform: `translate(${p.x}px, ${p.y}px)`, offset: total ? travelled / total : 1 };
    }),
    duration: total / 0.15,
  };
}
