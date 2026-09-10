import { isStatusActive, type MemberStatus } from '../../shared/types';

export type RoomActivity = 'library' | 'rest' | 'away';
export interface RoomPoint { x: number; y: number }
export const ROOM_WIDTH = 480;
export const ROOM_HEIGHT = 352;

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
  if (activity === 'away') return { x: 508, y: 263 };
  return { x: Math.round(80 + index * (320 / Math.max(1, count - 1))), y: activity === 'library' ? 170 : 308 };
}

/** Use the aisle and the open door, including when a walk is interrupted halfway. */
export function roomRoute(from: RoomPoint, to: RoomPoint): RoomPoint[] {
  const points: RoomPoint[] = [from];
  const add = (x: number, y: number) => {
    const last = points[points.length - 1]!;
    if (Math.abs(last.x - x) + Math.abs(last.y - y) > 0.01) points.push({ x, y });
  };
  if (Math.abs(from.x - to.x) + Math.abs(from.y - to.y) < 0.01) return points;
  const insideFrom = from.y < 232;
  const insideTo = to.y < 232;
  if (insideFrom) add(from.x, 214);
  else add(from.x, 263);
  if (insideFrom !== insideTo) {
    add(240, insideFrom ? 214 : 263);
    add(240, insideTo ? 214 : 263);
  }
  add(to.x, insideTo ? 214 : 263);
  add(to.x, to.y);
  return points;
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
    duration: total / 0.105,
  };
}
