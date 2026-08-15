import { describe, expect, it, vi } from 'vitest';
import type { CrewDatabase, CrewDB } from './idb';
import { openCrewDBWithTimeout, upgradePhotoCacheStore } from './idb';
import type { IDBPDatabase } from 'idb';

describe('IndexedDB v6 사진 스키마', () => {
  it('v5 photoCache만 버리고 다시 만들며 photoBlobs는 유지한다', () => {
    const deleted: string[] = [];
    const created: string[] = [];
    const db = {
      deleteObjectStore(name: string) {
        deleted.push(name);
      },
      createObjectStore(name: string) {
        created.push(name);
        return {};
      },
    } as unknown as Pick<IDBPDatabase<CrewDB>, 'createObjectStore' | 'deleteObjectStore'>;

    upgradePhotoCacheStore(db, 5);

    expect(deleted).toEqual(['photoCache']);
    expect(created).toEqual(['photoCache']);
    expect(deleted).not.toContain('photoBlobs');
  });

  it('open timeout 뒤 늦게 열린 losing handle을 닫는다', async () => {
    vi.useFakeTimers();
    let resolveOpen!: (db: CrewDatabase) => void;
    const close = vi.fn();
    const opened = new Promise<CrewDatabase>((resolve) => {
      resolveOpen = resolve;
    });
    try {
      const result = openCrewDBWithTimeout(50, () => opened);
      await vi.advanceTimersByTimeAsync(50);
      await expect(result).resolves.toBeNull();

      resolveOpen({ close } as unknown as CrewDatabase);
      await Promise.resolve();
      await Promise.resolve();
      expect(close).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});
