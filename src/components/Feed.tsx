import { useEffect, useMemo, useRef } from 'react';
import type {
  Comment,
  Entry,
  MemberId,
  MemberStatus,
  Post,
  PostComment,
  ReactionSet,
} from '../../shared/types';
import { isStatusActive } from '../../shared/types';
import { MEMBERS, dayKey, pad2, type CopySet } from '../lib/constants';
import type { FeedFilter } from '../lib/uiState';
import type { PhotoUploadInfo } from '../local/store';
import { EntryCard, type EntryActions } from './EntryCard';
import { LoungeComposerRow, PostCard, type LoungeActions } from './Lounge';

/* 피드는 기록(일기 형식)과 라운지 글(자유 글)을 한 스트림으로 섞는다 — 자유 글은 "가끔"
   올라오는 것이라 전용 탭은 텅 비기 쉽고, 모두가 이미 보는 이 자리에 실려야 읽힌다.
   종류 구분은 카드가 맡고(태그·별점 칩 vs "라운지" 칩), 필터 칩이 한쪽만 보기를 맡는다. */

const FILTERS: { id: FeedFilter; label: string }[] = [
  { id: 'all', label: '전체' },
  { id: 'entries', label: '기록' },
  { id: 'posts', label: '라운지' },
];

export type FeedItem = { kind: 'entry'; e: Entry } | { kind: 'post'; p: Post };

/** 피드가 다음 렌더에서 데려가 보여줄 카드 — 알림 딥링크가 채우고, 하이라이트가 끝나면
    App이 비운다(FeedItem의 kind와 같은 축이라 카드 종류 구분을 그대로 잇는다). */
export interface FeedFocus {
  kind: 'entry' | 'post';
  id: string;
}

/** 하이라이트 효과가 대상 카드에서 실제로 쓰는 DOM 표면 — 테스트가 stub으로 채워
    스크롤·플래시·타이머 수명주기를 돌려 본다(정적 렌더로는 effect가 돌지 않는다). */
export interface FocusCardEl {
  scrollIntoView(opts?: ScrollIntoViewOptions): void;
  classList: { add(c: string): void; remove(c: string): void };
}

/** 알림 딥링크 도착 효과의 본체 — 아래 effect가 그대로 위임한다.
    cleanup은 StrictMode의 가짜 해체인지 진짜 이탈(unmount·대상 교체)인지 모르므로,
    일단 0ms 만료를 expire에 걸어 두고 곧바로 다시 돌아온 실행이 앞머리에서 취소한다.
    취소되지 않으면 하이라이트를 다 채우기 전에 피드를 떠난 것 — 요청을 접어
    다음 방문 때 이미 소비된 타깃으로 또 튀지 않게 한다.
    expire.missed는 missing을 이미 알린 요청 — 같은 focus 객체로 setup이 겹으로 돌아도
    (StrictMode replay는 부모가 요청을 접기 전에 온다) 토스트가 한 번만 선다. */
export function runFeedFocus(
  focus: FeedFocus | null,
  el: FocusCardEl | null,
  expire: { id: number; missed?: FeedFocus },
  onFocusDone: () => void,
  onFocusMissing: () => void,
): (() => void) | undefined {
  window.clearTimeout(expire.id);
  if (!focus) return;
  if (!el) {
    // 필터까지 풀고 왔는데 카드가 없다 — 계획 뒤 커밋 사이에 지워졌거나 아직 동기화 전.
    // 붙잡고 있으면 뒤늦게 도착한 순간 화면이 멋대로 튀므로 접고, 못 찾았다고 알린다.
    if (expire.missed !== focus) {
      expire.missed = focus;
      onFocusMissing();
    }
    return;
  }
  // 완료는 이 호출에서 정확히 한 번 — 1.8초 타이머가 발화한 직후 진짜 unmount가 겹치면
  // cleanup이 만료를 또 예약하므로, 취소만으로는 중복을 못 막는다.
  let finished = false;
  const finish = (): void => {
    if (finished) return;
    finished = true;
    onFocusDone();
  };
  el.scrollIntoView({ block: 'center' });
  el.classList.add('feed-flash');
  // 플래시(1.6s)가 다 스러진 뒤에 접는다 — cleanup의 클래스 제거가 눈에 띄지 않는 시점
  const t = window.setTimeout(finish, 1800);
  return () => {
    window.clearTimeout(t);
    el.classList.remove('feed-flash');
    expire.id = window.setTimeout(finish, 0);
  };
}

