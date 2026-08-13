import type { Comment, Entry, MemberId, ReactionEmoji, ReactionSet } from '../../shared/types';
import { BY_ID, MEMBERS } from '../lib/constants';
import { Avatar, CheckMark, StarsRow } from './icons';
import { Chip } from './Chip';
import { EntrySocial } from './EntrySocial';

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
  const mm = BY_ID[e.m] ?? MEMBERS[0]!;
  const hasStars = e.tag !== 'OFF' && (e.stars ?? 0) > 0;
  const doneN = e.todos.filter((t) => t.done).length;
  const memoBold = e.body || e.todos.length > 0;

  return (
    <div className={'entry' + (compact ? ' compact' : '') + (editing ? ' editing' : '')}>
      <Avatar m={mm} size={compact ? 36 : 40} />
      <div className="entry-main">
        <div className="entry-head">
          <span className="entry-name">{mm.name}</span>
          <span className="entry-time">{e.time}</span>
          <span className="spacer" />
          {/* 컴팩트(캘린더)는 태그·별점 줄이 따로 없어 머리에 붙인다 */}
          {compact && (
            <>
              <Chip tag={e.tag} variant="sm2" />
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
            <Chip tag={e.tag} variant="md" />
            {hasStars && <StarsRow n={e.stars ?? 0} w={70} h={14} />}
            {e.todos.length > 0 && <span className="todo-count">{doneN}/{e.todos.length}</span>}
          </div>
        )}
        {e.memo && (
          <div className="entry-memo" style={{ fontWeight: memoBold ? 700 : 400 }}>{e.memo}</div>
        )}
        {e.body && <div className="entry-body">{e.body}</div>}
        {e.todos.length > 0 && (
          <div className="entry-todos">
            {e.todos.map((t, i) => (
              <div className="todo-line" key={i}>
                <button
                  className={'todo-check' + (t.done ? ' done' : '') + (mine ? ' tappable' : '')}
                  onClick={mine ? () => actions.onToggleTodo(e, i) : undefined}
                >
                  <CheckMark size={compact ? 10 : 11} />
                </button>
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
