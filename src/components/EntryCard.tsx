import type { Entry } from '../../shared/types';
import { BY_ID, MEMBERS } from '../lib/constants';
import { Avatar, CheckMark, StarsRow } from './icons';
import { Chip } from './Chip';

export interface EntryActions {
  onEdit: (e: Entry) => void;
  onDelete: (e: Entry) => void;
  onToggleTodo: (e: Entry, index: number) => void;
}

export function EntryCard({
  e, compact, mine, editing, actions,
}: {
  e: Entry;
  compact: boolean;
  mine: boolean;
  editing: boolean;
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
          {compact ? (
            <>
              <Chip tag={e.tag} variant="sm2" />
              {hasStars && <StarsRow n={e.stars ?? 0} w={55} h={11} />}
            </>
          ) : (
            mine && (
              <div className="entry-actions">
                <button className="entry-act edit" onClick={() => actions.onEdit(e)}>수정</button>
                <button className="entry-act del" onClick={() => actions.onDelete(e)}>삭제</button>
              </div>
            )
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
      </div>
    </div>
  );
}
