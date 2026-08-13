import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Entry, MemberStatus, PullCursor } from '../../shared/types';

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
  meta: { key: string; value: PullCursor | boolean | MemberStatus };
}

export type CrewDatabase = IDBPDatabase<CrewDB>;

export function openCrewDB(): Promise<CrewDatabase> {
  let handle: CrewDatabase | null = null;
  const opened = openDB<CrewDB>('learning-crew', 2, {
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
