/* 라운지 글(피드에 섞이는 자유 글)의 순수 판정·정적 마크업 검증 — 디자인 원본의 규칙
   (3줄 클램프 문턱, 캐러셀 자리 계산, 내 글에만 삭제, N장 배지)과 통합 피드의 규칙
   (날짜 묶음 혼합 정렬, 필터, 종류 칩)을 함께 본다. 딥링크 하이라이트의 타이머
   수명주기는 effect 본체(runFeedFocus)를 stub DOM으로 직접 돌려 본다. */
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Entry, Post, PostComment } from '../../shared/types';
import { COPY } from '../lib/constants';

vi.mock('../lib/usePhoto', () => ({
  usePhotoUrl: () => ({ url: null, missing: false, status: 'idle' }),
}));

import {
  LoungeComposer,
  carouselIndex,
  loungeCanSubmit,
  postIsLong,
  postWhen,
  type LoungeActions,
} from './Lounge';
import { Feed, feedDayGroups, postDayKey, runFeedFocus } from './Feed';

const TODAY = '2026-08-15';
const YDAY = '2026-08-14';
const PH1 = '22222222-2222-4222-8222-222222222221';
const PH2 = '22222222-2222-4222-8222-222222222222';

const noopActions: LoungeActions = {
  onCompose: () => undefined,
  onDelete: () => undefined,
  onAddComment: () => undefined,
  onDeleteComment: () => undefined,
  onOpenPhoto: () => undefined,
  onRetryPhoto: () => false,
};

function post(p: Partial<Post> & Pick<Post, 'id' | 'm'>): Post {
  return {
    body: '도서관 가는 길',
    photos: [],
    createdAt: `${TODAY}T07:41:00`,
    updatedAt: `${TODAY}T07:41:00`,
    deletedAt: null,
    ...p,
  };
}

function entry(e: Partial<Entry> & Pick<Entry, 'id' | 'm'>): Entry {
  return {
    day: TODAY, time: '10:00', tag: '영어', tags: ['영어'], stars: 3,
    memo: '오전 스퍼트', body: '', todos: [], photos: [], v: 1,
    updatedAt: `${TODAY}T10:00:00.000Z`, deletedAt: null,
    ...e,
  };
}

function renderFeed(over: {
  entries?: Entry[];
  posts?: Post[];
  postComments?: Map<string, PostComment[]>;
  filter?: 'all' | 'entries' | 'posts';
  photoUploads?: Map<string, { state: 'wait' | 'up' | 'fail' | 'done'; pct: number }>;
}): string {
  return renderToStaticMarkup(
    <Feed entries={over.entries ?? []} posts={over.posts ?? []}
      postComments={over.postComments ?? new Map()} statuses={{}} now={Date.now()}
      filter={over.filter ?? 'all'} onFilter={() => undefined}
      todayKey={TODAY} yKey={YDAY} meId="sh" editingId={null} leavingId={null}
      comments={new Map()} reactions={new Map()}
      photoUploads={over.photoUploads ?? new Map()}
      wit={COPY} actions={{
        onEdit: () => undefined, onDelete: () => undefined, onToggleTodo: () => undefined,
        onAddComment: () => undefined, onDeleteComment: () => undefined,
        onToggleReaction: () => undefined, onOpenPhoto: () => undefined,
        onRetryPhoto: () => false,
      }} loungeActions={noopActions}
      focus={null} onFocusDone={() => undefined} onFocusMissing={() => undefined} />,
  );
}

describe('postWhen (라이트박스 머리의 상대 시각 표기)', () => {
  it('오늘·어제는 접두어로, 더 오래되면 월·일을 함께 쓴다', () => {
    expect(postWhen(`${TODAY}T07:41:00`, TODAY, YDAY)).toBe('오늘 07:41');
    expect(postWhen(`${YDAY}T21:05:00`, TODAY, YDAY)).toBe('어제 21:05');
    expect(postWhen('2026-08-03T09:10:00', TODAY, YDAY)).toBe('8월 3일 09:10');
    expect(postWhen('깨진 값', TODAY, YDAY)).toBe('');
  });
});

