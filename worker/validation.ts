import {
  PUSH_LIMITS,
  TAGS,
  UUID_RE,
  type Entry,
  type MemberId,
} from '../shared/types';

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

/** 형식만이 아니라 실존하는 달력 날짜인지 — '2026-02-31'은 Postgres date 삽입에서
    500을 내며 배치 전체를 죽이므로 여기서 행 단위 400으로 걸러야 한다. */
function isRealDay(day: string): boolean {
  if (!DAY_RE.test(day)) return false;
  const [y, m, d] = day.split('-').map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m! - 1 && dt.getUTCDate() === d;
}

/** 본인 행 + 형식이 유효할 때만 통과. 실패 사유 문자열, 성공이면 null. */
export function invalidReason(e: Entry, me: MemberId): string | null {
  if (!e || typeof e !== 'object') return 'not an object';
  if (typeof e.id !== 'string' || !UUID_RE.test(e.id)) return 'bad id';
  if (e.m !== me) return 'not your entry';
  if (typeof e.day !== 'string' || !isRealDay(e.day)) return 'bad day';
  if (typeof e.time !== 'string' || !TIME_RE.test(e.time)) return 'bad time';
  // tags가 있으면 그것만 검사한다 — tag는 서버가 tags에서 다시 계산하므로 볼 필요가 없다.
  // tags가 없으면 구버전 클라이언트(단일 태그 프로토콜) — 예전대로 tag만 검사한다.
  if (e.tags !== undefined) {
    if (
      !Array.isArray(e.tags) ||
      e.tags.length === 0 ||
      e.tags.length > TAGS.length ||
      new Set(e.tags).size !== e.tags.length ||
      !e.tags.every((t) => (TAGS as readonly string[]).includes(t))
    ) {
      return 'bad tags';
    }
  } else if (!(TAGS as readonly string[]).includes(e.tag)) {
    return 'bad tag';
  }
  // null은 다중 태그 이전 서버·레거시 이관에 이미 존재하는 "평가 없음" 값이라 허용한다.
  // OFF가 숫자를 보내도 실제 저장은 toInsertRow가 null로 강제한다 — 한 행의 레거시 값을
  // 이유로 배치 전체를 400으로 막지 않으면서 OFF ⇒ null 불변식은 DB 경계에서 지킨다.
  if (e.stars !== null && (!Number.isInteger(e.stars) || e.stars < 1 || e.stars > 5)) {
    return 'bad stars';
  }
  if (typeof e.memo !== 'string' || e.memo.length > PUSH_LIMITS.memo) return 'bad memo';
  if (typeof e.body !== 'string' || e.body.length > PUSH_LIMITS.body) return 'bad body';
  if (!Array.isArray(e.todos) || e.todos.length > PUSH_LIMITS.todos) return 'bad todos';
  for (const t of e.todos) {
    if (!t || typeof t.t !== 'string' || t.t.length > PUSH_LIMITS.todoText || typeof t.done !== 'boolean') {
      return 'bad todo item';
    }
  }
  // v가 아예 없으면 구버전 클라이언트(레거시 LWW 프로토콜) — 거부하지 않고 레거시 경로로 처리
  if (e.v !== undefined && (!Number.isInteger(e.v) || e.v < 0 || e.v > 2_000_000_000)) return 'bad v';
  if (e.deletedAt !== null && typeof e.deletedAt !== 'string') return 'bad deletedAt';
  return null;
}
