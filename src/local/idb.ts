import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type {
  Comment,
  Entry,
  MemberId,
  MemberStatus,
  PullCursor,
  ReactionCursor,
  ReactionSet,
} from '../../shared/types';

/** 큐 항목 — 값이 rev/base를 담는다.
    rev: 로컬 수정 카운터. push 응답의 rev와 다르면 "전송 중 또 수정됨"이므로 큐에 남긴다.
    base: 이 행이 마지막으로 서버와 일치했던 스냅샷 — 충돌 시 3-way 병합의 기준. 신규 행은 null. */
export interface QueueMeta {
  rev: number;
  base: Entry | null;
}

export interface CrewDB extends DBSchema {
  entries: { key: string; value: Entry };
  queue: { key: string; value: QueueMeta };
  comments: { key: string; value: Comment };
  /** 존재 자체가 "아직 push 안 됨" 표시 (값은 항상 true) — 댓글은 내용이 불변이라
      기록처럼 rev/base를 들 필요가 없다. 정산은 "보낸 삭제 상태 vs 지금 삭제 상태"로 한다. */
  commentQueue: { key: string; value: boolean };
  /** key = reactionKey(entryId, m) */
  reactions: { key: string; value: ReactionSet };
  /** key = entryId — 내 행만 dirty가 될 수 있다(남의 리액션은 로컬에서 못 바꾼다) */
  reactionQueue: { key: string; value: boolean };
  meta: { key: string; value: PullCursor | ReactionCursor | boolean | MemberStatus };
}

/** 리액션 로컬 키 — (기록, 멤버) 쌍이 곧 행이다. */
export const reactionKey = (entryId: string, m: MemberId): string => `${entryId}|${m}`;

export type CrewDatabase = IDBPDatabase<CrewDB>;

export function openCrewDB(): Promise<CrewDatabase> {
  let handle: CrewDatabase | null = null;
  const opened = openDB<CrewDB>('learning-crew', 3, {
    async upgrade(db, oldVersion, _newVersion, tx) {
      if (oldVersion < 1) {
        db.createObjectStore('entries', { keyPath: 'id' });
        db.createObjectStore('queue');
        db.createObjectStore('meta');
      }
      if (oldVersion === 1) {
        // v1 큐 값은 true — base 스냅샷이 없으므로 "전 필드 로컬 변경"으로 취급되는 base:null로 이관
        const queue = tx.objectStore('queue');
        let cur = await queue.openCursor();
        while (cur) {
          await cur.update({ rev: 1, base: null });
          cur = await cur.continue();
        }
      }
      if (oldVersion < 3) {
        // 댓글·리액션 스트림 추가. 행 스토어와 큐 스토어를 나눠 두면 "행 + 큐"를 한
        // 트랜잭션으로 묶으면서도 큐만 지우는 정산이 값 전체를 다시 쓰지 않는다.
        db.createObjectStore('comments', { keyPath: 'id' });
        db.createObjectStore('commentQueue');
        // 리액션 키는 (entryId, m) 합성이라 keyPath로 표현할 수 없다 — 밖에서 준다
        db.createObjectStore('reactions');
        db.createObjectStore('reactionQueue');
      }
    },
    // 다른 탭이 더 높은 버전으로 업그레이드하려 할 때 이 연결이 막고 있으면 양보한다 —
    // 이 탭은 메모리 전용으로 강등되지만(쓰기는 txWrite가 조용히 무시) 새 탭이 살아난다.
    // (v1로 배포된 구버전 번들에는 이 핸들러가 없어 그 탭들만은 여전히 막을 수 있다 —
    //  init의 2초 레이스가 그 경우 메모리 전용으로 계속 동작하게 한다)
    blocking() {
      handle?.close();
    },
  });
  return opened.then((db) => (handle = db));
}
