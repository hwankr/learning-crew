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

export function MeBadge() {
  return <span className="me-badge">나</span>;
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

function CrewRow({
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
  const live = isStatusActive(status, now);
  // 오늘 기록도 없고 지금 켜 두지도 않은 사람만 흐리게 — "아직 안 온 자리"가 한눈에 구분된다
  const active = live || !!latest;
  const tags = latest ? entryTags(latest) : [];
  const isOff = isOffTags(tags);
  const hasStars = !!latest && !isOff && (latest.stars ?? 0) > 0;
  const firstTodo = latest && latest.todos.length > 0 ? latest.todos[0]!.t : '';
  const firstBody = latest ? (latest.body || '').split('\n')[0] ?? '' : '';
  const subLine = live
    ? `${wit.placeAt(status.place ?? '기타')} ${status.since ? fmtElapsed(status.since, now) : ''}`.trim()
    : latest
      // 항목 요약은 기록 본문을 먼저 보여 준다 — 할 일은 본문까지 빈 기록의 대체문이다
      ? latest.memo || firstBody || firstTodo || (isOff ? '오늘은 휴식' : '')
      : isMe
        ? wit.emptyMe
        : wit.empty;
  const extra = mine.length > 1 ? `외 ${mine.length - 1}개` : '';

  return (
    <div className="crew-row">
      <LiveAvatar live={live} m={m} size={38} className="crew-av"
        ring={active ? m.color : '#CDD2DB'} dash={active ? '0' : '5 4'}
        opacity={active ? undefined : 0.5} />
      <div className="crew-main">
        <div className="crew-name">
          <span className="crew-nm">{m.name}</span>
          {isMe && <MeBadge />}
          {latest && (
            // 대표 태그 하나만 이름 옆에 세우고 나머지는 +N으로 접는다 — 268px 패널에서
            // 태그를 다 펴면 이름 줄이 통째로 아래로 밀린다
            <span className="board-tags">
              <Chip tag={primaryTag(tags)} variant="sm" />
              {tags.length > 1 && <MoreChip n={tags.length - 1} variant="sm" />}
            </span>
          )}
          {extra && <span className="crew-extra">{extra}</span>}
        </div>
        <div className={'crew-sub' + (live ? ' live' : latest ? ' has' : '')}>{subLine}</div>
      </div>
      {hasStars && <StarsRow n={latest.stars ?? 0} w={60} h={12} />}
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
  // 도장은 기록만이 아니라 "지금 켜 둔 사람"도 찍는다 — 켜 놓고 아직 안 쓴 사람이
  // 0명 쪽에 세어지면 패널의 라이브 점과 숫자가 서로 다른 말을 한다
  const done = MEMBERS.filter(
    (m) => todays.some((e) => e.m === m.id) || isStatusActive(statuses[m.id], now),
  ).length;

  return (
    <div className="crew">
      <div className="crew-head">
        <div className="crew-title">오늘의 크루</div>
        <div className="crew-count">{wit.count(done)}</div>
      </div>
      {MEMBERS.map((m) => (
        <CrewRow key={m.id} m={m} todays={todays} status={statuses[m.id]} now={now} meId={meId} wit={wit} />
      ))}
    </div>
  );
}
