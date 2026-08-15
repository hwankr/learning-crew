import { describe, expect, it, vi } from 'vitest';
import type { EntryPhoto } from '../../shared/types';
import { addDraftPhotos } from './photoDraft';

function file(name: string): File {
  return new File(['x'], name, { type: 'image/jpeg' });
}

/** 준비가 끝나는 시점을 테스트가 직접 정한다 — 그 사이에 시트를 닫아 경합을 만든다. */
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const photo = (id: string): EntryPhoto => ({ id, w: 1600, h: 900 });

describe('addDraftPhotos (시트에 사진 붙이기)', () => {
  it('남은 자리만큼만 준비하고 순서대로 붙인다', async () => {
    const attach = vi.fn();
    const added = await addDraftPhotos({
      files: [file('a'), file('b'), file('c')],
      room: 2,
      prepare: (f) => Promise.resolve(photo(f.name)),
      isCurrent: () => true,
      attach,
      discard: vi.fn(),
      onError: vi.fn(),
    });
    expect(added.map((p) => p.id)).toEqual(['a', 'b']);
    expect(attach).toHaveBeenCalledTimes(2);
  });

  it('앞 장이 이미 붙은 사실을 다음 장의 자리 계산에 넘긴다', async () => {
    const seen: number[] = [];
    await addDraftPhotos({
      files: [file('a'), file('b')],
      room: 4,
      prepare: (f, alreadyAdded) => {
        seen.push(alreadyAdded.length);
        return Promise.resolve(photo(f.name));
      },
      isCurrent: () => true,
      attach: vi.fn(),
      discard: vi.fn(),
      onError: vi.fn(),
    });
    expect(seen).toEqual([0, 1]);
  });

  it('준비 중 시트가 닫히면 도착한 사진을 붙이지 않고 로컬 JPEG까지 되돌린다', async () => {
    // 리사이즈가 끝나기 전에 저장·닫기가 일어나는 경합 — 화면만 건너뛰면 photoBlobs에
    // 주인 없는 사진이 남고, 같은 기록을 다시 열었을 때 취소한 사진이 새 세션에 붙는다
    const gate = deferred<EntryPhoto>();
    let open = true;
    const attach = vi.fn();
    const discard = vi.fn();
    const done = addDraftPhotos({
      files: [file('a'), file('b')],
      room: 4,
      prepare: () => gate.promise,
      isCurrent: () => open,
      attach,
      discard,
      onError: vi.fn(),
    });

    open = false; // 시트를 닫는다(또는 저장으로 세션이 끝난다)
    gate.resolve(photo('a'));
    const added = await done;

    expect(added).toEqual([]);
    expect(attach).not.toHaveBeenCalled();
    expect(discard).toHaveBeenCalledWith('a');
  });

  it('한 장이 실패하면 거기서 멈추고 한 번만 알린다', async () => {
    const boom = new Error('decode');
    const onError = vi.fn();
    const prepare = vi.fn(() => Promise.reject(boom));
    const added = await addDraftPhotos({
      files: [file('a'), file('b'), file('c')],
      room: 4,
      prepare,
      isCurrent: () => true,
      attach: vi.fn(),
      discard: vi.fn(),
      onError,
    });
    expect(added).toEqual([]);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(boom);
  });
});
