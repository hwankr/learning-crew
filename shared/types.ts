/* 클라이언트와 Worker가 공유하는 도메인 타입 + 동기화 프로토콜. */

export const MEMBER_IDS = ['sh', 'wg', 'th', 'jj'] as const;
export type MemberId = (typeof MEMBER_IDS)[number];

export const TAGS = ['자격증', '영어', '코딩테스트', '기타', 'OFF'] as const;
export type Tag = (typeof TAGS)[number];

export interface Todo {
  t: string;
  done: boolean;
}

export interface Entry {
  id: string; // 클라이언트 생성 UUID — 멱등 업서트의 키
  m: MemberId;
  day: string; // YYYY-MM-DD
  time: string; // HH:MM
  tag: Tag;
  stars: number | null; // OFF는 null
  memo: string;
  body: string;
  todos: Todo[];
  updatedAt: string; // 서버 시계 기준 (클라이언트 값은 잠정치)
  deletedAt: string | null; // soft delete — 삭제도 동기화로 전파된다
}

/** 행 전체를 last-write-wins로 업서트한다. 삭제는 deletedAt이 찍힌 행. */
export interface PushRequest {
  entries: Entry[];
}
export interface PushResponse {
  ok: true;
  serverTime: string;
}

/** (updated_at, id) 키셋 커서 — 같은 타임스탬프 행도 놓치지 않는다. */
export interface PullCursor {
  ts: string;
  id: string;
}
export interface PullResponse {
  rows: Entry[];
  cursor: PullCursor | null;
}

export const PUSH_LIMITS = {
  batch: 200,
  memo: 60,
  body: 4000,
  todos: 50,
  todoText: 500,
} as const;
