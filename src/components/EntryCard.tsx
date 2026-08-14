import type { Comment, Entry, MemberId, ReactionEmoji, ReactionSet } from '../../shared/types';
import { entryTags, isOffTags } from '../../shared/types';
import { memberOf } from '../lib/constants';
import { Avatar, CheckMark, StarsRow } from './icons';
import { Chip, MoreChip } from './Chip';
import { EntrySocial } from './EntrySocial';

/** 컴팩트 카드의 한 줄 머리에 들어갈 칩 개수 — 나머지는 +N으로 접는다.
    이름·시각·별점과 한 줄을 나눠 써야 해서 태그가 자리를 다 먹으면 안 된다. */
const COMPACT_CHIPS = 2;

export interface EntryActions {
  onEdit: (e: Entry) => void;
  onDelete: (e: Entry) => void;
  onToggleTodo: (e: Entry, index: number) => void;
  onAddComment: (entryId: string, body: string) => void;
  onDeleteComment: (id: string) => void;
  onToggleReaction: (entryId: string, emoji: ReactionEmoji) => void;
}

export function EntryCard({
  e, compact, mine, meId, editing, comments, reactions, actions,
}: {
  e: Entry;
  compact: boolean;
  mine: boolean;
  meId: MemberId;
  editing: boolean;
  comments: Comment[];
  reactions: ReactionSet[];
  actions: EntryActions;
}) {
  // 모르는 멤버 id는 중립 표시로 — 구버전 번들이 새 멤버의 기록을 남의 이름으로 붙이면 안 된다
  const mm = memberOf(e.m);
  // 구버전 IDB 행(tags 없음)도 대표 태그에서 되살아난다 — 항상 1개 이상이다
  const tags = entryTags(e);
  const hasStars = !isOffTags(tags) && (e.stars ?? 0) > 0;
  const doneN = e.todos.filter((t) => t.done).length;

  return (
    <div className={'entry' + (compact ? ' compact' : '') + (editing ? ' editing' : '')}>
      <Avatar m={mm} size={compact ? 32 : 40} />
      <div className="entry-main">
        <div className="entry-head">
          <span className="entry-name">{mm.name}</span>
          <span className="entry-time">{e.time}</span>
          {/* 컴팩트(캘린더)는 태그·별점 줄이 따로 없어 머리에 붙인다 (넓은 모드는
              수정·삭제가 margin-left:auto로 밀려나므로 빈 칸이 필요 없다) */}
          {compact && (
            <>
              <span className="spacer" />
              {/* 좁은 한 줄 — 앞의 두 개만 보여 주고 나머지는 +N으로 접는다 */}
              <span className="entry-head-tags">
                {tags.slice(0, COMPACT_CHIPS).map((t) => (
                  <Chip key={t} tag={t} variant="sm2" />
                ))}
                {tags.length > COMPACT_CHIPS && (
                  <MoreChip n={tags.length - COMPACT_CHIPS} variant="sm2" />
                )}
              </span>
              {hasStars && <StarsRow n={e.stars ?? 0} w={55} h={11} />}
            </>
          )}
          {/* 내 기록이면 어디서 보든(피드·캘린더) 고치고 지울 수 있다 */}
          {mine && (
            <div className="entry-actions">
              <button className="entry-act edit" onClick={() => actions.onEdit(e)}>수정</button>
              <button className="entry-act del" onClick={() => actions.onDelete(e)}>삭제</button>
            </div>
          )}
        </div>
        {!compact && (
          <div className="entry-tags">
            {/* 넓은 모드는 전부 보여 준다 — .entry-tags가 flex-wrap이라 줄바꿈이 자연스럽다 */}
            {tags.map((t) => (
              <Chip key={t} tag={t} variant="md" />
            ))}
            {hasStars && <StarsRow n={e.stars ?? 0} w={66} h={13} />}
            {e.todos.length > 0 && (
              <span className="todo-count">할 일 {doneN}/{e.todos.length}</span>
            )}
          </div>
        )}
        {e.memo && <div className="entry-memo">{e.memo}</div>}
        {/* 제목(memo)이 없으면 본문이 그 자리로 올라온다 — 한 줄짜리 기록이 회색 잔글씨로
            깔리지 않게 하는 디자인 규칙 */}
        {e.body && <div className={'entry-body' + (e.memo ? '' : ' lead')}>{e.body}</div>}
        {e.todos.length > 0 && (
          <div className="entry-todos">
            {e.todos.map((t, i) => (
              <div className="todo-line" key={i}>
                {mine ? (
                  <button
                    type="button"
                    className={'todo-check' + (t.done ? ' done' : '') + ' tappable'}
                    aria-label={`${t.t}: ${t.done ? '완료 해제' : '완료로 표시'}`}
                    aria-pressed={t.done}
                    onClick={() => actions.onToggleTodo(e, i)}
                  >
                    <CheckMark size={compact ? 10 : 11} />
                  </button>
                ) : (
                  // 남의 할 일은 조작할 수 없다 — 버튼으로 그리면 키보드에 아무 일도 안 하는 제어가 남는다
                  <span className={'todo-check' + (t.done ? ' done' : '')}
                    role="img" aria-label={t.done ? '완료' : '미완료'}>
                    <CheckMark size={compact ? 10 : 11} />
                  </span>
                )}
                <span className={'todo-text' + (t.done ? ' done' : '')}>{t.t}</span>
              </div>
            ))}
          </div>
        )}
        <EntrySocial entryId={e.id} comments={comments} sets={reactions} meId={meId} actions={actions} />
      </div>
    </div>
  );
}
