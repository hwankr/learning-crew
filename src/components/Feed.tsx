import type { Comment, Entry, MemberId, ReactionSet } from '../../shared/types';
import { MEMBERS, type CopySet } from '../lib/constants';
import type { PhotoUploadInfo } from '../local/store';
import { EntryCard, type EntryActions } from './EntryCard';

export function Feed({
  entries, todayKey, yKey, meId, editingId, comments, reactions, photoUploads, wit, actions,
}: {
  entries: Entry[];
  todayKey: string;
  yKey: string;
  meId: MemberId;
  editingId: string | null;
  comments: Map<string, Comment[]>;
  reactions: Map<string, ReactionSet[]>;
  photoUploads: Map<string, PhotoUploadInfo>;
  wit: CopySet;
  actions: EntryActions;
}) {
  // 요일은 넣지 않는다 — 그룹 머리는 "언제쯤"만 알려 주면 되고, 정확한 날짜는 캘린더가 맡는다
  const dayLabel = (k: string): string => {
    if (k === todayKey) return '오늘';
    if (k === yKey) return '어제';
    const d = new Date(k + 'T12:00:00');
    return `${d.getMonth() + 1}월 ${d.getDate()}일`;
  };
  const keys = [...new Set(entries.map((e) => e.day))].sort().reverse();

  return (
    <div>
      {/* 제목은 와이드에서만 — 좁은 화면은 하단 탭바가 어디인지 알려 준다(메타 줄만 남는다) */}
      <div className="feed-head">
        <div className="feed-title">피드</div>
        <div className="feed-meta">기록 {entries.length}개 · 크루 {MEMBERS.length}명</div>
      </div>
      {keys.length === 0 && (
        <div className="feed-empty">
          <div className="feed-empty-title">{wit.feedEmpty}</div>
          <div className="feed-empty-sub">{wit.feedEmptyHint}</div>
        </div>
      )}
      {keys.map((k) => (
        <div key={k}>
          <div className="group-head">
            <span className="group-label">{dayLabel(k)}</span>
            <span className="group-line" />
          </div>
          <div>
            {entries
              .filter((e) => e.day === k)
              .sort((a, b) => b.time.localeCompare(a.time))
              .map((e) => (
                <EntryCard key={e.id} e={e} compact={false} mine={e.m === meId} meId={meId}
                  editing={e.id === editingId} comments={comments.get(e.id) ?? []}
                  reactions={reactions.get(e.id) ?? []} photoUploads={photoUploads}
                  actions={actions} />
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}
