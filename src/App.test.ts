import { describe, expect, it, vi } from 'vitest';
import type { Entry, EntryPhoto } from '../shared/types';
import { addDraftPhotos } from './lib/photoDraft';
import { contentEqual } from './local/store';
import {
  draftHasContent,
  draftPhotoResultIsCurrent,
  loadDraft,
  notiNavPlan,
  runRevivePhotoClone,
  saveDraft,
} from './App';
import { EMPTY_MODAL } from './components/EntryModal';

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('공부시간 초안', () => {
  it('시간만 적은 신규 초안도 저장하고 다시 복원한다', () => {
    const rows = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => rows.get(key) ?? null,
      setItem: (key: string, value: string) => rows.set(key, value),
      removeItem: (key: string) => rows.delete(key),
    });
    try {
      const modal = {
        ...EMPTY_MODAL,
        open: true,
        entryId: '11111111-1111-4111-8111-111111111111',
        day: '2026-08-14',
        tags: ['영어'],
        stars: 4,
        studyHoursInput: '2',
        studyMinutesInput: '05',
      };
      expect(draftHasContent(modal)).toBe(true);

      saveDraft('study-time-draft', modal, null);
      const restored = loadDraft('study-time-draft');
      expect(restored?.studyHoursInput).toBe('2');
      expect(restored?.studyMinutesInput).toBe('05');
      expect(restored?.body).toBe('');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('구버전 수정 초안 base의 누락된 공부시간을 null로 채워 이어 쓸 수 있게 한다', () => {
    const rows = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => rows.get(key) ?? null,
      setItem: (key: string, value: string) => rows.set(key, value),
      removeItem: (key: string) => rows.delete(key),
    });
    try {
      const current: Entry = {
        id: '22222222-2222-4222-8222-222222222222',
        m: 'sh', day: '2026-08-14', time: '21:00', tag: '영어', tags: ['영어'],
        stars: 4, studyMinutes: null, memo: '', body: '기존 본문', todos: [], photos: [],
        v: 3, updatedAt: '2026-08-14T12:00:00.000Z', deletedAt: null,
      };
      const { studyMinutes: _studyMinutes, ...legacyBase } = current;
      const modal = {
        ...EMPTY_MODAL,
        open: true,
        entryId: current.id,
        editingId: current.id,
        tags: current.tags,
        stars: current.stars ?? 0,
        body: '이어 쓰던 수정 초안',
        day: current.day,
      };

      saveDraft('legacy-study-time-draft', modal, legacyBase as Entry);
      const restored = loadDraft('legacy-study-time-draft');

      expect(restored?.base?.studyMinutes).toBeNull();
      expect(contentEqual(restored!.base!, current)).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('runRevivePhotoClone (삭제된 기록 살리기)', () => {
  it('blob 복제 await 동안 시트를 잠그고 세션 교체 시 복제본을 모두 rollback한다', async () => {
    const gate = deferred<EntryPhoto[]>();
    const discarded = vi.fn();
    const locks: boolean[] = [];
    let locked = false;
    let current = true;
    let body = '복제 전 입력';

    const running = runRevivePhotoClone({
      clone: () => gate.promise,
      isCurrent: () => current,
      discard: discarded,
      setLocked: (next) => {
        locked = next;
        locks.push(next);
      },
    });

    expect(locked).toBe(true);
    // App의 patch/onAddFiles와 같은 잠금 문턱: clone 중 입력과 늦은 사진 준비는 시작되지 않는다.
    if (!locked) body = '기다리는 사이 바뀐 입력';
    expect(body).toBe('복제 전 입력');

    current = false;
    gate.resolve([
      { id: '22222222-2222-4222-8222-222222222222', w: 1600, h: 900 },
      { id: '33333333-3333-4333-8333-333333333333', w: 900, h: 1600 },
    ]);

    await expect(running).resolves.toBeNull();
    expect(discarded.mock.calls.map(([id]) => id)).toEqual([
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333',
    ]);
    expect(locks).toEqual([true, false]);
    expect(locked).toBe(false);
  });

  it('같은 photoSession의 늦은 준비 결과도 살리기 잠금 중에는 discard한다', async () => {
    const gate = deferred<EntryPhoto>();
    const attach = vi.fn();
    const discard = vi.fn();
    const session = 7;
    let currentSession = session;
    let reviving = false;
    const adding = addDraftPhotos({
      files: [new File(['x'], 'late.jpg', { type: 'image/jpeg' })],
      room: 1,
      prepare: () => gate.promise,
      isCurrent: () => draftPhotoResultIsCurrent(session, currentSession, reviving),
      attach,
      discard,
      onError: vi.fn(),
    });

    // session 번호를 갱신하는 렌더가 없어도 ref 잠금만으로 늦은 결과를 막아야 한다.
    reviving = true;
    currentSession = session;
    gate.resolve({ id: '22222222-2222-4222-8222-222222222222', w: 1600, h: 900 });

    await expect(adding).resolves.toEqual([]);
    expect(attach).not.toHaveBeenCalled();
    expect(discard).toHaveBeenCalledWith('22222222-2222-4222-8222-222222222222');
  });
});

describe('notiNavPlan (알림 타깃 → 피드 이동 계획)', () => {
  const hasNone = () => false;
  const has = (want: string) => (id: string) => id === want;

  it('대상이 로컬에 있으면 필터를 그 갈래로 풀고 포커스를 싣는다', () => {
    expect(notiNavPlan({ kind: 'entry', id: 'e1' }, has('e1'), hasNone))
      .toEqual({ reveal: 'entry', focus: { kind: 'entry', id: 'e1' }, missing: false });
    expect(notiNavPlan({ kind: 'post', id: 'p1' }, hasNone, has('p1')))
      .toEqual({ reveal: 'post', focus: { kind: 'post', id: 'p1' }, missing: false });
  });

  // 다른 기기에서 삭제됐거나 아직 동기화 전 — 피드는 열되 스크롤 없이 토스트로 알린다
  it('대상이 없으면 포커스 없이 missing으로 표시하고, reveal은 타깃 갈래를 유지한다', () => {
    expect(notiNavPlan({ kind: 'post', id: 'gone' }, hasNone, hasNone))
      .toEqual({ reveal: 'post', focus: null, missing: true });
  });

  it('방향만 있는 타깃(feed)은 존재 확인 없이 필터만 푼다', () => {
    expect(notiNavPlan({ kind: 'feed', reveal: 'entry' }, hasNone, hasNone))
      .toEqual({ reveal: 'entry', focus: null, missing: false });
  });
});
