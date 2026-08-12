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
  return openDB<CrewDB>('learning-crew', 2, {
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
  });
}
