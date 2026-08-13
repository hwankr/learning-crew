import {
  entryTags,
  isOffTags,
  isStatusActive,
  primaryTag,
  type Entry,
  type MemberId,
  type MemberStatus,
} from '../../shared/types';
import { MEMBERS, fmtElapsed, type CopySet, type Member } from '../lib/constants';
import { Avatar, StarsRow } from './icons';
import { Chip, MoreChip } from './Chip';

function MeBadge({ sm }: { sm?: boolean }) {
  return <span className={'me-badge' + (sm ? ' sm' : '')}>나</span>;
}

/** 아바타 + 우하단 라이브 점. */
function LiveAvatar({ live, ...av }: { live: boolean } & Parameters<typeof Avatar>[0]) {
  return (
    <span className="av-wrap">
      <Avatar {...av} />
      {live && <span className="live-dot av" />}
    </span>
  );
}

function BoardCell({
  m, todays, status, now, meId, wit,
}: {
  m: Member;
  todays: Entry[];
  status: MemberStatus | undefined;
  now: number;
  meId: MemberId;
  wit: CopySet;
}) {
  const mine = todays.filter((e) => e.m === m.id).sort((a, b) => b.time.localeCompare(a.time));
  const latest = mine[0];
  const isMe = m.id === meId;
  const ring = latest ? m.color : '#CDD2DB';
  const dash = latest ? '0' : '5 4';
  const opacity = latest ? undefined : 0.55;
  // 보드는 4열이라 폭이 아주 좁다 — 첫 칩 하나만 놓고 나머지는 +N으로 접는다
  const tags = latest ? entryTags(latest) : [];
  const isOff = isOffTags(tags);
  const hasStars = !!latest && !isOff && (latest.stars ?? 0) > 0;
  const firstTodo = latest && latest.todos.length > 0 ? latest.todos[0]!.t : '';
  const live = isStatusActive(status, now);
  const liveLine = live
    ? `${wit.statusPeer(status.place ?? '기타')}${status.since ? ` · ${fmtElapsed(status.since, now)}` : ''}`
    : '';
  const subLine = latest
    ? latest.memo || firstTodo || (latest.body || '').split('\n')[0] || (isOff ? '오늘은 휴식' : '')
    : isMe
      ? wit.emptyMe
      : wit.empty;
  const extra = mine.length > 1 ? `외 ${mine.length - 1}개` : '';

  return (
    <div className="board-cell">
      <div className="board-strip">
        <LiveAvatar live={live} m={m} size={46} ring={ring} dash={dash} opacity={live ? undefined : opacity} />
        <div className="board-strip-name">
          <span>{m.name}</span>
          {isMe && <MeBadge />}
        </div>
        {live && <span className="board-strip-live">{status.place ?? '기타'} 공부 중</span>}
        {latest ? (
          <div className="board-strip-entry">
            <span className="board-tags">
              <Chip tag={primaryTag(tags)} variant="xs" />
              {tags.length > 1 && <MoreChip n={tags.length - 1} variant="xs" />}
            </span>
            {hasStars && <StarsRow n={latest.stars ?? 0} w={55} h={11} />}
            {isOff && <span className="board-strip-off">오늘은 휴식</span>}
          </div>
        ) : (
          !live && <span className="board-strip-empty">{wit.empty}</span>
        )}
      </div>
      <div className="board-row">
        <LiveAvatar live={live} m={m} size={40} ring={ring} dash={dash} opacity={live ? undefined : opacity} />
        <div className="board-row-main">
          <div className="board-row-name">
            <span className="board-row-nm">{m.name}</span>
            {isMe && <MeBadge sm />}
            {extra && <span className="board-row-extra">{extra}</span>}
          </div>
          <div className={'board-row-sub' + (live ? ' live' : '')}>{live ? liveLine : subLine}</div>
        </div>
        {latest && (
          <div className="board-row-right">
            <span className="board-tags">
              <Chip tag={primaryTag(tags)} variant="sm" />
              {tags.length > 1 && <MoreChip n={tags.length - 1} variant="sm" />}
            </span>
            {hasStars && <StarsRow n={latest.stars ?? 0} w={60} h={12} />}
          </div>
        )}
      </div>
    </div>
  );
}

export function Board({
  todays, statuses, now, meId, wit,
}: {
  todays: Entry[];
  statuses: Partial<Record<MemberId, MemberStatus>>;
  now: number;
  meId: MemberId;
  wit: CopySet;
}) {
  return (
    <div className="board">
      {MEMBERS.map((m) => (
        <BoardCell key={m.id} m={m} todays={todays} status={statuses[m.id]} now={now} meId={meId} wit={wit} />
      ))}
    </div>
  );
}
