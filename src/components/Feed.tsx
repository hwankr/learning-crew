import { useMemo } from 'react';
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
                충돌하면 카드의 펼침·캐러셀 상태가 엉뚱한 카드에 재사용된다 */}
            {g.items.map((item) =>
              item.kind === 'entry' ? (
                <EntryCard key={'e:' + item.e.id} e={item.e} compact={false} mine={item.e.m === meId}
                  meId={meId} editing={item.e.id === editingId}
                  comments={comments.get(item.e.id) ?? []}
                  reactions={reactions.get(item.e.id) ?? []} photoUploads={photoUploads}
                  actions={actions} />
              ) : (
                <PostCard key={'p:' + item.p.id} post={item.p}
                  comments={postComments.get(item.p.id) ?? []} meId={meId}
                  live={isStatusActive(statuses[item.p.m], now)} photoUploads={photoUploads}
                  wit={wit} actions={loungeActions} />
              ),
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