/** 글의 날짜 키 — 작성 기기 시각의 로컬 날짜. 기록의 day와 같은 축이라 한 묶음에 선다.
    깨진 시각은 null — 스트림에서 조용히 빼는 쪽이 맨 앞/맨 뒤에 박히는 것보다 낫다. */
export function postDayKey(p: Post): string | null {
  const d = new Date(p.createdAt);
  return Number.isNaN(d.getTime()) ? null : dayKey(d);
}

/** 하루 안 정렬 키 — 기록은 입력된 시각(HH:MM), 글은 작성 시각. 같은 분은 종류와 id가
    고정한다(동기화 재정렬로 카드가 자리를 바꾸며 깜빡이지 않게). 종류를 키에 넣는 이유:
    두 테이블은 교차 유일성 제약이 없어 같은 id의 기록·글이 이론상 공존할 수 있다. */
function itemSortKey(item: FeedItem): string {
  if (item.kind === 'entry') return `${item.e.time}|e|${item.e.id}`;
  const d = new Date(item.p.createdAt);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}|p|${item.p.id}`;
}

/** 날짜 내림차순 묶음 + 하루 안 시각 내림차순 — Feed가 그리는 유일한 순서 규칙. */
export function feedDayGroups(
  entries: readonly Entry[],
  posts: readonly Post[],
  filter: FeedFilter,
): { day: string; items: FeedItem[] }[] {
  const byDay = new Map<string, FeedItem[]>();
  const add = (day: string, item: FeedItem): void => {
    const arr = byDay.get(day);
    if (arr) arr.push(item);
    else byDay.set(day, [item]);
  };
  if (filter !== 'posts') for (const e of entries) add(e.day, { kind: 'entry', e });
  if (filter !== 'entries') {
    for (const p of posts) {
      const k = postDayKey(p);
      if (k) add(k, { kind: 'post', p });
    }
  }
  return [...byDay.keys()].sort().reverse().map((day) => ({
    day,
    items: byDay.get(day)!.sort((a, b) => itemSortKey(b).localeCompare(itemSortKey(a))),
  }));
}

export function Feed({
  entries, posts, postComments, statuses, now, filter, onFilter, todayKey, yKey, meId,
  editingId, comments, reactions, photoUploads, wit, actions, loungeActions,
  focus, onFocusDone, onFocusMissing,
}: {
  entries: Entry[];
  posts: Post[];
  postComments: Map<string, PostComment[]>;
  statuses: Partial<Record<MemberId, MemberStatus>>;
  /** 분 단위 재렌더 틱 — 글 카드 라이브 점의 TTL 판정에 쓴다 */
  now: number;
  filter: FeedFilter;
  onFilter: (f: FeedFilter) => void;
  todayKey: string;
  yKey: string;
  meId: MemberId;
  editingId: string | null;
  comments: Map<string, Comment[]>;
  reactions: Map<string, ReactionSet[]>;
  photoUploads: Map<string, PhotoUploadInfo>;
  wit: CopySet;
  actions: EntryActions;
  loungeActions: LoungeActions;
  /** 알림 딥링크의 대상 — 렌더된 뒤 스크롤+하이라이트하고 onFocusDone으로 돌려준다 */
  focus: FeedFocus | null;
  onFocusDone: () => void;
  /** 대상 카드가 이 커밋에 서지 못했다(계획 뒤 삭제·데이터 교체) — App이 접고 토스트를 띄운다 */
  onFocusMissing: () => void;
}) {
  // 요일은 넣지 않는다 — 그룹 머리는 "언제쯤"만 알려 주면 되고, 정확한 날짜는 캘린더가 맡는다
  const dayLabel = (k: string): string => {
    if (k === todayKey) return '오늘';
    if (k === yKey) return '어제';
    const d = new Date(k + 'T12:00:00');
    return `${d.getMonth() + 1}월 ${d.getDate()}일`;
  };
  const groups = useMemo(
    () => feedDayGroups(entries, posts, filter),
    [entries, posts, filter],
  );

  /* 알림 딥링크 도착 — 대상 카드가 이 커밋에 실제로 섰을 때만 스크롤+하이라이트.
     하이라이트 클래스는 상태가 아니라 DOM에 직접 얹는다: 순수 표시용이고, StrictMode의
     이중 실행도 cleanup이 클래스를 걷어내고 처음부터 다시 도는 것이라 안전하다.
     ref는 렌더 중 대상 래퍼에만 붙으므로(아래 focused) 효과 시점엔 이미 서 있다.
     본체는 runFeedFocus — 만료 타이머 자리(expire)만 렌더 사이에 여기서 든다. */
  const focusRef = useRef<HTMLDivElement | null>(null);
  const focusExpire = useRef({ id: 0 });
  useEffect(
    () => runFeedFocus(focus, focusRef.current, focusExpire.current, onFocusDone, onFocusMissing),
    [focus, onFocusDone, onFocusMissing],
  );

  return (
    <div>
      {/* 제목은 와이드에서만 — 좁은 화면은 하단 탭바가 어디인지 알려 준다(메타 줄만 남는다) */}
      <div className="feed-head">
        <div className="feed-title">피드</div>
        <div className="feed-meta">
          기록 {entries.length}개{posts.length > 0 && ` · 글 ${posts.length}개`} · 크루 {MEMBERS.length}명
        </div>
      </div>
      <div className="feed-filters" role="group" aria-label="피드 필터">
        {FILTERS.map((f) => (
          <button key={f.id} className={'feed-chip' + (filter === f.id ? ' on' : '')}
            aria-pressed={filter === f.id} onClick={() => onFilter(f.id)}>
            {f.label}
          </button>
        ))}
      </div>
      {/* 자유 글 입구는 기록만 보기에서는 접는다 — 그 화면에 올리는 글이 아니다 */}
      {filter !== 'entries' && (
        <LoungeComposerRow meId={meId} wit={wit} onCompose={loungeActions.onCompose} />
      )}
      {groups.length === 0 && (
        filter === 'posts' ? (
          <div className="lounge-empty">
            <div className="lounge-empty-title">{wit.loungeEmpty}</div>
            <div className="lounge-empty-sub">{wit.loungeEmptySub}</div>
          </div>
        ) : (
          <div className="feed-empty">
            <div className="feed-empty-title">{wit.feedEmpty}</div>
            <div className="feed-empty-sub">{wit.feedEmptyHint}</div>
          </div>
        )
      )}
      {groups.map((g) => (
        <div key={g.day}>
          <div className="group-head">
            <span className="group-label">{dayLabel(g.day)}</span>
            <span className="group-line" />
          </div>
          <div>
            {/* key에 종류 접두어 — 교차 유일성이 없는 두 id 공간이라 맨 id는 충돌할 수 있고,
                충돌하면 카드의 펼침·캐러셀 상태가 엉뚱한 카드에 재사용된다.
                래퍼 div는 딥링크의 앵커다 — 카드 컴포넌트에 ref를 뚫지 않고 여기서 잡는다. */}
            {g.items.map((item) => {
              const id = item.kind === 'entry' ? item.e.id : item.p.id;
              const focused = focus !== null && focus.kind === item.kind && focus.id === id;
              return (
                <div key={(item.kind === 'entry' ? 'e:' : 'p:') + id}
                  ref={focused ? focusRef : undefined}>
                  {item.kind === 'entry' ? (
                    <EntryCard e={item.e} compact={false} mine={item.e.m === meId}
                      meId={meId} editing={item.e.id === editingId}
                      comments={comments.get(item.e.id) ?? []}
                      reactions={reactions.get(item.e.id) ?? []} photoUploads={photoUploads}
                      actions={actions} />
                  ) : (
                    <PostCard post={item.p}
                      comments={postComments.get(item.p.id) ?? []} meId={meId}
                      live={isStatusActive(statuses[item.p.m], now)} photoUploads={photoUploads}
                      wit={wit} actions={loungeActions} />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
