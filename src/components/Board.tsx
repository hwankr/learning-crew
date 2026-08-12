import type { Entry, MemberId } from '../../shared/types';
import { MEMBERS, type CopySet, type Member } from '../lib/constants';
import { Avatar, StarsRow } from './icons';
import { Chip } from './Chip';

function MeBadge({ sm }: { sm?: boolean }) {
  return <span className={'me-badge' + (sm ? ' sm' : '')}>나</span>;
}

function BoardCell({
  m, todays, meId, wit,
}: {
  m: Member;
  todays: Entry[];
  meId: MemberId;
  wit: CopySet;
}) {
  const mine = todays.filter((e) => e.m === m.id).sort((a, b) => b.time.localeCompare(a.time));
  const latest = mine[0];
  const isMe = m.id === meId;
  const ring = latest ? m.color : '#CDD2DB';
  const dash = latest ? '0' : '5 4';
  const opacity = latest ? undefined : 0.55;
  const hasStars = !!latest && latest.tag !== 'OFF' && (latest.stars ?? 0) > 0;
  const firstTodo = latest && latest.todos.length > 0 ? latest.todos[0]!.t : '';
  const subLine = latest
    ? latest.memo || firstTodo || (latest.body || '').split('\n')[0] || (latest.tag === 'OFF' ? '오늘은 휴식' : '')
    : isMe
      ? wit.emptyMe
      : wit.empty;
  const extra = mine.length > 1 ? `외 ${mine.length - 1}개` : '';

  return (
    <div className="board-cell">
      <div className="board-strip">
        <Avatar m={m} size={46} ring={ring} dash={dash} opacity={opacity} />
        <div className="board-strip-name">
          <span>{m.name}</span>
          {isMe && <MeBadge />}
        </div>
        {latest ? (
          <div className="board-strip-entry">
            <Chip tag={latest.tag} variant="xs" />
            {hasStars && <StarsRow n={latest.stars ?? 0} w={55} h={11} />}
            {latest.tag === 'OFF' && <span className="board-strip-off">오늘은 휴식</span>}
          </div>
        ) : (
          <span className="board-strip-empty">{wit.empty}</span>
        )}
      </div>
      <div className="board-row">
        <Avatar m={m} size={40} ring={ring} dash={dash} opacity={opacity} />
        <div className="board-row-main">
          <div className="board-row-name">
            <span className="board-row-nm">{m.name}</span>
            {isMe && <MeBadge sm />}
            {extra && <span className="board-row-extra">{extra}</span>}
          </div>
          <div className="board-row-sub">{subLine}</div>
        </div>
        {latest && (
          <div className="board-row-right">
            <Chip tag={latest.tag} variant="sm" />
            {hasStars && <StarsRow n={latest.stars ?? 0} w={60} h={12} />}
          </div>
        )}
      </div>
    </div>
  );
}

export function Board({ todays, meId, wit }: { todays: Entry[]; meId: MemberId; wit: CopySet }) {
  return (
    <div className="board">
      {MEMBERS.map((m) => (
        <BoardCell key={m.id} m={m} todays={todays} meId={meId} wit={wit} />
      ))}
    </div>
  );
}