describe('postIsLong / carouselIndex / loungeCanSubmit (판정)', () => {
  it('76자 초과 또는 줄바꿈이 있으면 접는다', () => {
    expect(postIsLong('짧은 글')).toBe(false);
    expect(postIsLong('한 줄이지만\n둘로 나뉜 글')).toBe(true);
    expect(postIsLong('가'.repeat(77))).toBe(true);
  });

  it('캐러셀 자리는 프레임+간격 단위 반올림, 범위 밖은 클램프한다', () => {
    expect(carouselIndex(0, 268, 3)).toBe(0);
    expect(carouselIndex(276, 268, 3)).toBe(1); // 268 + gap 8
    expect(carouselIndex(9999, 268, 3)).toBe(2);
    expect(carouselIndex(100, 0, 3)).toBe(0); // 아직 폭을 못 쟀다
  });

  it('본문 또는 사진 중 하나는 있어야 올릴 수 있다 (서버 검증과 같은 규칙)', () => {
    expect(loungeCanSubmit({ body: '  ', photos: [] })).toBe(false);
    expect(loungeCanSubmit({ body: '글', photos: [] })).toBe(true);
    expect(loungeCanSubmit({ body: '', photos: [{ id: PH1, w: 1, h: 1 }] })).toBe(true);
  });
});

describe('feedDayGroups (기록×자유 글 혼합 정렬)', () => {
  it('같은 날 안에서 시각 내림차순으로 섞이고, 날짜는 최신 묶음이 먼저다', () => {
    const groups = feedDayGroups(
      [entry({ id: 'e1', m: 'wg', time: '09:40' }), entry({ id: 'e2', m: 'sh', day: YDAY, time: '22:05' })],
      [post({ id: 'p1', m: 'kj', createdAt: `${TODAY}T12:20:00` })],
      'all',
    );
    expect(groups.map((g) => g.day)).toEqual([TODAY, YDAY]);
    expect(groups[0]!.items.map((i) => (i.kind === 'entry' ? i.e.id : i.p.id))).toEqual(['p1', 'e1']);
  });

  it('같은 분·같은 id의 교차 종류도 결정적으로 정렬되고 둘 다 살아남는다', () => {
    // 두 테이블은 교차 유일성 제약이 없다 — 같은 id·같은 분이어도 종류가 2차 키를 가른다
    const sameId = 'ee444444-4444-4444-8444-444444444444';
    const groups = feedDayGroups(
      [entry({ id: sameId, m: 'wg', time: '12:20' })],
      [post({ id: sameId, m: 'kj', createdAt: `${TODAY}T12:20:00` })],
      'all',
    );
    const kinds = groups[0]!.items.map((i) => i.kind);
    expect(kinds).toEqual(['post', 'entry']); // 내림차순에서 'p' > 'e' — 항상 이 순서다
  });

  it('필터는 한쪽 스트림만 남기고, 깨진 작성 시각의 글은 조용히 뺀다', () => {
    const e = entry({ id: 'e1', m: 'wg' });
    const p = post({ id: 'p1', m: 'kj' });
    expect(feedDayGroups([e], [p], 'entries').flatMap((g) => g.items)).toHaveLength(1);
    expect(feedDayGroups([e], [p], 'posts').flatMap((g) => g.items)).toHaveLength(1);
    expect(postDayKey(post({ id: 'p2', m: 'kj', createdAt: '깨진 값' }))).toBeNull();
    expect(feedDayGroups([], [post({ id: 'p2', m: 'kj', createdAt: '깨진 값' })], 'all')).toHaveLength(0);
  });
});

