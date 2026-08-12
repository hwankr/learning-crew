import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Entry, MemberStatus, PullCursor } from '../../shared/types';

interface CrewDB extends DBSchema {
  entries: { key: string; value: Entry };
  queue: { key: string; value: true };
  meta: { key: string; value: PullCursor | boolean | MemberStatus };
}

export type CrewDatabase = IDBPDatabase<CrewDB>;

export function openCrewDB(): Promise<CrewDatabase> {
  return openDB<CrewDB>('learning-crew', 1, {
    upgrade(db) {
      db.createObjectStore('entries', { keyPath: 'id' });
      db.createObjectStore('queue');
      db.createObjectStore('meta');
    },
  });
}