describe('runFeedFocus (알림 딥링크 하이라이트 수명주기)', () => {
  const FOCUS = { kind: 'entry' as const, id: 'e1' };

  // FocusCardEl의 최소 stub — 스크롤 횟수와 클래스만 기록한다
  function stubEl() {
    const classes = new Set<string>();
    const el = {
      scrolls: 0,
      classes,
      scrollIntoView: () => { el.scrolls += 1; },
      classList: { add: (c: string) => { classes.add(c); }, remove: (c: string) => { classes.delete(c); } },
    };
    return el;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    // 효과 본체는 window.setTimeout을 쓴다 — node 테스트 환경엔 window가 없어 가짜 타이머로 잇는다
    vi.stubGlobal('window', {
      setTimeout: (fn: () => void, ms?: number) => setTimeout(fn, ms) as unknown as number,
      clearTimeout: (id?: number) => clearTimeout(id),
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('카드가 서 있으면 스크롤+플래시하고 1.8초 뒤 한 번만 접는다', () => {
    const el = stubEl();
    const done = vi.fn();
    const expire = { id: 0 };
    const cleanup = runFeedFocus(FOCUS, el, expire, done, vi.fn());
    expect(el.scrolls).toBe(1);
    expect(el.classes.has('feed-flash')).toBe(true);
    vi.advanceTimersByTime(1800);
    expect(done).toHaveBeenCalledTimes(1);
    // App이 focus를 비우면 effect가 다시 돈다 — cleanup의 만료 예약은 다음 실행이 취소한다
    cleanup!();
    runFeedFocus(null, null, expire, done, vi.fn());
    vi.runAllTimers();
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('필터까지 풀고 왔는데 카드가 없으면 missing 폴백을 부른다 (계획 뒤 삭제 레이스)', () => {
    const done = vi.fn();
    const missing = vi.fn();
    expect(runFeedFocus(FOCUS, null, { id: 0 }, done, missing)).toBeUndefined();
    expect(missing).toHaveBeenCalledTimes(1);
    vi.runAllTimers();
    expect(done).not.toHaveBeenCalled();
  });

  it('하이라이트 도중 피드를 떠나면(진짜 unmount) 요청이 만료된다 — 재방문 때 또 튀지 않는다', () => {
    const el = stubEl();
    const done = vi.fn();
    const cleanup = runFeedFocus(FOCUS, el, { id: 0 }, done, vi.fn());
    vi.advanceTimersByTime(1000);
    cleanup!();
    expect(el.classes.has('feed-flash')).toBe(false);
    expect(done).not.toHaveBeenCalled();
    vi.runAllTimers(); // 0ms 만료 — 되돌아온 effect가 없으니 요청을 접는다
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('1.8초 완료 직후 진짜 unmount가 겹쳐도 done은 한 번만 — 완료·만료 경합', () => {
    const el = stubEl();
    const done = vi.fn();
    const cleanup = runFeedFocus(FOCUS, el, { id: 0 }, done, vi.fn());
    vi.advanceTimersByTime(1800);
    expect(done).toHaveBeenCalledTimes(1);
    // focus=null 재실행이 도착하기 전에 실제 unmount cleanup이 먼저 끼어드는 경합 —
    // 다음 setup이 없으니 cleanup의 0ms 만료를 취소할 손이 없다
    cleanup!();
    vi.runAllTimers();
    expect(done).toHaveBeenCalledTimes(1); // 이미 완료한 요청 — 만료는 침묵한다
  });

  it('카드 없음 + StrictMode 재실행 조합에서도 missing은 요청당 한 번만 선다', () => {
    const missing = vi.fn();
    const expire = { id: 0 };
    // missing 분기는 cleanup이 없다 — replay는 부모가 요청을 접기 전에 같은 focus로 또 돈다
    runFeedFocus(FOCUS, null, expire, vi.fn(), missing);
    runFeedFocus(FOCUS, null, expire, vi.fn(), missing);
    expect(missing).toHaveBeenCalledTimes(1);
    // 새 요청(새 객체)은 다시 알린다 — 같은 대상이라도 별개의 딥링크다
    runFeedFocus({ ...FOCUS }, null, expire, vi.fn(), missing);
    expect(missing).toHaveBeenCalledTimes(2);
  });

  it('StrictMode의 가짜 해체는 만료시키지 않는다 — 곧바로 온 재실행이 취소하고 처음부터 다시 돈다', () => {
    const el = stubEl();
    const done = vi.fn();
    const expire = { id: 0 };
    const cleanup = runFeedFocus(FOCUS, el, expire, done, vi.fn());
    cleanup!();
    runFeedFocus(FOCUS, el, expire, done, vi.fn()); // React가 같은 커밋에서 곧장 다시 부른다
    vi.advanceTimersByTime(0);
    expect(done).not.toHaveBeenCalled(); // 만료가 취소됐다
    expect(el.classes.has('feed-flash')).toBe(true);
    vi.advanceTimersByTime(1800);
    expect(done).toHaveBeenCalledTimes(1);
  });
});

describe('통합 피드의 자유 글 카드', () => {
  it('글 카드는 라운지 칩·시각으로 일기 기록과 구분되고, 컴포저 행·필터 칩이 선다', () => {
    const html = renderFeed({ posts: [post({ id: 'p1', m: 'kj' })] });
    expect(html).toContain('post-kind');
    expect(html).toContain('라운지');
    expect(html).toContain('07:41');
    expect(html).toContain(COPY.loungePh); // 자유 글 입구
    expect(html).toContain('feed-chip on'); // 필터 칩(전체 활성)
    expect(html).toContain('오늘'); // 날짜 묶음 머리 아래 선다
  });

  it('기록만 보기에서는 자유 글 카드와 그 입구가 접힌다', () => {
    const html = renderFeed({
      entries: [entry({ id: 'e1', m: 'wg' })],
      posts: [post({ id: 'p1', m: 'kj', body: '자유 글 본문입니다' })],
      filter: 'entries',
    });
    expect(html).not.toContain('자유 글 본문입니다');
    expect(html).not.toContain(COPY.loungePh);
    expect(html).toContain('오전 스퍼트');
  });

  it('라운지만 보기에서 글이 없으면 시작 안내가 선다', () => {
    const html = renderFeed({ entries: [entry({ id: 'e1', m: 'wg' })], filter: 'posts' });
    expect(html).toContain(COPY.loungeEmpty);
    expect(html).not.toContain('오전 스퍼트');
  });

  it('삭제 버튼은 내 글에만 선다', () => {
    expect(renderFeed({ posts: [post({ id: 'p1', m: 'sh' })] })).toContain('post-del');
    expect(renderFeed({ posts: [post({ id: 'p1', m: 'kj' })] })).not.toContain('post-del');
  });

  it('긴 글은 3줄 클램프 + 더 보기, 짧은 글은 그대로', () => {
    const long = renderFeed({ posts: [post({ id: 'p1', m: 'kj', body: '첫 줄\n둘째 줄' })] });
    expect(long).toContain('post-body clamp');
    expect(long).toContain('더 보기');
    const short = renderFeed({ posts: [post({ id: 'p1', m: 'kj' })] });
    expect(short).not.toContain('clamp');
    expect(short).not.toContain('더 보기');
  });

  it('여러 장이면 첫 프레임에 장수 배지와 도트가 선다', () => {
    const html = renderFeed({
      posts: [post({ id: 'p1', m: 'kj', photos: [{ id: PH1, w: 4, h: 5 }, { id: PH2, w: 4, h: 5 }] })],
    });
    expect(html).toContain('2장');
    expect(html).toContain('post-dot on');
    const single = renderFeed({ posts: [post({ id: 'p1', m: 'kj', photos: [{ id: PH1, w: 4, h: 5 }] })] });
    expect(single).not.toContain('post-count-badge');
    expect(single).not.toContain('post-dots');
  });

  it('내 미완료 사진은 상태로 구분한다 — 올리는 중은 정적 프레임, 실패는 재시도 입구', () => {
    const photos = [{ id: PH1, w: 4, h: 5 }];
    const uploading = renderFeed({
      posts: [post({ id: 'p1', m: 'sh', photos })],
      photoUploads: new Map([[PH1, { state: 'up' as const, pct: 40 }]]),
    });
    expect(uploading).toContain('올리는 중…');
    expect(uploading).not.toContain('크게 보기'); // 라이트박스 목록에 없는 사진은 버튼이 아니다

    const failed = renderFeed({
      posts: [post({ id: 'p1', m: 'sh', photos })],
      photoUploads: new Map([[PH1, { state: 'fail' as const, pct: 0 }]]),
    });
    expect(failed).toContain('다시 시도');

    // 남의 사진에는 이 기기 상태 행이 없다 — 항상 done으로 읽혀 크게 보기 버튼이다
    const others = renderFeed({
      posts: [post({ id: 'p1', m: 'kj', photos })],
      photoUploads: new Map([[PH1, { state: 'fail' as const, pct: 0 }]]),
    });
    expect(others).toContain('크게 보기');
  });

  it('댓글은 글 아래에 작성 줄과 함께 선다', () => {
    const comments = new Map<string, PostComment[]>([[
      'p1',
      [{ id: 'c1', postId: 'p1', m: 'wg', body: '창가 자리 주인 인정합니다', createdAt: `${TODAY}T08:20:00`, updatedAt: `${TODAY}T08:20:00`, deletedAt: null }],
    ]]);
    const html = renderFeed({ posts: [post({ id: 'p1', m: 'kj' })], postComments: comments });
    expect(html).toContain('창가 자리 주인 인정합니다');
    expect(html).toContain('댓글 달기…');
  });
});

describe('LoungeComposer', () => {
  function renderComposer(over: { body?: string; durableStorage?: 'ready' | 'unavailable' }): string {
    return renderToStaticMarkup(
      <LoungeComposer draft={{ open: true, postId: PH1, body: over.body ?? '', photos: [] }}
        preparing={false} demo={false} durableStorage={over.durableStorage ?? 'ready'}
        wit={COPY} fallbackRef={{ current: null }}
        onBody={() => undefined} onAddFiles={() => undefined} onRemovePhoto={() => undefined}
        onClose={() => undefined} onSubmit={() => undefined} />,
    );
  }

  it('내용이 없으면 올리기가 눌리지 않는 모양(ready 없음)이고, 사진 힌트를 보여준다', () => {
    const html = renderComposer({});
    expect(html).toContain(COPY.loungeCta);
    expect(html).toContain(COPY.loungeNoPhotoHint);
    expect(html).toContain('class="submit"');
    expect(html).not.toContain('submit ready');
    expect(html).toContain('사진 추가'); // 보이는 라벨(디자인 원본의 84px 타일)
  });

  it('본문이 있으면 올리기가 활성 모양이 된다', () => {
    expect(renderComposer({ body: '글' })).toContain('submit ready');
  });

  it('저장 지속성이 없으면 기록 시트와 같은 보호 안내를 쓴다', () => {
    // 정적 렌더의 useOnline 서버 스냅샷은 online — "임시 저장" 경고는 사진이 있어야 나온다.
    // 여기서는 준비 중 플래그로 hasPhotos를 켠 상태를 확인한다.
    const html = renderToStaticMarkup(
      <LoungeComposer draft={{ open: true, postId: PH1, body: '', photos: [] }}
        preparing demo={false} durableStorage="unavailable"
        wit={COPY} fallbackRef={{ current: null }}
        onBody={() => undefined} onAddFiles={() => undefined} onRemovePhoto={() => undefined}
        onClose={() => undefined} onSubmit={() => undefined} />,
    );
    expect(html).toContain('임시 저장 상태예요');
  });
});
